import { describe, it, expect } from "vitest";
import { hasListFilters, filterQualifiers, listFilterQuery, parseListFilters, applyListFilters, type ListFilters } from "./prListFilters";
import { listQuery, type PrTab } from "./prQuery";
import { parse, serialize } from "./browseState";
import { expectNotInQuery, NASTY } from "./ciTestHelpers";
import { expectQueryOperation } from "./editTestHelpers";

// Module under test: src/lib/prListFilters.ts (stubs until the developer implements them). Requirement VW-8: "List filters on the PR list. Author, assignee, reviewer (review-requested / reviewed-by),
// label, draft or ready, target branch, and free text. Build GitHub search qualifiers for `search(type: ISSUE, query:)`, escaping quotes and spaces. They parse back from and serialise to hash keys.
// Check how `listing.ts` and `prQuery.ts` currently query; reuse the search path if it exists." The search facts (which qualifiers were checked live) and the decisions are in the header of
// src/lib/prListFilters.ts. listing.ts only sorts a folder listing; the search path that exists is prQuery.listQuery.

const ALL: ListFilters = { author: "ada", assignee: "bob", reviewRequested: "cy", reviewedBy: "di", labels: ["bug", "good first issue"], draft: "ready", base: "main", text: "fix typo" };
const TABS: Exclude<PrTab, "mine">[] = ["active", "completed", "abandoned"];

describe("VW-8: hasListFilters", () => {
  it("is false for nothing, empty arrays and blank values", () => {
    expect(hasListFilters({}), "Expected {} to have no filters").toBe(false);
    expect(hasListFilters({ labels: [], author: "  ", text: "" }), "Expected blank values to count as none").toBe(false);
  });

  it("is true when any field has a value", () => {
    for (const f of [{ author: "a" }, { assignee: "a" }, { reviewRequested: "a" }, { reviewedBy: "a" }, { labels: ["x"] }, { draft: "draft" as const }, { base: "main" }, { text: "t" }])
      expect(hasListFilters(f), `Expected ${JSON.stringify(f)} to count`).toBe(true);
  });
});

describe("VW-8: filterQualifiers builds the GitHub search qualifiers", () => {
  it("writes every qualifier in the fixed order, then the free text", () => {
    expect(filterQualifiers(ALL), "Expected author, assignee, review-requested, reviewed-by, labels, draft, base, text").toBe(
      'author:ada assignee:bob review-requested:cy reviewed-by:di label:bug label:"good first issue" draft:false base:main fix typo',
    );
  });

  it("writes draft:true for draft and draft:false for ready", () => {
    expect(filterQualifiers({ draft: "draft" }), "Expected draft:true").toBe("draft:true");
    expect(filterQualifiers({ draft: "ready" }), "Expected draft:false").toBe("draft:false");
  });

  it("gives '' when there is nothing to say", () => {
    expect(filterQualifiers({}), "Expected an empty string").toBe("");
  });

  it("leaves @me, branch names with slashes and plain words unquoted", () => {
    expect(filterQualifiers({ author: "@me", base: "release/1.2", labels: ["bug"] }), "Expected bare values").toBe("author:@me label:bug base:release/1.2");
  });

  it("quotes a value that holds a space, and a colon or comma (a label like 'type: bug')", () => {
    expect(filterQualifiers({ labels: ["help wanted"] }), "Expected a quoted label for a space").toBe('label:"help wanted"');
    expect(filterQualifiers({ labels: ["type: bug"] }), "Expected a quoted label for a colon and a space").toBe('label:"type: bug"');
    expect(filterQualifiers({ labels: ["a,b"] }), "Expected a quoted label for a comma").toBe('label:"a,b"');
  });

  it("escapes a double quote as \\\" and a backslash as \\\\ inside the quotes", () => {
    expect(filterQualifiers({ labels: ['we"ird'] }), "Expected the quote escaped").toBe('label:"we\\"ird"');
    expect(filterQualifiers({ labels: ["back\\slash"] }), "Expected the backslash doubled").toBe('label:"back\\\\slash"');
  });

  it("cannot be talked into another qualifier by a value that contains one", () => {
    expect(filterQualifiers({ author: "ada is:closed repo:other/x" }), "Expected the whole value quoted so it stays one author").toBe('author:"ada is:closed repo:other/x"');
  });

  it("trims values, omits blank ones and lists a repeated label once", () => {
    expect(filterQualifiers({ author: "  ada ", assignee: " ", labels: ["bug", "", " bug ", "docs"] }), "Expected trimmed, de-duplicated qualifiers").toBe("author:ada label:bug label:docs");
  });

  it("drops free-text terms that look like qualifiers, removes double quotes and collapses spaces", () => {
    expect(filterQualifiers({ text: 'fix  "typo" is:closed repo:x/y now' }), "Expected only plain words, as prQuery.listQuery does").toBe("fix typo now");
  });
});

describe("VW-8: listFilterQuery builds the request for a tab", () => {
  it.each(TABS)("%s: searches the repo's pull requests in that tab's state with the filters", (tab) => {
    const tokens = { active: "is:open", completed: "is:merged", abandoned: "is:closed is:unmerged" }[tab];
    const req = listFilterQuery(tab, { owner: "octo", name: "demo", filters: { author: "ada", labels: ["help wanted"] } });
    expect(req.source, "Expected the search entry point").toBe("search");
    expect(req.variables.q, "Expected repo, is:pr, the state tokens, then the qualifiers").toBe(`repo:octo/demo is:pr ${tokens} author:ada label:"help wanted"`);
    expect(req.variables.after, "Expected a null cursor on the first page").toBeNull();
  });

  it("uses the same search query text as prQuery.listQuery's search path, so list rows map identically", () => {
    const viaList = listQuery("active", { owner: "octo", name: "demo", filter: "words" })[0];
    expect(viaList.source, "Fixture check: free text uses the search path").toBe("search");
    const req = listFilterQuery("active", { owner: "octo", name: "demo", filters: { author: "ada" } });
    expect(req.query, "Expected the identical GraphQL text").toBe(viaList.query);
    expectQueryOperation(req);
  });

  it("passes the cursor through", () => {
    expect(listFilterQuery("active", { owner: "o", name: "n", filters: { author: "ada" }, after: "CUR" }).variables.after, "Expected the cursor in variables").toBe("CUR");
  });

  it("appends the free text last and nothing else when the text only contains qualifiers", () => {
    const req = listFilterQuery("active", { owner: "octo", name: "demo", filters: { author: "ada", text: "repo:evil/x is:closed" } });
    expect(req.variables.q, "Expected no injected qualifier and no trailing space").toBe("repo:octo/demo is:pr is:open author:ada");
  });

  it("with no filters is exactly listQuery for the tab", () => {
    for (const tab of TABS) expect(listFilterQuery(tab, { owner: "octo", name: "demo", filters: {}, after: "C" }), `Expected listQuery(${tab}) unchanged`).toEqual(listQuery(tab, { owner: "octo", name: "demo", after: "C" })[0]);
  });

  it("with only free text is exactly listQuery with that filter, so '123' still jumps to PR 123", () => {
    for (const text of ["fix typo", "123", "#45"]) expect(listFilterQuery("active", { owner: "octo", name: "demo", filters: { text } }), `Expected listQuery's own handling of ${JSON.stringify(text)}`).toEqual(listQuery("active", { owner: "octo", name: "demo", filter: text })[0]);
  });

  it("keeps every caller-supplied value out of the query text", () => {
    NASTY.forEach((v) => {
      const req = listFilterQuery("active", { owner: v, name: v, filters: { author: v, assignee: v, labels: [v], base: v, text: v, reviewedBy: v, reviewRequested: v }, after: v });
      expectNotInQuery(req, [v]);
    });
  });
});

describe("VW-8: the filters in the hash", () => {
  it("reads every key", () => {
    const hash = "#repo=o%2Fr&view=prs&author=ada&assignee=bob&reviewRequested=cy&reviewedBy=di&label=bug&label=good%20first%20issue&draft=ready&base=main&text=fix%20typo";
    expect(parseListFilters(hash), "Expected all the filters back").toEqual(ALL);
  });

  it("reads draft=draft and returns only the fields present", () => {
    expect(parseListFilters("#draft=draft&author=ada"), "Expected just draft and author").toEqual({ draft: "draft", author: "ada" });
  });

  it("drops blank values and an unknown draft value, and accepts ##", () => {
    expect(parseListFilters("##author=&label=&draft=maybe&base=%20"), "Expected nothing").toEqual({});
    expect(parseListFilters("##author=ada"), "Expected the doubled # to be accepted").toEqual({ author: "ada" });
  });

  it("caps the text at 200 characters, as the Branches name search does", () => {
    expect(parseListFilters(`#text=${"x".repeat(300)}`).text, "Expected 200 characters").toHaveLength(200);
  });

  it("never throws on garbage", () => {
    expect(parseListFilters("%%%&=&&label"), "Expected {} for garbage").toEqual({});
  });

  it("writes this module's keys last, in order, one label key each, encoded, keeping the other segments verbatim", () => {
    expect(applyListFilters("#repo=o%2Fr&path=a%20b&view=prs", ALL), "Expected the existing segments untouched and the filter keys appended").toBe(
      "#repo=o%2Fr&path=a%20b&view=prs&author=ada&assignee=bob&reviewRequested=cy&reviewedBy=di&label=bug&label=good%20first%20issue&draft=ready&base=main&text=fix%20typo",
    );
  });

  it("replaces earlier filter keys and removes cleared ones", () => {
    expect(applyListFilters("#view=prs&author=old&label=x&label=y&pr=3", { author: "ada", labels: ["bug"] }), "Expected old filter keys replaced and pr kept").toBe("#view=prs&pr=3&author=ada&label=bug");
    expect(applyListFilters("#view=prs&author=ada&label=x", {}), "Expected all filter keys removed").toBe("#view=prs");
  });

  it("starts with # even when the hash did not", () => {
    expect(applyListFilters("view=prs", { base: "main" }), "Expected a leading #").toBe("#view=prs&base=main");
  });

  it("round-trips awkward values", () => {
    NASTY.forEach((v) => {
      const f: ListFilters = { author: v, assignee: v, reviewRequested: v, reviewedBy: v, labels: [v], base: v, text: v };
      expect(parseListFilters(applyListFilters("#view=prs", f)), `Expected ${JSON.stringify(v)} to survive the hash`).toEqual(f);
    });
  });

  it("does not disturb browseState, and browseState does not disturb it", () => {
    const state = { repo: "octo/demo", view: "prs" as const, prTab: "active" as const };
    const hash = applyListFilters(serialize(state), ALL);
    expect(parse(hash), "Expected browseState to read the same state back (no key collision)").toEqual(state);
    expect(parseListFilters(hash), "Expected the filters back").toEqual(ALL);
  });
});

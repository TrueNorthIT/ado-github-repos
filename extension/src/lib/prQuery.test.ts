import { describe, it, expect } from "vitest";
import { listQuery, detailQuery, PAGE_SIZE, PrTab } from "./prQuery";

// Module under test: src/lib/prQuery.ts (listQuery, detailQuery).
// Shared rule, as in commits.ts: caller-supplied values (owner, name, filter, cursor) travel in `variables`;
// the query text is constant for a given tab/source and never contains them.
// Conventions fixed by these tests:
//  - listQuery always returns an array: one request, or two for Mine.
//  - repository.pullRequests requests carry variables { owner, name, states, after } with states as PullRequestState enums.
//  - search requests carry variables { q, after }; q is "repo:owner/name is:pr <state tokens> <terms>".
//  - a number filter gives one request with source "pullRequest" and variables { owner, name, number }.
//  - an absent cursor is sent as null.

const base = { owner: "acme", name: "web" };
const norm = (s: string) => s.replace(/\s+/g, " ");
const tokens = (q: unknown) => String(q).split(/\s+/).filter(Boolean);
const NASTY = ['we"ird', "back\\slash", "ünï cødé 日本", "sp ace #hash", "q{uery}", "$var"];

describe("PR-4: Active, Completed and Abandoned list pull requests by state", () => {
  // Given no filter, listQuery("active"|"completed"|"abandoned") makes one repository.pullRequests request.
  it.each([
    ["active", ["OPEN"]],
    ["completed", ["MERGED"]],
    ["abandoned", ["CLOSED"]],
  ] as [PrTab, string[]][])("%s tab asks repository.pullRequests for states %j", (tab, states) => {
    const reqs = listQuery(tab, base);
    expect(reqs, `Expected exactly one request for the ${tab} tab`).toHaveLength(1);
    expect(reqs[0].source, "Expected an unfiltered tab to read repository.pullRequests").toBe("pullRequests");
    expect(reqs[0].variables.states, `Expected ${tab} to map to PullRequestState ${states}`).toEqual(states);
    expect(reqs[0].variables).toMatchObject({ owner: "acme", name: "web" });
  });

  // Abandoned = "closed and not merged". GitHub's CLOSED state excludes MERGED, so MERGED must never be requested.
  it("abandoned never requests merged pull requests", () => {
    const [req] = listQuery("abandoned", base);
    expect(req.variables.states, "Expected Abandoned to exclude MERGED").not.toContain("MERGED");
    expect(req.variables.states, "Expected Abandoned to include CLOSED").toContain("CLOSED");
  });

  // Newest activity first, 25 per page.
  it("orders by UPDATED_AT descending and fetches 25 per page", () => {
    const [req] = listQuery("active", base);
    const q = norm(req.query);
    expect(PAGE_SIZE, "Expected page size 25").toBe(25);
    expect(q, "Expected states to be bound to the $states variable").toMatch(/states:\s*\$states/);
    expect(q, "Expected orderBy UPDATED_AT").toMatch(/orderBy:\s*\{\s*field:\s*UPDATED_AT,\s*direction:\s*DESC\s*\}/);
    expect(q, "Expected first: 25").toMatch(/first:\s*25\b/);
    expect(q, "Expected the cursor to come from $after").toMatch(/after:\s*\$after/);
  });
});

describe("PR-3: Other tabs page through results", () => {
  // The cursor from the previous page goes in the `after` variable; the first page sends null.
  it("sends the supplied cursor in the after variable", () => {
    const [req] = listQuery("active", { ...base, after: "Y3Vyc29yOjI1" });
    expect(req.variables.after, "Expected the cursor to be passed as variables.after").toBe("Y3Vyc29yOjI1");
  });

  it("sends a null after variable on the first page", () => {
    const [req] = listQuery("completed", base);
    expect(req.variables.after ?? null, "Expected no cursor on the first page").toBeNull();
  });

  it("passes the cursor on search requests too", () => {
    const [req] = listQuery("active", { ...base, filter: "login", after: "abc==" });
    expect(req.variables.after, "Expected the cursor on the search variables").toBe("abc==");
  });
});

describe("PR-3: The title-or-number filter", () => {
  // A text filter uses search(query: $q, type: ISSUE) with q = "repo:acme/web is:pr <state tokens> <terms>".
  it("a text filter searches with repo, is:pr, the state token and the terms", () => {
    const [req] = listQuery("active", { ...base, filter: "login bug" });
    expect(req.source, "Expected a text filter to use the search API").toBe("search");
    expect(norm(req.query), "Expected search(query: $q, type: ISSUE)").toMatch(/search\(\s*query:\s*\$q,\s*type:\s*ISSUE/);
    const t = tokens(req.variables.q);
    expect(t[0], "Expected the repo qualifier first so the search stays inside the selected repo").toBe("repo:acme/web");
    expect(t, "Expected is:pr").toContain("is:pr");
    expect(t, "Expected is:open for Active").toContain("is:open");
    expect(t.slice(-2), "Expected the user's terms last").toEqual(["login", "bug"]);
  });

  it("completed searches is:merged", () => {
    const t = tokens(listQuery("completed", { ...base, filter: "x" })[0].variables.q);
    expect(t, "Expected is:merged for Completed").toContain("is:merged");
    expect(t, "Expected Completed not to ask for is:open").not.toContain("is:open");
  });

  it("abandoned searches is:closed and is:unmerged", () => {
    const t = tokens(listQuery("abandoned", { ...base, filter: "x" })[0].variables.q);
    expect(t, "Expected is:closed for Abandoned").toContain("is:closed");
    expect(t, "Expected is:unmerged for Abandoned (closed and not merged)").toContain("is:unmerged");
    expect(t, "Expected Abandoned not to ask for is:merged").not.toContain("is:merged");
  });

  // Decision: a blank or whitespace-only filter is no filter.
  it("a blank filter falls back to repository.pullRequests", () => {
    const [req] = listQuery("active", { ...base, filter: "   " });
    expect(req.source, "Expected a whitespace-only filter to be ignored").toBe("pullRequests");
  });

  // Decision: the filter is free text. Qualifiers (anything containing ":") are dropped so a user cannot widen the
  // search beyond the selected repo (e.g. "repo:other/x") or change the state (e.g. "is:closed").
  it("drops qualifiers from the filter so the search cannot leave the selected repo", () => {
    const [req] = listQuery("active", { ...base, filter: "repo:other/thing is:closed login" });
    const t = tokens(req.variables.q);
    expect(t.filter((x) => x.startsWith("repo:")), "Expected only the selected repo qualifier").toEqual(["repo:acme/web"]);
    expect(t, "Expected the injected is:closed to be dropped").not.toContain("is:closed");
    expect(t[t.length - 1], "Expected the plain word to survive").toBe("login");
  });

  // "123" or "#123" fetches that PR directly, whatever the tab.
  it.each(["123", "#123", "  #123 "])("number filter %j fetches pull request 123 directly", (filter) => {
    const reqs = listQuery("completed", { ...base, filter });
    expect(reqs, "Expected one request for a number filter").toHaveLength(1);
    expect(reqs[0].source, "Expected a number filter to read repository.pullRequest").toBe("pullRequest");
    expect(reqs[0].variables, "Expected owner, name and a numeric number variable").toMatchObject({ owner: "acme", name: "web", number: 123 });
  });

  it.each(["123abc", "12 34", "#", "0", "-5"])("%j is not a number filter, so it is searched as text", (filter) => {
    const [req] = listQuery("active", { ...base, filter });
    expect(req.source, `Expected ${JSON.stringify(filter)} to use search, not a direct fetch`).not.toBe("pullRequest");
  });
});

describe("PR-3: Mine has two sections", () => {
  // Mine = "Created by me" (author:@me, open) and "Review requested" (review-requested:@me, open): two searches.
  it("makes a created-by-me search and a review-requested search, both open and in this repo", () => {
    const reqs = listQuery("mine", base);
    expect(reqs, "Expected two requests for Mine").toHaveLength(2);
    const created = reqs.find((r) => r.section === "created");
    const review = reqs.find((r) => r.section === "review-requested");
    expect(created, "Expected a request with section 'created'").toBeDefined();
    expect(review, "Expected a request with section 'review-requested'").toBeDefined();
    for (const r of reqs) {
      expect(r.source, "Expected Mine to use search").toBe("search");
      const t = tokens(r.variables.q);
      expect(t, "Expected repo scope").toContain("repo:acme/web");
      expect(t, "Expected is:pr").toContain("is:pr");
      expect(t, "Expected only open pull requests").toContain("is:open");
    }
    expect(tokens(created!.variables.q), "Expected author:@me in the created search").toContain("author:@me");
    expect(tokens(review!.variables.q), "Expected review-requested:@me in the review search").toContain("review-requested:@me");
  });

  it("ignores the filter and cursor on Mine", () => {
    const reqs = listQuery("mine", { ...base, filter: "login", after: "abc" });
    expect(reqs, "Expected still two requests").toHaveLength(2);
    for (const r of reqs) {
      expect(String(r.variables.q), "Expected the filter text not to reach the Mine search").not.toContain("login");
      expect(r.variables.after ?? null, "Expected no cursor on Mine").toBeNull();
    }
  });
});

describe("Query text never contains user-supplied strings", () => {
  // Same guarantee as commits.ts: owner, name, filter and cursor are variables only.
  it.each(["mine", "active", "completed", "abandoned"] as PrTab[])("%s: owner, name, filter and cursor stay out of the query text", (tab) => {
    for (const weird of NASTY) {
      const reqs = listQuery(tab, { owner: `o${weird}`, name: `n${weird}`, filter: `f${weird}`, after: `a${weird}` });
      for (const r of reqs) {
        for (const probe of [`o${weird}`, `n${weird}`, `f${weird}`, `a${weird}`, weird]) {
          expect(r.query, `Expected ${JSON.stringify(probe)} not to appear in the ${tab} query text`).not.toContain(probe);
        }
      }
    }
  });

  it("a number filter's request has no user text in the query either", () => {
    const [r] = listQuery("active", { owner: 'o"x', name: "n{y}", filter: "#123" });
    expect(r.query, "Expected owner not in query").not.toContain('o"x');
    expect(r.query, "Expected name not in query").not.toContain("n{y}");
    expect(r.query, "Expected the number not in the query text").not.toContain("123");
  });

  it("the owner and name reach the search only through the q variable", () => {
    const [r] = listQuery("active", { owner: "a.b-c", name: "d_e", filter: "x" });
    expect(tokens(r.variables.q)[0], "Expected repo:owner/name inside q").toBe("repo:a.b-c/d_e");
  });
});

describe("PR-5, PR-6: detailQuery", () => {
  it("passes owner, name and number as variables", () => {
    const d = detailQuery({ owner: 'o"x', name: "n{y}", number: 42 });
    expect(d.variables, "Expected exactly owner, name and a numeric number").toEqual({ owner: 'o"x', name: "n{y}", number: 42 });
    expect(d.query, "Expected owner not in the query text").not.toContain('o"x');
    expect(d.query, "Expected name not in the query text").not.toContain("n{y}");
  });

  it("is a single GraphQL operation", () => {
    const d = detailQuery({ ...base, number: 7 });
    const ops = d.query.match(/\b(query|mutation|subscription)\b/g) ?? [];
    expect(ops, "Expected one operation keyword, so one request fetches the whole page").toEqual(["query"]);
  });
});

describe("detailQuery: review requests for bots and teams", () => {
  // Live bug (0.25.0): a requested Copilot review (a Bot) and team requests came back as {} because only
  // `... on User` was selected, so the Reviewers panel never showed them.
  const q = detailQuery({ owner: "o", name: "r", number: 1 }).query.replace(/\s+/g, " ");
  it("selects Bot reviewers' login and avatar", () => expect(q).toMatch(/requestedReviewer \{.*\.\.\. on Bot \{ login avatarUrl \}/));
  it("selects Team reviewers as login: name", () => expect(q).toMatch(/\.\.\. on Team \{ login: name avatarUrl \}/));
});

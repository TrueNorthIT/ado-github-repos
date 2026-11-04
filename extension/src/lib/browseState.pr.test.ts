import { describe, it, expect } from "vitest";
import { parse, serialize, BrowseState } from "./browseState";

// Module under test: src/lib/browseState.ts (parse, serialize), extended for the Pull requests page.
// New hash keys: view=prs, prTab=mine|active|completed|abandoned, pr=<positive integer>, prPage=overview|files|updates|commits|checks, file=<path>.
// Rules fixed here (the brief left them open):
//  - All PR keys need a repo (as everything in this module does) and view=prs; without view=prs they are dropped.
//  - prPage and file are only honoured together with pr.
//  - Invalid values are dropped one by one; the rest of the state survives.
//  - `file` is normalised exactly like `path` (no leading slash, no ".." segments).
// Existing file-browser behaviour is covered by browseState.test.ts and must not change.

const roundTrip = (s: BrowseState) => parse(serialize(s));
const hasDotDot = (p: string) => p.split("/").includes("..");

describe("PR-1: Pull requests view and tab in the hash", () => {
  it("round-trips view=prs on its own", () => {
    expect(roundTrip({ repo: "acme/web", view: "prs" }), "Expected the PR list view to survive a round trip").toEqual({ repo: "acme/web", view: "prs" });
  });

  it.each(["mine", "active", "completed", "abandoned"] as const)("round-trips prTab=%s", (prTab) => {
    const s: BrowseState = { repo: "acme/web", view: "prs", prTab };
    expect(roundTrip(s), `Expected tab ${prTab} to survive`).toEqual(s);
  });

  it("writes the documented keys", () => {
    const h = serialize({ repo: "acme/web", view: "prs", prTab: "completed", pr: 123, prPage: "files", file: "src/a.ts" });
    const kv: Record<string, string> = {};
    h.replace(/^#/, "").split("&").forEach((pair) => { const [k, v] = pair.split("="); kv[k] = decodeURIComponent(v); });
    expect(kv, "Expected the hash to use the keys view, prTab, pr, prPage and file").toMatchObject({
      repo: "acme/web", view: "prs", prTab: "completed", pr: "123", prPage: "files", file: "src/a.ts",
    });
  });

  it("parses a hand-written hash", () => {
    expect(parse("#repo=acme%2Fweb&view=prs&prTab=abandoned"), "Expected view and tab from a typed hash").toEqual({ repo: "acme/web", view: "prs", prTab: "abandoned" });
  });

  it("drops an unknown prTab but keeps the view", () => {
    expect(parse("#repo=acme/web&view=prs&prTab=merged"), "Expected the invalid tab dropped").toEqual({ repo: "acme/web", view: "prs" });
  });

  it("drops an unknown view value", () => {
    expect(parse("#repo=acme/web&view=issues&prTab=active"), "Expected view=issues and the PR keys dropped").toEqual({ repo: "acme/web" });
  });

  it("drops the PR keys when view=prs is absent", () => {
    expect(parse("#repo=acme/web&prTab=active&pr=5&prPage=files&file=a.ts"), "Expected PR keys ignored without view=prs").toEqual({ repo: "acme/web" });
  });

  it("drops the PR keys when there is no repo", () => {
    expect(parse("#view=prs&prTab=active&pr=5"), "Expected {} without a repo, as before").toEqual({});
  });
});

describe("PR-5: A pull request page in the hash", () => {
  it("round-trips pr as a number", () => {
    const out = roundTrip({ repo: "acme/web", view: "prs", pr: 123 });
    expect(out, "Expected pr 123 to survive").toEqual({ repo: "acme/web", view: "prs", pr: 123 });
    expect(typeof out.pr, "Expected pr to be a number, not a string").toBe("number");
  });

  it.each(["overview", "files", "commits", "checks"] as const)("round-trips prPage=%s", (prPage) => {
    const s: BrowseState = { repo: "acme/web", view: "prs", pr: 7, prPage };
    expect(roundTrip(s), `Expected page ${prPage} to survive`).toEqual(s);
  });

  it("drops an unknown prPage but keeps the pull request", () => {
    expect(parse("#repo=acme/web&view=prs&pr=7&prPage=builds"), "Expected the invalid page dropped").toEqual({ repo: "acme/web", view: "prs", pr: 7 });
  });

  it("drops prPage when there is no pr", () => {
    expect(parse("#repo=acme/web&view=prs&prPage=files"), "Expected prPage ignored without a pull request").toEqual({ repo: "acme/web", view: "prs" });
  });

  it("keeps the list tab alongside a pull request so Back can return to it", () => {
    const s: BrowseState = { repo: "acme/web", view: "prs", prTab: "completed", pr: 9, prPage: "commits" };
    expect(roundTrip(s), "Expected tab, pr and page together").toEqual(s);
  });
});

describe("PR-5: pr must be a positive integer", () => {
  it.each(["0", "-1", "1.5", "abc", "", "12abc", "1e3", " 5", "007", "99999999999999999999"])("drops pr=%j", (pr) => {
    const out = parse(`#repo=acme/web&view=prs&pr=${encodeURIComponent(pr)}`);
    expect(out, `Expected pr=${JSON.stringify(pr)} dropped and the rest kept`).toEqual({ repo: "acme/web", view: "prs" });
  });

  it("accepts a large but safe integer", () => {
    expect(parse("#repo=acme/web&view=prs&pr=2147483647").pr, "Expected 2147483647 accepted").toBe(2147483647);
  });

  it.each([0, -3, 1.5, NaN, Infinity])("serialize leaves out an invalid pr (%s) so the hash stays parseable", (pr) => {
    expect(roundTrip({ repo: "acme/web", view: "prs", pr }), "Expected no pr after a round trip").toEqual({ repo: "acme/web", view: "prs" });
  });
});

describe("PR-8: The selected file in the hash", () => {
  it("round-trips a file path with spaces, ampersands and non-ASCII characters", () => {
    const s: BrowseState = { repo: "acme/web", view: "prs", pr: 5, prPage: "files", file: "src/my docs/a&b #1 ü.ts" };
    expect(roundTrip(s), "Expected the file path to survive encoding").toEqual(s);
  });

  it("normalises file like path: no leading slash, no .. segments", () => {
    const out = parse("#repo=acme/web&view=prs&pr=5&prPage=files&file=" + encodeURIComponent("/a/../../b/./c.ts"));
    expect(out.file, "Expected file normalised to b/c.ts").toBe("b/c.ts");
    expect(hasDotDot(out.file ?? ""), "Expected no .. segment").toBe(false);
  });

  it("drops a file that normalises to nothing", () => {
    expect(parse("#repo=acme/web&view=prs&pr=5&file=" + encodeURIComponent("../..")), "Expected an empty path dropped").toEqual({ repo: "acme/web", view: "prs", pr: 5 });
  });

  it("drops file when there is no pr", () => {
    expect(parse("#repo=acme/web&view=prs&file=a.ts"), "Expected file ignored without a pull request").toEqual({ repo: "acme/web", view: "prs" });
  });
});

describe("B-8: Existing file-browser state is unaffected", () => {
  // Regression guards: these pass before the work and must still pass after it.
  it("a file-browser hash parses to exactly the old fields, with no PR keys added", () => {
    const out = parse("#repo=acme%2Fweb&ref=main&path=src%2Findex.ts&tab=preview");
    expect(out, "Expected only repo, ref, path and tab").toStrictEqual({ repo: "acme/web", ref: "main", path: "src/index.ts", tab: "preview" });
  });

  it("a file-browser state serialises to the same hash as before", () => {
    expect(serialize({ repo: "acme/web", ref: "main", path: "src/index.ts" }), "Expected no PR keys in the hash").toBe("#repo=acme%2Fweb&ref=main&path=src%2Findex.ts");
  });

  it("the PR view can carry the repo's ref and path without disturbing them", () => {
    const s: BrowseState = { repo: "acme/web", ref: "feature/x", path: "docs", view: "prs", pr: 3 };
    expect(roundTrip(s), "Expected ref and path to coexist with the PR keys").toEqual(s);
  });

  it("serialising without a repo still gives the bare hash", () => {
    expect(serialize({ view: "prs", pr: 3 }), "Expected '#' with no repo").toBe("#");
  });
});

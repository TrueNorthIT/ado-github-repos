import { describe, it, expect } from "vitest";
import { parse, serialize, type BrowseState } from "./browseState";

// Batch R1 keys: commit, commitTab, parent, branchTab, q and the repo-list view.
const roundTrip = (s: BrowseState) => parse(serialize(s));
const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("R1: commit detail state", () => {
  it("round-trips a full SHA, a prefix, the tab and the parent", () => {
    expect(roundTrip({ repo: "acme/web", commit: SHA, commitTab: "details", parent: 2 })).toEqual({ repo: "acme/web", commit: SHA, commitTab: "details", parent: 2 });
    expect(roundTrip({ repo: "acme/web", commit: "a1b2c3d" })).toEqual({ repo: "acme/web", commit: "a1b2c3d" });
  });

  it("keeps the branch the commit list was on", () => {
    expect(roundTrip({ repo: "acme/web", ref: "feature/x", commit: "abcd" })).toEqual({ repo: "acme/web", ref: "feature/x", commit: "abcd" });
  });

  it("lower-cases the SHA", () => {
    expect(parse("#repo=acme%2Fweb&commit=ABCD12").commit).toBe("abcd12");
  });

  it.each(["abc", "xyz123", "a".repeat(41), "abcd;drop", ""])("drops %j as a commit", (c) => {
    expect(parse(`#repo=acme%2Fweb&commit=${encodeURIComponent(c)}`).commit).toBeUndefined();
  });

  it("only honours commitTab and parent together with a commit", () => {
    expect(parse("#repo=acme%2Fweb&commitTab=details&parent=2")).toEqual({ repo: "acme/web" });
    expect(parse(`#repo=acme%2Fweb&commit=abcd&commitTab=nope&parent=0`)).toEqual({ repo: "acme/web", commit: "abcd" });
  });

  it("does not write a commit that is not a SHA", () => {
    expect(serialize({ repo: "acme/web", commit: "main" })).toBe("#repo=acme%2Fweb");
  });
});

describe("R1: branches and search state", () => {
  it.each(["mine", "all", "stale"] as const)("round-trips branchTab %s", (branchTab) => {
    expect(roundTrip({ repo: "acme/web", branchTab })).toEqual({ repo: "acme/web", branchTab });
  });

  it("drops an unknown branchTab", () => {
    expect(parse("#repo=acme%2Fweb&branchTab=old").branchTab).toBeUndefined();
  });

  it("round-trips a search with awkward characters, trimmed", () => {
    expect(roundTrip({ repo: "acme/web", q: "feature/a&b #1" })).toEqual({ repo: "acme/web", q: "feature/a&b #1" });
    expect(roundTrip({ repo: "acme/web", q: "  x  " }).q).toBe("x");
  });

  it("omits a blank search", () => {
    expect(serialize({ repo: "acme/web", q: "   " })).toBe("#repo=acme%2Fweb");
  });
});

describe("R1: the repository list view", () => {
  it("round-trips view=repos without a repo", () => {
    expect(serialize({ view: "repos" })).toBe("#view=repos");
    expect(parse("#view=repos")).toEqual({ view: "repos" });
  });

  it("ignores view=repos next to a repo", () => {
    expect(parse("#repo=acme%2Fweb&view=repos")).toEqual({ repo: "acme/web" });
  });

  it("leaves an empty hash as the empty state", () => {
    expect(parse("#")).toEqual({});
    expect(serialize({})).toBe("#");
  });
});

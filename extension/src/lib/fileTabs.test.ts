import { describe, it, expect } from "vitest";
import { tabsFor, resolveTab, parseAgainst, applyAgainst } from "./fileTabs";
import { parse, serialize } from "./browseState";

describe("tabsFor", () => {
  it("a file has Contents, History, Compare and Blame", () => {
    expect(tabsFor("file", false)).toEqual(["contents", "history", "compare", "blame"]);
  });
  it("a markdown file also has Preview, after Contents", () => {
    expect(tabsFor("file", true)).toEqual(["contents", "preview", "history", "compare", "blame"]);
  });
  it("a folder has only Contents and History", () => {
    expect(tabsFor("folder", false)).toEqual(["contents", "history"]);
  });
});

describe("resolveTab", () => {
  it("keeps a tab the view offers", () => {
    expect(resolveTab("blame", "file", false)).toBe("blame");
    expect(resolveTab("history", "folder", false)).toBe("history");
  });
  it("falls back to Contents when the tab is not offered (compare on a folder, preview on code, unknown)", () => {
    expect(resolveTab("compare", "folder", false)).toBe("contents");
    expect(resolveTab("blame", "folder", false)).toBe("contents");
    expect(resolveTab("preview", "file", false)).toBe("contents");
    expect(resolveTab("nonsense", "file", false)).toBe("contents");
    expect(resolveTab(undefined, "file", false)).toBe("contents");
  });
  it("opens a markdown file on Preview unless another tab was asked for, as before", () => {
    expect(resolveTab(undefined, "file", true)).toBe("preview");
    expect(resolveTab("contents", "file", true)).toBe("contents");
    expect(resolveTab("history", "file", true)).toBe("history");
  });
});

describe("against (the Compare tab's other ref)", () => {
  const base = "#repo=o%2Fn&path=a.ts&tab=compare";
  it("round trips awkward ref names", () => {
    for (const r of ["main", "feature/x", 'we"ird', "sp ace #hash", "ünï"]) expect(parseAgainst(applyAgainst(base, r)), r).toBe(r);
  });
  it("replaces an earlier value and keeps other segments in order", () => {
    expect(applyAgainst(`${base}&against=old`, "new")).toBe(`${base}&against=new`);
  });
  it("removes it for an undefined or blank ref", () => {
    expect(applyAgainst(`${base}&against=old`, undefined)).toBe(base);
    expect(applyAgainst(`${base}&against=old`, "  ")).toBe(base);
  });
  it("parseAgainst is undefined when absent or blank, and caps at 255", () => {
    expect(parseAgainst(base)).toBeUndefined();
    expect(parseAgainst(`${base}&against=`)).toBeUndefined();
    expect(parseAgainst(`${base}&against=${"a".repeat(400)}`)).toHaveLength(255);
  });
  it("never throws on a broken hash", () => {
    expect(() => parseAgainst("#%E0%A4%A&against=%")).not.toThrow();
  });
  it("browseState keeps the tab key and ignores against (no collision)", () => {
    expect(parse(applyAgainst(base, "main"))).toEqual({ repo: "o/n", path: "a.ts", tab: "compare" });
    expect(applyAgainst(serialize(parse(applyAgainst(base, "main"))), "main")).toBe(applyAgainst(base, "main"));
  });
  it("round trips the new tab names through browseState", () => {
    for (const tab of ["history", "compare", "blame"]) expect(parse(serialize({ repo: "o/n", path: "a.ts", tab })).tab).toBe(tab);
  });
});

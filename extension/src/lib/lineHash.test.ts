import { describe, it, expect } from "vitest";
import { applyLines, copyLinkText, parseLines, selectionLines, withLines } from "./lineHash";
import { parse } from "./browseState";

describe("parseLines", () => {
  it("reads line and lineEnd", () => {
    expect(parseLines("#repo=a/b&path=x.ts&line=5&lineEnd=9")).toEqual({ line: 5, lineEnd: 9 });
  });
  it("a single line ends where it starts; a reversed range is put in order", () => {
    expect(parseLines("#line=7")).toEqual({ line: 7, lineEnd: 7 });
    expect(parseLines("#line=9&lineEnd=5")).toEqual({ line: 5, lineEnd: 9 });
  });
  it("ignores garbage, zero, negatives and a missing line", () => {
    for (const h of ["", "#", "#line=0", "#line=-3", "#line=abc", "#lineEnd=4", "#line=1e3", "#line=%"]) expect(parseLines(h)).toBeNull();
  });
  it("a bad lineEnd falls back to the line", () => {
    expect(parseLines("#line=3&lineEnd=x")).toEqual({ line: 3, lineEnd: 3 });
  });
});

describe("applyLines", () => {
  it("adds the keys after the others and replaces old ones (and native's column keys)", () => {
    expect(applyLines("#repo=a/b&line=1&lineStartColumn=1&path=x", { line: 4, lineEnd: 6 })).toBe("#repo=a/b&path=x&line=4&lineEnd=6");
  });
  it("leaves out lineEnd for one line, and removes the keys for null", () => {
    expect(applyLines("#repo=a/b", { line: 4, lineEnd: 4 })).toBe("#repo=a/b&line=4");
    expect(applyLines("#repo=a/b&line=4&lineEnd=8", null)).toBe("#repo=a/b");
  });
  it("round-trips through parseLines, and browseState still reads the rest", () => {
    const h = applyLines("#repo=a/b&path=src/x.ts", { line: 10, lineEnd: 12 });
    expect(parseLines(h)).toEqual({ line: 10, lineEnd: 12 });
    expect(parse(h)).toEqual({ repo: "a/b", path: "src/x.ts" });
  });
});

describe("withLines", () => {
  it("sets the keys on a full hub URL's hash", () => {
    expect(withLines("https://dev.azure.com/o/p/_apps/hub/x#repo=a/b&path=f", { line: 2, lineEnd: 3 })).toBe("https://dev.azure.com/o/p/_apps/hub/x#repo=a/b&path=f&line=2&lineEnd=3");
    expect(withLines("https://x/y", { line: 2, lineEnd: 2 })).toBe("https://x/y#line=2");
  });
});

describe("selectionLines", () => {
  it("a caret is its own line", () => {
    expect(selectionLines({ startLineNumber: 4, endLineNumber: 4, endColumn: 9 })).toEqual({ line: 4, lineEnd: 4 });
  });
  it("whole lines selected down to column 1 of the next line do not take that line", () => {
    expect(selectionLines({ startLineNumber: 3, endLineNumber: 6, endColumn: 1 })).toEqual({ line: 3, lineEnd: 5 });
    expect(selectionLines({ startLineNumber: 3, endLineNumber: 6, endColumn: 2 })).toEqual({ line: 3, lineEnd: 6 });
  });
});

describe("copyLinkText", () => {
  it("says what the link points at", () => {
    expect(copyLinkText(null)).toBe("Copy link");
    expect(copyLinkText({ line: 5, lineEnd: 5 })).toBe("Copy link to line 5");
    expect(copyLinkText({ line: 5, lineEnd: 9 })).toBe("Copy link to lines 5–9");
  });
});

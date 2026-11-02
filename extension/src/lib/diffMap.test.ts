import { describe, it, expect } from "vitest";
import { afterModifiedLine, type LineChange } from "./diffMap";

const ch = (os: number, oe: number, ms: number, me: number): LineChange => ({ originalStartLineNumber: os, originalEndLineNumber: oe, modifiedStartLineNumber: ms, modifiedEndLineNumber: me });

describe("AF-6: a comment on a base line in the inline diff", () => {
  it("is unchanged with no changes above it", () => {
    expect(afterModifiedLine(5, [])).toBe(5);
    expect(afterModifiedLine(5, [ch(10, 10, 10, 10)])).toBe(5);
  });
  it("shifts by the net lines added above it", () => {
    // original 3-4 became modified 3-6 (+2): original line 10 is modified line 12
    expect(afterModifiedLine(10, [ch(3, 4, 3, 6)])).toBe(12);
    // a pure insertion of 3 lines after original line 2
    expect(afterModifiedLine(10, [ch(2, 0, 3, 5)])).toBe(13);
    // a pure deletion of 2 lines (original 4-5)
    expect(afterModifiedLine(10, [ch(4, 5, 3, 0)])).toBe(8);
  });
  it("goes after the replacement when the line itself was replaced", () => {
    expect(afterModifiedLine(12, [ch(12, 12, 12, 13)])).toBe(13);
  });
  it("goes after the line following a pure deletion", () => {
    expect(afterModifiedLine(5, [ch(5, 6, 4, 0)])).toBe(5);
  });
});

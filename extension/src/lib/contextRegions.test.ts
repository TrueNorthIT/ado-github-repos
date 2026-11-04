import { describe, it, expect } from "vitest";
import { actionLabel, applyExpand, expandActions, hiddenCount, hiddenRange, NOTHING_REVEALED, unchangedRegions, type UnchangedRegion } from "./contextRegions";
import type { LineChange } from "./diffMap";

const ch = (os: number, oe: number, ms: number, me: number): LineChange => ({ originalStartLineNumber: os, originalEndLineNumber: oe, modifiedStartLineNumber: ms, modifiedEndLineNumber: me });

describe("VW-12: the unchanged regions a diff collapses", () => {
  it("collapses nothing when there are no changes", () => {
    expect(unchangedRegions([], 100, 100)).toEqual([]);
  });

  it("keeps three lines of context beside a change, none at the file's ends", () => {
    // line 50 of 100 changed in place
    expect(unchangedRegions([ch(50, 50, 50, 50)], 100, 100)).toEqual([
      { modifiedStart: 1, originalStart: 1, count: 46, atStart: true, atEnd: false }, // 1-46, context 47-49
      { modifiedStart: 54, originalStart: 54, count: 47, atStart: false, atEnd: true }, // context 51-53, then 54-100
    ]);
  });

  it("collapses a gap between two changes, minus context on both sides", () => {
    const r = unchangedRegions([ch(10, 10, 10, 10), ch(40, 40, 40, 40)], 50, 50);
    expect(r[1]).toEqual({ modifiedStart: 14, originalStart: 14, count: 23, atStart: false, atEnd: false }); // 11-39 less 3+3
  });

  it("leaves a gap open when fewer than three lines would hide", () => {
    // gap 11-18 is 8 lines: 3 + 2 + 3, so only 2 would hide
    const r = unchangedRegions([ch(10, 10, 10, 10), ch(19, 19, 19, 19)], 22, 22);
    expect(r.map((x) => x.modifiedStart)).toEqual([1]); // the top run (1-6); the end run is 20-22, all context
  });

  it("follows insertions and deletions in both numberings", () => {
    // 3 lines inserted after original line 20 (modified 21-23); later original 60-61 deleted (after modified 62)
    const r = unchangedRegions([ch(20, 0, 21, 23), ch(60, 61, 62, 0)], 100, 101);
    expect(r).toEqual([
      { modifiedStart: 1, originalStart: 1, count: 17, atStart: true, atEnd: false },
      { modifiedStart: 27, originalStart: 24, count: 33, atStart: false, atEnd: false }, // original 21-59, modified 24-62
      { modifiedStart: 66, originalStart: 65, count: 36, atStart: false, atEnd: true }, // original 62-100, modified 63-101
    ]);
  });

  it("handles a change on the first and the last line", () => {
    expect(unchangedRegions([ch(1, 1, 1, 1), ch(30, 30, 30, 30)], 30, 30)).toEqual([{ modifiedStart: 5, originalStart: 5, count: 22, atStart: false, atEnd: false }]);
  });
});

const R = (count: number, over: Partial<UnchangedRegion> = {}): UnchangedRegion => ({ modifiedStart: 10, originalStart: 8, count, atStart: false, atEnd: false, ...over });

describe("VW-12: expanding a region", () => {
  it("opens a small region whole with one click", () => {
    expect(expandActions(R(20), NOTHING_REVEALED)).toEqual(["all"]);
    expect(actionLabel("all", 1)).toBe("Show 1 hidden line");
    expect(actionLabel("all", 12)).toBe("Show 12 hidden lines");
  });

  it("offers 20 more above, 20 more below and all for a larger one", () => {
    expect(expandActions(R(21), NOTHING_REVEALED)).toEqual(["above", "below", "all"]);
    expect(actionLabel("above", 50)).toBe("Show 20 more above");
    expect(actionLabel("below", 50)).toBe("Show 20 more below");
    expect(actionLabel("all", 50)).toBe("Show all 50 lines");
  });

  it("offers no 'above' at the top of the file and no 'below' at the end", () => {
    expect(expandActions(R(40, { atStart: true }), NOTHING_REVEALED)).toEqual(["below", "all"]);
    expect(expandActions(R(40, { atEnd: true }), NOTHING_REVEALED)).toEqual(["above", "all"]);
  });

  it("reveals from the top for 'above' and from the bottom for 'below'", () => {
    const r = R(50);
    let v = applyExpand(r, NOTHING_REVEALED, "above");
    expect(v).toEqual({ top: 20, bottom: 0 });
    expect(hiddenRange(r, v)).toEqual({ modified: [30, 59], original: [28, 57] });
    v = applyExpand(r, v, "below");
    expect(v).toEqual({ top: 20, bottom: 20 });
    expect(hiddenRange(r, v)).toEqual({ modified: [30, 39], original: [28, 37] });
    expect(expandActions(r, v)).toEqual(["all"]); // ten left: one click
    v = applyExpand(r, v, "all");
    expect(hiddenCount(r, v)).toBe(0);
    expect(hiddenRange(r, v)).toBeNull();
    expect(expandActions(r, v)).toEqual([]);
  });

  it("never reveals more lines than are hidden", () => {
    const r = R(25);
    const v = applyExpand(r, { top: 10, bottom: 0 }, "below");
    expect(v).toEqual({ top: 10, bottom: 15 });
    expect(hiddenCount(r, v)).toBe(0);
  });
});

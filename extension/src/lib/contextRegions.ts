// VW-12: the unchanged regions a diff collapses, and how much of each the reader has expanded.
// Monaco's own hideUnchangedRegions hides its controls in thin click-or-drag strips, so the diff hides the lines itself
// (setHiddenAreas) and draws GitHub's expand row: small gaps open with one click, larger ones offer 20 more above,
// 20 more below or all of them. This module is the maths; monacoChunk applies it.
import type { LineChange } from "./diffMap";

/** Lines of unchanged context kept beside each change, as GitHub's patches and Monaco's default do. */
export const CONTEXT_LINES = 3;
/** A gap is only collapsed when this many lines or more would be hidden. */
export const MIN_HIDDEN = 3;
/** How many lines one "Show more" reveals. Gaps this small or smaller open whole with one click. */
export const REVEAL_STEP = 20;

/** One collapsible run of unchanged lines (the context lines beside changes are not part of it). */
export interface UnchangedRegion {
  /** First hidden line in the modified (head) file, 1-based. */
  modifiedStart: number;
  /** The same line in the original (base) file. */
  originalStart: number;
  /** Number of lines in the run. */
  count: number;
  /** The run starts at the top of the file, so there is nothing above it to grow from. */
  atStart: boolean;
  /** The run reaches the end of the file, so there is nothing below it. */
  atEnd: boolean;
}

/** How much of a region is shown: lines revealed at its top (under the change above) and at its bottom (over the change below). */
export interface Reveal {
  top: number;
  bottom: number;
}
export const NOTHING_REVEALED: Reveal = { top: 0, bottom: 0 };

/**
 * The regions to collapse, from Monaco's line changes and the two files' line counts. Each gap between changes keeps
 * `context` lines next to a change (none at the file's ends) and is collapsed when at least `minHidden` lines remain.
 * No changes at all gives no regions: an identical file (a whitespace-only change with whitespace ignored) is shown whole.
 */
export function unchangedRegions(changes: readonly LineChange[], originalCount: number, modifiedCount: number, context = CONTEXT_LINES, minHidden = MIN_HIDDEN): UnchangedRegion[] {
  if (!changes.length) return [];
  const out: UnchangedRegion[] = [];
  let o = 1, m = 1; // the first line of the current gap in each file
  const gap = (oEnd: number, mEnd: number, atStart: boolean, atEnd: boolean) => {
    const len = Math.min(mEnd - m, oEnd - o);
    const top = atStart ? 0 : context;
    const bottom = atEnd ? 0 : context;
    const count = len - top - bottom;
    if (count >= minHidden) out.push({ modifiedStart: m + top, originalStart: o + top, count, atStart, atEnd });
  };
  changes.forEach((c, i) => {
    // A zero end means the side has no lines; the start is then the line before the change.
    const oStart = c.originalEndLineNumber ? c.originalStartLineNumber : c.originalStartLineNumber + 1;
    const mStart = c.modifiedEndLineNumber ? c.modifiedStartLineNumber : c.modifiedStartLineNumber + 1;
    gap(oStart, mStart, i === 0, false);
    o = c.originalEndLineNumber ? c.originalEndLineNumber + 1 : oStart;
    m = c.modifiedEndLineNumber ? c.modifiedEndLineNumber + 1 : mStart;
  });
  gap(originalCount + 1, modifiedCount + 1, false, true);
  return out;
}

/** Lines of the region still hidden. */
export const hiddenCount = (r: UnchangedRegion, v: Reveal) => Math.max(0, r.count - v.top - v.bottom);

/** The hidden part of the region as inclusive line ranges in both files, or null once it is all shown. */
export function hiddenRange(r: UnchangedRegion, v: Reveal): { modified: [number, number]; original: [number, number] } | null {
  const n = hiddenCount(r, v);
  if (!n) return null;
  return { modified: [r.modifiedStart + v.top, r.modifiedStart + v.top + n - 1], original: [r.originalStart + v.top, r.originalStart + v.top + n - 1] };
}

export type ExpandAction = "above" | "below" | "all";

/**
 * What the region's row offers. A small remainder (at most `step` lines) opens whole, so the row itself is the one action.
 * Otherwise 20 more above (not for a run at the top of the file: nothing sits above it), 20 more below (not at the end), and all.
 */
export function expandActions(r: UnchangedRegion, v: Reveal, step = REVEAL_STEP): ExpandAction[] {
  const n = hiddenCount(r, v);
  if (!n) return [];
  if (n <= step) return ["all"];
  return [...(r.atStart ? [] : ["above" as const]), ...(r.atEnd ? [] : ["below" as const]), "all"];
}

/** The reveal after one action. "above" grows from the top of the hidden run (just under the row's upper edge), "below" from its bottom. */
export function applyExpand(r: UnchangedRegion, v: Reveal, action: ExpandAction, step = REVEAL_STEP): Reveal {
  const n = hiddenCount(r, v);
  if (action === "all") return { top: v.top, bottom: v.bottom + n };
  const k = Math.min(step, n);
  return action === "above" ? { top: v.top + k, bottom: v.bottom } : { top: v.top, bottom: v.bottom + k };
}

/** The row's label for an action. */
export function actionLabel(action: ExpandAction, hidden: number, step = REVEAL_STEP): string {
  if (action === "above") return `Show ${step} more above`;
  if (action === "below") return `Show ${step} more below`;
  return hidden <= step ? `Show ${hidden} hidden ${hidden === 1 ? "line" : "lines"}` : `Show all ${hidden} lines`;
}

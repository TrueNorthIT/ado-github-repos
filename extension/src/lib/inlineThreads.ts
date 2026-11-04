// Places review threads on the Files diff (AF-6).
import type { ThreadItem } from "./feedModel";

export type InlineThread = Pick<ThreadItem, "id" | "path" | "line" | "startLine" | "side" | "outdated">;

export interface InlineAnchor {
  line: number;
  side: "LEFT" | "RIGHT";
  /** Threads sharing this line and side, in input order. */
  threadIds: string[];
}

/** Anchors per file path, ascending by line, LEFT before RIGHT on the same line. Outdated threads and threads with a null line are left out. */
export function threadsByFile(threads: InlineThread[]): Map<string, InlineAnchor[]> {
  const map = new Map<string, InlineAnchor[]>();
  for (const t of threads) {
    if (t.outdated || t.line == null) continue;
    const list = map.get(t.path) ?? [];
    map.set(t.path, list);
    const hit = list.find((a) => a.line === t.line && a.side === t.side);
    if (hit) hit.threadIds.push(t.id);
    else list.push({ line: t.line, side: t.side, threadIds: [t.id] });
  }
  for (const list of map.values()) list.sort((a, b) => a.line - b.line || (a.side === b.side ? 0 : a.side === "LEFT" ? -1 : 1));
  return map;
}

/** CM-6: the lines a multi-line thread covers, marked in the diff's gutter (the thread itself sits under the last one). */
export interface ThreadRange {
  side: "LEFT" | "RIGHT";
  startLine: number;
  endLine: number;
}

/** Ranges per file path for threads that span more than one line. Outdated threads and single-line ones are left out; duplicates are merged. */
export function threadRanges(threads: InlineThread[]): Map<string, ThreadRange[]> {
  const map = new Map<string, ThreadRange[]>();
  for (const t of threads) {
    if (t.outdated || t.line == null || t.startLine == null || t.startLine === t.line) continue;
    const r = { side: t.side, startLine: Math.min(t.startLine, t.line), endLine: Math.max(t.startLine, t.line) };
    const list = map.get(t.path) ?? [];
    map.set(t.path, list);
    if (!list.some((x) => x.side === r.side && x.startLine === r.startLine && x.endLine === r.endLine)) list.push(r);
  }
  return map;
}

/** "line 12", or "lines 12–18" for a range (native ADO's wording), or "" with no line. `capital` starts it with a capital letter. */
export function linesLabel(t: { line: number | null; startLine?: number | null }, capital = false): string {
  if (t.line == null) return "";
  const s = t.startLine != null && t.startLine !== t.line ? `lines ${Math.min(t.startLine, t.line)}–${Math.max(t.startLine, t.line)}` : `line ${t.line}`;
  return capital ? s[0].toUpperCase() + s.slice(1) : s;
}

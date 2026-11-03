// A link to a line or range of a file in the Files hub. Native Repos writes `line`, `lineEnd`, `lineStartColumn`, `lineEndColumn`
// and `lineStyle=plain` into its URL; we keep the two line keys (whole lines, as native highlights them).
// browseState.parse drops these keys, so they are read from and written to the raw hash (hostNav's useHashExtras), as fileTabs' `against` is.
// A navigation inside the hub (another file, a tab) serialises a fresh hash, which drops them: the highlight belongs to the link that was opened.

export interface LineRange {
  /** 1-based first line. */
  line: number;
  /** 1-based last line, >= line. */
  lineEnd: number;
}

const KEYS = ["line", "lineEnd", "lineStartColumn", "lineEndColumn", "lineStyle"];
const MAX = 10_000_000;
const num = (v: string | null) => (v && /^[1-9]\d{0,7}$/.test(v) ? Number(v) : 0);

/** The lines of a hash, or null when it names none. `lineEnd` defaults to `line`; a reversed range is put in order. Never throws. */
export function parseLines(hash: string): LineRange | null {
  try {
    const p = new URLSearchParams(hash.replace(/^#+/, ""));
    const a = num(p.get("line"));
    if (!a || a > MAX) return null;
    const b = num(p.get("lineEnd")) || a;
    return { line: Math.min(a, b), lineEnd: Math.max(a, b) };
  } catch {
    return null;
  }
}

/** `hash` with the line keys replaced (or removed for null); other segments keep their order. Starts with "#". */
export function applyLines(hash: string, r: LineRange | null): string {
  const kept = hash.replace(/^#+/, "").split("&").filter((x) => x && !KEYS.includes(x.split("=")[0]));
  if (r && r.line >= 1) {
    const a = Math.min(r.line, r.lineEnd), b = Math.max(r.line, r.lineEnd);
    kept.push(`line=${a}`);
    if (b !== a) kept.push(`lineEnd=${b}`);
  }
  return "#" + kept.join("&");
}

/** A full hub URL with the line keys set on its hash. */
export function withLines(url: string, r: LineRange | null): string {
  const i = url.indexOf("#");
  return i < 0 ? url + applyLines("", r) : url.slice(0, i) + applyLines(url.slice(i), r);
}

/** The selection Monaco reports (1-based lines; a selection ending at column 1 of the next line does not take that line). */
export function selectionLines(s: { startLineNumber: number; endLineNumber: number; endColumn: number }): LineRange {
  const end = s.endLineNumber > s.startLineNumber && s.endColumn === 1 ? s.endLineNumber - 1 : s.endLineNumber;
  return { line: s.startLineNumber, lineEnd: Math.max(s.startLineNumber, end) };
}

/** The menu text: "Copy link", "Copy link to line 5" or "Copy link to lines 5–9". */
export function copyLinkText(r: LineRange | null): string {
  if (!r) return "Copy link";
  return r.line === r.lineEnd ? `Copy link to line ${r.line}` : `Copy link to lines ${r.line}–${r.lineEnd}`;
}

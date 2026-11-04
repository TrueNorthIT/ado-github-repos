// The code a review thread sits on, as the feed shows it above the first comment (native ADO and GitHub both do).
// Source: PullRequestReviewComment.diffHunk, the hunk up to and including the commented line. It can hold more than one `@@` header when the comment's
// position runs past the first hunk; numbering restarts at each header, and the context never reaches back across one.

export interface HunkRow {
  kind: "context" | "add" | "del";
  /** Line number on the base side; null for an added line. */
  oldLine: number | null;
  /** Line number on the head side; null for a deleted line. */
  newLine: number | null;
  text: string;
}

export interface HunkAnchor {
  /** The thread's end line; for an outdated thread, pass its originalLine. */
  line: number | null;
  side: "LEFT" | "RIGHT";
  /** First line of a range comment (null or absent for one line). */
  startLine?: number | null;
  /** Side of startLine when it differs from `side` (a range from a deleted line to an added one). */
  startSide?: "LEFT" | "RIGHT" | null;
}

const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Every body line of the hunk, numbered, split into segments at each `@@` header. "\ No newline at end of file" is not a line. */
function parse(diffHunk: string): HunkRow[][] {
  const segments: HunkRow[][] = [];
  let rows: HunkRow[] | null = null;
  let oldN = 0, newN = 0;
  for (const raw of diffHunk.split(/\r?\n/)) {
    const h = HEADER.exec(raw);
    if (h) {
      segments.push((rows = []));
      oldN = Number(h[1]);
      newN = Number(h[2]);
      continue;
    }
    if (!rows || raw.startsWith("\\")) continue;
    const mark = raw[0];
    const text = raw.slice(1);
    if (mark === "+") rows.push({ kind: "add", oldLine: null, newLine: newN++, text });
    else if (mark === "-") rows.push({ kind: "del", oldLine: oldN++, newLine: null, text });
    else if (mark === " " || raw === "") rows.push({ kind: "context", oldLine: oldN++, newLine: newN++, text });
  }
  // A trailing empty string from a final newline is not a line.
  const last = segments[segments.length - 1];
  if (last?.length && diffHunk.endsWith("\n") && last[last.length - 1].kind === "context" && last[last.length - 1].text === "") last.pop();
  return segments;
}

const numberOn = (r: HunkRow, side: "LEFT" | "RIGHT") => (side === "LEFT" ? r.oldLine : r.newLine);

/**
 * The rows to show for a thread: from its start line (or `context - 1` lines before its line) to its line, inclusive, never crossing a hunk header.
 * The end row is the last row numbered `line` on `side`; when no row is (a hunk that does not reach it), the hunk's last row stands in, since GitHub ends the hunk
 * at the commented line. A start line that is not found falls back to the usual context. Empty for an empty or header-only hunk.
 */
export function hunkContext(diffHunk: string | undefined, a: HunkAnchor, context = 4): HunkRow[] {
  const segments = parse(diffHunk ?? "").filter((s) => s.length);
  if (!segments.length) return [];
  let seg = segments[segments.length - 1];
  let end = seg.length - 1;
  if (a.line != null) {
    for (let s = segments.length - 1, found = false; s >= 0 && !found; s--) {
      for (let i = segments[s].length - 1; i >= 0; i--) {
        if (numberOn(segments[s][i], a.side) === a.line) {
          seg = segments[s];
          end = i;
          found = true;
          break;
        }
      }
    }
  }
  let start = Math.max(0, end - (context - 1));
  if (a.startLine != null && a.startLine !== a.line) {
    const side = a.startSide ?? a.side;
    for (let i = end; i >= 0; i--) {
      if (numberOn(seg[i], side) === a.startLine) {
        start = i;
        break;
      }
    }
  }
  return seg.slice(start, end + 1);
}

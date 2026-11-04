// CSV and TSV files as tables: the Files hub's Preview tab and the "Rendered" view of a changed file in a PR or commit diff.
//
// Parsing follows RFC 4180, leniently, as GitHub does: fields are split on the delimiter; a field that starts with a double quote runs to
// the closing quote and may hold delimiters, CR/LF and doubled quotes (""); records end at CRLF, LF or a lone CR; a final line break does
// not start an empty record, nor does a blank line; a UTF-8 byte-order mark is dropped. Anything after a closing quote up to the next delimiter is kept as text,
// and an unterminated quote runs to the end of the file, so malformed input still parses rather than throwing. TSV uses the same rules with a tab.

import type { DiffView } from "./richDiff";

/** Rows shown at most, in the preview and in each side of a diff. */
export const MAX_TABLE_ROWS = 5000;

const ext = (path: string) => /\.([^./]+)$/.exec(path)?.[1].toLowerCase() ?? "";

/** The delimiter for a .csv or .tsv path, else null (not a table). */
export function tableDelimiter(path: string): "," | "\t" | null {
  const e = ext(path);
  return e === "csv" ? "," : e === "tsv" ? "\t" : null;
}

/** A diff of a table offers the source diff and the rendered table diff, opening on the source (reviewers comment on lines), as markdown does. */
export const TABLE_DIFF_VIEWS: { views: DiffView[]; default: DiffView } = { views: ["source", "rendered"], default: "source" };

export interface ParsedTable {
  rows: string[][];
  /** Records in the file; more than rows.length when it was cut at maxRows. */
  total: number;
  truncated: boolean;
}

/** Parses delimited text into records (see the header). Stops collecting after `maxRows` records but keeps counting them. */
export function parseTable(text: string, delimiter: string = ",", maxRows = Infinity): ParsedTable {
  const rows: string[][] = [];
  let total = 0;
  let row: string[] = [];
  let field = "";
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  let fieldStarted = false; // anything seen in this record, so "" at end of input is not a record
  const endRecord = () => {
    row.push(field);
    if (total < maxRows) rows.push(row);
    total++;
    row = [];
    field = "";
    fieldStarted = false;
  };
  while (i < n) {
    const c = text[i];
    if (c === '"' && field === "") {
      // quoted field
      fieldStarted = true;
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) {
          field += text.slice(i);
          i = n;
          break;
        }
        field += text.slice(i, q);
        if (text[q + 1] === '"') {
          field += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      fieldStarted = true;
      i++;
    } else if (c === "\r" || c === "\n") {
      if (fieldStarted || row.length) endRecord(); // a blank line is not a record
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += c;
      fieldStarted = true;
      i++;
    }
  }
  if (fieldStarted || field !== "" || row.length) endRecord();
  return { rows, total, truncated: total > rows.length };
}

// ---------- the table diff ----------

export type RowChange =
  | { kind: "same"; cells: string[]; oldIndex: number; newIndex: number }
  | { kind: "added"; cells: string[]; newIndex: number }
  | { kind: "removed"; cells: string[]; oldIndex: number }
  /** Same position in a run of edits: `cells` is the new row, `oldCells` the old one, `changed` the column indexes that differ. */
  | { kind: "changed"; cells: string[]; oldCells: string[]; changed: number[]; oldIndex: number; newIndex: number };

/** Above this many before x after rows the LCS is skipped and the middle is one run of edits (keeps a big diff from freezing the page). */
export const MAX_LCS_CELLS = 4_000_000;

const key = (r: string[]) => JSON.stringify(r);

/** Column indexes whose text differs (a missing cell counts as ""). */
export function changedColumns(a: string[], b: string[]): number[] {
  const out: number[] = [];
  for (let c = 0; c < Math.max(a.length, b.length); c++) if ((a[c] ?? "") !== (b[c] ?? "")) out.push(c);
  return out;
}

/** How far ahead in a run of added rows a removed row looks for its edited self. */
export const PAIR_WINDOW = 50;

/** Share of cells two rows have in common (by position), 0 to 1. */
export function similarity(a: string[], b: string[]): number {
  const w = Math.max(a.length, b.length);
  if (!w) return 1;
  let same = 0;
  for (let c = 0; c < w; c++) if ((a[c] ?? "") === (b[c] ?? "")) same++;
  return same / w;
}

/**
 * Row diff of two tables: a longest-common-subsequence match on whole rows; within each run of edits a removed row and an added row that share
 * at least half their cells pair up as "changed" (with the differing columns), and the rest are "removed" or "added". Indexes are 0-based into the inputs.
 */
export function diffTables(before: string[][], after: string[][]): RowChange[] {
  const n = before.length;
  const m = after.length;
  // Common head and tail first: the usual edit touches a few rows of a long file.
  let head = 0;
  while (head < n && head < m && key(before[head]) === key(after[head])) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && key(before[n - 1 - tail]) === key(after[m - 1 - tail])) tail++;
  const a = before.slice(head, n - tail).map(key);
  const b = after.slice(head, m - tail).map(key);

  // Matched pairs (i, j) within the middle, in order.
  const pairs: [number, number][] = [];
  if (a.length && b.length && a.length * b.length <= MAX_LCS_CELLS) {
    const w = b.length + 1;
    const len = new Uint32Array((a.length + 1) * w);
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--) len[i * w + j] = a[i] === b[j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) pairs.push([i++, j++]);
      else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) i++;
      else j++;
    }
  }

  const out: RowChange[] = [];
  for (let k = 0; k < head; k++) out.push({ kind: "same", cells: after[k], oldIndex: k, newIndex: k });
  let i = 0;
  let j = 0;
  // A run of edits: a removed row pairs with the next added row (within PAIR_WINDOW) that shares at least half its cells, as "changed";
  // rows that find no partner stay "removed" or "added". So an edited record pairs with its new self, not with whatever sits at its position.
  const flush = (iEnd: number, jEnd: number) => {
    for (; i < iEnd; i++) {
      const oi = head + i;
      let hit = -1;
      for (let k = j; k < Math.min(jEnd, j + PAIR_WINDOW); k++) if (similarity(before[oi], after[head + k]) >= 0.5) { hit = k; break; }
      if (hit < 0) {
        out.push({ kind: "removed", cells: before[oi], oldIndex: oi });
        continue;
      }
      for (; j < hit; j++) out.push({ kind: "added", cells: after[head + j], newIndex: head + j });
      const ni = head + j++;
      out.push({ kind: "changed", cells: after[ni], oldCells: before[oi], changed: changedColumns(before[oi], after[ni]), oldIndex: oi, newIndex: ni });
    }
    for (; j < jEnd; j++) out.push({ kind: "added", cells: after[head + j], newIndex: head + j });
  };
  for (const [pi, pj] of pairs) {
    flush(pi, pj);
    out.push({ kind: "same", cells: after[head + pj], oldIndex: head + pi, newIndex: head + pj });
    i++;
    j++;
  }
  flush(a.length, b.length);
  for (let k = 0; k < tail; k++) out.push({ kind: "same", cells: after[m - tail + k], oldIndex: n - tail + k, newIndex: m - tail + k });
  return out;
}

/** The widest row's cell count. */
export const columnCount = (rows: string[][]) => rows.reduce((w, r) => Math.max(w, r.length), 0);

/** Pixels for a column whose longest text has `chars` characters: roughly 7px a character plus padding, between 72 and 320. */
export const widthFor = (chars: number) => Math.max(72, Math.min(320, chars * 7 + 32));

/** A column width from the longest text in the first 200 rows (and the header). */
export function columnWidth(rows: string[][], col: number, header?: string): number {
  let longest = header?.length ?? 0;
  for (let r = 0; r < Math.min(rows.length, 200); r++) longest = Math.max(longest, (rows[r][col] ?? "").length);
  return widthFor(longest);
}

/** A table diff's column width: an edited cell shows the old and the new text side by side, so it counts both and the gap. First 200 rows. */
export function diffColumnWidth(rows: RowChange[], col: number, header?: string): number {
  let longest = header?.length ?? 0;
  for (let r = 0; r < Math.min(rows.length, 200); r++) {
    const row = rows[r];
    const len = row.kind === "changed" && row.changed.includes(col) ? (row.oldCells[col] ?? "").length + (row.cells[col] ?? "").length + 4 : (row.cells[col] ?? "").length;
    longest = Math.max(longest, len);
  }
  return widthFor(longest);
}

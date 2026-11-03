// R2 AS-6, the code snippet under a code scanning alert. STUB: the developer implements it. Every function throws "Not implemented".

export interface SnippetLine {
  /** 1-based line number in the file. */
  number: number;
  text: string;
  /** True for the lines of the alert's range. */
  target: boolean;
}

/**
 * The lines of `text` from `startLine - context` to `endLine + context` (1-based, inclusive, default context 3), each marked `target` when it lies in startLine..endLine.
 * Lines end at LF or CRLF and carry no CR; a final newline does not add an empty last line; empty text has no lines.
 * `endLine` defaults to `startLine` and is raised to it when smaller. Everything is clamped to the file: a range that overlaps the file marks only the lines that exist;
 * a start line that is not a positive integer or lies beyond the last line gives no lines at all.
 */
export function codeSnippet(text: string, startLine: number, endLine?: number, context = 3): SnippetLine[] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  if (!Number.isInteger(startLine) || startLine < 1 || startLine > lines.length) return [];
  const end = Math.max(startLine, endLine ?? startLine);
  const from = Math.max(1, startLine - context);
  const to = Math.min(lines.length, end + context);
  const out: SnippetLine[] = [];
  for (let n = from; n <= to; n++) out.push({ number: n, text: lines[n - 1], target: n >= startLine && n <= end });
  return out;
}

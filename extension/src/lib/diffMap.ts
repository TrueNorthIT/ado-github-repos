// Where a comment on an ORIGINAL (base) line goes in an inline diff, whose only editor shows the modified file (AF-6).
/** Monaco's legacy ILineChange. A zero end line means none: a pure insertion has no original lines, a pure deletion no modified ones, and the start line is then the line before. */
export interface LineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

/**
 * The modified-file line a zone for original line `line` goes after. Monaco draws deleted lines as a block above the
 * replacement and puts a zone on the same line above that block, so a comment on a deleted line goes after the replacement
 * (or after the line following a pure deletion); any other line is shifted by the changes above it.
 */
export function afterModifiedLine(line: number, changes: readonly LineChange[]): number {
  let shift = 0;
  for (const c of changes) {
    const oLen = c.originalEndLineNumber ? c.originalEndLineNumber - c.originalStartLineNumber + 1 : 0;
    const mLen = c.modifiedEndLineNumber ? c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1 : 0;
    const first = oLen ? c.originalStartLineNumber : c.originalStartLineNumber + 1;
    if (line < first) break;
    if (line < first + oLen) return mLen ? c.modifiedEndLineNumber : c.modifiedStartLineNumber + 1;
    shift += mLen - oLen;
  }
  return line + shift;
}

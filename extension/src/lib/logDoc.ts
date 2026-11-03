// The text and styling the log viewer gives Monaco, from parsed lines (ACT-7). Pure, so it is testable without Monaco.
import type { AnsiSpan, LogLine } from "./workflowLog";

export interface LogMark { line: number; start: number; end: number; span: AnsiSpan }

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const clock = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)} `;

/** One document line per log line (so Monaco line numbers equal log line numbers). `start`/`end` are 1-based columns, end exclusive. Unstyled spans make no mark. */
export function buildLogDoc(lines: LogLine[], showTimestamps: boolean): { text: string; marks: LogMark[]; errors: number[] } {
  const out: string[] = [];
  const marks: LogMark[] = [];
  const errors: number[] = [];
  for (const l of lines) {
    const prefix = showTimestamps ? (l.ts ? clock(l.ts) : " ".repeat(13)) : "";
    out.push(prefix + l.text);
    if (l.kind === "error") errors.push(l.n);
    let col = prefix.length + 1;
    for (const s of l.spans) {
      if (s.fg !== undefined || s.bg !== undefined || s.bold || s.italic || s.underline) marks.push({ line: l.n, start: col, end: col + s.text.length, span: s });
      col += s.text.length;
    }
  }
  return { text: out.join("\n"), marks, errors };
}

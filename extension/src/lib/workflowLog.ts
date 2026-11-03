// Job log parsing for the Actions log view (ACT-7, ACT-8). FROZEN CONTRACT (2026-11-03); bodies are filled in against workflowLog.test.ts.
//
// A GitHub job log (GET .../actions/jobs/{id}/logs) is one text for the whole job. Each line starts with an ISO timestamp and a space,
// e.g. "2026-11-03T08:53:44.2746422Z ##[group]Run npm ci". Workflow commands seen in logs: ##[group], ##[endgroup], ##[error], ##[warning],
// ##[notice], ##[debug], ##[command], ##[section]. Text may contain ANSI SGR escapes (ESC [ ... m). A UTF-8 BOM may start the text.
// Lines end in \n or \r\n.

export type LogKind = "normal" | "group" | "endgroup" | "error" | "warning" | "notice" | "debug" | "command" | "section";

/** A run of text with one style. Colours are the SGR palette index 0-255 (30-37 -> 0-7, 90-97 -> 8-15, 38;5;n -> n) or "#rrggbb" for 38;2;r;g;b. */
export interface AnsiSpan {
  text: string;
  fg?: number | string;
  bg?: number | string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface LogLine {
  /** 1-based line number in the job log. */
  n: number;
  /** The leading timestamp, when the line has one. */
  ts?: Date;
  kind: LogKind;
  /** The text with the timestamp, the ##[kind] marker and ANSI escapes removed. */
  text: string;
  spans: AnsiSpan[];
  /** How many groups the line is inside (a group's own header line has the depth outside it). */
  depth: number;
}

/** Splits SGR escapes into styled spans. Unknown or non-SGR escapes are removed. 0 resets; 39/49 reset fg/bg; 22/23/24 unset bold/italic/underline.
 *  Adjacent text with the same style is merged; empty spans are dropped; "" -> []. */
export function ansiSpans(text: string): AnsiSpan[] { throw new Error("not implemented"); }

/** Parses the whole log. An empty text -> []. A trailing newline does not make an extra line. */
export function parseLog(text: string): LogLine[] { throw new Error("not implemented"); }

/** Foldable ranges: each ##[group] line to its matching ##[endgroup] (inclusive line numbers). An unclosed group runs to the last line. Nested groups nest. */
export function foldRanges(lines: LogLine[]): { start: number; end: number }[] { throw new Error("not implemented"); }

/** Assigns lines to steps by timestamp: a line belongs to the last step whose startedAt is at or before the line's ts. Lines before the first
 *  step, or without a ts, follow the previous line's step (the first ones go to the first step). Returns step number -> [first, last] line
 *  numbers, for steps that got any lines. Steps without startedAt get none. */
export function stepRanges(lines: LogLine[], steps: { number: number; startedAt?: Date }[]): Map<number, [number, number]> { throw new Error("not implemented"); }

/** Counts by kind, for the log toolbar ("3 errors, 1 warning"). */
export function logCounts(lines: LogLine[]): { errors: number; warnings: number } { throw new Error("not implemented"); }

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

const CSI = /\[([0-9;?]*)([ -/]*)([@-~])/g;
const KINDS = new Set(["group", "endgroup", "error", "warning", "notice", "debug", "command", "section"]);
const TS = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?Z ?/;

/** Splits SGR escapes into styled spans. Unknown or non-SGR escapes are removed. 0 resets; 39/49 reset fg/bg; 22/23/24 unset bold/italic/underline.
 *  Adjacent text with the same style is merged; empty spans are dropped; "" -> []. */
export function ansiSpans(text: string): AnsiSpan[] {
  const out: AnsiSpan[] = [];
  let st: Omit<AnsiSpan, "text"> = {};
  const push = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.fg === st.fg && last.bg === st.bg && !last.bold === !st.bold && !last.italic === !st.italic && !last.underline === !st.underline) last.text += t;
    else out.push({ text: t, ...st });
  };
  const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  let pos = 0;
  CSI.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = CSI.exec(text)); ) {
    push(text.slice(pos, m.index));
    pos = m.index + m[0].length;
    if (m[3] !== "m" || m[1].includes("?") || m[2]) continue;
    const p = m[1] === "" ? [0] : m[1].split(";").map((x) => (x === "" ? 0 : Number(x)));
    st = { ...st };
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === 0) st = {};
      else if (c === 1) st.bold = true;
      else if (c === 3) st.italic = true;
      else if (c === 4) st.underline = true;
      else if (c === 22) delete st.bold;
      else if (c === 23) delete st.italic;
      else if (c === 24) delete st.underline;
      else if (c >= 30 && c <= 37) st.fg = c - 30;
      else if (c >= 90 && c <= 97) st.fg = c - 90 + 8;
      else if (c >= 40 && c <= 47) st.bg = c - 40;
      else if (c >= 100 && c <= 107) st.bg = c - 100 + 8;
      else if (c === 39) delete st.fg;
      else if (c === 49) delete st.bg;
      else if (c === 38 || c === 48) {
        const key = c === 38 ? "fg" : "bg";
        if (p[i + 1] === 5) { st[key] = p[i + 2]; i += 2; }
        else if (p[i + 1] === 2) { st[key] = "#" + hex(p[i + 2]) + hex(p[i + 3]) + hex(p[i + 4]); i += 4; }
      }
    }
  }
  push(text.slice(pos));
  return out;
}

/** Parses the whole log. An empty text -> []. A trailing newline does not make an extra line. */
export function parseLog(text: string): LogLine[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text) return [];
  const raw = text.split(/\r?\n/);
  if (raw[raw.length - 1] === "") raw.pop();
  let depth = 0;
  return raw.map((r, i) => {
    let ts: Date | undefined;
    const t = TS.exec(r);
    if (t) {
      ts = new Date(`${t[1]}${(t[2] ?? "").slice(0, 4)}Z`);
      r = r.slice(t[0].length);
    }
    let kind: LogKind = "normal";
    const k = /^##\[(\w+)\]/.exec(r);
    if (k && KINDS.has(k[1])) {
      kind = k[1] as LogKind;
      r = r.slice(k[0].length);
    }
    const spans = ansiSpans(r);
    let d = depth;
    if (kind === "group") depth++;
    else if (kind === "endgroup") d = depth = Math.max(0, depth - 1);
    return { n: i + 1, ts, kind, text: spans.map((s) => s.text).join(""), spans, depth: d };
  });
}

/** Foldable ranges: each ##[group] line to its matching ##[endgroup] (inclusive line numbers). An unclosed group runs to the last line. Nested groups nest. */
export function foldRanges(lines: LogLine[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const open: number[] = [];
  for (const l of lines) {
    if (l.kind === "group") open.push(l.n);
    else if (l.kind === "endgroup" && open.length) out.push({ start: open.pop()!, end: l.n });
  }
  const last = lines.length ? lines[lines.length - 1].n : 0;
  for (const s of open) out.push({ start: s, end: last });
  return out;
}

export interface LogStep {
  number: number;
  startedAt?: Date;
  /** With names, steps are anchored on the runner's own markers (see stepRanges); without, by timestamp alone. */
  name?: string;
  conclusion?: string | null;
}

const SETUP_STEP = "Set up job";
const COMPLETE_STEP = "Complete job";
/** Step starts are whole seconds; a marker line may be stamped a moment before the step's recorded start. */
const SLACK_MS = 1000;

/** Step number -> [first, last] line numbers. When the steps carry names, each step starts at the runner's marker for it:
 *  "Set up job" at line 1, every other step that ran (not skipped) at the next `##[group]Run …` header (in step order, the header at or
 *  after the step's start, so a composite action's own inner "Run" headers are passed over), each "Post …" step at the next
 *  "Post job cleanup." line, and "Complete job" at "Cleaning up orphan processes". A step runs to the line before the next anchored step.
 *  Named steps echo their command, not their name, in the header, so headers are matched by order and time, not by text.
 *  Without names, or when no marker is found, it falls back to stepRangesByTime. */
export function stepRanges(lines: LogLine[], steps: LogStep[]): Map<number, [number, number]> {
  if (!lines.length || !steps.some((s) => s.name)) return stepRangesByTime(lines, steps);
  const anchors: { number: number; line: number }[] = [];
  let pos = 0; // index into lines: markers are searched forwards only
  const find = (test: (l: LogLine) => boolean, after?: Date) => {
    for (let i = pos; i < lines.length; i++) {
      const l = lines[i];
      if (!test(l)) continue;
      if (after && l.ts && l.ts.getTime() < after.getTime() - SLACK_MS) continue;
      pos = i + 1;
      return l.n;
    }
    return undefined;
  };
  for (const s of steps) {
    if (s.conclusion === "skipped") continue;
    const name = s.name ?? "";
    let line: number | undefined;
    if (name === SETUP_STEP) line = lines[0].n;
    else if (name === COMPLETE_STEP) line = find((l) => l.text.startsWith("Cleaning up orphan processes"));
    else if (name.startsWith("Post ")) line = find((l) => l.text === "Post job cleanup.", s.startedAt);
    else line = find((l) => l.kind === "group" && l.text.startsWith("Run "), s.startedAt);
    if (line !== undefined) anchors.push({ number: s.number, line });
  }
  if (!anchors.length) return stepRangesByTime(lines, steps);
  const out = new Map<number, [number, number]>();
  const last = lines[lines.length - 1].n;
  anchors.forEach((a, i) => out.set(a.number, [a.line, i + 1 < anchors.length ? anchors[i + 1].line - 1 : last]));
  return out;
}

/** Assigns lines to steps by timestamp: a line belongs to the last step whose startedAt is at or before the line's ts. Lines before the first
 *  step, or without a ts, follow the previous line's step (the first ones go to the first step). Returns step number -> [first, last] line
 *  numbers, for steps that got any lines. Steps without startedAt get none. */
export function stepRangesByTime(lines: LogLine[], steps: { number: number; startedAt?: Date }[]): Map<number, [number, number]> {
  const timed = steps.filter((s) => s.startedAt).map((s, i) => ({ number: s.number, t: s.startedAt!.getTime(), i })).sort((a, b) => a.t - b.t || a.i - b.i);
  const out = new Map<number, [number, number]>();
  if (!timed.length) return out;
  let cur = timed[0].number;
  for (const l of lines) {
    if (l.ts) {
      const t = l.ts.getTime();
      for (const s of timed) if (s.t <= t) cur = s.number;
      if (t < timed[0].t) cur = timed[0].number;
    }
    const r = out.get(cur);
    if (r) r[1] = l.n;
    else out.set(cur, [l.n, l.n]);
  }
  return out;
}

/** Counts by kind, for the log toolbar ("3 errors, 1 warning"). */
export function logCounts(lines: LogLine[]): { errors: number; warnings: number } {
  let errors = 0, warnings = 0;
  for (const l of lines) { if (l.kind === "error") errors++; else if (l.kind === "warning") warnings++; }
  return { errors, warnings };
}

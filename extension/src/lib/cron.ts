// POSIX cron for GitHub Actions `on.schedule[].cron`: five fields (minute hour day-of-month month day-of-week), always UTC.
// Supports *, numbers, lists (a,b), ranges (a-b), steps (*/n, a-b/n, a/n), month names (JAN-DEC) and day names (SUN-SAT), 0 or 7 for Sunday.
// As in Vixie cron (and GitHub), when both day-of-month and day-of-week are restricted a day matches if EITHER does.
// GitHub does not accept the @hourly style macros, so neither does this.

export interface CronSpec {
  minutes: number[];
  hours: number[];
  days: number[];
  months: number[];
  /** 0 = Sunday ... 6 = Saturday. */
  weekdays: number[];
  /** Day-of-month field was "*" (or "*\/1"). */
  anyDay: boolean;
  /** Day-of-week field was "*" (or "*\/1"). */
  anyWeekday: boolean;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

interface FieldDef {
  name: string;
  min: number;
  max: number;
  names?: string[];
  /** Offset of names[0]: months start at 1, days at 0. */
  nameBase?: number;
}

const FIELDS: FieldDef[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTHS, nameBase: 1 },
  { name: "day of week", min: 0, max: 7, names: DAYS, nameBase: 0 },
];

function value(text: string, f: FieldDef): number {
  const up = text.toUpperCase();
  const named = f.names?.indexOf(up) ?? -1;
  if (named >= 0) return named + (f.nameBase ?? 0);
  if (!/^\d+$/.test(text)) throw new Error(`Invalid ${f.name} "${text}"`);
  const n = Number(text);
  if (n < f.min || n > f.max) throw new Error(`The ${f.name} ${n} is out of range (${f.min}-${f.max})`);
  return n;
}

function field(text: string, f: FieldDef): { values: number[]; any: boolean } {
  const out = new Set<number>();
  let any = false;
  for (const part of text.split(",")) {
    if (!part) throw new Error(`Empty item in the ${f.name} field`);
    const [range, stepText, extra] = part.split("/");
    if (extra !== undefined) throw new Error(`Invalid ${f.name} "${part}"`);
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1) throw new Error(`Invalid step "${stepText}" in the ${f.name} field`);
      step = Number(stepText);
    }
    let lo: number, hi: number;
    if (range === "*") {
      lo = f.min;
      hi = f.name === "day of week" ? 6 : f.max;
      if (step === 1) any = true;
    } else if (range.includes("-")) {
      const [a, b, more] = range.split("-");
      if (more !== undefined || !a || !b) throw new Error(`Invalid range "${range}" in the ${f.name} field`);
      lo = value(a, f);
      hi = value(b, f);
      if (lo > hi) throw new Error(`The range "${range}" runs backwards`);
    } else {
      lo = value(range, f);
      hi = stepText !== undefined ? (f.name === "day of week" ? 6 : f.max) : lo; // "a/n" runs from a to the end
    }
    for (let v = lo; v <= hi; v += step) out.add(f.name === "day of week" && v === 7 ? 0 : v);
  }
  return { values: [...out].sort((a, b) => a - b), any };
}

/** Parses a five-field cron expression; throws an Error with a readable message when it is invalid. */
export function parseCron(expr: string): CronSpec {
  const parts = String(expr ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) throw new Error(`A cron schedule needs 5 fields, this has ${parts.length}`);
  const [mi, h, d, mo, w] = parts.map((p, i) => field(p, FIELDS[i]));
  return { minutes: mi.values, hours: h.values, days: d.values, months: mo.values, weekdays: w.values, anyDay: d.any, anyWeekday: w.any };
}

function dayMatches(s: CronSpec, y: number, m: number, d: number): boolean {
  if (!s.months.includes(m + 1)) return false;
  const dom = s.days.includes(d);
  const dow = s.weekdays.includes(new Date(Date.UTC(y, m, d)).getUTCDay());
  if (s.anyDay && s.anyWeekday) return true;
  if (s.anyDay) return dow;
  if (s.anyWeekday) return dom;
  return dom || dow;
}

/** How far ahead to look: eight years covers a 29 February schedule. A day that never comes (31 February) gives []. */
const MAX_DAYS = 366 * 8 + 2;

/** The next `count` times (strictly after `from`) the schedule fires, earliest first, as UTC instants. Throws when `expr` is invalid. */
export function nextCronRuns(expr: string, from: Date, count = 10): Date[] {
  const s = parseCron(expr);
  const out: Date[] = [];
  const start = from.getTime();
  const first = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let i = 0; i < MAX_DAYS && out.length < count; i++) {
    const day = new Date(first.getTime() + i * 86400e3);
    const y = day.getUTCFullYear(), m = day.getUTCMonth(), d = day.getUTCDate();
    if (!dayMatches(s, y, m, d)) continue;
    for (const h of s.hours) {
      for (const mi of s.minutes) {
        const t = Date.UTC(y, m, d, h, mi);
        if (t > start) {
          out.push(new Date(t));
          if (out.length >= count) return out;
        }
      }
    }
  }
  return out;
}

export interface ScheduledRun {
  at: Date;
  cron: string;
}

/** The next `count` runs across several schedules, merged and in time order (two schedules at the same minute fire once each, as on GitHub).
 *  Invalid expressions are skipped; `errors` lists them with the reason. */
export function nextScheduledRuns(crons: string[], from: Date, count = 10): { runs: ScheduledRun[]; errors: { cron: string; message: string }[] } {
  const runs: ScheduledRun[] = [];
  const errors: { cron: string; message: string }[] = [];
  for (const cron of crons) {
    try {
      runs.push(...nextCronRuns(cron, from, count).map((at) => ({ at, cron })));
    } catch (e) {
      errors.push({ cron, message: e instanceof Error ? e.message : String(e) });
    }
  }
  runs.sort((a, b) => a.at.getTime() - b.at.getTime() || crons.indexOf(a.cron) - crons.indexOf(b.cron));
  return { runs: runs.slice(0, count), errors };
}

/** How long until a run: "in under a minute", "in 45m", "in 3h 20m", "in 2d 4h" (whole minutes, rounded down). */
export function timeUntil(at: Date, now: Date): string {
  const mins = Math.floor((at.getTime() - now.getTime()) / 60000);
  if (mins < 1) return "in under a minute";
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return mins % 60 ? `in ${h}h ${mins % 60}m` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `in ${d}d ${h % 24}h` : `in ${d}d`;
}

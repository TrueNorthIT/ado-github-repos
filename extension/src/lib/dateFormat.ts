// Batch 4, one date policy for pull request views (VW-10).
//
// Facts: dateText.ts has shortDate(date, now) ("21 Aug", "6 Nov 2025") and commitDateText ("Today at 14:18"); tokens.relativeTime gives "3 hours ago" (used by the PR list rows, which this policy does not change).
// All times are LOCAL, as in dateText.ts. A September date must read "Sep": CLDR's en-GB data abbreviates it "Sept", so the full date is formatted by hand (dateText's month names), not with Intl.
//
// Policy fixed by the tests (dateFormat.test.ts), with `now` always passed in:
//  - under 1 minute (and any time in the future, from clock skew): "just now"
//  - under 1 hour: "{n}m ago" (whole minutes, rounded down); under 24 hours: "{n}h ago" (whole hours, rounded down)
//  - 24 hours or more: by calendar days between the two local dates: 1 is "Yesterday", 2 to 6 is "{n}d ago"
//  - 7 calendar days or more: dateText.shortDate(date, now), the year left out only for the current year
//  - the tooltip is fullDateTime: "21 Aug 2026, 14:18" (day, short month, year, 24-hour time), always with the year
//  - an invalid date gives "" for both.
import { shortDate } from "./dateText";

export const RELATIVE_DAYS = 7;
const toDate = (v: DateInput) => (v instanceof Date ? v : new Date(v));
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** A Date or an ISO string. */
export type DateInput = Date | string;

/** The text shown in the page. */
export function relativeOrShortDate(value: DateInput, now: Date): string {
  const d = toDate(value);
  if (isNaN(d.getTime())) return "";
  const ms = now.getTime() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (days >= RELATIVE_DAYS) return shortDate(d, now);
  return days <= 1 ? "Yesterday" : `${days}d ago`;
}

/** The tooltip text: the full UK-style date and time, e.g. "21 Aug 2026, 14:18". */
export function fullDateTime(value: DateInput): string {
  const d = toDate(value);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shortDate(d, new Date(0))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

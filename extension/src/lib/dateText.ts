// Native Repos' friendly dates: commit rows ("Today at 14:18", "21 Aug at 10:39", "6 Nov 2025 at 13:43") and the commit header (date only).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "6 Nov 2025" (the year is left out for the current year). Local time. */
export function shortDate(date: Date, now: Date = new Date()): string {
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

/** "Today at 14:18", "Yesterday at 09:05", otherwise "{shortDate} at HH:mm". Local time, 24-hour. */
export function commitDateText(date: Date, now: Date = new Date()): string {
  if (isNaN(date.getTime())) return "";
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  return `${shortDate(date, now)} at ${time}`;
}

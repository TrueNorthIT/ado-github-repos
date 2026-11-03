// The Pushes page's filters in the location hash, alongside browseState.ts without editing it (as compareHash.ts does).
// Hash keys, new in this module (collision-checked against browseState.ts and prListFilters.ts): pushedBy (a GitHub login) and pushPeriod.
// pushPeriod is the activity API's `time_period`: day, week, month, quarter or year (checked against the REST reference, 2026-11).

export type PushPeriod = "day" | "week" | "month" | "quarter" | "year";

/** The date filter's choices, in the order the dropdown lists them. "any" is no time_period. */
export const PUSH_PERIODS: { id: PushPeriod | "any"; text: string }[] = [
  { id: "any", text: "Any time" },
  { id: "day", text: "Past day" },
  { id: "week", text: "Past week" },
  { id: "month", text: "Past month" },
  { id: "quarter", text: "Past 3 months" },
  { id: "year", text: "Past year" },
];

const PERIODS = new Set<string>(["day", "week", "month", "quarter", "year"]);
export const isPushPeriod = (v: unknown): v is PushPeriod => typeof v === "string" && PERIODS.has(v);

export interface PushFilters {
  actor?: string;
  period?: PushPeriod;
}

const KEYS = ["pushedBy", "pushPeriod"];
const LOGIN = /^[A-Za-z0-9-[\]]{1,39}$/; // GitHub logins, plus the [bot] suffix

/** The push filters in a hash. A login that is not a plausible GitHub login and an unknown period are dropped. Never throws. */
export function parsePushFilters(hash: string): PushFilters {
  try {
    const p = new URLSearchParams(hash.replace(/^#+/, ""));
    const actor = (p.get("pushedBy") ?? "").trim();
    const period = p.get("pushPeriod");
    return { ...(actor && LOGIN.test(actor) ? { actor } : {}), ...(isPushPeriod(period) ? { period } : {}) };
  } catch {
    return {};
  }
}

/** The empty state's sentence, e.g. "GitHub has no recorded pushes to main by ann in the past week." */
export function noPushesText(branch: string, actor?: string, period?: PushPeriod): string {
  const when = period ? ` in the ${PUSH_PERIODS.find((p) => p.id === period)!.text.toLowerCase()}` : "";
  return `GitHub has no recorded pushes to ${branch}${actor?.trim() ? ` by ${actor.trim()}` : ""}${when}.`;
}

/** `hash` with pushedBy and pushPeriod replaced (blank ones removed); other segments keep their order. Starts with "#". */
export function applyPushFilters(hash: string, f: PushFilters): string {
  const kept = hash.replace(/^#+/, "").split("&").filter((x) => x && !KEYS.includes(x.split("=")[0]));
  const actor = (f.actor ?? "").trim();
  if (actor) kept.push(`pushedBy=${encodeURIComponent(actor)}`);
  if (isPushPeriod(f.period)) kept.push(`pushPeriod=${f.period}`);
  return "#" + kept.join("&");
}

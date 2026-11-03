// Batch 4, "updated since you viewed" on the pull request list (VW-9).
//
// Facts: PrListNode.updatedAt is an ISO 8601 string (prModel.ts). The map is kept per user in extension data (the same User scope as prefs.ts), so it must stay small:
// MAX_LAST_VIEWED entries. Pull request numbers repeat across repositories, so the keys are `${owner}/${name}#${number}` (viewedKey); the functions treat keys as opaque strings.
// A pull request's own updatedAt also moves when the viewer comments or pushes, so the indicator can fire after the viewer's own action: accepted, not modelled.
//
// Decisions fixed by the tests (lastViewed.test.ts):
//  - Merging keeps the LATER time per key; entries whose time is not a valid date are dropped.
//  - Pruning keeps the MAX_LAST_VIEWED newest; on equal times the key that sorts later (plain string comparison) is evicted first, so the result is deterministic.
//  - Nothing mutates its input.
//  - A pull request that has never been viewed is NOT flagged unless the caller opts in (the "new" indicator is off by default).
export const MAX_LAST_VIEWED = 500;

/** key (see viewedKey) to the ISO time the viewer last opened that pull request. */
export type LastViewedMap = Record<string, string>;

/** `${repo}#${number}`, repo being "owner/name". */
export function viewedKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

/** `local` and `incoming` merged (later time wins per key, invalid times dropped), then pruned to `max` entries (default MAX_LAST_VIEWED) by evicting the oldest. */
export function mergeLastViewed(local: LastViewedMap, incoming: LastViewedMap, max: number = MAX_LAST_VIEWED): LastViewedMap {
  const out: Record<string, string> = {};
  for (const m of [local, incoming])
    for (const [k, v] of Object.entries(m)) {
      const t = Date.parse(v);
      if (!isNaN(t) && !(k in out && Date.parse(out[k]) >= t)) out[k] = v;
    }
  const keep = Object.entries(out)
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, max);
  return Object.fromEntries(keep);
}

/** mergeLastViewed(map, { [key]: viewedAtIso }): records one view. An earlier time than the stored one changes nothing. */
export function recordViewed(map: LastViewedMap, key: string, viewedAtIso: string, max?: number): LastViewedMap {
  return mergeLastViewed(map, { [key]: viewedAtIso }, max);
}

/**
 * True when the pull request changed after the viewer last opened it: updatedAt strictly later than lastViewed. With no lastViewed (never viewed, or not a valid date) the answer is
 * `opts.newWhenNeverViewed` (default false). An invalid updatedAt is false.
 */
export function isUpdatedSinceViewed(updatedAt: string, lastViewed: string | undefined, opts?: { newWhenNeverViewed?: boolean }): boolean {
  const u = Date.parse(updatedAt);
  if (isNaN(u)) return false;
  const v = lastViewed === undefined ? NaN : Date.parse(lastViewed);
  return isNaN(v) ? !!opts?.newWhenNeverViewed : u > v;
}

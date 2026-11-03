// When to re-fetch a PR's actions quietly because GitHub is still working out mergeability (mergeStateStatus UNKNOWN right after a reopen or push).

export const POLL_FAST_MS = 3000;
export const POLL_SLOW_MS = 10_000;
/** Fast polling lasts this long, then the slow interval takes over. */
export const POLL_BACKOFF_AFTER_MS = 30_000;
export const POLL_GIVE_UP_MS = 120_000;

/** Ms until the next fetch, or null to stop (the PR is not open, the answer is known, or two minutes have passed). `elapsedMs` is since polling began. `keepPolling`: something else is awaited too (a re-run's checks, a queued pull request), so a known mergeStateStatus does not stop it. */
export function nextPollDelay(p: { state: string; mergeStateStatus: string; elapsedMs: number; keepPolling?: boolean }): number | null {
  if (p.state !== "OPEN" || (p.mergeStateStatus !== "UNKNOWN" && !p.keepPolling) || p.elapsedMs >= POLL_GIVE_UP_MS) return null;
  return p.elapsedMs < POLL_BACKOFF_AFTER_MS ? POLL_FAST_MS : POLL_SLOW_MS;
}

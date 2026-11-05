// The page's one TanStack Query cache (v4: v5 needs React 18, and azure-devops-ui pins React 16).
// Reads go through useQuery (or useGh below), so coming back to a list or page shows what it had at once and refreshes it in the
// background, instead of dropping to shimmer rows every time.
// Each hub is its own iframe, so this cache lasts as long as the hub page does; queryPersist.ts keeps the opted-in reads between visits.
import * as React from "react";
import { QueryClient, useQuery, type QueryKey } from "@tanstack/react-query";

/** How long a read counts as fresh: remounting within this shows it without asking GitHub again. Same as the old hand-rolled caches. */
export const STALE_MS = 30_000;

/** A GitHub failure worth one more try: no response at all, or a 5xx. Sign-in, permission and rate-limit failures are not (shape of GhError). */
const transient = (e: unknown) => {
  const g = e as { kind?: string; status?: number } | null;
  return g?.kind === "other" && (!g.status || g.status >= 500);
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_MS,
      cacheTime: 24 * 60 * 60_000, // as long as a persisted read may live (queryPersist.ts); memory is freed when the hub's frame goes
      retry: (n, e) => n < 1 && transient(e),
      // A stale read refreshes when the hub's frame gets focus back (TanStack listens for focus and visibilitychange).
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * The first element of every query key, so a write can drop everything it may have changed.
 * - prs: the PR lists. pr: one PR's page, files, updates and so on, as ["pr", repo, number, …].
 * - refs: commits, pushes, branches, tags, releases, compares, policies (invalidateRefs).
 * - browse: the Files hub's trees, folders, file contents and history (invalidateBrowse).
 * - actions, security, misc: the Actions and Advanced Security hubs, and reads nothing writes to.
 */
export type KeyRoot = "prs" | "pr" | "refs" | "browse" | "actions" | "security" | "misc";

/**
 * After a write or a "Try again": what is on screen refetches (keeping what it shows meanwhile), and what isn't is dropped,
 * so the next visit starts from GitHub rather than showing what the write has made wrong (a merged PR still under Active).
 */
export function dropQueries(queryKey: QueryKey): void {
  queryClient.removeQueries({ queryKey, type: "inactive" });
  void queryClient.invalidateQueries({ queryKey, type: "active" });
}

/** A read as the pages render it. `previous`: the value is the last key's, kept while this key loads (keepPrevious). */
export type GhLoad<T> =
  | { t: "loading" }
  | { t: "error"; err: unknown; retry: () => void }
  | { t: "ready"; v: T; previous: boolean; fetching: boolean; refetch: () => void };

export interface GhOptions<T> {
  /** Keep showing the last key's value while a new key loads (paging, filters). Off by default: another repo, ref or item starts from shimmer. */
  keepPrevious?: boolean;
  /** Keep this read between visits (queryPersist.ts). Only lists and metadata: never file contents, logs or blobs. */
  persist?: boolean;
  /** Poll while mounted (ms), or a function of the latest value; false to stop. */
  refetchInterval?: number | false | ((v: T | undefined) => number | false);
  staleTime?: number;
  /** Polling and refetches stop while the hub's frame is hidden unless this is set. */
  refetchInBackground?: boolean;
}

/**
 * useQuery in the shape the hubs render: loading only when there is nothing to show yet, error only when there is still nothing to show
 * (a failed background refresh keeps the value), ready otherwise. A null key waits (the query is disabled).
 */
export function useGh<T>(key: QueryKey | null, fn: () => Promise<T>, opts: GhOptions<T> = {}): GhLoad<T> {
  const { refetchInterval } = opts;
  const q = useQuery<T>({
    queryKey: key ?? ["disabled"],
    queryFn: fn,
    enabled: key !== null,
    keepPreviousData: !!opts.keepPrevious,
    meta: opts.persist ? { persist: true } : undefined,
    staleTime: opts.staleTime,
    refetchInterval: typeof refetchInterval === "function" ? (v) => refetchInterval(v) : refetchInterval,
    refetchIntervalInBackground: !!opts.refetchInBackground,
  });
  const refetch = React.useCallback(() => void q.refetch(), [q.refetch]); // eslint-disable-line react-hooks/exhaustive-deps
  if (key !== null && q.data !== undefined) return { t: "ready", v: q.data, previous: q.isPreviousData, fetching: q.isFetching, refetch };
  if (key !== null && q.isError) return { t: "error", err: q.error, retry: refetch };
  return { t: "loading" };
}

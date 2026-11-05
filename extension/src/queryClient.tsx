// The page's one TanStack Query cache (v4: v5 needs React 18, and azure-devops-ui pins React 16).
// Lists read through useQuery, so coming back to a list (from a PR, after a tab switch, on Retry) shows the rows it had at once
// and refreshes them in the background, instead of dropping to shimmer rows every time.
// Each hub is its own iframe, so this cache lasts as long as the hub page does; it is not shared between hubs.
import * as React from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";

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
      cacheTime: 10 * 60_000,
      retry: (n, e) => n < 1 && transient(e),
      // A stale list refreshes when the hub's frame gets focus back (TanStack listens for focus and visibilitychange).
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * After a write or a "Try again": what is on screen refetches (keeping its rows meanwhile), and what isn't is dropped,
 * so the next visit starts from GitHub rather than showing rows the write has made wrong (a merged PR still under Active).
 */
export function dropQueries(queryKey: QueryKey): void {
  queryClient.removeQueries({ queryKey, type: "inactive" });
  void queryClient.invalidateQueries({ queryKey, type: "active" });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// Optimistic updates for the activity feed (AF-7).
import type { FeedComment, FeedItem, ThreadItem } from "./feedModel";

const mapThread = (items: FeedItem[], id: string, fn: (t: ThreadItem) => ThreadItem): FeedItem[] =>
  items.map((i) => (i.kind === "thread" && i.id === id ? fn(i) : i));

/** Appends `comment` to the thread's replies and moves its lastActivity. Pure; an unknown threadId returns an equal array. */
export function applyReply(items: FeedItem[], threadId: string, comment: FeedComment): FeedItem[] {
  return mapThread(items, threadId, (t) => ({ ...t, comments: [...t.comments, comment], lastActivity: comment.date }));
}

/** Sets the thread's status to "resolved" (true) or "active" (false). Pure. */
export function applyResolve(items: FeedItem[], threadId: string, resolved: boolean): FeedItem[] {
  return mapThread(items, threadId, (t) => ({ ...t, status: resolved ? "resolved" : "active" }));
}

/** Adds a top-level comment item, newest first. Pure. */
export function applyComment(items: FeedItem[], comment: FeedComment): FeedItem[] {
  const at = items.findIndex((i) => i.date.getTime() <= comment.date.getTime());
  const next = { kind: "comment" as const, ...comment };
  return at < 0 ? [...items, next] : [...items.slice(0, at), next, ...items.slice(at)];
}

/** Resolved and total threads, outdated ones included, as prModel counts reviewThreads. Comments and events are ignored. */
export function resolvedCounts(items: FeedItem[]): { resolved: number; total: number } {
  const threads = items.filter((i): i is ThreadItem => i.kind === "thread");
  return { resolved: threads.filter((t) => t.status === "resolved").length, total: threads.length };
}

export type OptimisticResult = { ok: true } | { ok: false; error: unknown };

/**
 * Calls `set(apply(current))` immediately (before `commit` settles), then awaits `commit`.
 * On success resolves { ok: true } and leaves the optimistic state. On rejection calls `set(current)` with the very same
 * previous array, then resolves { ok: false, error }. Never rejects.
 */
export async function optimistic(
  current: FeedItem[],
  apply: (items: FeedItem[]) => FeedItem[],
  commit: () => Promise<unknown>,
  set: (items: FeedItem[]) => void,
): Promise<OptimisticResult> {
  set(apply(current));
  try {
    await commit();
    return { ok: true };
  } catch (error) {
    set(current);
    return { ok: false, error };
  }
}

// Shared state of one PR's activity feed (AF-7): the Overview feed and the inline threads in Files are two views of it.
// Replies, resolves and comments go through optimistic() and are serialised one at a time per PR, so a rollback never
// restores an array that a concurrent action has since moved on from.
import * as React from "react";
import { GhError, getFeed, invalidatePrPage, postComment, postReply, setThreadResolved } from "./githubBrowse";
import { applyComment, applyReply, applyResolve, optimistic } from "./lib/feedState";
import type { FeedComment, FeedItem, ThreadItem } from "./lib/feedModel";
import type { GhActor } from "./lib/prModel";

const STALE_MS = 30_000;
export const COMMENT_KEY = "comment";

/** What to tell the user when a post, reply or resolve fails. */
export function postErrorText(e: unknown): string {
  if (e instanceof GhError) {
    if (e.kind === "access") return "Your GitHub sign-in can't post to this repository.";
    if (e.kind === "auth") return "Your GitHub sign-in has expired. Sign in again to post.";
    if (e.kind === "rateLimit") return "GitHub's rate limit has been reached. Try again later.";
  }
  return "Could not reach GitHub. Try again.";
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class FeedStore {
  status: "loading" | "ready" | "error" = "loading";
  err: unknown;
  prId = "";
  viewer: GhActor = { login: "" };
  items: FeedItem[] = [];
  /** Ids (thread ids, or COMMENT_KEY) with a call queued or in flight: their buttons are disabled. */
  busy = new Set<string>();
  /** Inline error per id, from the last failed call. */
  errors = new Map<string, string>();
  /** Bumped after every successful mutation; the PR page refetches its header on it. */
  version = 0;
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private loadedAt = 0;
  private loading?: Promise<void>;
  private pending = 0;

  constructor(readonly repo: string, readonly number: number) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** Loads on first use, and again (keeping what is shown) once the data is 30 s old and nothing is in flight. */
  ensureLoaded(force = false) {
    if (this.loading || this.pending) return;
    if (!force && this.status === "ready" && Date.now() - this.loadedAt < STALE_MS) return;
    if (this.status === "error") this.status = "loading";
    this.loading = getFeed(this.repo, this.number).then(
      (d) => {
        if (this.pending) return; // an action started meanwhile: its state wins
        this.prId = d.prId;
        this.viewer = d.viewer;
        this.items = d.items;
        this.status = "ready";
        this.loadedAt = Date.now();
      },
      (err) => {
        if (this.status !== "ready") (this.status = "error"), (this.err = err);
      }
    ).then(() => { this.loading = undefined; this.emit(); });
    this.emit();
  }

  thread(id: string) {
    return this.items.find((i): i is ThreadItem => i.kind === "thread" && i.id === id);
  }

  private set = (items: FeedItem[]) => { this.items = items; this.emit(); };

  /** Queues `task` behind the previous call for this PR. Resolves true on success. The error text is kept under `key`. */
  private run(key: string, task: () => Promise<boolean>): Promise<boolean> {
    this.pending++;
    this.busy = new Set(this.busy).add(key);
    this.errors.delete(key);
    this.emit();
    const done = this.queue.then(task, task);
    this.queue = done;
    return done.then((ok) => {
      this.pending--;
      this.busy = new Set([...this.busy].filter((k) => k !== key));
      if (ok) {
        this.version++;
        invalidatePrPage(this.repo, this.number); // the header's x/y resolved and the list's counts refetch
      }
      this.emit();
      return ok;
    });
  }

  private local(body: string): FeedComment {
    return { id: `pending-${Date.now()}-${Math.random()}`, author: this.viewer.login, avatarUrl: this.viewer.avatarUrl ?? "", html: `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`, date: new Date(), url: "" };
  }

  private async step(key: string, apply: (i: FeedItem[]) => FeedItem[], commit: () => Promise<void>): Promise<boolean> {
    const r = await optimistic(this.items, apply, commit, this.set);
    if (!r.ok) this.errors.set(key, postErrorText(r.error));
    return r.ok;
  }

  comment(body: string) {
    return this.run(COMMENT_KEY, () => {
      const tmp = this.local(body);
      return this.step(COMMENT_KEY, (i) => applyComment(i, tmp), async () => {
        const real = await postComment(this.prId, body);
        this.set(this.items.map((i) => (i.id === tmp.id ? { kind: "comment", ...real } : i)));
      });
    });
  }

  reply(threadId: string, body: string) {
    return this.run(threadId, () => {
      const tmp = this.local(body);
      return this.step(threadId, (i) => applyReply(i, threadId, tmp), async () => {
        const real = await postReply(threadId, body);
        this.set(this.items.map((i) => (i.kind === "thread" && i.id === threadId ? { ...i, comments: i.comments.map((c) => (c.id === tmp.id ? real : c)), lastActivity: real.date } : i)));
      });
    });
  }

  resolve(threadId: string, resolved: boolean) {
    return this.run(threadId, () =>
      this.step(threadId, (i) => applyResolve(i, threadId, resolved), async () => {
        const now = await setThreadResolved(threadId, resolved);
        this.set(applyResolve(this.items, threadId, now));
      })
    );
  }
}

// ponytail: unbounded; one entry per PR opened in a session. Add eviction if memory shows up.
const stores = new Map<string, FeedStore>();
export function feedStore(repo: string, number: number): FeedStore {
  const key = `${repo}#${number}`;
  let s = stores.get(key);
  if (!s) stores.set(key, (s = new FeedStore(repo, number)));
  return s;
}

/** The store for a PR, re-rendering the caller on every change. Starts (or refreshes) the load. */
export function useFeed(repo: string, number: number): FeedStore {
  const store = feedStore(repo, number);
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const off = store.subscribe(bump);
    store.ensureLoaded();
    return off;
  }, [store]);
  return store;
}

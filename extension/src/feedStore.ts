// Shared state of one PR's activity feed (AF-7): the Overview feed and the inline threads in Files are two views of it.
// Replies, resolves and comments go through optimistic() and are serialised one at a time per PR, so a rollback never
// restores an array that a concurrent action has since moved on from.
import * as React from "react";
import { GhError, getFeed, graphql, invalidatePr, invalidatePrPage, loadCommentMeta, mutate, postComment, postPendingReply, postReply, setThreadResolved, toThreadItem, type PrExtras } from "./githubBrowse";
import { applyComment, applyReply, applyResolve, optimistic } from "./lib/feedState";
import type { FeedComment, FeedItem, ThreadItem } from "./lib/feedModel";
import type { GhActor } from "./lib/prModel";
import { addThreadMutation, applyNewThread, type ThreadTarget } from "./lib/newThread";
import { countPendingComments, discardReviewMutation, startReviewMutation, submitReviewMutation, type PendingFeedComment, type PendingReview, type SubmitEvent } from "./lib/pendingReview";
import { applyCommentDelete, applyCommentEdit, commentActions, deleteCommentMutation, editCommentMutation, minimizeMutation, toEditInfo, toMinimizedView, unminimizeMutation, type CommentKind, type CommentMeta, type MinimizeClassifier } from "./lib/commentEdit";
import { normaliseReactions, reactionMutation, toggleOptimistically, type ReactionContent, type ReactionState } from "./lib/reactions";
import { applyFailureText, applySuggestions, commitSuggestionsMutation, headFileQuery, suggestionCommitMessage, suggestionContextQuery, toApplyContext, toFileText, type Suggestion } from "./lib/suggestions";

const STALE_MS = 30_000;
export const COMMENT_KEY = "comment";
export const REVIEW_KEY = "review";
export const BATCH_KEY = "suggest:batch";

/** A suggestion waiting in "Commit N suggestions". */
export interface BatchItem {
  /** `${commentId}#${index of the block in the comment}` */
  key: string;
  path: string;
  suggestion: Suggestion;
  originalLines: string[];
  outdated: boolean;
}

const NO_EXTRAS: PrExtras = { viewerCanReact: false, reactionGroups: [], viewerCanApplySuggestion: false };

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
  /** Per comment id: raw body, permissions, edit info, minimised state. */
  meta: Record<string, CommentMeta> = {};
  /** The viewer's unsubmitted review. */
  pending: PendingReview | null = null;
  pr: PrExtras = NO_EXTRAS;
  /** Optimistic reaction state per subject id (a comment id, or the PR id). */
  reactions = new Map<string, ReactionState[]>();
  batch: BatchItem[] = [];
  /** Set after suggestions were committed, until dismissed. */
  committed: { count: number; url: string } | null = null;
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
  private inflight = 0;

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
    if (this.loading || this.inflight) return;
    if (!force && this.status === "ready" && Date.now() - this.loadedAt < STALE_MS) return;
    if (this.status === "error") this.status = "loading";
    this.loading = getFeed(this.repo, this.number).then(
      (d) => {
        if (this.inflight) return; // an action started meanwhile: its state wins
        this.prId = d.prId;
        this.viewer = d.viewer;
        this.items = d.items;
        this.meta = d.meta;
        this.pending = d.pending;
        this.pr = d.pr;
        this.reactions = new Map();
        this.status = "ready";
        this.loadedAt = Date.now();
      },
      (err) => {
        if (this.status !== "ready") (this.status = "error"), (this.err = err);
      }
    ).then(() => { this.loading = undefined; this.emit(); });
    this.emit();
  }

  /** Pending comments in the feed, or the count GitHub reports for the review when that is larger (comments on files we cannot see). */
  get pendingCount() {
    return Math.max(countPendingComments(this.items), this.pending?.commentCount ?? 0);
  }

  /** Top-level comments are issue comments; everything inside a thread is a review comment. */
  kindOf(commentId: string): CommentKind {
    return this.meta[commentId]?.kind ?? (this.items.some((i) => i.kind === "comment" && i.id === commentId) ? "IssueComment" : "PullRequestReviewComment");
  }

  reactionState(subjectId: string): ReactionState[] {
    return this.reactions.get(subjectId) ?? normaliseReactions(subjectId === this.prId ? this.pr.reactionGroups : this.meta[subjectId]?.reactionGroups);
  }

  /** Reads metadata for comments the store just created, so they can be edited and reacted to. Best effort. */
  private async loadMeta(ids: string[]) {
    try {
      this.meta = { ...this.meta, ...(await loadCommentMeta(ids)) };
    } catch {
      /* the comment shows without its menu until the next refresh */
    }
  }

  thread(id: string) {
    return this.items.find((i): i is ThreadItem => i.kind === "thread" && i.id === id);
  }

  private set = (items: FeedItem[]) => { this.items = items; this.emit(); };

  /** Queues `task` behind the previous call for this PR. Resolves true on success. The error text is kept under `key`. */
  private run(key: string, task: () => Promise<boolean>): Promise<boolean> {
    this.inflight++;
    this.busy = new Set(this.busy).add(key);
    this.errors.delete(key);
    this.emit();
    const done = this.queue.then(task, task);
    this.queue = done;
    return done.then((ok) => {
      this.inflight--;
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
        const real = this.pending ? await postPendingReply(threadId, this.pending.id, body) : await postReply(threadId, body);
        this.set(this.items.map((i) => (i.kind === "thread" && i.id === threadId ? { ...i, comments: i.comments.map((c) => (c.id === tmp.id ? real : c)), lastActivity: real.date } : i)));
      });
    });
  }

  /** A new line, range or file comment. `review` adds it to the viewer's pending review (starting one first); `single` posts it at once. */
  newThread(key: string, target: ThreadTarget, body: string, mode: "single" | "review"): Promise<boolean> {
    return this.run(key, async () => {
      try {
        let reviewId = mode === "review" ? this.pending?.id : undefined;
        if (mode === "review" && !reviewId) {
          reviewId = (await mutate(startReviewMutation(this.prId))).addPullRequestReview.pullRequestReview.id as string;
          this.pending = { id: reviewId, commentCount: 0, body: "" };
        }
        const d = await mutate(addThreadMutation({ pullRequestId: this.prId, reviewId, body, target }));
        const thread = toThreadItem(d.addPullRequestReviewThread.thread, this.viewer.login);
        if (!thread) throw new Error("no thread came back");
        this.set(applyNewThread(this.items, thread));
        await this.loadMeta(thread.comments.map((c) => c.id));
        this.emit();
        return true;
      } catch (e) {
        this.errors.set(key, postErrorText(e));
        return false;
      }
    });
  }

  /** Submits the pending review with a verdict and an optional message. */
  async submitReview(event: SubmitEvent, body: string): Promise<boolean> {
    const review = this.pending;
    if (!review) return false;
    const ok = await this.run(REVIEW_KEY, async () => {
      try {
        await mutate(submitReviewMutation({ reviewId: review.id, event, body }));
        this.pending = null;
        this.set(this.items.map((i) => (i.kind === "thread" ? { ...i, comments: i.comments.map(({ pending: _p, ...c }: PendingFeedComment) => c) } : i)));
        return true;
      } catch (e) {
        this.errors.set(REVIEW_KEY, postErrorText(e));
        return false;
      }
    });
    if (ok) this.ensureLoaded(true); // the comments are submitted now: read them back as GitHub has them
    return ok;
  }

  /** Deletes the pending review and every comment in it. */
  discardReview(): Promise<boolean> {
    const review = this.pending;
    if (!review) return Promise.resolve(false);
    return this.run(REVIEW_KEY, async () => {
      try {
        await mutate(discardReviewMutation(review.id));
        this.pending = null;
        this.set(
          this.items.flatMap((i): FeedItem[] => {
            if (i.kind !== "thread") return [i];
            const comments = i.comments.filter((c) => !(c as PendingFeedComment).pending);
            return comments.length ? [{ ...i, comments, date: comments[0].date, lastActivity: comments[comments.length - 1].date }] : [];
          })
        );
        return true;
      } catch (e) {
        this.errors.set(REVIEW_KEY, postErrorText(e));
        return false;
      }
    });
  }

  /** Edits a comment's markdown; the rendered html comes back from GitHub. */
  edit(commentId: string, body: string): Promise<boolean> {
    return this.run(commentId, async () => {
      try {
        const payload = Object.values(await mutate(editCommentMutation({ __typename: this.kindOf(commentId), id: commentId }, body)))[0] as Record<string, { bodyHTML: string; lastEditedAt: string | null }>;
        const node = Object.values(payload)[0];
        this.set(applyCommentEdit(this.items, commentId, node.bodyHTML));
        const m = this.meta[commentId];
        if (m) this.meta = { ...this.meta, [commentId]: { ...m, body, edit: toEditInfo({ lastEditedAt: node.lastEditedAt ?? new Date().toISOString() }) } };
        return true;
      } catch (e) {
        this.errors.set(commentId, postErrorText(e));
        return false;
      }
    });
  }

  /** Deletes a comment; it disappears at once and comes back if GitHub refuses. */
  remove(commentId: string): Promise<boolean> {
    return this.run(commentId, () => this.step(commentId, (i) => applyCommentDelete(i, commentId), async () => void (await mutate(deleteCommentMutation({ __typename: this.kindOf(commentId), id: commentId })))));
  }

  /** Hides (minimises) a comment, or shows it again when `classifier` is null. */
  setMinimized(commentId: string, classifier: MinimizeClassifier | null): Promise<boolean> {
    return this.run(commentId, async () => {
      try {
        const d = await mutate(classifier ? minimizeMutation(commentId, classifier) : unminimizeMutation(commentId));
        const r = (classifier ? d.minimizeComment.minimizedComment : d.unminimizeComment.unminimizedComment) as { isMinimized: boolean; minimizedReason: string | null; viewerCanMinimize: boolean; viewerCanUnminimize: boolean };
        const m = this.meta[commentId];
        if (m) {
          const actions = commentActions({ __typename: m.kind, viewerCanUpdate: m.actions.canEdit, viewerCanDelete: m.actions.canDelete, viewerCanMinimize: r.viewerCanMinimize, viewerCanUnminimize: r.viewerCanUnminimize, isMinimized: r.isMinimized });
          this.meta = { ...this.meta, [commentId]: { ...m, actions, minimized: toMinimizedView(r) } };
        }
        return true;
      } catch (e) {
        this.errors.set(commentId, postErrorText(e));
        return false;
      }
    });
  }

  /** Toggles the viewer's reaction on a comment (or the PR description) at once, and puts it back if GitHub refuses. */
  async react(subjectId: string, content: ReactionContent): Promise<void> {
    const key = `react:${subjectId}`;
    if (this.busy.has(key)) return; // one in flight per subject keeps the rollback exact
    this.busy = new Set(this.busy).add(key);
    this.errors.delete(key);
    const r = await toggleOptimistically(this.reactionState(subjectId), content, (add) => mutate(reactionMutation(subjectId, content, add)), (s) => { this.reactions = new Map(this.reactions).set(subjectId, s); this.emit(); });
    this.busy = new Set([...this.busy].filter((k) => k !== key));
    if (!r.ok) this.errors.set(key, postErrorText(r.error));
    this.emit();
  }

  addToBatch(item: BatchItem) {
    if (!this.batch.some((b) => b.key === item.key)) this.batch = [...this.batch, item];
    this.emit();
  }
  removeFromBatch(key: string) {
    this.batch = this.batch.filter((b) => b.key !== key);
    this.emit();
  }
  clearBatch() {
    this.batch = [];
    this.emit();
  }
  dismissCommitted() {
    this.committed = null;
    this.emit();
  }

  /**
   * Commits suggestions to the PR branch: one commit holding all of them, through createCommitOnBranch (GitHub has no apply-suggestion API).
   * `errorKey` is where a refusal is shown: BATCH_KEY for the batch bar, or the suggestion's own key.
   */
  applySuggestions(items: BatchItem[], errorKey: string): Promise<boolean> {
    return this.run(errorKey, async () => {
      try {
        const [owner, name] = this.repo.split("/");
        const node = (await graphql(suggestionContextQuery({ owner, name, number: this.number }))).data?.repository?.pullRequest;
        const ctx = toApplyContext(node);
        if (!ctx.ok) return this.fail(errorKey, applyFailureText(ctx.reason));
        const [headOwner, headName] = ctx.repo.split("/");
        const files: Record<string, string> = {};
        for (const path of new Set(items.map((i) => i.path))) {
          const text = toFileText((await graphql(headFileQuery({ owner: headOwner, name: headName, oid: ctx.headOid, path }))).data);
          if (text !== null) files[path] = text;
        }
        const res = applySuggestions(files, items.map((i) => ({ path: i.path, suggestion: i.suggestion, originalLines: i.originalLines, outdated: i.outdated })));
        if (!res.ok) return this.fail(errorKey, applyFailureText(res.reason));
        const d = await mutate(commitSuggestionsMutation({ repo: ctx.repo, branch: ctx.branch, expectedHeadOid: ctx.headOid, message: suggestionCommitMessage(items.length), files: res.files }));
        this.committed = { count: items.length, url: d.createCommitOnBranch?.commit?.url ?? "" };
        const done = new Set(items.map((i) => i.key));
        this.batch = this.batch.filter((b) => !done.has(b.key));
        invalidatePr(); // the head moved: the Files tab reads the new diff
        return true;
      } catch (e) {
        return this.fail(errorKey, e instanceof GhError && e.kind === "other" && e.detail ? `GitHub refused the commit: ${e.detail}` : postErrorText(e));
      }
    });
  }

  private fail(key: string, text: string): false {
    this.errors.set(key, text);
    return false;
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

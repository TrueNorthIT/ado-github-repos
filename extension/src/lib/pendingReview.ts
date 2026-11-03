// Batch 3, pending reviews (CM-3). 
//
// Schema facts (checked live with `gh api graphql`; mutations were run with bogus node ids, so they passed validation and wrote nothing):
//  - mutation addPullRequestReview(input: AddPullRequestReviewInput!) takes { pullRequestId: ID!, commitOID, body, event: PullRequestReviewEvent, comments, threads }. Leaving `event` out creates a
//    PENDING review. Payload { pullRequestReview { id state } } validates (also reviewEdge).
//  - PullRequestReviewEvent = COMMENT | APPROVE | REQUEST_CHANGES | DISMISS. DISMISS is for dismissPullRequestReview, not for submitting, so submit accepts the first three only.
//  - mutation submitPullRequestReview(input: SubmitPullRequestReviewInput!) takes { pullRequestReviewId: ID, pullRequestId: ID, event: PullRequestReviewEvent! (required), body }.
//  - mutation deletePullRequestReview(input: DeletePullRequestReviewInput!) takes { pullRequestReviewId: ID! }; payload { pullRequestReview { id state } }. It is how a PENDING review is discarded.
//  - A comment joins a pending review through addPullRequestReviewThread (pullRequestReviewId, see newThread.ts) or, for a reply, addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: ID!,
//    body: String!, pullRequestReviewId: ID }) whose pullRequestReviewId is documented as "the Node ID of the pending review to which the reply will belong".
//  - PullRequest.reviews(states: [PullRequestReviewState!], author: String, first:...) : "author" is a login. PullRequestReviewState = PENDING | COMMENTED | APPROVED | CHANGES_REQUESTED | DISMISSED.
//    Validated live on a real PR as the signed-in viewer (an empty result, since none was pending). PullRequestReview has viewerDidAuthor (from the Comment interface) and comments { totalCount }.
//  - PullRequestReviewComment.state = PENDING ("A comment that is part of a pending review") | SUBMITTED, and pullRequestReview { id state }.
//  - The schema does not say who can see a pending review. GitHub's documented behaviour is that only its author can; that could NOT be exercised live (creating one is a write). The model therefore
//    filters pending comments to their author itself instead of relying on the API, and ignores any PENDING review not authored by the viewer.
//  - feedModel.toFeed already drops PENDING PullRequestReview timeline items (no event is shown until the review is submitted).
import type { GraphQlRequest } from "./prQuery";
import type { CommentItem, EventItem, FeedComment, FeedItem, FeedPr, ReviewThreadCommentNode, ReviewThreadNode, ThreadItem, TimelineNode } from "./feedModel";

/** What the UI shows on a comment that belongs to the viewer's unsubmitted review. */
export const PENDING_LABEL = "Pending";

export type SubmitEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

import { toFeed } from "./feedModel";
const blank = (s: string | null | undefined) => !s || !s.trim();
const REVIEW = "pullRequestReview { id state }";
const EVENTS = ["COMMENT", "APPROVE", "REQUEST_CHANGES"];


/** `mutation($input: AddPullRequestReviewInput!) { addPullRequestReview(input: $input) { pullRequestReview { id state } } }`. variables.input is exactly { pullRequestId }: no `event`, so the review is PENDING. Throws "pullRequestId is required". */
export function startReviewMutation(pullRequestId: string): GraphQlRequest {
  if (blank(pullRequestId)) throw new Error("pullRequestId is required");
  return { query: `mutation($input: AddPullRequestReviewInput!) { addPullRequestReview(input: $input) { ${REVIEW} } }`, variables: { input: { pullRequestId } } };
}

/**
 * `mutation($input: SubmitPullRequestReviewInput!) { submitPullRequestReview(input: $input) { pullRequestReview { id state } } }`.
 * variables.input: { pullRequestReviewId, event, body? } with body left out when undefined and otherwise sent exactly as given (an empty string is allowed).
 * Throws "reviewId is required" for a blank id and "event must be COMMENT, APPROVE or REQUEST_CHANGES" for anything else (DISMISS included).
 */
export function submitReviewMutation(p: { reviewId: string; event: SubmitEvent; body?: string }): GraphQlRequest {
  if (blank(p.reviewId)) throw new Error("reviewId is required");
  if (!EVENTS.includes(p.event)) throw new Error("event must be COMMENT, APPROVE or REQUEST_CHANGES");
  const input: Record<string, unknown> = { pullRequestReviewId: p.reviewId, event: p.event };
  if (p.body !== undefined) input.body = p.body;
  return { query: `mutation($input: SubmitPullRequestReviewInput!) { submitPullRequestReview(input: $input) { ${REVIEW} } }`, variables: { input } };
}

/** `mutation($input: DeletePullRequestReviewInput!) { deletePullRequestReview(input: $input) { pullRequestReview { id state } } }`. variables.input { pullRequestReviewId }. Throws "reviewId is required". */
export function discardReviewMutation(reviewId: string): GraphQlRequest {
  if (blank(reviewId)) throw new Error("reviewId is required");
  return { query: `mutation($input: DeletePullRequestReviewInput!) { deletePullRequestReview(input: $input) { ${REVIEW} } }`, variables: { input: { pullRequestReviewId: reviewId } } };
}

/**
 * A reply that joins the pending review: `mutation($input: AddPullRequestReviewThreadReplyInput!) { addPullRequestReviewThreadReply(input: $input) { comment { id url bodyHTML createdAt author { login avatarUrl } state } } }`.
 * variables.input { pullRequestReviewThreadId, pullRequestReviewId, body }. Throws "body is required" for a blank body, "threadId is required" and "reviewId is required" for blank ids.
 */
export function pendingReplyMutation(threadId: string, reviewId: string, body: string): GraphQlRequest {
  if (blank(body)) throw new Error("body is required");
  if (blank(threadId)) throw new Error("threadId is required");
  if (blank(reviewId)) throw new Error("reviewId is required");
  return {
    query: `mutation($input: AddPullRequestReviewThreadReplyInput!) { addPullRequestReviewThreadReply(input: $input) { comment { id url bodyHTML createdAt author { login avatarUrl } state } } }`,
    variables: { input: { pullRequestReviewThreadId: threadId, pullRequestReviewId: reviewId, body } },
  };
}

/**
 * `query($owner: String!, $name: String!, $number: Int!, $author: String)` over viewer { login } and repository(...) { pullRequest(number: $number) { id reviews(states: [PENDING], author: $author, first: 10)
 * { nodes { id state body viewerDidAuthor author { login } comments(first: 1) { totalCount } } } } }. Variables { owner, name, number, author } with author null when not given. The states list is constant text.
 */
export function pendingReviewQuery(p: { owner: string; name: string; number: number; author?: string }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $number: Int!, $author: String) {
  viewer { login }
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { id reviews(states: [PENDING], author: $author, first: 10) { nodes { id state body viewerDidAuthor author { login } comments(first: 1) { totalCount } } } } }
}`,
    variables: { owner: p.owner, name: p.name, number: p.number, author: p.author ?? null },
  };
}

export interface PendingReview {
  id: string;
  /** comments.totalCount. */
  commentCount: number;
  body: string;
}

/**
 * The viewer's own PENDING review from a pendingReviewQuery response, or null. A node counts when its state is PENDING and it was authored by the viewer
 * (viewerDidAuthor is true, or author.login equals viewerLogin ignoring case). Someone else's PENDING node, other states, null nodes and missing data give null. A missing comments count is 0.
 */
export function toPendingReview(
  data: { repository?: { pullRequest?: { reviews?: { nodes?: ({ id: string; state: string; body?: string | null; viewerDidAuthor?: boolean; author?: { login: string } | null; comments?: { totalCount: number } | null } | null)[] } | null } | null } | null } | null | undefined,
  viewerLogin: string,
): PendingReview | null {
  for (const n of data?.repository?.pullRequest?.reviews?.nodes ?? []) {
    if (!n || n.state !== "PENDING") continue;
    if (n.viewerDidAuthor || (n.author && n.author.login.toLowerCase() === viewerLogin.toLowerCase())) return { id: n.id, commentCount: n.comments?.totalCount ?? 0, body: n.body ?? "" };
  }
  return null;
}

/** Whether the Submit button is enabled. APPROVE always. COMMENT and REQUEST_CHANGES need a non-blank body or at least one pending comment. */
export function canSubmitReview(p: { event: SubmitEvent; body: string; pendingCount: number }): boolean {
  return p.event === "APPROVE" || !blank(p.body) || p.pendingCount > 0;
}

// ---- the feed ------------------------------------------------------------------------------------------------------------------------------------

export interface PendingAwareComment extends ReviewThreadCommentNode {
  /** PullRequestReviewComment.state; absent is treated as SUBMITTED. */
  state?: "PENDING" | "SUBMITTED";
}

export interface PendingAwareThread extends Omit<ReviewThreadNode, "comments"> {
  comments: { nodes: (PendingAwareComment | null)[] };
}

export interface PendingFeedComment extends FeedComment {
  /** True for a comment of the viewer's unsubmitted review: the UI labels it PENDING_LABEL. */
  pending?: boolean;
}

export interface PendingThreadItem extends Omit<ThreadItem, "comments"> {
  comments: PendingFeedComment[];
}

/**
 * feedModel.toFeed for one viewer. Before the threads reach toFeed:
 *  - a PENDING comment whose author is not `viewerLogin` (ignoring case; a deleted author counts as not the viewer, as does a null viewerLogin) is dropped, and a thread left with no comments is dropped.
 * After toFeed, every remaining PENDING comment has `pending: true`; other comments have no `pending` key (or it is false). Ordering, grouping and everything else is toFeed's.
 */
export function toFeedForViewer(
  timeline: (TimelineNode | null)[],
  threads: (PendingAwareThread | null)[],
  pr: FeedPr,
  viewerLogin: string | null,
): (CommentItem | EventItem | PendingThreadItem)[] {
  const me = viewerLogin?.toLowerCase() ?? null;
  const pending = new Set<string>();
  const visible: ReviewThreadNode[] = [];
  for (const t of threads) {
    if (!t) continue;
    const nodes = t.comments.nodes.filter((c): c is PendingAwareComment => {
      if (!c) return false;
      if (c.state !== "PENDING") return true;
      if (me === null || !c.author || c.author.login.toLowerCase() !== me) return false;
      pending.add(c.id);
      return true;
    });
    if (nodes.length) visible.push({ ...t, comments: { nodes } });
  }
  return toFeed(timeline, visible, pr).map((i) => (i.kind === "thread" ? { ...i, comments: i.comments.map((c) => (pending.has(c.id) ? { ...c, pending: true } : c)) } : i));
}

/** How many comments in thread items carry `pending: true`. Other items are ignored. */
export function countPendingComments(items: FeedItem[]): number {
  let n = 0;
  for (const i of items) if (i.kind === "thread") for (const c of i.comments as PendingFeedComment[]) if (c.pending) n++;
  return n;
}

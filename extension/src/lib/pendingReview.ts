// Batch 3, pending reviews (CM-3). STUBS: the developer implements them. Every function throws "Not implemented" except the constants.
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

const NOT_IMPLEMENTED = "Not implemented";

/** `mutation($input: AddPullRequestReviewInput!) { addPullRequestReview(input: $input) { pullRequestReview { id state } } }`. variables.input is exactly { pullRequestId }: no `event`, so the review is PENDING. Throws "pullRequestId is required". */
export function startReviewMutation(_pullRequestId: string): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * `mutation($input: SubmitPullRequestReviewInput!) { submitPullRequestReview(input: $input) { pullRequestReview { id state } } }`.
 * variables.input: { pullRequestReviewId, event, body? } with body left out when undefined and otherwise sent exactly as given (an empty string is allowed).
 * Throws "reviewId is required" for a blank id and "event must be COMMENT, APPROVE or REQUEST_CHANGES" for anything else (DISMISS included).
 */
export function submitReviewMutation(_p: { reviewId: string; event: SubmitEvent; body?: string }): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

/** `mutation($input: DeletePullRequestReviewInput!) { deletePullRequestReview(input: $input) { pullRequestReview { id state } } }`. variables.input { pullRequestReviewId }. Throws "reviewId is required". */
export function discardReviewMutation(_reviewId: string): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * A reply that joins the pending review: `mutation($input: AddPullRequestReviewThreadReplyInput!) { addPullRequestReviewThreadReply(input: $input) { comment { id url bodyHTML createdAt author { login avatarUrl } state } } }`.
 * variables.input { pullRequestReviewThreadId, pullRequestReviewId, body }. Throws "body is required" for a blank body, "threadId is required" and "reviewId is required" for blank ids.
 */
export function pendingReplyMutation(_threadId: string, _reviewId: string, _body: string): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * `query($owner: String!, $name: String!, $number: Int!, $author: String)` over viewer { login } and repository(...) { pullRequest(number: $number) { id reviews(states: [PENDING], author: $author, first: 10)
 * { nodes { id state body viewerDidAuthor author { login } comments(first: 1) { totalCount } } } } }. Variables { owner, name, number, author } with author null when not given. The states list is constant text.
 */
export function pendingReviewQuery(_p: { owner: string; name: string; number: number; author?: string }): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
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
  _data: { repository?: { pullRequest?: { reviews?: { nodes?: ({ id: string; state: string; body?: string | null; viewerDidAuthor?: boolean; author?: { login: string } | null; comments?: { totalCount: number } | null } | null)[] } | null } | null } | null } | null | undefined,
  _viewerLogin: string,
): PendingReview | null {
  throw new Error(NOT_IMPLEMENTED);
}

/** Whether the Submit button is enabled. APPROVE always. COMMENT and REQUEST_CHANGES need a non-blank body or at least one pending comment. */
export function canSubmitReview(_p: { event: SubmitEvent; body: string; pendingCount: number }): boolean {
  throw new Error(NOT_IMPLEMENTED);
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
  _timeline: (TimelineNode | null)[],
  _threads: (PendingAwareThread | null)[],
  _pr: FeedPr,
  _viewerLogin: string | null,
): (CommentItem | EventItem | PendingThreadItem)[] {
  throw new Error(NOT_IMPLEMENTED);
}

/** How many comments in thread items carry `pending: true`. Other items are ignored. */
export function countPendingComments(_items: FeedItem[]): number {
  throw new Error(NOT_IMPLEMENTED);
}

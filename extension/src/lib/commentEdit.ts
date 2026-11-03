// Batch 3, editing, deleting, edit history and minimising comments (CM-4, CM-5, CM-6). STUBS: the developer implements them. Every function throws "Not implemented" except the constants.
//
// Schema facts (checked live with `gh api graphql`; mutations were run with bogus node ids, so they passed validation and wrote nothing):
//  CM-4 edit and delete
//  - updateIssueComment(input: UpdateIssueCommentInput! { id: ID!, body: String! }) -> { issueComment { id body bodyHTML lastEditedAt } }.
//  - updatePullRequestReviewComment(input: UpdatePullRequestReviewCommentInput! { pullRequestReviewCommentId: ID!, body: String! }) -> { pullRequestReviewComment { ... } }.
//  - updatePullRequestReview(input: UpdatePullRequestReviewInput! { pullRequestReviewId: ID!, body: String! }) -> { pullRequestReview { ... } }. Edits the review's own body only.
//  - deleteIssueComment(input: DeleteIssueCommentInput! { id: ID! }) -> { clientMutationId } (no node comes back, so the UI removes the comment itself).
//  - deletePullRequestReviewComment(input: DeletePullRequestReviewCommentInput! { id: ID! }) -> { pullRequestReview { id } pullRequestReviewComment { id } }.
//  - There is NO delete mutation for a submitted PullRequestReview (deletePullRequestReview only works on a PENDING one: pendingReview.ts discardReviewMutation).
//  - IssueComment, PullRequestReviewComment and PullRequestReview all have viewerCanUpdate, viewerCanDelete, viewerCanMinimize, viewerCanUnminimize, isMinimized, minimizedReason, lastEditedAt,
//    includesCreatedEdit and userContentEdits (the Comment and Minimizable interfaces). viewerDidAuthor comes from Comment. PullRequestReviewComment also has state PENDING | SUBMITTED.
//  - Query nodes(ids: [ID!]!) accepts at most 100 ids ("You may not provide more than 100 node ids; you provided 101", ARGUMENT_LIMIT), so ids are sent in chunks of 100.
//  CM-5 edit history
//  - UserContentEdit fields: id, editedAt, createdAt, updatedAt, deletedAt, deletedBy, editor (Actor, nullable), diff (String, nullable).
//  - `diff` EXISTS but is NOT a unified diff: read live on microsoft/vscode and facebook/react bot comments it is the FULL TEXT of the comment as it stood after that edit (the newest node's diff starts with the
//    same markdown as the comment's current body). It is null when an edit's content was deleted (deletedAt set). `createdAt` on the edit record is when the record was stored and is unreliable; order by editedAt.
//  - userContentEdits(first: 20) returns newest first. With includesCreatedEdit true the OLDEST node is the creation itself: its editedAt equals the comment's createdAt (confirmed live:
//    comment createdAt 2026-10-02T01:02:01Z, oldest node editedAt 2026-10-02T01:02:01Z, 4 nodes for 3 edits). Totals are available as userContentEdits.totalCount.
//  - `... on Comment { userContentEdits(first: 20) { nodes { ... } } }` works inside node(id:), so one history query serves all three comment types.
//  CM-6 minimise
//  - minimizeComment(input: MinimizeCommentInput! { subjectId: ID!, classifier: ReportedContentClassifiers! }) -> { minimizedComment { isMinimized minimizedReason viewerCanMinimize viewerCanUnminimize } }.
//    unminimizeComment(input: UnminimizeCommentInput! { subjectId: ID! }) -> { unminimizedComment { ... } }.
//  - ReportedContentClassifiers = SPAM | ABUSE | OFF_TOPIC | OUTDATED | DUPLICATE | RESOLVED | LOW_QUALITY. The requirement lists the first six, which are what GitHub's menu offers; LOW_QUALITY exists in the
//    schema and is refused here (decision).
//  - minimizedReason is a String whose case differs from the input: "abuse", "off-topic", "outdated", "resolved", "duplicate", "spam", "low-quality" (schema description: "the case and formatting of these values
//    differs from the inputs to the MinimizeComment mutation"). The label therefore maps these lower-case, hyphenated strings.
import type { GraphQlRequest } from "./prQuery";
import type { FeedItem } from "./feedModel";
import type { RawReactionGroup } from "./reactions";

export type CommentKind = "IssueComment" | "PullRequestReviewComment" | "PullRequestReview";

/** The six classifiers GitHub's menu offers, in its order. */
export const MINIMIZE_CLASSIFIERS = ["SPAM", "ABUSE", "OFF_TOPIC", "OUTDATED", "DUPLICATE", "RESOLVED"] as const;
export type MinimizeClassifier = (typeof MINIMIZE_CLASSIFIERS)[number];

/** Newest first, as GitHub returns them; `first: 20` is the page size of editHistoryQuery. */
export const EDIT_HISTORY_PAGE = 20;

const NOT_IMPLEMENTED = "Not implemented";

// ---- CM-4: edit and delete -----------------------------------------------------------------------------------------------------------------------

/**
 * The mutation for editing `comment`, chosen by its __typename:
 *  IssueComment -> updateIssueComment, input { id, body }; PullRequestReviewComment -> updatePullRequestReviewComment, input { pullRequestReviewCommentId, body };
 *  PullRequestReview -> updatePullRequestReview, input { pullRequestReviewId, body }.
 * Each is `mutation($input: <InputType>!) { <field>(input: $input) { <node> { id body bodyHTML lastEditedAt } } }`. The body is sent exactly as given.
 * Throws "unsupported comment type" for any other __typename and "body is required" for a blank body.
 */
export function editCommentMutation(_comment: { __typename: string; id: string }, _body: string): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * The mutation for deleting `comment`: IssueComment -> deleteIssueComment, input { id }; PullRequestReviewComment -> deletePullRequestReviewComment, input { id }.
 * Throws "a submitted review cannot be deleted" for PullRequestReview and "unsupported comment type" for any other __typename.
 */
export function deleteCommentMutation(_comment: { __typename: string; id: string }): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

export interface CommentFlags {
  __typename: string;
  viewerCanUpdate?: boolean | null;
  viewerCanDelete?: boolean | null;
  viewerCanMinimize?: boolean | null;
  viewerCanUnminimize?: boolean | null;
  isMinimized?: boolean | null;
}

export interface CommentActions {
  canEdit: boolean;
  canDelete: boolean;
  canMinimize: boolean;
  canUnminimize: boolean;
}

/**
 * Which buttons a comment gets.
 *  canEdit = viewerCanUpdate for the three known types. canDelete = viewerCanDelete for IssueComment and PullRequestReviewComment only (a submitted review has no delete mutation).
 *  canMinimize = viewerCanMinimize and not already minimised. canUnminimize = viewerCanUnminimize and minimised. A missing or null flag is false; an unknown __typename gives all false.
 */
export function commentActions(_c: CommentFlags): CommentActions {
  throw new Error(NOT_IMPLEMENTED);
}

/** Removes the comment from the feed's optimistic state: a top-level comment item is removed; a thread comment is removed and the thread's `date` and `lastActivity` recomputed from what is left; a thread left with no comments is removed. Items keep their positions. Pure; an unknown id returns an equal array. */
export function applyCommentDelete(_items: FeedItem[], _commentId: string): FeedItem[] {
  throw new Error(NOT_IMPLEMENTED);
}

/** Sets the rendered `html` of the comment (top-level or inside a thread) after an edit. Pure; an unknown id returns an equal array. */
export function applyCommentEdit(_items: FeedItem[], _commentId: string, _html: string): FeedItem[] {
  throw new Error(NOT_IMPLEMENTED);
}

// ---- reading comment metadata --------------------------------------------------------------------------------------------------------------------

/**
 * Metadata for comments the feed already shows, looked up by node id so feedQuery.ts needs no change:
 * `query($ids: [ID!]!) { nodes(ids: $ids) { __typename id ... on IssueComment { body viewerDidAuthor lastEditedAt includesCreatedEdit viewerCanUpdate viewerCanDelete viewerCanMinimize viewerCanUnminimize isMinimized minimizedReason viewerCanReact reactionGroups { content reactors { totalCount } viewerHasReacted } }
 *  ... on PullRequestReviewComment { state <same fields> } ... on PullRequestReview { state <same fields> } } }`. Variables { ids }.
 * Returns one request per 100 distinct ids, in first-seen order; [] for no ids. Blank ids are dropped.
 */
export function commentMetaQueries(_ids: string[]): GraphQlRequest[] {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * `query($id: ID!) { node(id: $id) { __typename id ... on Comment { lastEditedAt includesCreatedEdit userContentEdits(first: 20) { totalCount nodes { editedAt deletedAt editor { login } diff } } } } }`.
 * Variables { id }. Throws "id is required" for a blank id.
 */
export function editHistoryQuery(_id: string): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

export interface EditEntry {
  editedAt: Date;
  /** Login; "ghost" when the editor account is gone. */
  editor: string;
  /** The full text of the comment after this edit (GraphQL `diff`); null when that content was deleted. */
  body: string | null;
  /** deletedAt was set: GitHub removed this revision's content. */
  deleted: boolean;
  /** True for the oldest entry when includesCreatedEdit is true: it is the comment as first written, not an edit. */
  isCreation: boolean;
}

export interface EditInfo {
  /** lastEditedAt is set. */
  edited: boolean;
  /** "Edited" when edited, otherwise null. */
  label: "Edited" | null;
  lastEditedAt: Date | null;
  /** Newest first (sorted by editedAt, ties keep GitHub's order). Null nodes are skipped. Empty when never edited. */
  history: EditEntry[];
}

export interface EditSource {
  lastEditedAt?: string | null;
  includesCreatedEdit?: boolean | null;
  userContentEdits?: { nodes?: ({ editedAt: string; deletedAt?: string | null; editor?: { login: string } | null; diff?: string | null } | null)[] | null } | null;
}

/** The "Edited" label and history list for one comment node (see EditInfo). */
export function toEditInfo(_node: EditSource): EditInfo {
  throw new Error(NOT_IMPLEMENTED);
}

export interface MinimizedView {
  collapsed: boolean;
  /** "This comment was marked as {reason}" when collapsed, else null. */
  label: string | null;
}

/**
 * Collapsed with a label when isMinimized. The reason is minimizedReason, matched ignoring case and with "_" read as "-": abuse, off-topic, outdated, resolved, duplicate, spam are shown as they are,
 * "low-quality" as "low quality", any other text as given. A minimised comment with no reason reads "This comment was hidden". Not minimised: { collapsed: false, label: null }.
 */
export function toMinimizedView(_node: { isMinimized?: boolean | null; minimizedReason?: string | null }): MinimizedView {
  throw new Error(NOT_IMPLEMENTED);
}

export interface CommentMeta {
  id: string;
  kind: CommentKind;
  /** The raw markdown, for the edit box. */
  body: string;
  viewerDidAuthor: boolean;
  /** PullRequestReviewComment.state is PENDING. */
  pending: boolean;
  actions: CommentActions;
  edit: EditInfo;
  minimized: MinimizedView;
  /** Viewer may react (viewerCanReact; false when missing). */
  viewerCanReact: boolean;
  /** Raw reactionGroups, for reactions.normaliseReactions; [] when missing. */
  reactionGroups: RawReactionGroup[];
}

/** One `nodes` entry of a commentMetaQueries response as a CommentMeta, or null for null and for any other __typename. */
export function toCommentMeta(_node: (CommentFlags & EditSource & { id: string; body?: string | null; state?: string; viewerDidAuthor?: boolean | null; minimizedReason?: string | null; viewerCanReact?: boolean | null; reactionGroups?: RawReactionGroup[] | null }) | null): CommentMeta | null {
  throw new Error(NOT_IMPLEMENTED);
}

// ---- CM-6: minimise ------------------------------------------------------------------------------------------------------------------------------

/** `mutation($input: MinimizeCommentInput!) { minimizeComment(input: $input) { minimizedComment { isMinimized minimizedReason viewerCanMinimize viewerCanUnminimize } } }`. Input { subjectId, classifier }. Throws "subjectId is required" and "classifier must be one of SPAM, ABUSE, OFF_TOPIC, OUTDATED, DUPLICATE, RESOLVED". */
export function minimizeMutation(_subjectId: string, _classifier: MinimizeClassifier): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

/** `mutation($input: UnminimizeCommentInput!) { unminimizeComment(input: $input) { unminimizedComment { isMinimized minimizedReason viewerCanMinimize viewerCanUnminimize } } }`. Input { subjectId }. Throws "subjectId is required". */
export function unminimizeMutation(_subjectId: string): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

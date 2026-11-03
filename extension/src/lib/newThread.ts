// Batch 3, new line and file comments (CM-1). STUBS: the developer implements them. Every function throws "Not implemented" except the types.
//
// Schema facts (checked live with `gh api graphql`; mutations were run with bogus node ids, so they passed validation and wrote nothing):
//  - mutation addPullRequestReviewThread(input: AddPullRequestReviewThreadInput!) takes { path: String, body: String!, pullRequestId: ID, pullRequestReviewId: ID, line: Int, side: DiffSide,
//    startLine: Int, startSide: DiffSide, subjectType: PullRequestReviewThreadSubjectType }. Only `body` is non-null in the schema; GitHub documents `line` as "required for line-level threads".
//    pullRequestId ("the node ID of the pull request reviewing") and pullRequestReviewId ("the Node ID of the review to modify") are alternatives, so a thread added to a pending review
//    sends pullRequestReviewId and NOT pullRequestId. For a multi-line range `line` and `side` are the END of the range; startLine and startSide the first line.
//  - Enums: DiffSide = LEFT | RIGHT; PullRequestReviewThreadSubjectType = LINE | FILE (a FILE thread has no line or side).
//  - Payload `thread` is a PullRequestReviewThread: the selection below is the same shape feedQuery.ts reads, so feedModel.toFeed can render the new thread unchanged.
//  - PullRequestReviewThread has isOutdated, subjectType, originalLine, originalStartLine, startDiffSide, viewerCanReply, viewerCanResolve.
//  - REST GET /pulls/{n}/files returns `patch` (unified diff hunks, no file header; absent for binary and very large files); prFiles.ts carries it as PrFile.patch.
//  - A line comment is only accepted on a line that is inside a diff hunk: RIGHT for added and context lines (new file numbering), LEFT for deleted and context lines (old file numbering).
//    A multi-line range must lie inside ONE hunk (GitHub answers 422 "start_line must be part of the same hunk as the line" otherwise). The 422 text is recalled from the REST API
//    and is NOT exercised live (it needs a real write), so the same-hunk rule is a decision made from documented behaviour.
import type { GraphQlRequest } from "./prQuery";
import type { FeedItem, ThreadItem } from "./feedModel";

export type DiffSide = "LEFT" | "RIGHT";
/** Which Monaco editor a line number belongs to: the original (base) file or the modified (head) file. Inline and side-by-side layouts report the same thing, so the layout does not matter here. */
export type DiffEditor = "original" | "modified";

export interface DiffPoint {
  /** 1-based Monaco line number in that editor. */
  line: number;
  editor: DiffEditor;
}

/** A selection in the diff. `start` and `end` may be in either order (the user can drag upwards). */
export interface DiffSelection {
  start: DiffPoint;
  end: DiffPoint;
}

export interface LineTarget {
  subjectType: "LINE";
  path: string;
  /** End of the range. */
  line: number;
  side: DiffSide;
  /** Only for a multi-line range. */
  startLine?: number;
  startSide?: DiffSide;
}

export interface FileTarget {
  subjectType: "FILE";
  path: string;
}

export type ThreadTarget = LineTarget | FileTarget;

export interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

const NOT_IMPLEMENTED = "Not implemented";

/** Hunk headers of a unified-diff `patch` in order. `@@ -a,b +c,d @@`; an omitted count means 1. An empty patch gives []. */
export function parsePatch(_patch: string): PatchHunk[] {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Monaco selection to a GitHub line target. original -> LEFT, modified -> RIGHT.
 *  - one line (same line and editor): { line, side } only.
 *  - a range: line/side are the END, startLine/startSide the start, both always sent.
 *  - same editor with the points reversed: swapped so startLine <= line. Different editors: the original (LEFT) point is the start.
 * Throws "line must be a positive integer" for a line below 1 or not an integer, and "path is required" for a blank path.
 */
export function toThreadTarget(_path: string, _sel: DiffSelection): LineTarget {
  throw new Error(NOT_IMPLEMENTED);
}

/** A whole-file thread (subjectType FILE). Throws "path is required" for a blank path. */
export function fileTarget(_path: string): FileTarget {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * True when `target` can be commented on given the file's REST `patch`: every end of the range is a line inside a hunk on its own side
 * (RIGHT: added and context lines, LEFT: deleted and context lines) AND the whole range lies in one hunk. A missing, null or empty patch (binary, very large,
 * pure rename) gives false: line comments are impossible there, a FILE thread is still possible.
 */
export function isCommentable(_patch: string | null | undefined, _target: LineTarget): boolean {
  throw new Error(NOT_IMPLEMENTED);
}

export interface AddThreadParams {
  pullRequestId: string;
  /** A PENDING review to attach to (CM-3); when set the input carries pullRequestReviewId instead of pullRequestId. */
  reviewId?: string;
  body: string;
  target: ThreadTarget;
}

/**
 * `mutation($input: AddPullRequestReviewThreadInput!) { addPullRequestReviewThread(input: $input) { thread { ...feedQuery review thread fields... } } }`.
 * variables.input: { pullRequestId | pullRequestReviewId, path, body, subjectType, and for LINE line, side, startLine?, startSide? }. A FILE target sends no line or side.
 * The body is sent exactly as given. Throws "body is required" for a blank body, "pullRequestId is required" for a blank id when no reviewId is given.
 */
export function addThreadMutation(_p: AddThreadParams): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

/** Adds a new thread, newest first by its first comment's date (same ordering rule as feedState.applyComment). Pure; the input array is not changed. */
export function applyNewThread(_items: FeedItem[], _thread: ThreadItem): FeedItem[] {
  throw new Error(NOT_IMPLEMENTED);
}

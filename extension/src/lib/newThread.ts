// Batch 3, new line and file comments (CM-1). 
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

import { THREAD_FIELDS } from "./feedQuery";
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
const blank = (s: string) => !s.trim();


/** Hunk headers of a unified-diff `patch` in order. `@@ -a,b +c,d @@`; an omitted count means 1. An empty patch gives []. */
export function parsePatch(patch: string): PatchHunk[] {
  return [...(patch ?? "").matchAll(HUNK)].map((m) => ({ oldStart: +m[1], oldCount: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newCount: m[4] === undefined ? 1 : +m[4] }));
}

/**
 * Monaco selection to a GitHub line target. original -> LEFT, modified -> RIGHT.
 *  - one line (same line and editor): { line, side } only.
 *  - a range: line/side are the END, startLine/startSide the start, both always sent.
 *  - same editor with the points reversed: swapped so startLine <= line. Different editors: the original (LEFT) point is the start.
 * Throws "line must be a positive integer" for a line below 1 or not an integer, and "path is required" for a blank path.
 */
export function toThreadTarget(path: string, sel: DiffSelection): LineTarget {
  if (blank(path)) throw new Error("path is required");
  for (const p of [sel.start, sel.end]) if (!Number.isInteger(p.line) || p.line < 1) throw new Error("line must be a positive integer");
  const side = (p: DiffPoint): DiffSide => (p.editor === "original" ? "LEFT" : "RIGHT");
  let { start, end } = sel;
  if (start.editor === end.editor && start.line === end.line) return { subjectType: "LINE", path, line: end.line, side: side(end) };
  const swap = start.editor === end.editor ? start.line > end.line : start.editor === "modified";
  if (swap) [start, end] = [end, start];
  return { subjectType: "LINE", path, line: end.line, side: side(end), startLine: start.line, startSide: side(start) };
}

/** A whole-file thread (subjectType FILE). Throws "path is required" for a blank path. */
export function fileTarget(path: string): FileTarget {
  if (blank(path)) throw new Error("path is required");
  return { subjectType: "FILE", path };
}

/**
 * True when `target` can be commented on given the file's REST `patch`: every end of the range is a line inside a hunk on its own side
 * (RIGHT: added and context lines, LEFT: deleted and context lines) AND the whole range lies in one hunk. A missing, null or empty patch (binary, very large,
 * pure rename) gives false: line comments are impossible there, a FILE thread is still possible.
 */
export function isCommentable(patch: string | null | undefined, target: LineTarget): boolean {
  if (!patch) return false;
  const hunks = parsePatch(patch);
  const find = (line: number, side: DiffSide) =>
    hunks.findIndex((h) => (side === "LEFT" ? line >= h.oldStart && line < h.oldStart + h.oldCount : line >= h.newStart && line < h.newStart + h.newCount));
  const end = find(target.line, target.side);
  if (end < 0) return false;
  return target.startLine === undefined || find(target.startLine, target.startSide ?? target.side) === end;
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
export function addThreadMutation(p: AddThreadParams): GraphQlRequest {
  if (blank(p.body)) throw new Error("body is required");
  if (!p.reviewId && blank(p.pullRequestId)) throw new Error("pullRequestId is required");
  const t = p.target;
  const input: Record<string, unknown> = { ...(p.reviewId ? { pullRequestReviewId: p.reviewId } : { pullRequestId: p.pullRequestId }), path: t.path, body: p.body, subjectType: t.subjectType };
  if (t.subjectType === "LINE") {
    input.line = t.line;
    input.side = t.side;
    if (t.startLine !== undefined) {
      input.startLine = t.startLine;
      input.startSide = t.startSide ?? t.side;
    }
  }
  return { query: `mutation($input: AddPullRequestReviewThreadInput!) { addPullRequestReviewThread(input: $input) { thread { ${THREAD_FIELDS} } } }`, variables: { input } };
}

/** Adds a new thread, newest first by its first comment's date (same ordering rule as feedState.applyComment). Pure; the input array is not changed. */
export function applyNewThread(items: FeedItem[], thread: ThreadItem): FeedItem[] {
  const at = items.findIndex((i) => i.date.getTime() <= thread.date.getTime());
  return at < 0 ? [...items, thread] : [...items.slice(0, at), thread, ...items.slice(at)];
}

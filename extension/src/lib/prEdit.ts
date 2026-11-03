// Batch 2, editing a pull request: title and description (ED-1), work items in the body (ED-4), linked issues (ED-8) and the permission rules (ED-9).
// STUBS: the developer implements them. Every function throws "Not implemented" except the constants.
//
// Schema facts (checked live with `gh api graphql`; mutations were run with bogus node ids, so they passed validation and wrote nothing):
//  - mutation updatePullRequest(input: UpdatePullRequestInput!) takes { pullRequestId: ID!, title, body, milestoneId: ID, baseRefName, state, maintainerCanModify, assigneeIds, labelIds, projectIds }.
//    Payload selection { pullRequest { id title body milestone { id number title dueOn } } } validates.
//  - PullRequest has viewerCanUpdate, viewerCanLabel and viewerCanAssign (also viewerCanClose, viewerCanReopen...). It has NO per-field flag for title, body, reviewers or milestone,
//    so those follow viewerCanUpdate. Labels follow viewerCanLabel and assignees follow viewerCanAssign (a triager can label and assign without being able to edit the text).
//  - closingIssuesReferences(first: 20) { nodes { number title state url } } validates. Its args userLinkedOnly / excludeUserLinked exist: issues linked in the sidebar are NOT in the body,
//    so only issues whose "Closes #n" line is in the body can be removed by editing the body (see isClosingIssueRemovable).
//  - A body read from GitHub uses CRLF line endings when it was written in the web editor ("...\r\n\r\n..."). Compare and edit bodies without disturbing them.
//  - Title limit 256 and body limit 65536 characters are GitHub's validation messages ("Title is too long (maximum is 256 characters)"); NOT documented in the schema or REST docs and NOT
//    exercised live (it needs a real write). Treated as UTF-16-agnostic: count Unicode code points, not UTF-16 units.
//  - pullRequest.reviewRequests.nodes[].requestedReviewer can be null with asCodeOwner true (seen live on cli/cli#14846: a team the viewer cannot see).
import type { GraphQlRequest } from "./prQuery";

export const MAX_TITLE_LENGTH = 256;
export const MAX_BODY_LENGTH = 65536;

const NOT_IMPLEMENTED = () => new Error("Not implemented");

// ---- ED-1: edit title and description -------------------------------------------------------------------------------------------------------------

/** Raw `pullRequest` node of prEditQuery. Projects have their own query (projects.ts projectItemsQuery) because they need the read:project scope and would fail this whole query without it. */
export interface PrEditNode {
  id: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  title: string;
  body: string | null;
  author: { login: string } | null;
  viewerCanUpdate: boolean;
  viewerCanLabel: boolean;
  viewerCanAssign: boolean;
  reviewRequests: { nodes: { asCodeOwner: boolean; requestedReviewer: { __typename: string; id?: string; login?: string; slug?: string; name?: string | null; avatarUrl?: string } | null }[] };
  assignees: { nodes: { id: string; login: string; name?: string | null; avatarUrl?: string }[] };
  labels: { nodes: { id: string; name: string; color: string; description?: string | null }[] };
  milestone: { id: string; number: number; title: string; dueOn: string | null; state: string } | null;
  closingIssuesReferences: { nodes: LinkedIssue[] };
}

/**
 * `query($owner: String!, $name: String!, $number: Int!)` over repository(owner: $owner, name: $name) { pullRequest(number: $number) { ... } } selecting id state title body author { login },
 * viewerCanUpdate viewerCanLabel viewerCanAssign, reviewRequests(first: 50) { nodes { asCodeOwner requestedReviewer { __typename ... on User { id login name avatarUrl } ... on Team { id slug name avatarUrl }
 * ... on Bot { id login avatarUrl } } } }, assignees(first: 20), labels(first: 50) { nodes { id name color description } }, milestone { id number title dueOn state }
 * and closingIssuesReferences(first: 20) { nodes { number title state url } }. Variables { owner, name, number }.
 */
export function prEditQuery(_p: { owner: string; name: string; number: number }): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

export interface UpdatePullRequestInput {
  pullRequestId: string;
  title?: string;
  body?: string;
  /** null clears the milestone: the key must be present with the value null. undefined means "do not touch". */
  milestoneId?: string | null;
}

/**
 * `mutation($input: UpdatePullRequestInput!) { updatePullRequest(input: $input) { pullRequest { id title body milestone { id number title dueOn } } } }`.
 * variables.input carries pullRequestId plus exactly the keys that are not undefined (null is kept). Throws "pullRequestId is required" when it is blank.
 */
export function updatePullRequestMutation(_input: UpdatePullRequestInput): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

export type TitleBodyPlan =
  /** `input` is null when nothing changed: send no mutation. Otherwise it holds pullRequestId and only the changed keys. */
  | { ok: true; input: { pullRequestId: string; title?: string; body?: string } | null }
  | { ok: false; field: "title" | "body"; error: string };

/**
 * Plans an edit of the title and / or description against the current values.
 *  - title: trimmed. Empty after trimming is refused ("required"); more than MAX_TITLE_LENGTH code points is refused (the message names 256). Equal to the current title: omitted.
 *  - body: sent as given (not trimmed). More than MAX_BODY_LENGTH code points is refused. An empty body is allowed (it clears the description). Equal to the current body ignoring CRLF vs LF, with a
 *    null current body counting as "": omitted.
 *  - an invalid field refuses the whole plan (no partial update). A field left undefined is neither validated nor sent.
 */
export function planTitleBodyUpdate(_pullRequestId: string, _current: { title: string; body?: string | null }, _edit: { title?: string; body?: string }): TitleBodyPlan {
  throw NOT_IMPLEMENTED();
}

// ---- ED-4: work items in the body -----------------------------------------------------------------------------------------------------------------

/**
 * Links Azure Boards work item `id` by mentioning AB#id in the body (the GitHub-Boards integration). null / undefined body counts as "".
 *  - already mentioned (as workItems.ts findWorkItemIds sees it: not in code, a whole number so AB#1234 is not AB#123): returns the body unchanged, byte for byte.
 *  - the last non-blank line consists only of AB#n mentions separated by spaces: appends " AB#id" to it.
 *  - otherwise: the trimmed-end body, a blank line, then "AB#id" (an empty body gives just "AB#id"). The result has no trailing newline.
 *  - new line breaks match the body: "\r\n" when the body uses CRLF, else "\n".
 * Throws "work item id must be a positive integer" for 0, negatives and non-integers.
 */
export function addWorkItemToBody(_body: string | null | undefined, _id: number): string {
  throw NOT_IMPLEMENTED();
}

/**
 * Removes every real AB#id mention (case-insensitive, not inside code, whole number only) and touches nothing else.
 *  - a mention takes the spaces before it with it (at the start of a line, the spaces after it): "Fixes AB#12 today" -> "Fixes today", "AB#1 AB#2" minus 1 -> "AB#2".
 *  - a line left empty by the removal is deleted, and so is one blank line if that would leave two in a row; a body that then ends in blank lines is trimmed at the end.
 *  - id absent: returns the body unchanged, byte for byte. null / undefined gives "".
 */
export function removeWorkItemFromBody(_body: string | null | undefined, _id: number): string {
  throw NOT_IMPLEMENTED();
}

// ---- ED-8: linked issues ---------------------------------------------------------------------------------------------------------------------------

export interface LinkedIssue {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  url: string;
}

/**
 * Issue numbers the body closes with GitHub's keywords: close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved (case-insensitive), then an optional ":", spaces, and "#n".
 * Whole words only ("prefixes #5" is not "fixes #5"); same-repository "#n" only (not "owner/repo#5"); not inside code spans or fences. Unique, first-seen order.
 */
export function findClosingIssueNumbers(_body: string | null | undefined): number[] {
  throw NOT_IMPLEMENTED();
}

/**
 * Adds "Closes #n". Already closed by any keyword: body unchanged. The line goes straight under an existing trailing keyword line ("Closes #1\nCloses #2": each reference needs its own keyword),
 * otherwise after a blank line like addWorkItemToBody. Same line-break rules as addWorkItemToBody. Throws "issue number must be a positive integer" for 0, negatives and non-integers.
 */
export function addClosingIssueToBody(_body: string | null | undefined, _issueNumber: number): string {
  throw NOT_IMPLEMENTED();
}

/**
 * A keyword line we can parse: the whole line is [list marker "- " or "* "] KEYWORD [":"] " #n" and nothing else (case-insensitive). Removing deletes that line (and tidies blank lines like
 * removeWorkItemFromBody). Prose ("This closes #12 and more"), several references on one line and anything else is left alone: the body comes back unchanged.
 */
export function removeClosingIssueFromBody(_body: string | null | undefined, _issueNumber: number): string {
  throw NOT_IMPLEMENTED();
}

/** true when removeClosingIssueFromBody would change the body, i.e. a parsable keyword line for the issue exists. */
export function isClosingIssueRemovable(_body: string | null | undefined, _issueNumber: number): boolean {
  throw NOT_IMPLEMENTED();
}

export interface LinkedIssueRow extends LinkedIssue {
  /** Whether the "remove" action is offered: false for issues linked in the sidebar or through prose, which editing the body cannot undo. */
  removable: boolean;
}

/** closingIssuesReferences nodes in order, each with `removable` from isClosingIssueRemovable(body, number). Missing nodes give []. */
export function toLinkedIssueRows(_nodes: LinkedIssue[] | null | undefined, _body: string | null | undefined): LinkedIssueRow[] {
  throw NOT_IMPLEMENTED();
}

// ---- ED-9: permissions ------------------------------------------------------------------------------------------------------------------------------

export type EditField = "title" | "body" | "reviewers" | "assignees" | "labels" | "milestone" | "projects" | "workItems" | "closingIssues";

export interface EditContext {
  state: "OPEN" | "CLOSED" | "MERGED";
  viewerCanUpdate: boolean;
  /** PullRequest.viewerCanLabel; undefined when the query did not select it (falls back to viewerCanUpdate). */
  viewerCanLabel?: boolean;
  /** PullRequest.viewerCanAssign; undefined when the query did not select it (falls back to viewerCanUpdate). */
  viewerCanAssign?: boolean;
}

/**
 * Which edits the page offers. Hidden (false) on CLOSED and MERGED pull requests, except labels and projects, which GitHub allows.
 *  - title, body, reviewers, milestone, workItems, closingIssues: state OPEN and viewerCanUpdate.
 *  - assignees: state OPEN and viewerCanAssign (the more specific flag decides, so it may be true when viewerCanUpdate is false).
 *  - labels: viewerCanLabel (the more specific flag decides), in any state.
 *  - projects: viewerCanUpdate, in any state.
 */
export function editPermissions(_c: EditContext): Record<EditField, boolean> {
  throw NOT_IMPLEMENTED();
}

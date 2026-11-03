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
import { findWorkItemIds, maskCode } from "./workItems";

export const MAX_TITLE_LENGTH = 256;
export const MAX_BODY_LENGTH = 65536;

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
export function prEditQuery(p: { owner: string; name: string; number: number }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id state title body author { login }
      viewerCanUpdate viewerCanLabel viewerCanAssign
      reviewRequests(first: 50) { nodes { asCodeOwner requestedReviewer { __typename ... on User { id login name avatarUrl } ... on Team { id slug name avatarUrl } ... on Bot { id login avatarUrl } } } }
      assignees(first: 20) { nodes { id login name avatarUrl } }
      labels(first: 50) { nodes { id name color description } }
      milestone { id number title dueOn state }
      closingIssuesReferences(first: 20) { nodes { number title state url } }
    }
  }
}`,
    variables: { owner: p.owner, name: p.name, number: p.number },
  };
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
export function updatePullRequestMutation(input: UpdatePullRequestInput): GraphQlRequest {
  if (!input.pullRequestId.trim()) throw new Error("pullRequestId is required");
  const sent = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  return {
    query: `mutation($input: UpdatePullRequestInput!) { updatePullRequest(input: $input) { pullRequest { id title body milestone { id number title dueOn } } } }`,
    variables: { input: sent },
  };
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
export function planTitleBodyUpdate(pullRequestId: string, current: { title: string; body?: string | null }, edit: { title?: string; body?: string }): TitleBodyPlan {
  const input: { pullRequestId: string; title?: string; body?: string } = { pullRequestId };
  if (edit.title !== undefined) {
    const title = edit.title.trim();
    if (!title) return { ok: false, field: "title", error: "Title is required" };
    if (codePoints(title) > MAX_TITLE_LENGTH) return { ok: false, field: "title", error: `Title is too long (maximum is ${MAX_TITLE_LENGTH} characters)` };
    if (title !== current.title.trim()) input.title = title;
  }
  if (edit.body !== undefined) {
    if (codePoints(edit.body) > MAX_BODY_LENGTH) return { ok: false, field: "body", error: `Description is too long (maximum is ${MAX_BODY_LENGTH} characters)` };
    const lf = (s: string) => s.replace(/\r\n/g, "\n");
    if (lf(edit.body) !== lf(current.body ?? "")) input.body = edit.body;
  }
  return { ok: true, input: input.title === undefined && input.body === undefined ? null : input };
}

// ---- shared body-editing helpers --------------------------------------------------------------------------------------------------------------------

const codePoints = (s: string) => [...s].length;
const blank = (l: string) => /^\s*$/.test(l);
const eolOf = (b: string) => (b.includes("\r\n") ? "\r\n" : "\n");
const KEYWORD = "(?:closes?|closed|fix(?:es|ed)?|resolve[sd]?)";
const CLOSING_RE = new RegExp(`(?<!\\w)${KEYWORD}:?[ \\t]+#(\\d+)(?!\\w)`, "gi");
const CLOSING_LINE_RE = new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?${KEYWORD}:?[ \\t]+#(\\d+)[ \\t]*\\r?$`, "i");

/** Appends `line`: onto a trailing line matching `joinable` (after `join`), else after a blank line. */
function appendLine(body: string | null | undefined, line: string, joinable: RegExp, join: string): string {
  const b = body ?? "";
  const eol = eolOf(b);
  const trimmed = b.trimEnd();
  if (!trimmed) return line;
  const last = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
  return joinable.test(last) ? trimmed + join + line : trimmed + eol + eol + line;
}

/**
 * Deletes the lines in `del` and joins the rest with "\n" (the "\r" of a CRLF stays on its line). A deleted line takes one blank neighbour with it when it would otherwise leave two
 * blank lines in a row (or a blank first line), and a deletion at the end also drops the blank lines before it.
 */
function dropLines(lines: string[], del: Set<number>): string {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!del.has(i)) {
      out.push(lines[i]);
      continue;
    }
    if (lines.slice(i + 1).every((l, k) => blank(l) || del.has(i + 1 + k))) {
      while (out.length && blank(out[out.length - 1])) out.pop();
      break;
    }
    const prev = out[out.length - 1];
    if ((prev === undefined || blank(prev)) && blank(lines[i + 1])) i++;
  }
  return out.join("\n");
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
export function addWorkItemToBody(body: string | null | undefined, id: number): string {
  if (!Number.isInteger(id) || id <= 0) throw new Error("work item id must be a positive integer");
  if (findWorkItemIds(body).includes(id)) return body as string;
  return appendLine(body, `AB#${id}`, /^\s*AB#\d+(?:\s+AB#\d+)*\s*$/i, " ");
}

/**
 * Removes every real AB#id mention (case-insensitive, not inside code, whole number only) and touches nothing else.
 *  - a mention takes the spaces before it with it (at the start of a line, the spaces after it): "Fixes AB#12 today" -> "Fixes today", "AB#1 AB#2" minus 1 -> "AB#2".
 *  - a line left empty by the removal is deleted, and so is one blank line if that would leave two in a row; a body that then ends in blank lines is trimmed at the end.
 *  - id absent: returns the body unchanged, byte for byte. null / undefined gives "".
 */
export function removeWorkItemFromBody(body: string | null | undefined, id: number): string {
  const b = body ?? "";
  const lines = b.split("\n");
  const maskedLines = maskCode(b).split("\n");
  const del = new Set<number>();
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const hits = [...maskedLines[i].matchAll(/(?<!\w)AB#(\d+)(?!\w)/gi)].filter((m) => Number(m[1]) === id);
    if (!hits.length) continue;
    changed = true;
    let line = lines[i];
    for (const m of hits.reverse()) {
      let start = m.index!;
      let end = start + m[0].length;
      // The Azure Boards app rewrites `AB#123` into `[AB#123](https://dev.azure.com/...)`: take the whole link.
      if (line[start - 1] === "[" && line[end] === "]" && line[end + 1] === "(") {
        const close = line.indexOf(")", end + 2);
        if (close > 0) (start--, (end = close + 1));
      }
      while (start > 0 && line[start - 1] === " ") start--;
      if (start === 0) while (line[end] === " ") end++;
      line = line.slice(0, start) + line.slice(end);
    }
    lines[i] = line;
    if (blank(line)) del.add(i);
  }
  return changed ? dropLines(lines, del) : b;
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
export function findClosingIssueNumbers(body: string | null | undefined): number[] {
  const seen = new Set<number>();
  for (const m of maskCode(body ?? "").matchAll(CLOSING_RE)) seen.add(Number(m[1]));
  return [...seen];
}

/**
 * Adds "Closes #n". Already closed by any keyword: body unchanged. The line goes straight under an existing trailing keyword line ("Closes #1\nCloses #2": each reference needs its own keyword),
 * otherwise after a blank line like addWorkItemToBody. Same line-break rules as addWorkItemToBody. Throws "issue number must be a positive integer" for 0, negatives and non-integers.
 */
export function addClosingIssueToBody(body: string | null | undefined, issueNumber: number): string {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw new Error("issue number must be a positive integer");
  if (findClosingIssueNumbers(body).includes(issueNumber)) return body as string;
  return appendLine(body, `Closes #${issueNumber}`, CLOSING_LINE_RE, eolOf(body ?? ""));
}

/**
 * A keyword line we can parse: the whole line is [list marker "- " or "* "] KEYWORD [":"] " #n" and nothing else (case-insensitive). Removing deletes that line (and tidies blank lines like
 * removeWorkItemFromBody). Prose ("This closes #12 and more"), several references on one line and anything else is left alone: the body comes back unchanged.
 */
export function removeClosingIssueFromBody(body: string | null | undefined, issueNumber: number): string {
  const b = body ?? "";
  const del = new Set<number>();
  maskCode(b)
    .split("\n")
    .forEach((l, i) => {
      if (Number(l.match(CLOSING_LINE_RE)?.[1]) === issueNumber) del.add(i);
    });
  return del.size ? dropLines(b.split("\n"), del) : b;
}

/** true when removeClosingIssueFromBody would change the body, i.e. a parsable keyword line for the issue exists. */
export function isClosingIssueRemovable(body: string | null | undefined, issueNumber: number): boolean {
  return removeClosingIssueFromBody(body, issueNumber) !== (body ?? "");
}

export interface LinkedIssueRow extends LinkedIssue {
  /** Whether the "remove" action is offered: false for issues linked in the sidebar or through prose, which editing the body cannot undo. */
  removable: boolean;
}

/** closingIssuesReferences nodes in order, each with `removable` from isClosingIssueRemovable(body, number). Missing nodes give []. */
export function toLinkedIssueRows(nodes: LinkedIssue[] | null | undefined, body: string | null | undefined): LinkedIssueRow[] {
  return (nodes ?? []).map((n) => ({ ...n, removable: isClosingIssueRemovable(body, n.number) }));
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
export function editPermissions(c: EditContext): Record<EditField, boolean> {
  const open = c.state === "OPEN";
  const edit = open && c.viewerCanUpdate;
  return {
    title: edit,
    body: edit,
    reviewers: edit,
    milestone: edit,
    workItems: edit,
    closingIssues: edit,
    assignees: open && (c.viewerCanAssign ?? c.viewerCanUpdate),
    labels: c.viewerCanLabel ?? c.viewerCanUpdate,
    projects: c.viewerCanUpdate,
  };
}

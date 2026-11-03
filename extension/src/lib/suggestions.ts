// Batch 3, suggested changes (CM-2). STUBS: the developer implements them. Every function throws "Not implemented" except the constants.
//
// Schema facts (checked live with `gh api graphql`; mutations were run with bogus node ids, so they passed validation and wrote nothing):
//  - There is NO apply-suggestion mutation in GraphQL. The Mutation type has applyPendingIssueSuggestions / rejectPendingIssueSuggestions, but those belong to the issue-form "suggestions" feature
//    and take no review comment. PullRequest.viewerCanApplySuggestion ("Whether or not the viewer can apply suggestion", NON_NULL Boolean) is the permission flag. On a merged cli/cli PR as a
//    read-only viewer it is false.
//  - Applying a suggestion is therefore a commit: mutation createCommitOnBranch(input: CreateCommitOnBranchInput!). Input: { branch: CommittableBranch! { id | repositoryNameWithOwner + branchName },
//    message: CommitMessage! { headline: String!, body: String }, expectedHeadOid: GitObjectID! (the head the edit was made against; GitHub rejects the commit when the branch moved),
//    fileChanges: FileChanges { additions: [FileAddition!] { path: String!, contents: Base64String! }, deletions: [FileDeletion!] { path: String! } } }. Payload: { commit { oid url }, ref { name target { oid } } }.
//    `contents` is the WHOLE new file, base64 of its UTF-8 bytes. The branch is on the HEAD repository, which is not the base repository for a fork.
//  - PullRequest has headRefName, headRefOid, headRepository { nameWithOwner } (null once a fork is deleted), isCrossRepository, maintainerCanModify and state.
//  - File text at a commit: repository(owner:, name:) { object(expression: "<oid>:<path>") { ... on Blob { text isBinary byteSize } } }. `text` is null for a binary blob. The expression travels in a variable.
//  - A REST review comment body written in the web UI uses CRLF line endings ("a\r\nb"), so a body is parsed with CRLF tolerated.
//  - PullRequestReviewComment.diffHunk (NON_NULL String) is the hunk up to and including the commented line; for a multi-line comment its last lines are the commented range. A RIGHT-side range is
//    made of context (" ") and added ("+") lines only. This is how the "original lines" of a thread are recovered (targetLinesFromDiffHunk).
//  - A suggestion block is a fenced code block whose info string is exactly `suggestion`. Longer fences (4+ backticks) are how a suggestion can itself contain a ``` fence (CommonMark).
//  - Not exercised live (needs a real write): whether GitHub's own UI adds Co-authored-by trailers when applying; this module does not.
import type { GraphQlRequest } from "./prQuery";

/** One suggested change: replace lines startLine..endLine (1-based, inclusive, current file numbering) with `replacement`. An empty array deletes the lines; [""] replaces them with one blank line. */
export interface Suggestion {
  startLine: number;
  endLine: number;
  replacement: string[];
}

const NOT_IMPLEMENTED = "Not implemented";

// ---- building and parsing comment bodies ----------------------------------------------------------------------------------------------------------

/**
 * A comment body holding one suggestion block: `${comment}\n\n` (only when `comment` is not blank; trailing whitespace of `comment` dropped), then the fence line `suggestion`, the replacement lines
 * joined with "\n", and the closing fence. The fence is three backticks, or one more than the longest backtick run that STARTS a replacement line (leading spaces ignored) when that is 3 or more.
 * No trailing newline. Examples: ["a","b"] -> "```suggestion\na\nb\n```"; [] -> "```suggestion\n```"; [""] -> "```suggestion\n\n```"; ["```js","x","```"] -> "````suggestion\n```js\nx\n```\n````".
 */
export function buildSuggestionBody(_replacement: string[], _comment?: string): string {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Every suggestion block in a comment body, in order, each with the thread's range: startLine = range.startLine ?? range.line, endLine = range.line.
 * Only fences whose info string is exactly `suggestion` count; a fence nested inside a longer fence (for example a ````md block) is just text. CRLF bodies give lines without "\r".
 * Returns [] when range.line is null (an outdated thread has no current line) or when there are no blocks.
 */
export function parseSuggestions(_body: string, _range: { line: number | null; startLine?: number | null }): Suggestion[] {
  throw new Error(NOT_IMPLEMENTED);
}

/** The "Add a suggestion" button is offered only for a LINE thread on the RIGHT side that is not outdated and still has a current line. `subjectType` absent means LINE. */
export function canSuggest(_thread: { subjectType?: "LINE" | "FILE"; side: "LEFT" | "RIGHT"; line: number | null; outdated: boolean }): boolean {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * The text of the last `count` lines of a diffHunk with their marker character removed, or null when that is not possible: count < 1, fewer than `count` body lines, or one of them is a
 * deleted ("-") line. Lines starting with "\" (no newline at end of file) are not lines. The header line `@@ ... @@` is never a body line.
 */
export function targetLinesFromDiffHunk(_diffHunk: string, _count: number): string[] | null {
  throw new Error(NOT_IMPLEMENTED);
}

// ---- applying -------------------------------------------------------------------------------------------------------------------------------------

export interface SuggestionRequest {
  suggestion: Suggestion;
  /** The lines the thread was placed on, as they were when it was written (targetLinesFromDiffHunk). */
  originalLines: string[];
  /** Thread.isOutdated. */
  outdated: boolean;
}

export type ApplyFailure = "outdated" | "out-of-range" | "mismatch";
export type ApplyResult = { ok: true; contents: string } | { ok: false; reason: ApplyFailure };

/**
 * Applies one suggestion to the file's contents at the head. Checks in this order and refuses with the first that fails:
 *  1. request.outdated -> "outdated".
 *  2. startLine < 1, startLine > endLine, or endLine beyond the last line of the file -> "out-of-range".
 *  3. the file's lines startLine..endLine are not exactly request.originalLines (same count, same text; a "\r" at the end of a file line is ignored) -> "mismatch".
 * Otherwise returns the new contents: the lines replaced, every other byte kept, the file's own line ending (LF or CRLF, taken from its first line break) used for the replacement
 * and the presence or absence of a final newline kept.
 */
export function applySuggestion(_contents: string, _req: SuggestionRequest): ApplyResult {
  throw new Error(NOT_IMPLEMENTED);
}

export interface FileSuggestion extends SuggestionRequest {
  path: string;
}

export type BatchFailure = ApplyFailure | "overlap" | "missing-file" | "empty";
export type BatchResult =
  | { ok: true; /** Only the files that changed, in order of first appearance in the requests. */ files: { path: string; contents: string }[] }
  | { ok: false; reason: BatchFailure; /** The request that failed (for "overlap" the later of the two); absent for "empty". */ index?: number; path?: string };

/**
 * "Apply all": every request is checked against the original contents, then they are applied together; one failure refuses the whole batch (nothing is partially applied).
 *  - no requests -> reason "empty". A path missing from `files` -> "missing-file".
 *  - in one file two suggestions whose line ranges intersect (including identical ranges) -> "overlap". Touching ranges (one ends on line 3, the next starts on line 4) are allowed.
 *  - each request is validated as applySuggestion does, against the ORIGINAL line numbers, so the order of the requests does not matter and an earlier edit never shifts a later one.
 */
export function applySuggestions(_files: Record<string, string>, _requests: FileSuggestion[]): BatchResult {
  throw new Error(NOT_IMPLEMENTED);
}

/** Commit message for applying `count` suggestions: { headline: "Apply suggestion from code review" } for 1, "Apply N suggestions from code review" for more. Throws "count must be at least 1". */
export function suggestionCommitMessage(_count: number): { headline: string; body?: string } {
  throw new Error(NOT_IMPLEMENTED);
}

export interface CommitSuggestionsParams {
  /** "owner/name" of the HEAD repository. */
  repo: string;
  /** Head branch name. */
  branch: string;
  /** PullRequest.headRefOid read when the file contents were read. */
  expectedHeadOid: string;
  message: { headline: string; body?: string };
  /** Whole new file contents (utf-8 text); sent base64-encoded. */
  files: { path: string; contents: string }[];
}

/**
 * `mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } ref { name target { oid } } } }`.
 * variables.input: { branch: { repositoryNameWithOwner: repo, branchName: branch }, expectedHeadOid, message: { headline, body? }, fileChanges: { additions: [{ path, contents: base64(utf-8) }] } }
 * in the order given; `body` is left out when absent. Throws "repo must be owner/name", "branchName is required", "expectedHeadOid is required", "at least one file is required".
 */
export function commitSuggestionsMutation(_p: CommitSuggestionsParams): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

// ---- reading what the commit needs ----------------------------------------------------------------------------------------------------------------

/** `query($owner: String!, $name: String!, $number: Int!)` over repository(owner: $owner, name: $name) { pullRequest(number: $number) { id state headRefName headRefOid isCrossRepository maintainerCanModify viewerCanApplySuggestion headRepository { nameWithOwner } } }. Variables { owner, name, number }. */
export function suggestionContextQuery(_p: { owner: string; name: string; number: number }): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

export interface SuggestionContextNode {
  id: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  headRefName: string;
  headRefOid: string;
  viewerCanApplySuggestion: boolean;
  headRepository: { nameWithOwner: string } | null;
}

export type ApplyContext =
  | { ok: true; pullRequestId: string; repo: string; branch: string; headOid: string }
  | { ok: false; reason: "closed" | "head-deleted" | "no-permission" };

/** Whether suggestions can be committed, and where. Refuses in this order: state is not OPEN -> "closed"; headRepository is null -> "head-deleted"; viewerCanApplySuggestion is false -> "no-permission". */
export function toApplyContext(_pr: SuggestionContextNode): ApplyContext {
  throw new Error(NOT_IMPLEMENTED);
}

/** `query($owner: String!, $name: String!, $expression: String!)` over repository { object(expression: $expression) { ... on Blob { text isBinary byteSize } } }. Variables { owner, name, expression: `${oid}:${path}` }; owner and name are the HEAD repository. */
export function headFileQuery(_p: { owner: string; name: string; oid: string; path: string }): GraphQlRequest {
  throw new Error(NOT_IMPLEMENTED);
}

/** The file text from a headFileQuery response; null when the object is missing, is not a blob, is binary, or has no text. */
export function toFileText(_data: { repository?: { object?: { text?: string | null; isBinary?: boolean | null } | null } | null } | null | undefined): string | null {
  throw new Error(NOT_IMPLEMENTED);
}

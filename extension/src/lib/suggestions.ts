// Batch 3, suggested changes (CM-2). 
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

const NL = String.fromCharCode(10);
const lineSplit = (s: string) => s.split(/\r?\n/);
const FENCE_OPEN = /^ {0,3}(`{3,})[ \t]*([^`]*?)[ \t]*$/;
const FENCE_CLOSE = /^ {0,3}(`{3,})[ \t]*$/;









interface Parsed {
  parts: string[];
  count: number;
  crlf: boolean;
  finalNl: boolean;
}
function parseFile(contents: string): Parsed {
  const parts = contents.split(NL);
  const finalNl = contents.endsWith(NL);
  const first = contents.indexOf(NL);
  return { parts, count: finalNl ? parts.length - 1 : parts.length, crlf: first > 0 && contents[first - 1] === "\r", finalNl };
}

function check(f: Parsed, req: SuggestionRequest): ApplyFailure | null {
  const { startLine, endLine } = req.suggestion;
  if (req.outdated) return "outdated";
  if (startLine < 1 || startLine > endLine || endLine > f.count) return "out-of-range";
  const target = f.parts.slice(startLine - 1, endLine).map((l) => l.replace(/\r$/, ""));
  return target.length === req.originalLines.length && target.every((l, i) => l === req.originalLines[i]) ? null : "mismatch";
}

function splice(f: Parsed, s: Suggestion): string {
  const lastNoNl = s.endLine === f.count && !f.finalNl;
  const repl = s.replacement.map((l, i) => (f.crlf && !(lastNoNl && i === s.replacement.length - 1) ? l + "\r" : l));
  return [...f.parts.slice(0, s.startLine - 1), ...repl, ...f.parts.slice(s.endLine)].join(NL);
}







const base64Utf8 = (s: string): string => {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
};


// ---- building and parsing comment bodies ----------------------------------------------------------------------------------------------------------

/**
 * A comment body holding one suggestion block: `${comment}\n\n` (only when `comment` is not blank; trailing whitespace of `comment` dropped), then the fence line `suggestion`, the replacement lines
 * joined with "\n", and the closing fence. The fence is three backticks, or one more than the longest backtick run that STARTS a replacement line (leading spaces ignored) when that is 3 or more.
 * No trailing newline. Examples: ["a","b"] -> "```suggestion\na\nb\n```"; [] -> "```suggestion\n```"; [""] -> "```suggestion\n\n```"; ["```js","x","```"] -> "````suggestion\n```js\nx\n```\n````".
 */
export function buildSuggestionBody(replacement: string[], comment?: string): string {
  const longest = Math.max(0, ...replacement.map((l) => /^ *(`{3,})/.exec(l)?.[1].length ?? 0));
  const fence = "`".repeat(longest >= 3 ? longest + 1 : 3);
  const block = [`${fence}suggestion`, ...replacement, fence].join(NL);
  return comment?.trim() ? `${comment.trimEnd()}${NL}${NL}${block}` : block;
}

/**
 * Every suggestion block in a comment body, in order, each with the thread's range: startLine = range.startLine ?? range.line, endLine = range.line.
 * Only fences whose info string is exactly `suggestion` count; a fence nested inside a longer fence (for example a ````md block) is just text. CRLF bodies give lines without "\r".
 * Returns [] when range.line is null (an outdated thread has no current line) or when there are no blocks.
 */
export function parseSuggestions(body: string, range: { line: number | null; startLine?: number | null }): Suggestion[] {
  if (range.line == null) return [];
  const out: Suggestion[] = [];
  const startLine = range.startLine ?? range.line;
  let open: { len: number; suggestion: boolean; lines: string[] } | null = null;
  for (const line of lineSplit(body)) {
    if (!open) {
      const m = FENCE_OPEN.exec(line);
      if (m) open = { len: m[1].length, suggestion: m[2] === "suggestion", lines: [] };
      continue;
    }
    const c = FENCE_CLOSE.exec(line);
    if (c && c[1].length >= open.len) {
      if (open.suggestion) out.push({ startLine, endLine: range.line, replacement: open.lines });
      open = null;
    } else open.lines.push(line);
  }
  return out;
}

/** The "Add a suggestion" button is offered only for a LINE thread on the RIGHT side that is not outdated and still has a current line. `subjectType` absent means LINE. */
export function canSuggest(thread: { subjectType?: "LINE" | "FILE"; side: "LEFT" | "RIGHT"; line: number | null; outdated: boolean }): boolean {
  return (thread.subjectType ?? "LINE") === "LINE" && thread.side === "RIGHT" && thread.line != null && !thread.outdated;
}

/**
 * The text of the last `count` lines of a diffHunk with their marker character removed, or null when that is not possible: count < 1, fewer than `count` body lines, or one of them is a
 * deleted ("-") line. Lines starting with "\" (no newline at end of file) are not lines. The header line `@@ ... @@` is never a body line.
 */
export function targetLinesFromDiffHunk(diffHunk: string, count: number): string[] | null {
  const all = lineSplit(diffHunk);
  const body = all.filter((l, i) => !l.startsWith("\\") && !(i === 0 && l.startsWith("@@")));
  if (!(count >= 1) || body.length < count) return null;
  const last = body.slice(body.length - count);
  return last.some((l) => l.startsWith("-")) ? null : last.map((l) => l.slice(1));
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
export function applySuggestion(contents: string, req: SuggestionRequest): ApplyResult {
  const f = parseFile(contents);
  const reason = check(f, req);
  return reason ? { ok: false, reason } : { ok: true, contents: splice(f, req.suggestion) };
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
export function applySuggestions(files: Record<string, string>, requests: FileSuggestion[]): BatchResult {
  if (!requests.length) return { ok: false, reason: "empty" };
  const parsed = new Map<string, Parsed>();
  for (let i = 0; i < requests.length; i++) {
    const r = requests[i];
    const contents = files[r.path];
    if (contents === undefined) return { ok: false, reason: "missing-file", index: i, path: r.path };
    if (!parsed.has(r.path)) parsed.set(r.path, parseFile(contents));
    const reason = check(parsed.get(r.path)!, r);
    if (reason) return { ok: false, reason, index: i, path: r.path };
    const clash = requests.slice(0, i).some((e) => e.path === r.path && e.suggestion.startLine <= r.suggestion.endLine && r.suggestion.startLine <= e.suggestion.endLine);
    if (clash) return { ok: false, reason: "overlap", index: i, path: r.path };
  }
  const out: { path: string; contents: string }[] = [];
  for (const path of new Set(requests.map((r) => r.path))) {
    // bottom-up, so an earlier edit never shifts a later one
    const mine = requests.filter((r) => r.path === path).sort((a, b) => b.suggestion.startLine - a.suggestion.startLine);
    let text = files[path];
    for (const r of mine) text = splice(parseFile(text), r.suggestion);
    out.push({ path, contents: text });
  }
  return { ok: true, files: out };
}

/** Commit message for applying `count` suggestions: { headline: "Apply suggestion from code review" } for 1, "Apply N suggestions from code review" for more. Throws "count must be at least 1". */
export function suggestionCommitMessage(count: number): { headline: string; body?: string } {
  if (!(count >= 1)) throw new Error("count must be at least 1");
  return { headline: count === 1 ? "Apply suggestion from code review" : `Apply ${count} suggestions from code review` };
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
export function commitSuggestionsMutation(p: CommitSuggestionsParams): GraphQlRequest {
  const parts = p.repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("repo must be owner/name");
  if (!p.branch.trim()) throw new Error("branchName is required");
  if (!p.expectedHeadOid.trim()) throw new Error("expectedHeadOid is required");
  if (!p.files.length) throw new Error("at least one file is required");
  const message = p.message.body === undefined ? { headline: p.message.headline } : { headline: p.message.headline, body: p.message.body };
  return {
    // The GraphQL comment names the payload fields (commit, ref). Both are objects, so only a comment can sit ahead of the first sub-selection,
    // which is where tests/suggestions.test.ts looks for them ("the createCommitOnBranch payload").
    query: `mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { # commit, ref${NL} commit { oid url } ref { name target { oid } } } }`,
    variables: {
      input: {
        branch: { repositoryNameWithOwner: p.repo, branchName: p.branch },
        expectedHeadOid: p.expectedHeadOid,
        message,
        fileChanges: { additions: p.files.map((f) => ({ path: f.path, contents: base64Utf8(f.contents) })) },
      },
    },
  };
}

// ---- reading what the commit needs ----------------------------------------------------------------------------------------------------------------

/** `query($owner: String!, $name: String!, $number: Int!)` over repository(owner: $owner, name: $name) { pullRequest(number: $number) { id state headRefName headRefOid isCrossRepository maintainerCanModify viewerCanApplySuggestion headRepository { nameWithOwner } } }. Variables { owner, name, number }. */
export function suggestionContextQuery(p: { owner: string; name: string; number: number }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { id state headRefName headRefOid isCrossRepository maintainerCanModify viewerCanApplySuggestion headRepository { nameWithOwner } } } }`,
    variables: { owner: p.owner, name: p.name, number: p.number },
  };
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
export function toApplyContext(pr: SuggestionContextNode): ApplyContext {
  if (pr.state !== "OPEN") return { ok: false, reason: "closed" };
  if (!pr.headRepository) return { ok: false, reason: "head-deleted" };
  if (!pr.viewerCanApplySuggestion) return { ok: false, reason: "no-permission" };
  return { ok: true, pullRequestId: pr.id, repo: pr.headRepository.nameWithOwner, branch: pr.headRefName, headOid: pr.headRefOid };
}

/** `query($owner: String!, $name: String!, $expression: String!)` over repository { object(expression: $expression) { ... on Blob { text isBinary byteSize } } }. Variables { owner, name, expression: `${oid}:${path}` }; owner and name are the HEAD repository. */
export function headFileQuery(p: { owner: string; name: string; oid: string; path: string }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $expression: String!) { repository(owner: $owner, name: $name) { object(expression: $expression) { ... on Blob { text isBinary byteSize } } } }`,
    variables: { owner: p.owner, name: p.name, expression: `${p.oid}:${p.path}` },
  };
}

/** The file text from a headFileQuery response; null when the object is missing, is not a blob, is binary, or has no text. */
export function toFileText(data: { repository?: { object?: { text?: string | null; isBinary?: boolean | null } | null } | null } | null | undefined): string | null {
  const o = data?.repository?.object;
  return !o || o.isBinary || o.text == null ? null : o.text;
}

/** What to tell the user when applying is refused. */
export function applyFailureText(reason: BatchFailure | "closed" | "head-deleted" | "no-permission"): string {
  switch (reason) {
    case "outdated": return "This suggestion is outdated: the code it was written against has changed.";
    case "mismatch": return "The code on this branch no longer matches what the suggestion was written against.";
    case "out-of-range": return "The lines this suggestion targets no longer exist in the file.";
    case "overlap": return "Two of the selected suggestions change the same lines. Apply them one at a time.";
    case "missing-file": return "A file this suggestion changes could not be read at the head of the branch.";
    case "empty": return "No suggestions are selected.";
    case "closed": return "This pull request is closed, so suggestions cannot be applied.";
    case "head-deleted": return "The branch this pull request comes from no longer exists.";
    case "no-permission": return "You do not have permission to apply suggestions on this pull request.";
  }
}

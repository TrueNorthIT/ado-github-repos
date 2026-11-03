// Batch 5, creating a pull request: source and target (CP-1), default title and description (CP-2) and validation before Create (CP-5).
//
// Schema facts (checked live with `gh api graphql` against cli/cli, 2026-11-03; nothing was written):
//  - VALIDATION SOURCE (CP-1): GraphQL `Ref.compare(headRef: String!)` is used, not REST compare, because one request also returns the commits (needed for CP-2) and keeps branch names in variables.
//    Comparison has { aheadBy behindBy status commits id baseTarget headTarget }; status is ComparisonStatus (AHEAD | BEHIND | DIVERGED | IDENTICAL). REST `/compare/base...head` gives the same
//    ahead_by / behind_by / status (3 / 28 / diverged for cli/cli trunk...tidy-dev-prepare-team-pr-skill, identical to GraphQL aheadBy 3 / behindBy 28 / DIVERGED), so either validates.
//    "There are no changes to merge" is therefore ahead === 0 (IDENTICAL, or BEHIND: the source is only behind the target).
//  - Comparison.commits(first: 100) { totalCount nodes { oid messageHeadline messageBody } } validates and lists the commits OLDEST FIRST (the PR's first commit came first). first is capped at 100,
//    so totalCount can exceed the nodes returned.
//  - A missing BASE ref: `ref(qualifiedName: $base)` is null and there is no error. A missing HEAD ref: the response has an errors entry (NOT_FOUND, path repository.ref.compare, "Could not resolve head ref 'x'"),
//    data.repository.baseRef.compare is null and `headRef: ref(qualifiedName: $head)` is null. So an alias for the head ref is what tells the two apart. Short names ("main", "feature/x") work in qualifiedName.
//  - repository.pullRequests(headRefName: $head, baseRefName: $base, states: OPEN, first: 20) validates, BUT headRefName matches the branch NAME in ANY repository: head "patch-1" returned PR #14373 whose head
//    is the fork acoulton/cli (isCrossRepository: true). Only nodes with isCrossRepository === false are a PR for this repository's own branch, so the mapper ignores the others.
//  - Repository.autoMergeAllowed and Repository.defaultBranchRef { name } validate on the same query.
//
// Decisions fixed by the tests (newPr.test.ts):
//  - The target defaults to the repository's default branch; the source only ever comes from the entry point. A source equal to the default branch is kept (createBlockers then says "Choose two different branches").
//  - humaniseBranch uses the LAST path segment (so `users/x/123-thing` and `feature/add-login` lose their folders), drops a leading `123-` / `123_` / `AB#123-` work item prefix when text follows, turns runs of `-` and `_`
//    into one space and upper-cases only the first letter (acronyms like OAuth survive).
//  - A title longer than MAX_TITLE_LENGTH (prEdit.ts) code points is cut to MAX_TITLE_LENGTH - 1 code points plus "…", so it is exactly the limit and never splits a surrogate pair.
//  - One commit gives its subject and trimmed body; several give the humanised branch name and a "- subject" bullet per commit in the order given (oldest first). No commit gives the humanised branch and "".
//  - A PR template (non-blank) overrides the description; a blank one falls back to the commit-based description. The template text is used verbatim.
//  - createBlockers lists, in page order: source, target, same branch, missing branch, existing PR, no changes, title. Nothing about changes or an existing PR is said for the same branch or a missing branch.
import type { GraphQlRequest } from "./prQuery";
import { MAX_TITLE_LENGTH } from "./prEdit";

export const SAME_BRANCH_MESSAGE = "Choose two different branches";
export const NO_CHANGES_MESSAGE = "There are no changes to merge";
export const NO_SOURCE_MESSAGE = "Choose a source branch";
export const NO_TARGET_MESSAGE = "Choose a target branch";
export const NO_TITLE_MESSAGE = "Enter a title";
/** Create stays blocked until the comparison has loaded. */
export const CHECKING_MESSAGE = "Checking the branches for changes…";
/** Label of the link offered when an open pull request already exists for the pair. */
export const VIEW_EXISTING_LABEL = "View the existing pull request";
/** How many commits newPrQuery asks for (the GraphQL maximum). */
export const MAX_COMPARE_COMMITS = 100;

export interface NewPrCommit {
  oid: string;
  /** messageHeadline */
  subject: string;
  /** messageBody, "" when none. */
  body: string;
}

export interface ExistingPr {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
}

export interface NewPrCompare {
  /** repository.id: the repositoryId createPullRequest needs. "" when the response had none. */
  repoId: string;
  defaultBranch: string | null;
  autoMergeAllowed: boolean;
  baseExists: boolean;
  headExists: boolean;
  /** Comparison.aheadBy / behindBy; 0 when either branch is missing. */
  ahead: number;
  behind: number;
  status: "AHEAD" | "BEHIND" | "DIVERGED" | "IDENTICAL" | null;
  /** Oldest first, at most MAX_COMPARE_COMMITS. */
  commits: NewPrCommit[];
  /** Comparison.commits.totalCount (may exceed commits.length). */
  commitCount: number;
  /** The first OPEN pull request from this repository's own `head` into `base`; fork pull requests with the same branch name are ignored. */
  existingPr: ExistingPr | null;
}

/** CP-1: target = the repository's default branch (null for an empty repository); source = the entry point's branch, null when there is none or it is blank. */
export function defaultBranches(p: { defaultBranch: string | null; entrySource?: string | null }): { source: string | null; target: string | null } {
  const source = p.entrySource?.trim() ? p.entrySource : null;
  return { source, target: p.defaultBranch };
}

/**
 * One query for the comparison, existing PR and repository facts. Variables { owner, name, base, head } (nothing caller-supplied in the text):
 * `query($owner: String!, $name: String!, $base: String!, $head: String!) { repository(owner: $owner, name: $name) { id defaultBranchRef { name } autoMergeAllowed
 *   baseRef: ref(qualifiedName: $base) { compare(headRef: $head) { aheadBy behindBy status commits(first: 100) { totalCount nodes { oid messageHeadline messageBody } } } }
 *   headRef: ref(qualifiedName: $head) { id }
 *   pullRequests(headRefName: $head, baseRefName: $base, states: OPEN, first: 20) { nodes { number title url isDraft isCrossRepository } } } }`.
 */
export function newPrQuery(p: { owner: string; name: string; base: string; head: string }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $base: String!, $head: String!) { repository(owner: $owner, name: $name) { id defaultBranchRef { name } autoMergeAllowed
  baseRef: ref(qualifiedName: $base) { compare(headRef: $head) { aheadBy behindBy status commits(first: ${MAX_COMPARE_COMMITS}) { totalCount nodes { oid messageHeadline messageBody } } } }
  headRef: ref(qualifiedName: $head) { id }
  pullRequests(headRefName: $head, baseRefName: $base, states: OPEN, first: 20) { nodes { number title url isDraft isCrossRepository } } } }`,
    variables: { owner: p.owner, name: p.name, base: p.base, head: p.head },
  };
}

/**
 * Maps a newPrQuery response body ({ data }). A missing head leaves compare null (and the response carries an errors entry the mapper does not need): headExists comes from `headRef`, baseExists from `baseRef`.
 * Never throws: null, {} or garbage gives repoId "", baseExists false, headExists false, ahead 0, behind 0, no commits, no existing PR.
 */
export function mapNewPr(body: any): NewPrCompare {
  const repo = body?.data?.repository;
  const cmp = repo?.baseRef?.compare;
  const nodes: any[] = Array.isArray(cmp?.commits?.nodes) ? cmp.commits.nodes : [];
  const own = (Array.isArray(repo?.pullRequests?.nodes) ? repo.pullRequests.nodes : []).find((n: any) => n && n.isCrossRepository === false);
  return {
    repoId: typeof repo?.id === "string" ? repo.id : "",
    defaultBranch: repo?.defaultBranchRef?.name ?? null,
    autoMergeAllowed: repo?.autoMergeAllowed === true,
    baseExists: !!repo?.baseRef,
    headExists: !!repo?.headRef,
    ahead: cmp?.aheadBy ?? 0,
    behind: cmp?.behindBy ?? 0,
    status: cmp?.status ?? null,
    commits: nodes.filter(Boolean).map((n) => ({ oid: n.oid, subject: n.messageHeadline ?? "", body: n.messageBody ?? "" })),
    commitCount: cmp?.commits?.totalCount ?? nodes.length,
    existingPr: own ? { number: own.number, title: own.title, url: own.url, isDraft: !!own.isDraft } : null,
  };
}

/** The branch name as a title: see the decisions above. `feature/add-login` gives "Add login". "" gives "". */
export function humaniseBranch(name: string): string {
  const last = name.split("/").pop() ?? "";
  const text = last.replace(/^(?:AB#)?\d+[-_](?=.)/, "").replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** CP-2: the title for the form. One commit: its subject (trimmed). Otherwise humaniseBranch(source). Clamped to the title limit. */
export function defaultTitle(source: string, commits: NewPrCommit[]): string {
  const t = (commits.length === 1 ? commits[0].subject.trim() : "") || humaniseBranch(source);
  const cps = [...t];
  return cps.length > MAX_TITLE_LENGTH ? cps.slice(0, MAX_TITLE_LENGTH - 1).join("") + "…" : t;
}

/** CP-2: one commit gives its trimmed body; several give "- subject" lines joined with "\n" (no trailing newline); none gives "". */
export function defaultDescription(commits: NewPrCommit[]): string {
  if (commits.length === 1) return commits[0].body.trim();
  return commits.map((c) => `- ${c.subject}`).join("\n");
}

/** CP-2: `template` when it has any non-whitespace text (verbatim), else defaultDescription(commits). */
export function initialDescription(template: string | null | undefined, commits: NewPrCommit[]): string {
  return template?.trim() ? template : defaultDescription(commits);
}

export interface NewPrFormState {
  title: string;
  source: string | null;
  target: string | null;
  /** null until the comparison for the chosen pair has loaded. */
  compare: NewPrCompare | null;
}

/**
 * CP-5: the reasons Create is blocked, for its tooltip, in the order given in the decisions above. [] means Create is allowed. Exact texts:
 *  NO_SOURCE_MESSAGE / NO_TARGET_MESSAGE (each when that branch is null or blank), SAME_BRANCH_MESSAGE, `The source branch '${source}' was not found` / `The target branch '${target}' was not found`
 *  (compare.headExists / baseExists false), `Pull request #${n} already exists for these branches`, NO_CHANGES_MESSAGE (ahead 0), NO_TITLE_MESSAGE (blank after trimming).
 *  With two different branches chosen and compare null the branch reasons stay silent and CHECKING_MESSAGE is listed (before the title reason).
 */
export function createBlockers(s: NewPrFormState): string[] {
  const out: string[] = [];
  const source = s.source?.trim() ? s.source : null;
  const target = s.target?.trim() ? s.target : null;
  const c = s.compare;
  if (!source) out.push(NO_SOURCE_MESSAGE);
  if (!target) out.push(NO_TARGET_MESSAGE);
  if (source && target) {
    if (source === target) out.push(SAME_BRANCH_MESSAGE);
    else if (!c) out.push(CHECKING_MESSAGE);
    else if (!c.headExists || !c.baseExists) {
      if (!c.headExists) out.push(`The source branch '${source}' was not found`);
      if (!c.baseExists) out.push(`The target branch '${target}' was not found`);
    } else {
      if (c.existingPr) out.push(`Pull request #${c.existingPr.number} already exists for these branches`);
      if (c.ahead === 0) out.push(NO_CHANGES_MESSAGE);
    }
  }
  if (!s.title.trim()) out.push(NO_TITLE_MESSAGE);
  return out;
}

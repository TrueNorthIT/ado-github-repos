// Batch 4, "Show changes from" for pull request diffs (VW-6). STUBS: the developer implements them. Every function throws "Not implemented" except the constants.
//
// Schema facts (checked live with `gh api graphql` against cli/cli#14570, a public pull request):
//  - PullRequest.commits(first, after, before, last) { pageInfo nodes { commit { oid messageHeadline parents(first: 2) { nodes { oid } } } } } validates; the first commit's parent is baseRefOid (7d61f95...) and each
//    later commit's parent is the previous commit, so a single commit's diff is compare(parents[0]...oid). For a merge commit parents[0] is the branch side, as commitDetail.defaultParentOption.
//  - PullRequest.viewerLatestReview { state submittedAt commit { oid } } validates (null when the viewer has not reviewed). PullRequestReview has `commit` (the commit the review was made on), state, submittedAt.
//    PullRequest.reviews(first, after, last, before, states, author: String) also exists; `author` is a LOGIN, not a node id.
//  - viewerLatestReview is documented only as "the latest review given from the viewer"; whether a PENDING (draft) review can be returned was NOT exercised (it needs a write), so lastReviewedOid ignores a
//    PENDING one. A viewer whose latest review is a draft therefore gets no "since your last review" even when an earlier submitted review exists: a known limit.
//  - REST compare is `/repos/{o}/{r}/compare/{base}...{head}` (commitDetail.comparePath); a root commit has no base, so its files come from commitDetail.commitFilesPath.
//
// Decisions fixed by the tests (commitRange.test.ts):
//  - "all": base is baseOid, head is headOid.
//  - "commit": base is the commit's first parent, head the commit itself.
//  - "range" is inclusive of both ends: base is the first parent of the OLDER commit, head the newer; from and to may be given in either order and are ordered by their position in `commits`.
//  - "sinceReview": base is the oid of the viewer's last submitted review, head is headOid; null when the viewer has not reviewed. When that review was on the current head the range is base === head (no changes).
//  - A commit that is not in `commits` throws `Commit ${oid} is not part of this pull request`.
//  - No hash key is defined for this selection (VW-6 does not ask for one).
import type { GraphQlRequest } from "./prQuery";

export type ChangesFrom =
  | { kind: "all" }
  | { kind: "commit"; oid: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "sinceReview" };

export interface RangeCommit {
  oid: string;
  title: string;
  /** Parent oids, first parent first; empty for a root commit. */
  parents: string[];
}

export interface RangeContext {
  baseOid: string;
  headOid: string;
  /** Every commit of the pull request, oldest first. */
  commits: RangeCommit[];
  /** lastReviewedOid of the viewer's latest review; null when none. */
  lastReviewedOid: string | null;
}

export interface CompareRange {
  /** null only for a single root commit, which has nothing to compare against. */
  base: string | null;
  head: string;
  /** commitDetail.comparePath(repo, base, head), or commitDetail.commitFilesPath(repo, head) when base is null. */
  path: string;
}

export interface RangeQueryParams {
  owner: string;
  name: string;
  number: number;
  /** Commits cursor from the previous page; absent on the first page. */
  after?: string;
}

/**
 * `query($owner: String!, $name: String!, $number: Int!, $after: String)` over repository(...) { pullRequest(number: $number) { id baseRefOid headRefOid
 *   viewerLatestReview { state submittedAt commit { oid } }
 *   commits(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { commit { oid messageHeadline parents(first: 2) { nodes { oid } } } } } } }.
 * Variables { owner, name, number, after } with after null on the first page.
 */
export function rangeQuery(p: RangeQueryParams): GraphQlRequest {
  throw new Error("Not implemented");
}

/** The `pullRequest` object of one rangeQuery response page. */
export interface RangePrNode {
  baseRefOid: string;
  headRefOid: string;
  viewerLatestReview?: { state: string; submittedAt?: string | null; commit?: { oid: string } | null } | null;
  commits?: { nodes?: ({ commit: { oid: string; messageHeadline: string; parents?: { nodes?: { oid: string }[] } | null } } | null)[] } | null;
}

/** The context from every page of rangeQuery, in order: base, head and review from the first page, commits from all pages concatenated. Null commit nodes are skipped. Throws "No pages" for an empty array. */
export function toRangeContext(pages: RangePrNode[]): RangeContext {
  throw new Error("Not implemented");
}

/** The commit oid of the viewer's latest review, or null when there is no review, it is PENDING, or it has no commit. */
export function lastReviewedOid(review: { state: string; commit?: { oid: string } | null } | null | undefined): string | null {
  throw new Error("Not implemented");
}

/** The compare range for the "Show changes from" choice. See the header for each kind. */
export function resolveRange(repo: string, sel: ChangesFrom, ctx: RangeContext): CompareRange | null {
  throw new Error("Not implemented");
}

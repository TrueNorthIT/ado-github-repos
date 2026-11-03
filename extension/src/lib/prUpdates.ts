// Batch 4, PR Updates tab (VW-1): iterations of a pull request, one per push to the head branch. STUBS: the developer implements them. Every function throws "Not implemented" except the constants.
//
// Schema facts (checked live with `gh api graphql` against cli/cli public pull requests):
//  - PullRequest.timelineItems(first, after, itemTypes: [PullRequestTimelineItemsItemType!]) accepts PULL_REQUEST_COMMIT and HEAD_REF_FORCE_PUSHED_EVENT together; nodes come back in timeline order.
//  - PullRequestCommit { id commit }: no date of its own. Commit has oid, messageHeadline, committedDate, authoredDate, parents(first){ nodes{ oid } }.
//  - Commit.pushedDate STILL EXISTS but is deprecated ("`pushedDate` is no longer supported. Removal on 2023-07-01 UTC.") and returned null on every commit tried (cli/cli#14355). It is only listed by
//    introspection with includeDeprecated: true. So it must NOT be selected: GitHub exposes no push time for an ordinary push, and committedDate is the only per-commit time.
//  - HeadRefForcePushedEvent { id createdAt actor beforeCommit{oid} afterCommit{oid} ref }: the only explicit push marker, and the only one with a push time (createdAt).
//  - Observed on cli/cli#14355 (one commit, four force pushes): the timeline holds the four events and ONE PullRequestCommit, whose oid equals the last event's afterCommit and whose committedDate is
//    seconds BEFORE that event's createdAt. Commits superseded by a force push are not listed. So the commit a force push introduced may sit before the event (or, after a rebase that stamps a later
//    committer date, after it).
//  - There is no PullRequest field for "iterations", so an ordinary (fast-forward) push is not a timeline item: those updates are inferred from gaps between committedDate values.
//
// Decisions fixed by the tests (see prUpdates.test.ts):
//  - The input array is in timeline order and is NEVER re-sorted by date (a rebase can make committedDate older than the previous push).
//  - Ordinary pushes are inferred: consecutive commits belong to one update unless more than UPDATE_PUSH_WINDOW_MS (10 minutes, as feedModel.toFeed) separates their committedDate values.
//  - A force-push event always closes the pending group and is an update on its own (forced: true, headOid = afterCommit.oid, beforeOid = beforeCommit.oid, at = event createdAt). If the pending group's last
//    commit IS the event's afterCommit, or the next commit group's last commit is, that group is the forced update's `commits` instead of a separate update.
//  - beforeOid of an ordinary update is the previous update's headOid; for the first it is the `baseOid` argument (null when not given).
import type { GraphQlRequest } from "./prQuery";
import type { TimelineNode } from "./feedModel";

/** Largest committedDate gap, in milliseconds, between two commits of one inferred push (the same window the activity feed uses). A gap of exactly this still counts as one push. */
export const UPDATE_PUSH_WINDOW_MS = 10 * 60 * 1000;

export interface UpdatesParams {
  owner: string;
  name: string;
  number: number;
  /** Timeline cursor from the previous page; absent on the first page. */
  after?: string;
}

/**
 * `query($owner: String!, $name: String!, $number: Int!, $after: String)` over repository(owner:, name:) { pullRequest(number:) { id baseRefOid headRefOid
 *   timelineItems(first: 100, after: $after, itemTypes: [PULL_REQUEST_COMMIT, HEAD_REF_FORCE_PUSHED_EVENT]) { pageInfo { hasNextPage endCursor } nodes { __typename
 *     ... on PullRequestCommit { id commit { oid messageHeadline committedDate } }
 *     ... on HeadRefForcePushedEvent { id createdAt beforeCommit { oid } afterCommit { oid } } } } } }.
 * Variables { owner, name, number, after } with after null on the first page. Nothing caller-supplied goes in the text.
 */
export function updatesQuery(p: UpdatesParams): GraphQlRequest {
  throw new Error("Not implemented");
}

export interface UpdateCommit {
  oid: string;
  /** First line of the message (commit.messageHeadline). */
  title: string;
  date: Date;
}

export interface PrUpdate {
  /** 1-based, contiguous, oldest first. */
  index: number;
  /** Commits of this update in timeline order. Empty for a force push whose commits are no longer listed. */
  commits: UpdateCommit[];
  /** The head of the branch after this update: the last commit's oid, or the force-push event's afterCommit. */
  headOid: string;
  /** The head before this update (see the header); null for the first update when no baseOid was given. */
  beforeOid: string | null;
  forced: boolean;
  /** Force push: the event's createdAt. Otherwise the last commit's committedDate. */
  at: Date;
}

/**
 * Updates, oldest first, from `timelineItems` nodes of updatesQuery (or feedQuery, which asks for the same two types). Null nodes and other __typenames are ignored. A force-push event with no
 * afterCommit is skipped (the new head is unknown) and takes no index. `baseOid` is the PR's baseRefOid, the beforeOid of the first ordinary update. An empty timeline gives [].
 */
export function toUpdates(timeline: (TimelineNode | null)[], baseOid?: string | null): PrUpdate[] {
  throw new Error("Not implemented");
}

export interface UpdateComparison {
  /** The older state: the headOid of the older of the two updates (or the PR base for index 0). */
  base: string;
  /** The newer state. */
  head: string;
  /** commitDetail.comparePath(repo, base, head): `/repos/{owner}/{repo}/compare/{base}...{head}`. */
  path: string;
}

/**
 * "Compare update N with M". Index 0 means the pull request's base (updates[0].beforeOid), so "changes in update N" is (N - 1, N). The two indexes may be given in either order: the older is the base.
 * Throws "Choose two different updates" when a === b, `Unknown update ${n}` for an index outside 0..updates.length, and "The base of the pull request is unknown" for 0 when updates[0].beforeOid is null.
 */
export function compareUpdates(repo: string, updates: PrUpdate[], a: number, b: number): UpdateComparison {
  throw new Error("Not implemented");
}

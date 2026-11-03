// Batch 4, viewed files (VW-3). STUBS: the developer implements them. Every function throws "Not implemented" except the constants.
//
// Schema facts (checked live with `gh api graphql`; mutations were run with a bogus pull request id and answered NOT_FOUND "Could not resolve to a node with the global id of 'PR_bogus'", so they passed validation and wrote nothing):
//  - mutation markFileAsViewed(input: MarkFileAsViewedInput!) and unmarkFileAsViewed(input: UnmarkFileAsViewedInput!). Both inputs are { pullRequestId: ID!, path: String!, clientMutationId }.
//    Payload { clientMutationId, pullRequest }. Selecting pullRequest { id files(first: 100) { nodes { path viewerViewedState } } } validates.
//  - PullRequest.files(first, after, before, last) is a PullRequestChangedFileConnection with totalCount, pageInfo { hasNextPage endCursor } and nodes { path additions deletions changeType viewerViewedState }.
//    The cursor is an offset ("Mw" is 3). first is capped at 100, so a pull request with more files needs more pages.
//  - FileViewedState = VIEWED ("marked as viewed") | UNVIEWED ("not marked as viewed") | DISMISSED ("The file has new changes since last viewed"). viewerViewedState is NON_NULL.
//  - viewerViewedState needs an authenticated viewer; without one it is not meaningful.
// Decisions fixed by the tests: only VIEWED counts towards "N of M viewed" (DISMISSED does not: the file changed since); M is the changed-file list the caller passes (it can exceed one page);
// a path with no known state is UNVIEWED; VIEWED files start collapsed and DISMISSED files start expanded with a badge.
import type { GraphQlRequest } from "./prQuery";

export type ViewedState = "VIEWED" | "UNVIEWED" | "DISMISSED";

/** Files per page; GitHub's maximum for `first`. */
export const VIEWED_PAGE_SIZE = 100;
/** Text of the badge on a DISMISSED file. */
export const CHANGED_SINCE_VIEWED = "Changed since last viewed";

export interface ViewedFilesParams {
  owner: string;
  name: string;
  number: number;
  /** Cursor from the previous page; absent on the first page. */
  after?: string;
}

/**
 * `query($owner: String!, $name: String!, $number: Int!, $after: String)` over repository(...) { pullRequest(number: $number) { id files(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } } } }.
 * Variables { owner, name, number, after } with after null on the first page.
 */
export function viewedFilesQuery(p: ViewedFilesParams): GraphQlRequest {
  throw new Error("Not implemented");
}

/** `mutation($input: MarkFileAsViewedInput!) { markFileAsViewed(input: $input) { pullRequest { id } } }`, variables { input: { pullRequestId, path } }. Throws "pullRequestId is required" or "path is required" when blank. The path is sent exactly as given. */
export function markViewedMutation(pullRequestId: string, path: string): GraphQlRequest {
  throw new Error("Not implemented");
}

/** The same with UnmarkFileAsViewedInput and unmarkFileAsViewed. */
export function unmarkViewedMutation(pullRequestId: string, path: string): GraphQlRequest {
  throw new Error("Not implemented");
}

export interface ViewedPage {
  pullRequestId: string;
  states: Record<string, ViewedState>;
  hasNextPage: boolean;
  /** endCursor, null when there is no next page. */
  cursor: string | null;
}

/** Maps a GraphQL response body of viewedFilesQuery. Null nodes are skipped; an unrecognised state counts as UNVIEWED. A missing pull request gives an empty page with pullRequestId "". Never throws. */
export function toViewedPage(body: any): ViewedPage {
  throw new Error("Not implemented");
}

/** Pages in order into one path-to-state record (a later page wins on a repeated path). */
export function mergeViewed(pages: ViewedPage[]): Record<string, ViewedState> {
  throw new Error("Not implemented");
}

export interface ViewedProgress {
  viewed: number;
  total: number;
  /** `${viewed} of ${total} viewed`. */
  text: string;
}

/** Progress over `paths` (every changed file). Only VIEWED counts; states for paths not in `paths` are ignored. */
export function viewedProgress(paths: string[], states: Record<string, ViewedState>): ViewedProgress {
  throw new Error("Not implemented");
}

/** VIEWED files are collapsed when the Files tab opens; UNVIEWED, DISMISSED and unknown (undefined) are expanded. */
export function isCollapsedByDefault(state: ViewedState | undefined): boolean {
  throw new Error("Not implemented");
}

/** True for DISMISSED only: shows the CHANGED_SINCE_VIEWED badge. */
export function changedSinceViewed(state: ViewedState | undefined): boolean {
  throw new Error("Not implemented");
}

/** Optimistic update after a toggle: a new record with `path` VIEWED (viewed true) or UNVIEWED (false). The input is not changed. */
export function withViewed(states: Record<string, ViewedState>, path: string, viewed: boolean): Record<string, ViewedState> {
  throw new Error("Not implemented");
}

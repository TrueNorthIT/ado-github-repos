// Batch 2, reviewers (ED-2) and assignees (ED-5). STUBS: the developer implements them.
//
// Schema facts (checked live with `gh api graphql`; mutations were run with bogus node ids, so they passed validation and wrote nothing):
//  - mutation requestReviews(input: RequestReviewsInput!) takes { pullRequestId: ID!, userIds: [ID!], botIds: [ID!], teamIds: [ID!], union: Boolean }. union is documented as "Add users to the
//    set rather than replace": without `union: true` the call REPLACES the whole reviewer set, so the builder always sends union: true for adding.
//  - There is NO removeReviewRequests mutation in GraphQL (Mutation has requestReviews, requestReviewsByLogin, rerequestReviews only). Removal is REST:
//    DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers, body { reviewers: string[] (REQUIRED, user logins), team_reviewers?: string[] (team slugs) }
//    (OpenAPI "Remove requested reviewers from a pull request": `required: ["reviewers"]`, responses 200 and 422). So the body always carries `reviewers`, even as [] when only teams go.
//    GraphQL alternative rejected: requestReviews with union: false and the remaining ids would also drop bots (Copilot) unless botIds were resent, and races with other editors.
//    Live: the endpoint exists (404 without write access on a public repo; the call was not allowed to write).
//  - Repository.assignableUsers(query: String, first: Int) { nodes { id login name avatarUrl } }: "Filters users with query on user name and login". A null query lists everyone (checked on cli/cli).
//  - Organization.teams(query: String, first: Int) { nodes { id slug name avatarUrl } }: "filters teams with query on team name and team slug". For a user-owned repository
//    organization(login:) fails with NOT_FOUND ("Could not resolve to an Organization") and data.organization is null, so teams are a separate request from users: one failure must not lose the other.
//    A non-member sees no secret teams (an empty list for `github`).
//  - ReviewRequest.asCodeOwner: "Whether this request was created for a code owner". requestedReviewer is null for a team the viewer cannot see (cli/cli#14846 had asCodeOwner: true with a null reviewer).
//  - PullRequest.suggestedReviewerActors exists (not used here).
//  - Assigning: addAssigneesToAssignable(input: { assignableId: ID!, assigneeIds: [ID!] }) and removeAssigneesFromAssignable(input: { assignableId: ID!, assigneeIds: [ID!]! }); payload `assignable`.
import type { GraphQlRequest } from "./prQuery";
import type { RestRequest } from "./restRequest";

/** How many results one search request asks for. */
export const SEARCH_PAGE = 20;

const NOT_IMPLEMENTED = () => new Error("Not implemented");

export interface Candidate {
  kind: "user" | "team";
  /** GraphQL node id, what requestReviews / addAssigneesToAssignable take. */
  id: string;
  /** User login, or the team slug. */
  login: string;
  /** Display name: the user's profile name, or the team's name. */
  name?: string | null;
  avatarUrl?: string;
}

/**
 * `query($owner: String!, $name: String!, $query: String)` over repository(owner: $owner, name: $name) { assignableUsers(query: $query, first: 20) { nodes { id login name avatarUrl } } }.
 * Serves reviewers and assignees. Variables { owner, name, query }: the query is trimmed, and null when blank (null lists everyone). Nothing user-supplied goes in the text.
 */
export function userSearchQuery(_p: { owner: string; name: string; query: string }): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

/**
 * `query($org: String!, $query: String)` over organization(login: $org) { teams(query: $query, first: 20) { nodes { id slug name avatarUrl } } }.
 * Variables { org, query } with the same trimming rule. Only for repositories owned by an organisation.
 */
export function teamSearchQuery(_p: { org: string; query: string }): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

/** data.repository.assignableUsers.nodes as user Candidates (in order). Missing data, nulls and null nodes give []. */
export function userCandidates(_data: { repository?: { assignableUsers?: { nodes?: ({ id: string; login: string; name?: string | null; avatarUrl?: string } | null)[] } | null } | null } | null | undefined): Candidate[] {
  throw NOT_IMPLEMENTED();
}

/** data.organization.teams.nodes as team Candidates: login is the slug. Missing data (for example a user-owned repository), nulls and null nodes give []. */
export function teamCandidates(_data: { organization?: { teams?: { nodes?: ({ id: string; slug: string; name?: string | null; avatarUrl?: string } | null)[] } | null } | null } | null | undefined): Candidate[] {
  throw NOT_IMPLEMENTED();
}

export interface RankOptions {
  /** The pull request author: never offered as a reviewer. Matched case-insensitively against users only. */
  authorLogin?: string;
  /** Already requested: left out. A user matches by login; a team by slug or by name (the PR page labels teams by name). Case-insensitive. */
  current?: { kind: "user" | "team"; login: string }[];
  /** Default 10. */
  limit?: number;
}

/**
 * Merges users and teams into one ranked list for the picker.
 *  - removes the author and the current reviewers (see RankOptions).
 *  - a non-blank query (trimmed, case-insensitive) keeps only matches, in tiers: 1 exact login, 2 login starting with the query, 3 fuzzy (fuzzy.ts fuzzyFind, over login and name). Within a tier,
 *    shorter login first, then alphabetical by login, users before teams on a tie. Everything else is dropped.
 *  - a blank query keeps everything, alphabetical by login (users before teams on a tie).
 *  - at most `limit` results.
 */
export function rankCandidates(_candidates: Candidate[], _query: string, _opts?: RankOptions): Candidate[] {
  throw NOT_IMPLEMENTED();
}

/**
 * `mutation($input: RequestReviewsInput!) { requestReviews(input: $input) { pullRequest { id } } }`.
 * variables.input is { pullRequestId, userIds?, teamIds?, union: true }; an empty or missing id list is left out. Throws "pullRequestId is required" for a blank id and
 * "at least one reviewer is required" when both lists are empty.
 */
export function requestReviewsMutation(_p: { pullRequestId: string; userIds?: string[]; teamIds?: string[] }): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

/**
 * REST removal: { method: "DELETE", path: `/repos/${repo}/pulls/${number}/requested_reviewers`, body: { reviewers: users, team_reviewers?: teams } } where `repo` is "owner/name", users are logins
 * and teams are slugs. `reviewers` is always present ([] when only teams are removed); `team_reviewers` only when non-empty. Throws "at least one reviewer is required" when both are empty.
 */
export function removeReviewRequestsRequest(_repo: string, _number: number, _p: { users?: string[]; teams?: string[] }): RestRequest {
  throw NOT_IMPLEMENTED();
}

export interface RequestedReviewer {
  kind: "user" | "team" | "bot";
  id: string;
  /** User or bot login, or the team slug (what removeReviewRequestsRequest needs). */
  login: string;
  /** What the page shows: the profile name for a user (login when none), the team name for a team, reviewerName(login) (copilotReview.ts) for a bot. */
  name: string;
  avatarUrl?: string;
  /** ReviewRequest.asCodeOwner. */
  codeOwner: boolean;
  /** "Code owner" exactly when codeOwner is true. */
  badge?: "Code owner";
}

/** PullRequest.reviewRequests.nodes as rows, in order. Nodes whose requestedReviewer is null (an invisible team) or of another type (Mannequin) are dropped. */
export function toRequestedReviewers(_nodes: { asCodeOwner?: boolean | null; requestedReviewer: { __typename: string; id?: string; login?: string; slug?: string; name?: string | null; avatarUrl?: string } | null }[] | null | undefined): RequestedReviewer[] {
  throw NOT_IMPLEMENTED();
}

/** `mutation($input: AddAssigneesToAssignableInput!) { addAssigneesToAssignable(input: $input) { assignable { ... on PullRequest { id assignees(first: 20) { nodes { id login name avatarUrl } } } } } }`. Input { assignableId, assigneeIds }. Throws "assignableId is required" / "at least one assignee is required". */
export function addAssigneesMutation(_assignableId: string, _assigneeIds: string[]): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

/** `mutation($input: RemoveAssigneesFromAssignableInput!) { removeAssigneesFromAssignable(input: $input) { assignable { ... on PullRequest { id assignees(first: 20) { nodes { id login name avatarUrl } } } } } }`. Same guards. */
export function removeAssigneesMutation(_assignableId: string, _assigneeIds: string[]): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

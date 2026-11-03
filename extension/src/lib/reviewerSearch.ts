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
import { fuzzyFind } from "./fuzzy";
import { reviewerName } from "./copilotReview";

/** How many results one search request asks for. */
export const SEARCH_PAGE = 20;

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
export function userSearchQuery(p: { owner: string; name: string; query: string }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $query: String) {
  repository(owner: $owner, name: $name) { assignableUsers(query: $query, first: ${SEARCH_PAGE}) { nodes{ id login name avatarUrl } } }
}`,
    variables: { owner: p.owner, name: p.name, query: p.query.trim() || null },
  };
}

/**
 * `query($org: String!, $query: String)` over organization(login: $org) { teams(query: $query, first: 20) { nodes { id slug name avatarUrl } } }.
 * Variables { org, query } with the same trimming rule. Only for repositories owned by an organisation.
 */
export function teamSearchQuery(p: { org: string; query: string }): GraphQlRequest {
  return {
    query: `query($org: String!, $query: String) {
  organization(login: $org) { teams(query: $query, first: ${SEARCH_PAGE}) { nodes{ id slug name avatarUrl } } }
}`,
    variables: { org: p.org, query: p.query.trim() || null },
  };
}

/** data.repository.assignableUsers.nodes as user Candidates (in order). Missing data, nulls and null nodes give []. */
export function userCandidates(data: { repository?: { assignableUsers?: { nodes?: ({ id: string; login: string; name?: string | null; avatarUrl?: string } | null)[] } | null } | null } | null | undefined): Candidate[] {
  const out: Candidate[] = [];
  for (const n of data?.repository?.assignableUsers?.nodes ?? []) if (n) out.push({ kind: "user", id: n.id, login: n.login, name: n.name, avatarUrl: n.avatarUrl });
  return out;
}

/** data.organization.teams.nodes as team Candidates: login is the slug. Missing data (for example a user-owned repository), nulls and null nodes give []. */
export function teamCandidates(data: { organization?: { teams?: { nodes?: ({ id: string; slug: string; name?: string | null; avatarUrl?: string } | null)[] } | null } | null } | null | undefined): Candidate[] {
  const out: Candidate[] = [];
  for (const n of data?.organization?.teams?.nodes ?? []) if (n) out.push({ kind: "team", id: n.id, login: n.slug, name: n.name, avatarUrl: n.avatarUrl });
  return out;
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
export function rankCandidates(candidates: Candidate[], query: string, opts?: RankOptions): Candidate[] {
  const q = query.trim().toLowerCase();
  const author = opts?.authorLogin?.toLowerCase();
  const current = (opts?.current ?? []).map((c) => ({ kind: c.kind, login: c.login.toLowerCase() }));
  const requested = (c: Candidate) =>
    current.some((r) => r.kind === c.kind && (r.login === c.login.toLowerCase() || (c.kind === "team" && r.login === (c.name ?? "").toLowerCase())));
  const tier = (c: Candidate) => {
    const l = c.login.toLowerCase();
    if (!q) return 0;
    if (l === q) return 1;
    if (l.startsWith(q)) return 2;
    return fuzzyFind([c.login, c.name ?? ""].filter(Boolean), q, 1).length ? 3 : 4;
  };
  return candidates
    .filter((c) => !(c.kind === "user" && author && c.login.toLowerCase() === author) && !requested(c))
    .map((c) => ({ c, t: tier(c) }))
    .filter((x) => x.t < 4)
    .sort((a, b) => {
      const la = a.c.login.toLowerCase();
      const lb = b.c.login.toLowerCase();
      return a.t - b.t || (a.t === 0 ? 0 : la.length - lb.length) || (la < lb ? -1 : la > lb ? 1 : 0) || (a.c.kind === b.c.kind ? 0 : a.c.kind === "user" ? -1 : 1);
    })
    .slice(0, opts?.limit ?? 10)
    .map((x) => x.c);
}

/**
 * `mutation($input: RequestReviewsInput!) { requestReviews(input: $input) { pullRequest { id } } }`.
 * variables.input is { pullRequestId, userIds?, teamIds?, union: true }; an empty or missing id list is left out. Throws "pullRequestId is required" for a blank id and
 * "at least one reviewer is required" when both lists are empty.
 */
export function requestReviewsMutation(p: { pullRequestId: string; userIds?: string[]; teamIds?: string[] }): GraphQlRequest {
  if (!p.pullRequestId.trim()) throw new Error("pullRequestId is required");
  const input: Record<string, unknown> = { pullRequestId: p.pullRequestId };
  if (p.userIds?.length) input.userIds = p.userIds;
  if (p.teamIds?.length) input.teamIds = p.teamIds;
  if (!input.userIds && !input.teamIds) throw new Error("at least one reviewer is required");
  input.union = true;
  return { query: `mutation($input: RequestReviewsInput!) { requestReviews(input: $input) { pullRequest{ id } } }`, variables: { input } };
}

/**
 * REST removal: { method: "DELETE", path: `/repos/${repo}/pulls/${number}/requested_reviewers`, body: { reviewers: users, team_reviewers?: teams } } where `repo` is "owner/name", users are logins
 * and teams are slugs. `reviewers` is always present ([] when only teams are removed); `team_reviewers` only when non-empty. Throws "at least one reviewer is required" when both are empty.
 */
export function removeReviewRequestsRequest(repo: string, number: number, p: { users?: string[]; teams?: string[] }): RestRequest {
  const users = p.users ?? [];
  const teams = p.teams ?? [];
  if (!users.length && !teams.length) throw new Error("at least one reviewer is required");
  return { method: "DELETE", path: `/repos/${repo}/pulls/${number}/requested_reviewers`, body: { reviewers: users, ...(teams.length ? { team_reviewers: teams } : {}) } };
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
export function toRequestedReviewers(nodes: { asCodeOwner?: boolean | null; requestedReviewer: { __typename: string; id?: string; login?: string; slug?: string; name?: string | null; avatarUrl?: string } | null }[] | null | undefined): RequestedReviewer[] {
  const out: RequestedReviewer[] = [];
  for (const n of nodes ?? []) {
    const r = n.requestedReviewer;
    if (!r) continue;
    const codeOwner = !!n.asCodeOwner;
    const base = { id: r.id ?? "", avatarUrl: r.avatarUrl, codeOwner, ...(codeOwner ? { badge: "Code owner" as const } : {}) };
    if (r.__typename === "User") out.push({ kind: "user", login: r.login ?? "", name: r.name || r.login || "", ...base });
    else if (r.__typename === "Team") out.push({ kind: "team", login: r.slug ?? "", name: r.name || r.slug || "", ...base });
    else if (r.__typename === "Bot") out.push({ kind: "bot", login: r.login ?? "", name: reviewerName(r.login ?? ""), ...base });
  }
  return out;
}

function assigneesMutation(inputType: string, field: string, assignableId: string, assigneeIds: string[]): GraphQlRequest {
  if (!assignableId.trim()) throw new Error("assignableId is required");
  if (!assigneeIds.length) throw new Error("at least one assignee is required");
  return {
    query: `mutation($input: ${inputType}!) { ${field}(input: $input) { assignable { ... on PullRequest{ id assignees(first: 20) { nodes{ id login name avatarUrl } } } } } }`,
    variables: { input: { assignableId, assigneeIds } },
  };
}

/** `mutation($input: AddAssigneesToAssignableInput!) { addAssigneesToAssignable(input: $input) { assignable { ... on PullRequest { id assignees(first: 20) { nodes { id login name avatarUrl } } } } } }`. Input { assignableId, assigneeIds }. Throws "assignableId is required" / "at least one assignee is required". */
export function addAssigneesMutation(assignableId: string, assigneeIds: string[]): GraphQlRequest {
  return assigneesMutation("AddAssigneesToAssignableInput", "addAssigneesToAssignable", assignableId, assigneeIds);
}

/** `mutation($input: RemoveAssigneesFromAssignableInput!) { removeAssigneesFromAssignable(input: $input) { assignable { ... on PullRequest { id assignees(first: 20) { nodes { id login name avatarUrl } } } } } }`. Same guards. */
export function removeAssigneesMutation(assignableId: string, assigneeIds: string[]): GraphQlRequest {
  return assigneesMutation("RemoveAssigneesFromAssignableInput", "removeAssigneesFromAssignable", assignableId, assigneeIds);
}

// GitHub pull request GraphQL query builders (PR-1, PR-3, PR-4, PR-6).
// Rule shared with commits.ts: every caller-supplied value travels in `variables`, never in the query text.

export type PrTab = "mine" | "active" | "completed" | "abandoned";

/** Rows per page for the Active / Completed / Abandoned tabs. */
export const PAGE_SIZE = 25;

export interface GraphQlRequest {
  query: string;
  variables: Record<string, unknown>;
}

export interface PrListRequest extends GraphQlRequest {
  /** Which GraphQL entry point the request uses (repository.pullRequests, search, or repository.pullRequest for a number filter). */
  source: "pullRequests" | "search" | "pullRequest";
  /** Only set for the two Mine searches. */
  section?: "created" | "review-requested";
}

export interface ListParams {
  owner: string;
  name: string;
  /** Free text, "123" or "#123". Ignored on the Mine tab. */
  filter?: string;
  /** Cursor from the previous page. Ignored on the Mine tab. */
  after?: string;
}

const STATES: Record<Exclude<PrTab, "mine">, { states: string[]; tokens: string }> = {
  active: { states: ["OPEN"], tokens: "is:open" },
  completed: { states: ["MERGED"], tokens: "is:merged" },
  abandoned: { states: ["CLOSED"], tokens: "is:closed is:unmerged" },
};

// Fields of PrListNode. reviewThreads first:100 so `resolved` is exact.
const NODE = `number title url state isDraft createdAt updatedAt mergedAt closedAt baseRefName
  author { login avatarUrl ... on User { name } }
  labels(first: 10) { nodes { name color } }
  reviewThreads(first: 100) { totalCount nodes { isResolved } }
  comments { totalCount }`;
const PAGE = "pageInfo { hasNextPage endCursor }";

const Q_PULLS = `query($owner: String!, $name: String!, $states: [PullRequestState!], $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: $states, orderBy: {field: UPDATED_AT, direction: DESC}, first: ${PAGE_SIZE}, after: $after) { nodes { ${NODE} } ${PAGE} }
  }
}`;
const Q_SEARCH = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: ${PAGE_SIZE}, after: $after) { nodes { ... on PullRequest { ${NODE} } } ${PAGE} }
}`;
const Q_ONE = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${NODE} } }
}`;

/** Requests needed to render one tab: one for Active / Completed / Abandoned, two (created, review-requested) for Mine. */
export function listQuery(tab: PrTab, { owner, name, filter, after }: ListParams): PrListRequest[] {
  const repoQ = `repo:${owner}/${name} is:pr`;
  if (tab === "mine")
    return (["created", "review-requested"] as const).map((section) => ({
      query: Q_SEARCH,
      variables: { q: `${repoQ} is:open ${section === "created" ? "author:@me" : "review-requested:@me"}`, after: null },
      source: "search" as const,
      section,
    }));
  const text = (filter ?? "").trim();
  if (/^#?[1-9]\d*$/.test(text)) return [{ query: Q_ONE, variables: { owner, name, number: Number(text.replace("#", "")) }, source: "pullRequest" }];
  // Free text only: anything with ":" is a qualifier and could leave the repo or change the state.
  const terms = text.split(/\s+/).filter((t) => t && !t.includes(":"));
  const cursor = after ?? null;
  if (terms.length) return [{ query: Q_SEARCH, variables: { q: `${repoQ} ${STATES[tab].tokens} ${terms.join(" ")}`, after: cursor }, source: "search" }];
  return [{ query: Q_PULLS, variables: { owner, name, states: STATES[tab].states, after: cursor }, source: "pullRequests" }];
}

/** One query for header, overview (rendered body), reviewers, labels, checks, review threads and commits (first 100). Every field was checked against GitHub's published GraphQL schema. Files come from REST (getPrFiles). */
export function detailQuery({ owner, name, number }: { owner: string; name: string; number: number }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      ${NODE} body bodyHTML headRefName headRefOid baseRefOid mergeable
      statusCheckRollup { state }
      reviewRequests(first: 50) { nodes { requestedReviewer { ... on User { login avatarUrl } ... on Bot { login avatarUrl } ... on Team { login: name avatarUrl } } } }
      reviews(first: 100) { nodes { author { login avatarUrl } state submittedAt } }
      commits(first: 100) { nodes { commit { oid message authoredDate author { name avatarUrl user { login } } } } }
    }
  }
}`,
    variables: { owner, name, number },
  };
}

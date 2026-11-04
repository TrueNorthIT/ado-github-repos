// GitHub GraphQL builders for the PR activity feed (AF-1..AF-3, AF-5, AF-6, AF-7).
// Rule shared with prQuery.ts / commits.ts: every caller-supplied value travels in `variables`, never in the query text.
import type { GraphQlRequest } from "./prQuery";

export interface FeedParams {
  owner: string;
  name: string;
  number: number;
  /** Timeline cursor from the previous page; absent on the first page. */
  after?: string;
}

/** One review thread as the feed reads it; addPullRequestReviewThread selects the same shape so a new thread renders unchanged. */
export const THREAD_FIELDS = `id isResolved isOutdated path line originalLine startLine originalStartLine diffSide startDiffSide subjectType
          comments(first: 100) {
            nodes { id databaseId author { login avatarUrl } bodyHTML body createdAt url replyTo { id } state diffHunk }
          }`;

const ACTOR = "actor { login avatarUrl }";
const FEED_QUERY = `query FeedQuery($owner: String!, $name: String!, $number: Int!, $after: String) {
  viewer { login avatarUrl }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id createdAt author { login avatarUrl }
      timelineItems(first: 100, after: $after, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, PULL_REQUEST_COMMIT, REVIEW_REQUESTED_EVENT, LABELED_EVENT, UNLABELED_EVENT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT]) {
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on IssueComment { id databaseId author { login avatarUrl } bodyHTML body createdAt url }
          ... on PullRequestReview { id author { login avatarUrl } state body bodyHTML submittedAt createdAt url }
          ... on PullRequestCommit { id commit { oid messageHeadline message committedDate authoredDate author { name avatarUrl user { login } } } }
          ... on ReviewRequestedEvent { id createdAt ${ACTOR} requestedReviewer { __typename ... on User { login } ... on Bot { login avatarUrl } ... on Team { name } } }
          ... on LabeledEvent { id createdAt ${ACTOR} label { name color } }
          ... on UnlabeledEvent { id createdAt ${ACTOR} label { name color } }
          ... on ReadyForReviewEvent { id createdAt ${ACTOR} }
          ... on ConvertToDraftEvent { id createdAt ${ACTOR} }
          ... on MergedEvent { id createdAt ${ACTOR} }
          ... on ClosedEvent { id createdAt ${ACTOR} }
          ... on ReopenedEvent { id createdAt ${ACTOR} }
          ... on HeadRefForcePushedEvent { id createdAt ${ACTOR} beforeCommit { oid } afterCommit { oid } }
        }
      }
      reviewThreads(first: 100) {
        nodes { ${THREAD_FIELDS} }
      }
    }
  }
}`;

/** Timeline page plus the first 100 review threads of one pull request. */
export function feedQuery(p: FeedParams): GraphQlRequest {
  return { query: FEED_QUERY, variables: { owner: p.owner, name: p.name, number: p.number, after: p.after ?? null } };
}

function nonBlank(body: string): string {
  if (!body.trim()) throw new Error("A comment body is required");
  return body;
}

// Fields the UI reconciles from (AF-7): the new comment's id, url, bodyHTML, createdAt (+ author for the avatar); the thread's isResolved.
const COMMENT_FIELDS = "id url bodyHTML createdAt author { login avatarUrl }";

/** addComment: a top-level PR comment (issue comment) on the PR node. Throws on an empty or whitespace-only body. */
export function addCommentMutation(subjectId: string, body: string): GraphQlRequest {
  return {
    query: `mutation AddComment($input: AddCommentInput!) { addComment(input: $input) { commentEdge { node { ${COMMENT_FIELDS} } } } }`,
    variables: { input: { subjectId, body: nonBlank(body) } },
  };
}

/** addPullRequestReviewThreadReply. Throws on an empty or whitespace-only body. */
export function replyMutation(threadId: string, body: string): GraphQlRequest {
  return {
    query: `mutation ReplyToThread($input: AddPullRequestReviewThreadReplyInput!) { addPullRequestReviewThreadReply(input: $input) { comment { ${COMMENT_FIELDS} } } }`,
    variables: { input: { pullRequestReviewThreadId: threadId, body: nonBlank(body) } },
  };
}

/** resolveReviewThread. */
export function resolveMutation(threadId: string): GraphQlRequest {
  return {
    query: `mutation ResolveThread($input: ResolveReviewThreadInput!) { resolveReviewThread(input: $input) { thread { id isResolved } } }`,
    variables: { input: { threadId } },
  };
}

/** unresolveReviewThread. */
export function unresolveMutation(threadId: string): GraphQlRequest {
  return {
    query: `mutation UnresolveThread($input: UnresolveReviewThreadInput!) { unresolveReviewThread(input: $input) { thread { id isResolved } } }`,
    variables: { input: { threadId } },
  };
}

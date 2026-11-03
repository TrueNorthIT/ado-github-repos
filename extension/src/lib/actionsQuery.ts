// GitHub GraphQL builders for acting on a pull request (A-1, A-2, A-3, A-4).
// Rule shared with feedQuery.ts / prQuery.ts: every caller-supplied value travels in `variables`, never in the query text.
// Mutation builders take one `$input` variable typed with GitHub's input object.
import type { GraphQlRequest } from "./prQuery";

/** GitHub's PullRequestMergeMethod enum. */
export type MergeMethod = "MERGE" | "SQUASH" | "REBASE";

/** Raw node of `actionsDetailQuery` (repository + pull request): what policies, votes, mergeOptions and stateActions are fed from. */
export interface PrActionsNode {
  repository: {
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
    autoMergeAllowed: boolean;
    deleteBranchOnMerge: boolean;
    /** ADMIN | MAINTAIN | WRITE | TRIAGE | READ, null when unknown. */
    viewerPermission: string | null;
    defaultBranchRef: { name: string } | null;
    pullRequest: {
      id: string;
      state: "OPEN" | "CLOSED" | "MERGED";
      isDraft: boolean;
      merged: boolean;
      mergeStateStatus: string;
      reviewDecision: string | null;
      baseRefName: string;
      headRefName: string;
      headRefOid: string;
      isCrossRepository: boolean;
      headRepository: { nameWithOwner: string; viewerPermission?: string | null } | null;
      maintainerCanModify?: boolean;
      viewerCanUpdateBranch?: boolean;
      isMergeQueueEnabled?: boolean;
      isInMergeQueue?: boolean;
      mergeQueueEntry?: { position: number | null; state: "QUEUED" | "AWAITING_CHECKS" | "MERGEABLE" | "UNMERGEABLE" | "LOCKED"; estimatedTimeToMerge: number | null } | null;
      reviewRequests?: { nodes: { requestedReviewer: { __typename: string; login?: string } | null }[] };
      headRef: { id: string; name: string; branchProtectionRule: { allowsDeletions: boolean } | null } | null;
      viewerSubscription: "SUBSCRIBED" | "UNSUBSCRIBED" | "IGNORED" | null;
      viewerDidAuthor: boolean;
      viewerCanUpdate: boolean;
      viewerCanClose: boolean;
      viewerCanReopen: boolean;
      viewerCanDeleteHeadRef: boolean;
      viewerCanEnableAutoMerge: boolean;
      viewerCanDisableAutoMerge: boolean;
      viewerCanMergeAsAdmin: boolean;
      viewerLatestReview: { id: string; state: string } | null;
      autoMergeRequest: { enabledAt?: string | null; mergeMethod: MergeMethod; commitHeadline?: string | null; commitBody?: string | null; enabledBy?: { login: string } | null } | null;
      statusCheckRollup: {
        state: string;
        contexts: { pageInfo?: { hasNextPage: boolean }; nodes: unknown[] };
      } | null;
    } | null;
  } | null;
}

const CHECK_FIELDS = `__typename
        ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: $number) startedAt completedAt checkSuite { workflowRun { workflow { name } } } runSuite: checkSuite { workflowRun { databaseId } } annotations(first: 1) { totalCount } }
        ... on StatusContext { context state targetUrl createdAt isRequired(pullRequestNumber: $number) }`;

/** The extra fields the actions need: repo merge settings, mergeStateStatus, reviewDecision, viewer flags, head ref + protection, default branch, auto-merge request and the head commit's check contexts. Variables { owner, name, number }. */
export function actionsDetailQuery({ owner, name, number }: { owner: string; name: string; number: number }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed autoMergeAllowed deleteBranchOnMerge viewerPermission
    defaultBranchRef { name }
    pullRequest(number: $number) {
      id state isDraft merged mergeStateStatus reviewDecision baseRefName headRefName headRefOid isCrossRepository
      headRepository { nameWithOwner viewerPermission }
      maintainerCanModify viewerCanUpdateBranch isMergeQueueEnabled isInMergeQueue mergeQueueEntry { position state estimatedTimeToMerge }
      reviewRequests(first: 30) { nodes { requestedReviewer { __typename ... on User { login } ... on Bot { login } } } }
      headRef { id name branchProtectionRule { allowsDeletions } }
      viewerDidAuthor viewerCanUpdate viewerCanClose viewerCanReopen viewerCanDeleteHeadRef viewerCanEnableAutoMerge viewerCanDisableAutoMerge viewerCanMergeAsAdmin viewerSubscription
      viewerLatestReview { id state }
      autoMergeRequest { enabledAt mergeMethod commitHeadline commitBody enabledBy { login } }
      statusCheckRollup { state contexts(first: 100) { pageInfo { hasNextPage } nodes { ${CHECK_FIELDS} } } }
    }
  }
}`,
    variables: { owner, name, number },
  };
}

const blank = (s?: string) => !s || !s.trim();
/** `$input` mutation: one operation, caller text only in variables. */
const mutation = (type: string, field: string, input: Record<string, unknown>, selection: string): GraphQlRequest => ({
  query: `mutation($input: ${type}!) { ${field}(input: $input) { ${selection} } }`,
  variables: { input },
});
const PR_STATE = "pullRequest { id state isDraft merged }";

export interface ReviewParams {
  pullRequestId: string;
  event: "APPROVE" | "REQUEST_CHANGES";
  body?: string;
  /** Pins the review to the commit the reviewer saw (AddPullRequestReviewInput.commitOID). */
  commitOid?: string;
}
/** addPullRequestReview. REQUEST_CHANGES throws on a blank body; for APPROVE a blank body is omitted from the input. */
export function reviewMutation(p: ReviewParams): GraphQlRequest {
  if (p.event === "REQUEST_CHANGES" && blank(p.body)) throw new Error("Requesting changes needs a comment: the body is empty.");
  return mutation(
    "AddPullRequestReviewInput",
    "addPullRequestReview",
    { pullRequestId: p.pullRequestId, event: p.event, ...(blank(p.body) ? {} : { body: p.body }), ...(p.commitOid ? { commitOID: p.commitOid } : {}) },
    "pullRequestReview { id state }"
  );
}

/** dismissPullRequestReview (message is String! in the schema). Throws on a blank message. */
export function dismissReviewMutation(pullRequestReviewId: string, message: string): GraphQlRequest {
  if (blank(message)) throw new Error("A dismissal message is required: the message is empty.");
  return mutation("DismissPullRequestReviewInput", "dismissPullRequestReview", { pullRequestReviewId, message }, "pullRequestReview { id state }");
}

export interface MergeParams {
  pullRequestId: string;
  mergeMethod: MergeMethod;
  /** Required: the merge is refused if the head moved. Throws when blank. */
  expectedHeadOid: string;
  /** Ignored for REBASE. A blank value is omitted (GitHub then uses its default). */
  commitHeadline?: string;
  commitBody?: string;
}
function mergeInput(p: MergeParams) {
  if (blank(p.expectedHeadOid)) throw new Error("expectedHeadOid is required so the merge is refused if the branch moved.");
  const msg = p.mergeMethod !== "REBASE";
  return {
    pullRequestId: p.pullRequestId,
    mergeMethod: p.mergeMethod,
    expectedHeadOid: p.expectedHeadOid,
    ...(msg && !blank(p.commitHeadline) ? { commitHeadline: p.commitHeadline } : {}),
    ...(msg && !blank(p.commitBody) ? { commitBody: p.commitBody } : {}),
  };
}
/** mergePullRequest. */
export const mergePullRequestMutation = (p: MergeParams): GraphQlRequest => mutation("MergePullRequestInput", "mergePullRequest", mergeInput(p), PR_STATE);

/** enablePullRequestAutoMerge; same parameters and message rules as mergePullRequestMutation. */
export const enableAutoMergeMutation = (p: MergeParams): GraphQlRequest =>
  mutation("EnablePullRequestAutoMergeInput", "enablePullRequestAutoMerge", mergeInput(p), PR_STATE);

/** disablePullRequestAutoMerge. */
export const disableAutoMergeMutation = (pullRequestId: string): GraphQlRequest =>
  mutation("DisablePullRequestAutoMergeInput", "disablePullRequestAutoMerge", { pullRequestId }, PR_STATE);

/** deleteRef: `refId` is the node id of the head ref (headRef { id }). */
export const deleteRefMutation = (refId: string): GraphQlRequest => mutation("DeleteRefInput", "deleteRef", { refId }, "clientMutationId");

/** closePullRequest (Abandon). */
export const closePullRequestMutation = (pullRequestId: string): GraphQlRequest => mutation("ClosePullRequestInput", "closePullRequest", { pullRequestId }, PR_STATE);

/** reopenPullRequest (Reactivate). */
export const reopenPullRequestMutation = (pullRequestId: string): GraphQlRequest => mutation("ReopenPullRequestInput", "reopenPullRequest", { pullRequestId }, PR_STATE);

/** convertPullRequestToDraft (Mark as draft). */
export const convertToDraftMutation = (pullRequestId: string): GraphQlRequest =>
  mutation("ConvertPullRequestToDraftInput", "convertPullRequestToDraft", { pullRequestId }, PR_STATE);

/** markPullRequestReadyForReview (Publish). */
export const markReadyForReviewMutation = (pullRequestId: string): GraphQlRequest =>
  mutation("MarkPullRequestReadyForReviewInput", "markPullRequestReadyForReview", { pullRequestId }, PR_STATE);

/** updateSubscription on the pull request's node id (Follow / Unfollow). */
export const subscriptionMutation = (subscribableId: string, state: "SUBSCRIBED" | "UNSUBSCRIBED"): GraphQlRequest =>
  mutation("UpdateSubscriptionInput", "updateSubscription", { subscribableId, state }, "subscribable { viewerSubscription }");

/** updatePullRequest with a new base branch (Change target branch). Throws on a blank name. */
export function updateBaseMutation(pullRequestId: string, baseRefName: string): GraphQlRequest {
  if (blank(baseRefName)) throw new Error("A target branch is required: the baseRefName is empty.");
  return mutation("UpdatePullRequestInput", "updatePullRequest", { pullRequestId, baseRefName }, "pullRequest { id baseRefName }");
}

/** The branches a pull request can be retargeted to (first 100 refs/heads). */
export const branchesQuery = ({ owner, name }: { owner: string; name: string }): GraphQlRequest => ({
  query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { refs(refPrefix: "refs/heads/", first: 100) { nodes { name } } } }`,
  variables: { owner, name },
});

/** GitHub's own suggested merge commit title and body for each method, for prefilling "Customize merge commit message". Variables { owner, name, number }. */
export const mergeMessageQuery = ({ owner, name, number }: { owner: string; name: string; number: number }): GraphQlRequest => ({
  query: `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    mergeH: viewerMergeHeadlineText(mergeType: MERGE) mergeB: viewerMergeBodyText(mergeType: MERGE)
    squashH: viewerMergeHeadlineText(mergeType: SQUASH) squashB: viewerMergeBodyText(mergeType: SQUASH)
  } } }`,
  variables: { owner, name, number },
});
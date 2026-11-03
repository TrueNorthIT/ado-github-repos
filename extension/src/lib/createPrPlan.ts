// Batch 5, creating the pull request (CP-4): the create mutation, the follow-ups that need the new PR's id, and a runner that reports partial failure.
// STUBS: the developer implements them. Every function throws "Not implemented".
//
// Schema facts (checked live with `gh api graphql`; createPullRequest was run with repositoryId "BOGUS" and failed on the id ("Could not resolve to a node with the global id of 'BOGUS'"), so it passed
// validation and created nothing):
//  - mutation createPullRequest(input: CreatePullRequestInput!). Input fields (introspected): repositoryId: ID!, baseRefName: String!, headRefName: String!, title: String!, body: String, draft: Boolean,
//    maintainerCanModify: Boolean, headRepositoryId: ID, clientMutationId. It has NO labels, assignees, reviewers, milestone or projects: adding milestoneId was rejected ("Field is not defined on
//    CreatePullRequestInput"). Hence the follow-ups below, once the PR id is known.
//  - Payload CreatePullRequestPayload { clientMutationId pullRequest }. `pullRequest { id number url headRefOid }` validates (headRefOid is the expectedHeadOid enablePullRequestAutoMerge needs).
//  - The follow-ups reuse builders that were validated in batch 2 and batch 3: requestReviewsMutation (reviewerSearch.ts, union: true), addLabelsMutation (labels.ts), addAssigneesMutation (reviewerSearch.ts),
//    setMilestoneMutation (milestones.ts; updatePullRequest has milestoneId), addProjectItemMutation (projects.ts; needs the `project` scope) and enableAutoMergeMutation (actionsQuery.ts). EnablePullRequestAutoMergeInput
//    (introspected) is { pullRequestId, commitHeadline, commitBody, mergeMethod, authorEmail, expectedHeadOid }; expectedHeadOid is a GitObjectID ("abc" was refused as not coercible), so it must be the real headRefOid.
//
// Decisions fixed by the tests (createPrPlan.test.ts):
//  - draft defaults to false and maintainerCanModify to true (GitHub's own defaults); body defaults to "". The title is trimmed.
//  - Follow-up order: reviewers, labels, assignees, milestone, projects (one per project, in the order given), auto-complete last. A follow-up with nothing to do is left out; a null milestone is "none" (a new PR has none to clear).
//  - Auto-complete is planned only when `autoMergeAllowed` is true AND the PR is not a draft (auto-merge cannot be enabled on a draft: UNVERIFIED live, it needs a real write). Otherwise it is silently left out;
//    the page decides whether to show the option.
//  - A follow-up failing does not stop the next ones, and never loses the created PR. If the create itself fails nothing else is sent.
//  - `send` resolves to the GraphQL response body ({ data, errors? }) and may reject. A body with a non-empty `errors` array counts as a failure whose message joins the error messages with "; ".
import type { GraphQlRequest } from "./prQuery";
import type { MergeMethod } from "./actionsQuery";

const todo = (): never => {
  throw new Error("Not implemented");
};

export interface CreatePrParams {
  repositoryId: string;
  baseRefName: string;
  headRefName: string;
  title: string;
  body?: string;
  draft?: boolean;
  maintainerCanModify?: boolean;
  /** User node ids. */
  reviewerUserIds?: string[];
  /** Team node ids. */
  reviewerTeamIds?: string[];
  labelIds?: string[];
  assigneeIds?: string[];
  milestoneId?: string | null;
  /** ProjectV2 node ids. */
  projectIds?: string[];
  /** Enable auto-merge after creation with this method (and optional message). */
  autoComplete?: { mergeMethod: MergeMethod; commitHeadline?: string; commitBody?: string };
  /** Repository.autoMergeAllowed (NewPrCompare.autoMergeAllowed). */
  autoMergeAllowed?: boolean;
}

/** The fields of the createPullRequest payload the follow-ups need. */
export interface CreatedPr {
  id: string;
  number: number;
  url: string;
  headRefOid: string;
}

export type FollowUpKind = "reviewers" | "labels" | "assignees" | "milestone" | "project" | "autoComplete";

export interface FollowUp {
  kind: FollowUpKind;
  /** A phrase for a failure message: "adding reviewers", "adding labels", "adding assignees", "setting the milestone", "adding to a project", "enabling auto-complete". */
  doing: string;
  /** The request once the PR exists, using the existing builders named in the header. */
  build(pr: CreatedPr): GraphQlRequest;
}

export interface CreatePrPlan {
  create: GraphQlRequest;
  followUps: FollowUp[];
}

/**
 * `mutation($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { id number url headRefOid } } }`.
 * variables.input is exactly { repositoryId, baseRefName, headRefName, title, body, draft, maintainerCanModify }.
 * Throws "repositoryId is required", "baseRefName is required", "headRefName is required", "title is required" (blank after trimming) and `Title is too long (maximum is 256 characters)` (prEdit.MAX_TITLE_LENGTH code points).
 */
export function createPullRequestMutation(p: Pick<CreatePrParams, "repositoryId" | "baseRefName" | "headRefName" | "title" | "body" | "draft" | "maintainerCanModify">): GraphQlRequest {
  return todo();
}

/** The ordered requests for the form: `create` from createPullRequestMutation (same throws) and the follow-ups described above. */
export function planCreatePr(p: CreatePrParams): CreatePrPlan {
  return todo();
}

export interface FollowUpFailure {
  kind: FollowUpKind;
  doing: string;
  message: string;
}

export type CreateOutcome =
  /** `message`: `Created PR #${number}` when nothing failed, else `Created PR #12, but adding reviewers failed: boom` (several: `...failed: A; adding labels failed: B`, in plan order). */
  | { created: CreatedPr; failures: FollowUpFailure[]; message: string }
  /** `message`: `Could not create the pull request: ${reason}`. No follow-up was sent. */
  | { created: null; message: string };

/**
 * Runs the plan: sends `plan.create`, reads data.createPullRequest.pullRequest as the CreatedPr, then sends each follow-up's build(created) in order. `send` resolves to the response body and may reject
 * (the rejection's message, or String(value), is the failure reason). A create response without a pull request and without errors fails with the reason "createPullRequest returned no pull request".
 */
export function executeCreatePlan(plan: CreatePrPlan, send: (req: GraphQlRequest) => Promise<any>): Promise<CreateOutcome> {
  return todo();
}

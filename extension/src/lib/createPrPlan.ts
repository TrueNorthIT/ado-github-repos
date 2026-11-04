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
import { enableAutoMergeMutation, type MergeMethod } from "./actionsQuery";
import { addAssigneesMutation, requestReviewsMutation } from "./reviewerSearch";
import { addLabelsMutation } from "./labels";
import { setMilestoneMutation } from "./milestones";
import { addProjectItemMutation } from "./projects";
import { MAX_TITLE_LENGTH } from "./prEdit";

export interface CreatePrParams {
  repositoryId: string;
  baseRefName: string;
  headRefName: string;
  title: string;
  body?: string;
  draft?: boolean;
  maintainerCanModify?: boolean;
  /** A fork's node id when the head branch lives there (batch H, lib/forks.ts); absent for a branch of this repository. */
  headRepositoryId?: string;
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
export function createPullRequestMutation(p: Pick<CreatePrParams, "repositoryId" | "baseRefName" | "headRefName" | "title" | "body" | "draft" | "maintainerCanModify" | "headRepositoryId">): GraphQlRequest {
  if (!p.repositoryId.trim()) throw new Error("repositoryId is required");
  if (!p.baseRefName.trim()) throw new Error("baseRefName is required");
  if (!p.headRefName.trim()) throw new Error("headRefName is required");
  const title = p.title.trim();
  if (!title) throw new Error("title is required");
  if ([...title].length > MAX_TITLE_LENGTH) throw new Error(`Title is too long (maximum is ${MAX_TITLE_LENGTH} characters)`);
  return {
    query: `mutation($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { id number url headRefOid } } }`,
    variables: { input: { repositoryId: p.repositoryId, baseRefName: p.baseRefName, headRefName: p.headRefName, title, body: p.body ?? "", draft: p.draft ?? false, maintainerCanModify: p.maintainerCanModify ?? true, ...(p.headRepositoryId ? { headRepositoryId: p.headRepositoryId } : {}) } },
  };
}

/** The ordered requests for the form: `create` from createPullRequestMutation (same throws) and the follow-ups described above. */
export function planCreatePr(p: CreatePrParams): CreatePrPlan {
  const followUps: FollowUp[] = [];
  const users = p.reviewerUserIds ?? [];
  const teams = p.reviewerTeamIds ?? [];
  if (users.length || teams.length)
    followUps.push({ kind: "reviewers", doing: "adding reviewers", build: (pr) => requestReviewsMutation({ pullRequestId: pr.id, userIds: users, teamIds: teams }) });
  if (p.labelIds?.length) followUps.push({ kind: "labels", doing: "adding labels", build: (pr) => addLabelsMutation(pr.id, p.labelIds!) });
  if (p.assigneeIds?.length) followUps.push({ kind: "assignees", doing: "adding assignees", build: (pr) => addAssigneesMutation(pr.id, p.assigneeIds!) });
  if (p.milestoneId) followUps.push({ kind: "milestone", doing: "setting the milestone", build: (pr) => setMilestoneMutation(pr.id, p.milestoneId!) });
  for (const projectId of p.projectIds ?? []) followUps.push({ kind: "project", doing: "adding to a project", build: (pr) => addProjectItemMutation({ projectId, contentId: pr.id }) });
  const auto = p.autoComplete;
  if (auto && p.autoMergeAllowed === true && !p.draft)
    followUps.push({
      kind: "autoComplete",
      doing: "enabling auto-complete",
      build: (pr) => enableAutoMergeMutation({ pullRequestId: pr.id, mergeMethod: auto.mergeMethod, expectedHeadOid: pr.headRefOid, commitHeadline: auto.commitHeadline, commitBody: auto.commitBody }),
    });
  return { create: createPullRequestMutation(p), followUps };
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
export async function executeCreatePlan(plan: CreatePrPlan, send: (req: GraphQlRequest) => Promise<any>): Promise<CreateOutcome> {
  const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
  /** Sends one request; throws on rejection or a body with errors. */
  const run = async (req: GraphQlRequest) => {
    const body = await send(req);
    const errs: any[] = Array.isArray(body?.errors) ? body.errors : [];
    if (errs.length) throw new Error(errs.map((e) => e?.message ?? String(e)).join("; "));
    return body;
  };
  let created: CreatedPr;
  try {
    const pr = (await run(plan.create))?.data?.createPullRequest?.pullRequest;
    if (!pr) throw new Error("createPullRequest returned no pull request");
    created = pr;
  } catch (e) {
    return { created: null, message: `Could not create the pull request: ${reason(e)}` };
  }
  const failures: FollowUpFailure[] = [];
  for (const f of plan.followUps) {
    try {
      await run(f.build(created));
    } catch (e) {
      failures.push({ kind: f.kind, doing: f.doing, message: reason(e) });
    }
  }
  const message = failures.length ? `Created PR #${created.number}, but ${failures.map((f) => `${f.doing} failed: ${f.message}`).join("; ")}` : `Created PR #${created.number}`;
  return { created, failures, message };
}

// Turns the raw actionsDetailQuery node into what the header, the Complete panel and the policies card show.
import type { PrActionsNode } from "./actionsQuery";
import { defaultCompleteOptions, deleteBranchDefault, allowedMergeMethods, type CompleteOptions, type DeleteBranchChoice, type DeleteBranchContext, type RepoMergeSettings } from "./mergeOptions";
import { copilotAvailability, type CopilotAvailability } from "./copilotReview";
import { mergeQueueDecision, type QueueDecision } from "./mergeQueue";
import { dedupeChecks, policyRows, type CheckContext } from "./policies";
import { checkRerun, type CheckRerun, type RerunCheck } from "./reruns";
import { updateBranchOptions, withUpdateBranchAction, type ActionablePolicyRow, type UpdateBranchOptions } from "./updateBranch";
import { stateActions, type StateAction } from "./stateActions";
import { voteOptions, type VoteOption } from "./votes";

export type ActionsRepo = NonNullable<PrActionsNode["repository"]>;
export type ActionsPr = NonNullable<ActionsRepo["pullRequest"]>;

/** What the main Complete button does. */
export type CompleteMain =
  | { kind: "complete" | "autoComplete" | "publish" | "cancelAuto" | "reactivate" | "enqueue" | "dequeue"; label: string; disabled?: undefined; reason?: undefined }
  | { kind: "none"; label: string; disabled: true; reason: string };

export interface ActionsView {
  repo: ActionsRepo;
  pr: ActionsPr;
  rows: ActionablePolicyRow[];
  decision: QueueDecision;
  /** Per check row title: whether it can be re-run, and how many annotations it has. */
  checkInfo: Map<string, { rerun: CheckRerun; annotations: number }>;
  updateBranch: UpdateBranchOptions;
  copilot: CopilotAvailability;
  votes: VoteOption[];
  states: StateAction[];
  settings: RepoMergeSettings;
  methods: ReturnType<typeof allowedMergeMethods>;
  deleteCtx: DeleteBranchContext;
  deleteChoice: DeleteBranchChoice;
  defaults: CompleteOptions;
  main: CompleteMain;
  /** The viewer's current decision, in the Approve button's words; undefined when they have none. */
  voteLabel?: string;
}

export function deriveActions(repo: ActionsRepo, opts: { copilotFailure?: string | null } = {}): ActionsView {
  const pr = repo.pullRequest!;
  const settings: RepoMergeSettings = { mergeCommitAllowed: repo.mergeCommitAllowed, squashMergeAllowed: repo.squashMergeAllowed, rebaseMergeAllowed: repo.rebaseMergeAllowed };
  const policyInput = {
    state: pr.state,
    isDraft: pr.isDraft,
    mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision,
    checks: (pr.statusCheckRollup?.contexts.nodes ?? []) as CheckContext[],
    // Set auto-complete is hidden when the viewer cannot enable it, even if the repository allows auto-merge.
    autoMergeAllowed: repo.autoMergeAllowed && pr.viewerCanEnableAutoMerge,
    autoMergeRequest: pr.autoMergeRequest,
  };
  const decision = mergeQueueDecision({
    ...policyInput,
    isMergeQueueEnabled: !!pr.isMergeQueueEnabled,
    isInMergeQueue: !!pr.isInMergeQueue,
    mergeQueueEntry: pr.mergeQueueEntry ?? null,
  });
  const states = stateActions(pr);
  const deleteCtx: DeleteBranchContext = {
    isCrossRepository: pr.isCrossRepository,
    headRefName: pr.headRefName,
    defaultBranchName: repo.defaultBranchRef?.name ?? "",
    branchProtectionRule: pr.headRef?.branchProtectionRule ?? null,
    // GitHub reports viewerCanDeleteHeadRef false for every OPEN pull request (checked live as ADMIN on same-repo heads): the flag
    // only turns true once the head ref is deletable after merge. So while open, ask the question it stands for: can the viewer push?
    viewerCanDeleteHeadRef: pr.state === "OPEN" ? ["WRITE", "MAINTAIN", "ADMIN"].includes(repo.viewerPermission ?? "") : pr.viewerCanDeleteHeadRef,
  };
  const methods = allowedMergeMethods(settings);
  let main: CompleteMain;
  if (pr.state === "CLOSED") main = { kind: "reactivate", label: "Reactivate" };
  else if (decision.primaryAction === "dequeue") main = { kind: "dequeue", label: decision.primaryLabel ?? "Remove from queue" };
  else if (decision.primaryAction === "enqueue" && !methods.length) main = { kind: "none", label: "Merge when ready", disabled: true, reason: "This repository doesn't allow any merge type." };
  else if (decision.primaryAction === "enqueue") main = { kind: "enqueue", label: decision.primaryLabel ?? "Merge when ready" };
  else if (decision.autoCompleteEnabled && pr.state === "OPEN") main = pr.viewerCanDisableAutoMerge ? { kind: "cancelAuto", label: "Cancel auto-complete" } : { kind: "none", label: "Auto-complete set", disabled: true, reason: "You can't cancel auto-complete on this pull request." };
  else if (decision.primaryAction === "publish") main = { kind: "publish", label: "Publish" };
  else if ((decision.primaryAction === "complete" || decision.primaryAction === "autoComplete") && !methods.length) main = { kind: "none", label: "Complete", disabled: true, reason: "This repository doesn't allow any merge type." };
  else if (decision.primaryAction === "complete") main = { kind: "complete", label: "Complete" };
  else if (decision.primaryAction === "autoComplete") main = { kind: "autoComplete", label: "Set auto-complete" };
  else main = { kind: "none", label: "Complete", disabled: true, reason: decision.blockers.length ? `Can't complete yet:\n${decision.blockers.map((b) => `• ${b}`).join("\n")}` : "Nothing to complete." };

  const latest = pr.viewerLatestReview?.state;
  const deduped = dedupeChecks(policyInput.checks);
  const rerunInput = deduped.map(({ c }): RerunCheck => (c.__typename === "CheckRun" ? { __typename: "CheckRun", name: c.name, status: c.status, conclusion: c.conclusion, checkSuite: c.runSuite?.workflowRun?.databaseId ? { workflowRun: { databaseId: c.runSuite.workflowRun.databaseId, workflow: c.checkSuite?.workflowRun?.workflow ?? null } } : { workflowRun: null } } : { __typename: "StatusContext", context: c.context }));
  const checkInfo = new Map(deduped.map(({ c, title }, i) => [title, { rerun: checkRerun(rerunInput[i], rerunInput), annotations: c.__typename === "CheckRun" ? c.annotations?.totalCount ?? 0 : 0 }]));
  const updateBranch = updateBranchOptions({
    state: pr.state,
    mergeStateStatus: pr.mergeStateStatus,
    viewerCanUpdateBranch: pr.viewerCanUpdateBranch,
    isCrossRepository: pr.isCrossRepository,
    maintainerCanModify: !!pr.maintainerCanModify,
    headRepositoryViewerPermission: pr.headRepository?.viewerPermission ?? null,
    viewerPermission: repo.viewerPermission,
  });
  return {
    repo,
    pr,
    rows: withUpdateBranchAction(policyRows(policyInput), updateBranch),
    checkInfo,
    updateBranch,
    copilot: copilotAvailability({ state: pr.state, viewerCanUpdate: pr.viewerCanUpdate, reviewRequests: pr.reviewRequests?.nodes ?? [], lastFailureReason: opts.copilotFailure }),
    decision,
    votes: voteOptions({ state: pr.state, viewerDidAuthor: pr.viewerDidAuthor, viewerPermission: repo.viewerPermission, viewerLatestReview: pr.viewerLatestReview }),
    states,
    settings,
    methods,
    deleteCtx,
    deleteChoice: deleteBranchDefault(deleteCtx),
    defaults: defaultCompleteOptions(settings, deleteCtx),
    main,
    voteLabel: latest === "APPROVED" ? "Approved" : latest === "CHANGES_REQUESTED" ? "Changes requested" : undefined,
  };
}

// CI-3: Update branch. STUBS: the developer implements them.
// Schema (checked live): mutation updatePullRequestBranch(input: UpdatePullRequestBranchInput!) with { pullRequestId: ID!, expectedHeadOid: GitObjectID, updateMethod: PullRequestBranchUpdateMethod (MERGE | REBASE, default MERGE) }.
// PullRequest.viewerCanUpdateBranch: "Whether or not the viewer can update the head ref of this PR, by merging or rebasing the base ref. If the head ref is up to date
// or unable to be updated by this user, this will return false." So it is the signal for "the base has moved"; BEHIND alone is the fallback when it was not fetched.
import type { GraphQlRequest } from "./prQuery";
import type { PolicyRow } from "./policies";

export type UpdateMethod = "MERGE" | "REBASE";

/** `mutation($input: UpdatePullRequestBranchInput!)`. expectedHeadOid is required (throws when blank) so the update is refused if the head moved. Returns pullRequest { id headRefOid mergeStateStatus viewerCanUpdateBranch }. */
export function updateBranchMutation({ pullRequestId, expectedHeadOid, updateMethod }: { pullRequestId: string; expectedHeadOid: string; updateMethod: UpdateMethod }): GraphQlRequest {
  if (!expectedHeadOid.trim()) throw new Error("expectedHeadOid is required");
  return {
    query: `mutation($input: UpdatePullRequestBranchInput!) {
  updatePullRequestBranch(input: $input) { pullRequest { id headRefOid mergeStateStatus viewerCanUpdateBranch } }
}`,
    variables: { input: { pullRequestId, expectedHeadOid, updateMethod } },
  };
}

export interface UpdateBranchInput {
  state: "OPEN" | "CLOSED" | "MERGED";
  mergeStateStatus: string;
  /** PullRequest.viewerCanUpdateBranch; undefined when the query did not select it. */
  viewerCanUpdateBranch?: boolean;
  /** PullRequest.isCrossRepository: the head branch is in a fork. */
  isCrossRepository: boolean;
  /** PullRequest.maintainerCanModify. */
  maintainerCanModify: boolean;
  /** headRepository.viewerPermission (ADMIN | MAINTAIN | WRITE | TRIAGE | READ), null when unknown or the fork was deleted. */
  headRepositoryViewerPermission: string | null;
  /** Repository.viewerPermission on the base repository. */
  viewerPermission: string | null;
}

export interface UpdateBranchMethod {
  method: UpdateMethod;
  /** "Update branch (merge)" or "Update branch (rebase)". */
  label: string;
  disabled: boolean;
  /** Present exactly when disabled. */
  reason?: string;
}

export interface UpdateBranchOptions {
  offered: boolean;
  /** Why it is not offered; absent when offered. */
  reason?: string;
  /** [] when not offered; otherwise MERGE then REBASE. */
  methods: UpdateBranchMethod[];
}

/**
 * Offered when the pull request is OPEN and the base has moved: viewerCanUpdateBranch when it is present (true offers, false does not, even when BEHIND:
 * the viewer cannot do it), otherwise mergeStateStatus BEHIND. REBASE is disabled with a reason when the head is in a fork the viewer cannot push to:
 * a fork is pushable when the viewer has WRITE, MAINTAIN or ADMIN on it, or maintainerCanModify is set and the viewer has WRITE, MAINTAIN or ADMIN on the base repository.
 */
export function updateBranchOptions(i: UpdateBranchInput): UpdateBranchOptions {
  const no = (reason: string): UpdateBranchOptions => ({ offered: false, reason, methods: [] });
  if (i.state !== "OPEN") return no("The pull request is not open.");
  const behind = i.viewerCanUpdateBranch ?? i.mergeStateStatus === "BEHIND";
  if (!behind) return no(i.viewerCanUpdateBranch === false ? "The branch is up to date, or you cannot update it." : "The branch is up to date with the base branch.");
  const push = (p: string | null) => p === "WRITE" || p === "MAINTAIN" || p === "ADMIN";
  const pushable = !i.isCrossRepository || push(i.headRepositoryViewerPermission) || (i.maintainerCanModify && push(i.viewerPermission));
  return {
    offered: true,
    methods: [
      { method: "MERGE", label: "Update branch (merge)", disabled: false },
      { method: "REBASE", label: "Update branch (rebase)", disabled: !pushable, ...(pushable ? {} : { reason: "The head branch is in a fork you cannot push to." }) },
    ],
  };
}

/** A policy row that may carry an action button. */
export type ActionablePolicyRow = PolicyRow & { action?: { kind: "updateBranch"; methods: UpdateBranchMethod[] } };

/** policyRows output with the "behind" row given the update-branch action when `options.offered`. Every other row, and the behind row when not offered, is returned unchanged (no `action` key). Does not reorder. */
export function withUpdateBranchAction(rows: PolicyRow[], options: UpdateBranchOptions): ActionablePolicyRow[] {
  return rows.map((r) => (r.kind === "behind" && options.offered ? { ...r, action: { kind: "updateBranch" as const, methods: options.methods } } : r));
}

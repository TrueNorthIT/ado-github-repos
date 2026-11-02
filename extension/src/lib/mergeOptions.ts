// The Complete pull request panel's choices (A-2).
import type { MergeMethod } from "./actionsQuery";
export type { MergeMethod };

export interface RepoMergeSettings {
  mergeCommitAllowed: boolean;
  squashMergeAllowed: boolean;
  rebaseMergeAllowed: boolean;
}

/** Allowed methods in the native dropdown order: MERGE, SQUASH, REBASE. */
export function allowedMergeMethods(s: RepoMergeSettings): MergeMethod[] {
  const m: MergeMethod[] = [];
  if (s.mergeCommitAllowed) m.push("MERGE");
  if (s.squashMergeAllowed) m.push("SQUASH");
  if (s.rebaseMergeAllowed) m.push("REBASE");
  return m;
}

/** First allowed method in the order SQUASH, MERGE, REBASE; null when the repository allows none. */
export function defaultMergeMethod(s: RepoMergeSettings): MergeMethod | null {
  const ok = allowedMergeMethods(s);
  return (["SQUASH", "MERGE", "REBASE"] as const).find((m) => ok.includes(m)) ?? null;
}

const LABELS: Record<MergeMethod, string> = { MERGE: "Merge (no fast forward)", SQUASH: "Squash commit", REBASE: "Rebase and fast-forward" };
/** Native label: "Merge (no fast forward)", "Squash commit", "Rebase and fast-forward". */
export const mergeMethodLabel = (m: MergeMethod): string => LABELS[m];

/** A custom merge commit title and body only exist for MERGE and SQUASH. */
export const supportsCustomMessage = (m: MergeMethod): boolean => m !== "REBASE";

export interface DeleteBranchContext {
  /** PullRequest.isCrossRepository: the head branch lives in another repository (a fork). */
  isCrossRepository: boolean;
  headRefName: string;
  /** Repository.defaultBranchRef.name. */
  defaultBranchName: string;
  /** headRef.branchProtectionRule, null when no rule matches. */
  branchProtectionRule: { allowsDeletions: boolean } | null;
  /** PullRequest.viewerCanDeleteHeadRef. */
  viewerCanDeleteHeadRef: boolean;
}

export interface DeleteBranchChoice {
  /** false: the checkbox is disabled (the branch cannot or must not be deleted). */
  available: boolean;
  /** Initial tick state. */
  checked: boolean;
  /** Present whenever the branch is not simply deletable by default, i.e. available is false or checked is false. */
  reason?: string;
}

export function deleteBranchDefault(c: DeleteBranchContext): DeleteBranchChoice {
  const no = (reason: string): DeleteBranchChoice => ({ available: false, checked: false, reason });
  if (c.isCrossRepository) return no("The source branch is in another repository (a fork), so it can't be deleted from here.");
  if (c.headRefName === c.defaultBranchName) return no("The source branch is the default branch, so it can't be deleted.");
  if (!c.viewerCanDeleteHeadRef) return no("You don't have permission to delete the source branch.");
  if (c.branchProtectionRule) {
    return c.branchProtectionRule.allowsDeletions
      ? { available: true, checked: false, reason: "The source branch is protected, so it isn't deleted by default." }
      : no("The source branch is protected and can't be deleted.");
  }
  return { available: true, checked: true };
}

export interface CompleteOptions {
  mergeMethod: MergeMethod | null;
  deleteSourceBranch: boolean;
  completeWorkItems: boolean;
  customizeMessage: boolean;
}

/** Initial state of the panel. */
export function defaultCompleteOptions(settings: RepoMergeSettings, deleteBranch: DeleteBranchContext): CompleteOptions {
  return { mergeMethod: defaultMergeMethod(settings), deleteSourceBranch: deleteBranchDefault(deleteBranch).checked, completeWorkItems: false, customizeMessage: false };
}

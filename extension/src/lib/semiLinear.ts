// "Semi-linear merge" in the Complete panel: native ADO rebases the source onto the target and then creates a merge commit, so the
// history stays straight but each pull request is still one merge. GitHub has no single call for it, so it is two:
//  1. update the pull request branch by rebase (GraphQL updatePullRequestBranch, updateMethod REBASE: the "Update branch (rebase)" the
//     policies card already offers), skipped when the head already sits on the target's tip (REST compare `base...headSha`, behind_by 0);
//  2. once GitHub reports the new head and has worked out mergeability (REST `GET /pulls/{n}`, polled), merge it with merge_method
//     "merge" and `sha` set to that new head (REST `PUT /pulls/{n}/merge`). If anyone pushes in between, GitHub answers 409 and nothing
//     unrebased is merged.
// The option needs merge commits allowed on the repository, and a head this user may rewrite: not a fork without maintainer edits,
// and not a branch protected against force pushes (classic protection's allowsForcePushes false, or a non_fast_forward / update rule).
import type { BranchRule } from "./branchRules";
import { rulesBlockForcePush } from "./branchRules";
import type { RestRequest } from "./restRequest";

export const SEMI_LINEAR_LABEL = "Semi-linear merge";

export interface SemiLinearInput {
  /** Repository.mergeCommitAllowed. */
  mergeCommitAllowed: boolean;
  /** PullRequest.isCrossRepository. */
  isCrossRepository: boolean;
  /** updateBranch.ts canPushHead: the viewer may push to the head branch (always true for a same-repository head). */
  headPushable: boolean;
  /** headRef.branchProtectionRule: null when no classic rule matches, undefined when not known. */
  classicRule: { allowsForcePushes?: boolean | null } | null | undefined;
  /** branchRules.ts rules for the head branch; null or undefined when they could not be read (then only classic protection counts). */
  headRules: BranchRule[] | null | undefined;
}

export interface SemiLinearChoice {
  /** false: the dropdown doesn't list it at all (the repository refuses merge commits). */
  offered: boolean;
  disabled: boolean;
  /** Present exactly when disabled. */
  reason?: string;
}

export const FORK_REASON = "The source branch is in a fork that doesn't allow edits from maintainers, so it can't be rebased from here.";
export const PROTECTED_REASON = "The source branch is protected against force pushes, and a rebase rewrites it.";

export function semiLinearChoice(i: SemiLinearInput): SemiLinearChoice {
  if (!i.mergeCommitAllowed) return { offered: false, disabled: true, reason: "This repository doesn't allow merge commits." };
  const no = (reason: string): SemiLinearChoice => ({ offered: true, disabled: true, reason });
  if (i.isCrossRepository && !i.headPushable) return no(FORK_REASON);
  if (i.classicRule && i.classicRule.allowsForcePushes === false) return no(PROTECTED_REASON);
  if (i.headRules && rulesBlockForcePush(i.headRules)) return no(PROTECTED_REASON);
  return { offered: true, disabled: false };
}

// ---------- the REST calls ----------

const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** GET compare of the target branch with the head commit; behind_by says whether a rebase is needed. per_page=1: only the counts are read. */
export function headCompareRequest(repo: string, base: string, headSha: string): RestRequest {
  if (!base.trim() || !headSha.trim()) throw new Error("base and headSha are required");
  return { method: "GET", path: `/repos/${repo}/compare/${encPath(base)}...${encodeURIComponent(headSha)}?per_page=1` };
}

/** GET of the pull request (head.sha, mergeable, mergeable_state, state). */
export const pullRequestRequest = (repo: string, number: number): RestRequest => ({ method: "GET", path: `/repos/${repo}/pulls/${number}` });

/** PUT merge with merge_method "merge" and the expected head `sha`; the commit title and message only when given. Throws on a blank sha. */
export function semiLinearMergeRequest(repo: string, number: number, p: { sha: string; commitTitle?: string; commitMessage?: string }): RestRequest {
  if (!p.sha.trim()) throw new Error("sha is required");
  const body: Record<string, unknown> = { merge_method: "merge", sha: p.sha };
  if (p.commitTitle?.trim()) body.commit_title = p.commitTitle;
  if (p.commitMessage !== undefined && p.commitTitle?.trim()) body.commit_message = p.commitMessage;
  return { method: "PUT", path: `/repos/${repo}/pulls/${number}/merge`, body };
}

// ---------- waiting for the rebase ----------

/** The fields of REST's pull request that the wait reads. */
export interface RestPull {
  state: string;
  merged?: boolean;
  head: { sha: string };
  /** null while GitHub is still working it out. */
  mergeable: boolean | null;
  /** clean | unstable | has_hooks | blocked | behind | dirty | draft | unknown. */
  mergeable_state?: string;
}

export type RebaseStatus = "waiting" | "ready" | "conflicts" | "closed";

/** Where the rebase has got to: the head must have moved off `oldSha` and GitHub must know whether it merges. "blocked" (required checks re-running on the new commits) still counts as ready: the merge then says why, or goes through for an admin. */
export function rebaseStatus(pull: RestPull, oldSha: string): RebaseStatus {
  if (pull.state !== "open" || pull.merged) return "closed";
  if (pull.head.sha === oldSha) return "waiting";
  if (pull.mergeable === null || pull.mergeable_state === "unknown") return "waiting";
  if (pull.mergeable === false || pull.mergeable_state === "dirty") return "conflicts";
  return "ready";
}

// ---------- the two steps ----------

export type SemiLinearStep = "checking" | "rebasing" | "waiting" | "merging";
export const SEMI_LINEAR_STEP_TEXT: Record<SemiLinearStep, string> = {
  checking: "Checking whether the source branch needs rebasing…",
  rebasing: "Rebasing the source branch onto the target…",
  waiting: "Waiting for GitHub to finish the rebase…",
  merging: "Merging…",
};
export const SEMI_LINEAR_TIMEOUT_MS = 90_000;
export const SEMI_LINEAR_POLL_MS = 2_000;

/** A failure whose message is already what the user should read. */
export class SemiLinearError extends Error {}

export interface SemiLinearDeps {
  /** compare base...head: how many commits the head is behind the target. */
  behindBy(): Promise<number>;
  /** updatePullRequestBranch REBASE with expectedHeadOid = the head the page loaded. */
  rebase(): Promise<void>;
  getPull(): Promise<RestPull>;
  /** PUT merge expecting `sha`. */
  merge(sha: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  onStep(step: SemiLinearStep): void;
}

/** What GitHub's refusal of the merge step means, from its status and message. `rebased`: step 1 ran, so the branch already moved. */
export function mergeFailureText(status: number, apiMessage: string | undefined, rebased: boolean): string {
  const moved = rebased ? " The source branch has been rebased." : "";
  if (status === 409) return `The source branch changed after it was ${rebased ? "rebased" : "checked"}, so it wasn't merged. Refresh and try again.`;
  if (status === 405 || status === 422) return `GitHub won't merge it yet${apiMessage ? `: ${apiMessage.replace(/\.$/, "")}` : ""}.${moved}${rebased ? " Its required checks and reviews may need to pass again on the rebased commits before you complete it." : ""}`;
  return `The merge failed${apiMessage ? `: ${apiMessage.replace(/\.$/, "")}` : ""}.${moved}`;
}

/**
 * Runs both steps. Resolves with whether the branch was rebased; throws SemiLinearError for a wait that failed, and lets the
 * callers' own errors (a refused rebase or merge) through. The merge always names the head it expects.
 */
export async function runSemiLinear(d: SemiLinearDeps, headSha: string): Promise<{ rebased: boolean; mergedSha: string }> {
  d.onStep("checking");
  const behind = await d.behindBy();
  let sha = headSha;
  const rebased = behind > 0;
  if (rebased) {
    d.onStep("rebasing");
    await d.rebase();
    d.onStep("waiting");
    const t0 = d.now();
    for (;;) {
      const pull = await d.getPull();
      const s = rebaseStatus(pull, headSha);
      if (s === "ready") {
        sha = pull.head.sha;
        break;
      }
      if (s === "closed") throw new SemiLinearError("The pull request was closed or merged while it was being rebased.");
      if (s === "conflicts") throw new SemiLinearError("GitHub reports merge conflicts after the rebase, so it wasn't merged. Resolve them and try again.");
      if (d.now() - t0 >= SEMI_LINEAR_TIMEOUT_MS) throw new SemiLinearError(`GitHub hadn't finished the rebase after ${SEMI_LINEAR_TIMEOUT_MS / 1000} seconds, so nothing was merged. Refresh the page; if the branch was rebased, complete the pull request again.`);
      await d.sleep(SEMI_LINEAR_POLL_MS);
    }
  }
  d.onStep("merging");
  await d.merge(sha);
  return { rebased, mergedSha: sha };
}

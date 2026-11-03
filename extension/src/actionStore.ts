// Shared state of one PR's actions (approve, complete, abandon...): the header buttons, the panels and the policies card are views of it.
// Same shape as feedStore.ts: calls are serialised one at a time per PR, buttons are disabled while one is queued or in flight,
// optimistic changes are rolled back on failure, and a success drops the cached page and list so they refetch.
import * as React from "react";
import { PermissionError } from "./connections";
import { GhError, getActions, getBodyNow, invalidateActions, invalidatePrPage, invalidatePrs, mutate, rest } from "./githubBrowse";
import {
  closePullRequestMutation, convertToDraftMutation, deleteRefMutation, disableAutoMergeMutation, enableAutoMergeMutation, markReadyForReviewMutation,
  mergePullRequestMutation, reopenPullRequestMutation, updateBaseMutation, type MergeMethod,
} from "./lib/actionsQuery";
import { copilotResult, copilotReviewMutation } from "./lib/copilotReview";
import { dequeueMutation, enqueueMutation } from "./lib/mergeQueue";
import { nextPollDelay } from "./lib/pollPlan";
import { rerunAllRequest, rerunFailedJobsRequest } from "./lib/reruns";
import { updateBranchMutation, type UpdateMethod } from "./lib/updateBranch";
import { deriveActions, type ActionsPr, type ActionsRepo, type ActionsView } from "./lib/prActions";
import type { PrStatus } from "./lib/prModel";
import type { StateActionId } from "./lib/stateActions";
import { voteMutation, type VoteId } from "./lib/votes";
import type { WorkItemRef } from "./lib/workItems";
import { completeWorkItems } from "./workItemsApi";
import { addClosingIssueToBody, addWorkItemToBody, removeClosingIssueFromBody, removeWorkItemFromBody, updatePullRequestMutation, type EditField, type UpdatePullRequestInput } from "./lib/prEdit";
import { addAssigneesMutation, removeAssigneesMutation, removeReviewRequestsRequest, requestReviewsMutation, type Candidate, type RequestedReviewer } from "./lib/reviewerSearch";
import { addLabelsMutation, removeLabelsMutation } from "./lib/labels";
import { setMilestoneMutation } from "./lib/milestones";
import { addProjectItemMutation, deleteProjectItemMutation } from "./lib/projects";

const STALE_MS = 30_000;

/** The head moved after the page was loaded: expectedHeadOid no longer matches. GitHub: "Head branch was modified. Review and try the merge again." */
const headMoved = (e: unknown) => e instanceof GhError && /head branch was modified|expected.*head|head.*(changed|moved)/i.test(e.detail ?? "");

/** What to tell the user when an action fails. */
export function actionErrorText(e: unknown): string {
  if (headMoved(e)) return "The branch changed since you loaded this page. Refresh and try again.";
  if (e instanceof PermissionError) return "The extension doesn't have permission to update work items. An organisation admin needs to approve the new work item permission.";
  if (e instanceof GhError) {
    if (e.kind === "access") return "Your GitHub sign-in isn't allowed to do this on this repository.";
    if (e.kind === "auth") return "Your GitHub sign-in has expired. Sign in again to continue.";
    if (e.kind === "rateLimit") return "GitHub's rate limit has been reached. Try again later.";
    if (e.detail) return `GitHub said: ${e.detail}`;
  }
  return "Could not reach GitHub. Try again.";
}

export interface CompleteRequest {
  /** "autoComplete" enables auto-merge instead of merging now. */
  mode: "complete" | "autoComplete";
  mergeMethod: MergeMethod;
  commitHeadline?: string;
  commitBody?: string;
  deleteSourceBranch: boolean;
  /** The linked work items to move to a Completed state; empty or omitted to leave them. */
  workItems?: WorkItemRef[];
}

const REVIEW_OF: Partial<Record<VoteId, string | null>> = { approve: "APPROVED", approveWithSuggestions: "APPROVED", waitForAuthor: "CHANGES_REQUESTED", reject: "CHANGES_REQUESTED", reset: null };

export class ActionStore {
  status: "loading" | "ready" | "error" = "loading";
  err: unknown;
  raw?: ActionsRepo;
  view?: ActionsView;
  /** A call is queued or in flight: every action button is disabled. */
  busy = false;
  /** Set when the last action failed. */
  error?: string;
  /** The action worked but a later step did not (e.g. merged, branch not deleted), or a note worth showing. */
  notice?: string;
  /** Bumped after every successful action; the PR page refetches its header on it. */
  version = 0;
  /** While a state change is in flight, the status the pill should already show. */
  optimisticStatus?: PrStatus;
  /** Set after a re-run: the checks are polled until this time, and for as long as one is still pending. */
  watchChecksUntil = 0;
  /** GitHub's answer to the last "Request Copilot review" that was refused, shown in the reviewers panel. */
  copilotMessage?: string;
  /** failureReason of that answer; copilotAvailability hides the option for the permanent ones. */
  copilotReason?: string | null;
  /** Set when an edit (batch 2) failed: shown in the panel of that field. */
  editError?: { field: EditField; text: string };
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private loadedAt = 0;
  private loading?: Promise<void>;
  private pending = 0;

  constructor(readonly repo: string, readonly number: number) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
  private setRaw(raw: ActionsRepo) {
    this.raw = raw;
    this.view = deriveActions(raw, { copilotFailure: this.copilotReason });
  }
  private patchPr(p: Partial<ActionsPr>) {
    this.setRaw({ ...this.raw!, pullRequest: { ...this.raw!.pullRequest!, ...p } });
  }

  /** Loads on first use, and again (keeping what is shown) once the data is 30 s old and nothing is in flight. */
  ensureLoaded(force = false): Promise<void> {
    if (this.loading) return this.loading;
    if (this.pending) return Promise.resolve();
    if (!force && this.status === "ready" && Date.now() - this.loadedAt < STALE_MS) return Promise.resolve();
    if (this.status === "error") this.status = "loading";
    this.loading = getActions(this.repo, this.number)
      .then(
        (node) => {
          if (this.pending) return; // an action started meanwhile: its state wins
          this.setRaw(node);
          this.status = "ready";
          this.loadedAt = Date.now();
        },
        (err) => {
          if (this.status !== "ready") (this.status = "error"), (this.err = err);
        }
      )
      .then(() => {
        this.loading = undefined;
        this.emit();
      });
    this.emit();
    return this.loading;
  }

  /** Quietly re-asks GitHub, skipping the cache. Bumps `version` when mergeStateStatus stopped being UNKNOWN, so the page header refetches too. */
  async refresh() {
    if (this.pending) return;
    const was = this.raw?.pullRequest;
    invalidateActions(this.repo, this.number);
    await this.ensureLoaded(true);
    const now = this.raw?.pullRequest;
    // The header refetches when mergeability settled, or when the queue merged the pull request.
    if ((was?.mergeStateStatus === "UNKNOWN" && now?.mergeStateStatus !== "UNKNOWN") || was?.state !== now?.state || !!was?.isInMergeQueue !== !!now?.isInMergeQueue) {
      if (was?.state !== now?.state) (invalidatePrPage(this.repo, this.number), invalidatePrs()); // the header and list must show the new state, not their cached one
      this.version++;
      this.emit();
    }
  }

  dismiss() {
    this.error = this.notice = undefined;
    this.emit();
  }
  dismissEditError() {
    this.editError = undefined;
    this.emit();
  }

  /**
   * Queues `task` behind the previous call for this PR. `task` throws to fail; it may return a notice for a partial failure.
   * `optimistic` runs at once and `rollback` undoes it if the task throws. Resolves true on success.
   */
  private run(task: () => Promise<string | void>, optimistic?: () => void, rollback?: () => void, field?: EditField): Promise<boolean> {
    this.pending++;
    this.busy = true;
    this.error = this.notice = this.editError = undefined;
    optimistic?.();
    this.emit();
    const step = async (): Promise<boolean> => {
      try {
        this.notice = (await task()) || undefined;
        return true;
      } catch (e) {
        rollback?.();
        if (field) this.editError = { field, text: actionErrorText(e) };
        else this.error = actionErrorText(e);
        return false;
      }
    };
    const done = this.queue.then(step, step);
    this.queue = done;
    return done.then(async (ok) => {
      if (ok) {
        invalidatePrPage(this.repo, this.number);
        invalidatePrs();
      }
      this.pending--;
      this.busy = this.pending > 0;
      if (ok && !this.pending) await this.ensureLoaded(true); // refetch quietly
      if (!this.pending) this.optimisticStatus = undefined;
      if (ok) this.version++;
      this.emit();
      if (ok) setTimeout(() => void this.refresh(), 3000); // GitHub settles a moment after a change (e.g. mergeability after a reopen)
      return ok;
    });
  }

  private v() {
    if (!this.view) throw new Error("Pull request actions have not loaded.");
    return this.view;
  }

  vote(id: VoteId, body?: string) {
    const v = this.v();
    const prev = this.raw!;
    const state = REVIEW_OF[id];
    return this.run(
      async () => void (await mutate(voteMutation(id, { ...v.pr, state: v.pr.state, viewerPermission: v.repo.viewerPermission, pullRequestId: v.pr.id, headOid: v.pr.headRefOid }, body))),
      () => this.patchPr({ viewerLatestReview: state ? { id: "pending", state } : null }),
      () => this.setRaw(prev)
    );
  }

  setState(id: StateActionId) {
    const pr = this.v().pr;
    const prev = this.raw!;
    const build = { abandon: closePullRequestMutation, reactivate: reopenPullRequestMutation, markAsDraft: convertToDraftMutation, publish: markReadyForReviewMutation }[id];
    const next: Partial<ActionsPr> = { abandon: { state: "CLOSED" as const }, reactivate: { state: "OPEN" as const }, markAsDraft: { isDraft: true }, publish: { isDraft: false } }[id];
    return this.run(
      async () => void (await mutate(build(pr.id))),
      () => {
        this.patchPr(next);
        this.optimisticStatus = id === "abandon" ? "abandoned" : id === "markAsDraft" ? "draft" : "active";
      },
      () => {
        this.setRaw(prev);
        this.optimisticStatus = undefined;
      }
    );
  }

  cancelAutoComplete() {
    const pr = this.v().pr;
    const prev = this.raw!;
    return this.run(async () => void (await mutate(disableAutoMergeMutation(pr.id))), () => this.patchPr({ autoMergeRequest: null }), () => this.setRaw(prev));
  }

  /** Merge (or enable auto-merge), then delete the branch, then complete the work items. Only the first step can fail the whole action; the rest become a notice. */
  complete(r: CompleteRequest) {
    const { pr, repo } = this.v();
    return this.run(async () => {
      const params = { pullRequestId: pr.id, mergeMethod: r.mergeMethod, expectedHeadOid: pr.headRefOid, commitHeadline: r.commitHeadline, commitBody: r.commitBody };
      await mutate(r.mode === "complete" ? mergePullRequestMutation(params) : enableAutoMergeMutation(params));
      if (r.mode === "autoComplete") return;
      const warnings: string[] = [];
      // GitHub deletes the branch itself when the repository setting is on; a second deleteRef would only fail.
      if (r.deleteSourceBranch && !repo.deleteBranchOnMerge && pr.headRef) {
        try {
          await mutate(deleteRefMutation(pr.headRef.id));
        } catch (e) {
          warnings.push(`Merged, but couldn't delete the branch: ${actionErrorText(e)}`);
        }
      }
      if (r.workItems?.length) {
        try {
          const res = await completeWorkItems(r.workItems);
          if (res.failed) warnings.push(`${warnings.length ? "Also, " : "Merged, but "}${res.failed} work item${res.failed === 1 ? "" : "s"} couldn't be completed.`);
        } catch (e) {
          warnings.push(`${warnings.length ? "Also, " : "Merged, but "}couldn't complete the work items: ${actionErrorText(e)}`);
        }
      }
      return warnings.join(" ") || undefined;
    });
  }

  /** CI-2: re-run the failed jobs of one workflow run, or all of its jobs. The checks are then polled (useActions). */
  rerun(runId: number, all: boolean) {
    return this.run(async () => {
      await rest((all ? rerunAllRequest : rerunFailedJobsRequest)(this.repo, runId));
      this.watchChecksUntil = Date.now() + 30_000;
    });
  }

  /** CI-3: merge or rebase the base branch into the head. expectedHeadOid refuses it if the head moved. */
  updateBranch(method: UpdateMethod) {
    const pr = this.v().pr;
    return this.run(async () => void (await mutate(updateBranchMutation({ pullRequestId: pr.id, expectedHeadOid: pr.headRefOid, updateMethod: method }))));
  }

  /** CI-4: add to, or remove from, the merge queue. */
  enqueue() {
    const pr = this.v().pr;
    return this.run(async () => void (await mutate(enqueueMutation({ pullRequestId: pr.id, expectedHeadOid: pr.headRefOid }))));
  }
  dequeue() {
    const pr = this.v().pr;
    return this.run(async () => void (await mutate(dequeueMutation(pr.id))));
  }

  /** CI-7: GitHub refuses with a typed reason, which is kept for the reviewers panel instead of becoming the page's error. */
  requestCopilotReview() {
    const pr = this.v().pr;
    this.copilotMessage = undefined;
    return this.run(async () => {
      let payload: Parameters<typeof copilotResult>[0];
      try {
        payload = (await mutate(copilotReviewMutation(pr.id))).requestCopilotCodeReview;
      } catch (e) {
        this.copilotMessage = actionErrorText(e);
        return;
      }
      const r = copilotResult(payload);
      if (r.ok) return;
      this.copilotMessage = r.message;
      this.copilotReason = payload?.failureReason ?? null;
      if (this.raw) this.setRaw(this.raw);
    });
  }
  dismissCopilot() {
    this.copilotMessage = undefined;
    this.emit();
  }

  // ---------- batch 2: editing a pull request. Each write is queued like the actions above; its error shows in its own panel, and the page refetches on success. ----------

  /** Title and / or description (lib/prEdit.ts planTitleBodyUpdate has already validated them). */
  saveTitleBody(input: UpdatePullRequestInput) {
    return this.run(async () => void (await mutate(updatePullRequestMutation(input))), undefined, undefined, input.title !== undefined ? "title" : "body");
  }
  addReviewers(prId: string, picked: Candidate[]) {
    const ids = (kind: Candidate["kind"]) => picked.filter((c) => c.kind === kind).map((c) => c.id);
    return this.run(async () => void (await mutate(requestReviewsMutation({ pullRequestId: prId, userIds: ids("user"), teamIds: ids("team") }))), undefined, undefined, "reviewers");
  }
  removeReviewer(r: RequestedReviewer) {
    return this.run(async () => rest(removeReviewRequestsRequest(this.repo, this.number, r.kind === "team" ? { teams: [r.login] } : { users: [r.login] })), undefined, undefined, "reviewers");
  }
  addAssignee(prId: string, c: Candidate) {
    return this.run(async () => void (await mutate(addAssigneesMutation(prId, [c.id]))), undefined, undefined, "assignees");
  }
  removeAssignee(prId: string, userId: string) {
    return this.run(async () => void (await mutate(removeAssigneesMutation(prId, [userId]))), undefined, undefined, "assignees");
  }
  addLabel(prId: string, labelId: string) {
    return this.run(async () => void (await mutate(addLabelsMutation(prId, [labelId]))), undefined, undefined, "labels");
  }
  removeLabel(prId: string, labelId: string) {
    return this.run(async () => void (await mutate(removeLabelsMutation(prId, [labelId]))), undefined, undefined, "labels");
  }
  /** null clears the milestone. */
  setMilestone(prId: string, milestoneId: string | null) {
    return this.run(async () => void (await mutate(setMilestoneMutation(prId, milestoneId))), undefined, undefined, "milestone");
  }
  addProject(prId: string, projectId: string) {
    return this.run(async () => void (await mutate(addProjectItemMutation({ projectId, contentId: prId }))), undefined, undefined, "projects");
  }
  removeProject(projectId: string, itemId: string) {
    return this.run(async () => void (await mutate(deleteProjectItemMutation({ projectId, itemId }))), undefined, undefined, "projects");
  }
  /** Body edits read the description when their turn comes (not when the button was pressed), so queued edits stack instead of overwriting each other. */
  private editBody(field: EditField, prId: string, change: (body: string) => string) {
    return this.run(
      async () => {
        const body = await getBodyNow(this.repo, this.number);
        const next = change(body);
        if (next !== body) await mutate(updatePullRequestMutation({ pullRequestId: prId, body: next }));
      },
      undefined,
      undefined,
      field
    );
  }
  addWorkItem(prId: string, id: number) {
    return this.editBody("workItems", prId, (b) => addWorkItemToBody(b, id));
  }
  removeWorkItem(prId: string, id: number) {
    return this.editBody("workItems", prId, (b) => removeWorkItemFromBody(b, id));
  }
  addClosingIssue(prId: string, n: number) {
    return this.editBody("closingIssues", prId, (b) => addClosingIssueToBody(b, n));
  }
  removeClosingIssue(prId: string, n: number) {
    return this.editBody("closingIssues", prId, (b) => removeClosingIssueFromBody(b, n));
  }

  changeTarget(branch: string) {
    const pr = this.v().pr;
    return this.run(async () => void (await mutate(updateBaseMutation(pr.id, branch))));
  }
}

// ponytail: unbounded; one entry per PR opened in a session, like feedStore. Add eviction if memory shows up.
const stores = new Map<string, ActionStore>();
export function actionStore(repo: string, number: number): ActionStore {
  const key = `${repo}#${number}`;
  let s = stores.get(key);
  if (!s) stores.set(key, (s = new ActionStore(repo, number)));
  return s;
}

/** The store for a PR, re-rendering the caller on every change. Starts (or refreshes) the load. */
export function useActions(repo: string, number: number, enabled = true): ActionStore {
  const store = actionStore(repo, number);
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const off = store.subscribe(bump);
    if (enabled) store.ensureLoaded();
    return off;
  }, [store, enabled]);
  // While GitHub is still working out mergeability, a re-run's checks are running, or the pull request is queued, ask again (see lib/pollPlan.ts). Stops on unmount.
  const open = store.view?.pr.state === "OPEN";
  const unknown = open && store.view!.pr.mergeStateStatus === "UNKNOWN";
  const queued = open && !!store.view!.pr.isInMergeQueue;
  const watching = open && Date.now() < store.watchChecksUntil;
  const polling = unknown || queued || watching;
  React.useEffect(() => {
    if (!enabled || !polling) return;
    const t0 = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let dead = false;
    const tick = () => {
      const pr = store.view?.pr;
      const waiting = !!store.view?.rows.some((r) => r.kind === "check" && r.state === "pending");
      const keepPolling = !!pr?.isInMergeQueue || (store.watchChecksUntil > 0 && (Date.now() < store.watchChecksUntil || waiting));
      if (!keepPolling) store.watchChecksUntil = 0;
      const delay = pr && nextPollDelay({ state: pr.state, mergeStateStatus: pr.mergeStateStatus, elapsedMs: Date.now() - t0, keepPolling });
      if (dead || delay == null) return;
      timer = setTimeout(async () => {
        await store.refresh();
        tick();
      }, delay);
    };
    tick();
    return () => ((dead = true), clearTimeout(timer));
  }, [store, enabled, polling]);
  return store;
}

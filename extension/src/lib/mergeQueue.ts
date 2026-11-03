// CI-4: merge queue. STUBS: the developer implements them.
// Schema signals (checked live against github/docs, which has a queue, and cli/cli, which has none):
//  PullRequest.isMergeQueueEnabled: "whether the pull request's base ref has a merge queue enabled" (true on github/docs PRs, false on cli/cli).
//  PullRequest.isInMergeQueue, PullRequest.mergeQueueEntry { position state estimatedTimeToMerge (seconds) enqueuedAt }, Repository.mergeQueue(branch:) / PullRequest.mergeQueue.
// We use the PR-scoped flags: no branch argument to pass, and the flag is already false when the base has no queue.
// Mutations: enqueuePullRequest(input: EnqueuePullRequestInput! { pullRequestId: ID!, expectedHeadOid, jump }) and
// dequeuePullRequest(input: DequeuePullRequestInput! { id: ID! }), where `id` is the PULL REQUEST's node id ("The ID of the pull request to be dequeued").
import type { GraphQlRequest } from "./prQuery";
import { mergeDecision, type PolicyDecision, type PolicyInput } from "./policies";

const ENTRY = "mergeQueueEntry { position state estimatedTimeToMerge pullRequest { id isInMergeQueue } }";

export type MergeQueueState = "QUEUED" | "AWAITING_CHECKS" | "MERGEABLE" | "UNMERGEABLE" | "LOCKED";

export interface MergeQueueEntry {
  /** 1 is the front of the queue. */
  position: number | null;
  state: MergeQueueState;
  /** Seconds. */
  estimatedTimeToMerge: number | null;
}

/** Query for the queue fields. Variables { owner, name, number }. Selects repository.pullRequest { id isMergeQueueEnabled isInMergeQueue mergeQueueEntry { position state estimatedTimeToMerge } }. */
export function mergeQueueQuery({ owner, name, number }: { owner: string; name: string; number: number }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { id isMergeQueueEnabled isInMergeQueue mergeQueueEntry { position state estimatedTimeToMerge } } }
}`,
    variables: { owner, name, number },
  };
}

/** `mutation($input: EnqueuePullRequestInput!)` with { pullRequestId, expectedHeadOid }. Throws when expectedHeadOid is blank (the add is refused if the head moved). Returns mergeQueueEntry { position state estimatedTimeToMerge pullRequest { id isInMergeQueue } } (the payload has no `pullRequest` field of its own: checked live). */
export function enqueueMutation({ pullRequestId, expectedHeadOid }: { pullRequestId: string; expectedHeadOid: string }): GraphQlRequest {
  if (!expectedHeadOid.trim()) throw new Error("expectedHeadOid is required");
  return { query: `mutation($input: EnqueuePullRequestInput!) { enqueuePullRequest(input: $input) { ${ENTRY} } }`, variables: { input: { pullRequestId, expectedHeadOid } } };
}

/** `mutation($input: DequeuePullRequestInput!)` with { id: pullRequestId }. Same selection as enqueueMutation (mergeQueueEntry may come back null once removed). */
export function dequeueMutation(pullRequestId: string): GraphQlRequest {
  return { query: `mutation($input: DequeuePullRequestInput!) { dequeuePullRequest(input: $input) { ${ENTRY} } }`, variables: { input: { id: pullRequestId } } };
}

/** "#3 in the merge queue · about 12 min". The time part is omitted when estimatedTimeToMerge is null or 0; "In the merge queue" when position is null. Time: under 60 s "under a minute", under an hour "about N min" (rounded), else "about 1 hr" or "about 1 hr 30 min". */
export function queuePositionText({ position, estimatedTimeToMerge: s }: Pick<MergeQueueEntry, "position" | "estimatedTimeToMerge">): string {
  const head = position === null ? "In the merge queue" : `#${position} in the merge queue`;
  if (!s) return head;
  let t: string;
  if (s < 60) t = "under a minute";
  else if (s < 3600) t = `about ${Math.round(s / 60)} min`;
  else {
    const m = Math.round((s % 3600) / 60);
    t = `about ${Math.floor(s / 3600)} hr${m ? ` ${m} min` : ""}`;
  }
  return `${head} · ${t}`;
}

export interface MergeQueueInput extends PolicyInput {
  /** PullRequest.isMergeQueueEnabled. */
  isMergeQueueEnabled: boolean;
  /** PullRequest.isInMergeQueue. */
  isInMergeQueue: boolean;
  /** PullRequest.mergeQueueEntry, null when not queued. */
  mergeQueueEntry: MergeQueueEntry | null;
}

export type QueueDecision = Omit<PolicyDecision, "primaryAction"> & {
  primaryAction: PolicyDecision["primaryAction"] | "enqueue" | "dequeue";
  /** Label for the primary button when the queue changes it: "Merge when ready" or "Remove from queue"; absent otherwise. */
  primaryLabel?: string;
  /** queuePositionText of the entry while queued; absent otherwise. */
  queueText?: string;
};

/**
 * mergeDecision (policies.ts, unchanged) with the merge queue layered on top:
 *  - no queue on the base (isMergeQueueEnabled false and not queued): exactly mergeDecision.
 *  - closed or merged: exactly mergeDecision (none).
 *  - queued: primaryAction "dequeue", "Remove from queue", queueText, canComplete and canAutoComplete false, no blockers.
 *  - queue enabled, not queued, and mergeDecision says "complete": primaryAction "enqueue", "Merge when ready", canComplete stays true.
 *  - every other primaryAction (publish, autoComplete, none) is kept as mergeDecision gives it: while requirements are unmet GitHub's auto-merge adds the pull request to the queue when they pass.
 */
export function mergeQueueDecision(i: MergeQueueInput): QueueDecision {
  const { isMergeQueueEnabled, isInMergeQueue, mergeQueueEntry, ...policy } = i;
  const d = mergeDecision(policy);
  if (i.state !== "OPEN") return d;
  if (isInMergeQueue) {
    return { ...d, canComplete: false, canAutoComplete: false, blockers: [], primaryAction: "dequeue", primaryLabel: "Remove from queue", queueText: queuePositionText(mergeQueueEntry ?? { position: null, estimatedTimeToMerge: null }) };
  }
  if (isMergeQueueEnabled && d.primaryAction === "complete") return { ...d, primaryAction: "enqueue", primaryLabel: "Merge when ready" };
  return d;
}

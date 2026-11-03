import { describe, it, expect } from "vitest";
import { mergeQueueQuery, enqueueMutation, dequeueMutation, queuePositionText, mergeQueueDecision, type MergeQueueInput } from "./mergeQueue";
import { mergeDecision } from "./policies";
import { expectMutation, expectNotInQuery, expectPrQuery, norm, NASTY } from "./ciTestHelpers";

// Module under test: src/lib/mergeQueue.ts (mergeQueueQuery, enqueueMutation, dequeueMutation, queuePositionText, mergeQueueDecision).
// Requirement CI-4: "Merge queue": when the base branch requires a merge queue the primary Complete action becomes "Merge when ready"
// (enqueuePullRequest), and when queued "Remove from queue" (dequeuePullRequest); position text "#3 in the merge queue · about 12 min";
// the decision rules extend, not edit, mergeDecision: a new function layers on top.
//
// Schema (checked live): PullRequest.isMergeQueueEnabled (true on github/docs PRs, false on cli/cli), PullRequest.isInMergeQueue,
// PullRequest.mergeQueueEntry { position state estimatedTimeToMerge } (seconds), mutations enqueuePullRequest(EnqueuePullRequestInput { pullRequestId, expectedHeadOid, jump })
// and dequeuePullRequest(DequeuePullRequestInput { id }) where id is the PULL REQUEST id.
// Decisions fixed by these tests:
//  - the signal is PullRequest.isMergeQueueEnabled (PR-scoped), not Repository.mergeQueue(branch:).
//  - mergeQueueDecision returns exactly mergeDecision's answer when there is no queue, the PR is closed or merged, or mergeDecision's action is not "complete".
//    Only "complete" becomes "enqueue" ("Merge when ready", canComplete stays true); only queued becomes "dequeue" ("Remove from queue").
//  - while requirements are unmet the existing autoComplete path is kept: GitHub's auto-merge adds the pull request to the queue when they pass.
//  - queued: no blockers, cannot complete or auto-complete, queueText from queuePositionText.
//  - the time in the position text is rounded: under 60 s "under a minute", under an hour "about N min", then "about 1 hr" or "about 1 hr 30 min".

const base = (over: Partial<MergeQueueInput> = {}): MergeQueueInput => ({
  state: "OPEN",
  isDraft: false,
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  checks: [],
  autoMergeAllowed: false,
  autoMergeRequest: null,
  isMergeQueueEnabled: true,
  isInMergeQueue: false,
  mergeQueueEntry: null,
  ...over,
});
/** The PolicyInput part of a MergeQueueInput, for comparing with mergeDecision. */
const policyPart = (i: MergeQueueInput) => {
  const { isMergeQueueEnabled: _a, isInMergeQueue: _b, mergeQueueEntry: _c, ...rest } = i;
  return rest;
};
const queued = (over: Partial<MergeQueueInput> = {}) =>
  base({ isInMergeQueue: true, mergeQueueEntry: { position: 3, state: "QUEUED", estimatedTimeToMerge: 720 }, ...over });

describe("CI-4: mergeQueueQuery reads the queue fields of the pull request", () => {
  it("takes { owner, name, number } as variables on repository.pullRequest", () => {
    const req = mergeQueueQuery({ owner: "octo", name: "repo", number: 9 });
    expectPrQuery(req);
    expect(req.variables, "Expected variables { owner, name, number } and nothing else").toEqual({ owner: "octo", name: "repo", number: 9 });
  });

  it("selects id, isMergeQueueEnabled, isInMergeQueue and mergeQueueEntry { position state estimatedTimeToMerge }", () => {
    const q = norm(mergeQueueQuery({ owner: "o", name: "r", number: 1 }).query);
    for (const f of ["id", "isMergeQueueEnabled", "isInMergeQueue"]) expect(q, `Expected the pull request selection to include ${f}`).toMatch(new RegExp(`\\b${f}\\b`));
    expect(q, "Expected mergeQueueEntry { position state estimatedTimeToMerge }").toMatch(/mergeQueueEntry\s*\{(?=[^}]*\bposition\b)(?=[^}]*\bstate\b)(?=[^}]*\bestimatedTimeToMerge\b)[^}]*\}/);
  });

  it.each(NASTY)("keeps %j out of the query text", (v) => {
    const req = mergeQueueQuery({ owner: v, name: v, number: 1 });
    expectNotInQuery(req, [v]);
    expect(req.variables, "Expected the awkward owner and name to travel in variables").toMatchObject({ owner: v, name: v });
  });
});

describe("CI-4: enqueueMutation and dequeueMutation", () => {
  // Given a PR id and the head oid the viewer saw, Merge when ready sends enqueuePullRequest with { pullRequestId, expectedHeadOid }.
  it("enqueues with $input: EnqueuePullRequestInput! { pullRequestId, expectedHeadOid }", () => {
    const req = enqueueMutation({ pullRequestId: "PR_1", expectedHeadOid: "abc123" });
    expectMutation(req, "EnqueuePullRequestInput", "enqueuePullRequest");
    expect(req.variables, "Expected variables { input: { pullRequestId, expectedHeadOid } } and no jump key").toEqual({ input: { pullRequestId: "PR_1", expectedHeadOid: "abc123" } });
  });

  it.each(["", "  "])("throws on a blank expectedHeadOid %j, so the add is refused if the head moved", (blank) => {
    expect(() => enqueueMutation({ pullRequestId: "PR_1", expectedHeadOid: blank }), "Expected an error mentioning expectedHeadOid").toThrow(/expectedHeadOid/);
  });

  // Live finding: EnqueuePullRequestPayload and DequeuePullRequestPayload only have { clientMutationId, mergeQueueEntry }; `pullRequest` is not a field of either.
  it.each([
    ["enqueue", () => enqueueMutation({ pullRequestId: "PR_1", expectedHeadOid: "abc" })],
    ["dequeue", () => dequeueMutation("PR_1")],
  ])("selects the queue state the UI shows after %s through mergeQueueEntry, since the payload has no pullRequest field", (_n, build) => {
    const q = norm(build().query);
    expect(q, "Expected mergeQueueEntry { position state estimatedTimeToMerge pullRequest { ... isInMergeQueue } }").toMatch(
      /mergeQueueEntry\s*\{(?=[^]*\bposition\b)(?=[^]*\bstate\b)(?=[^]*\bestimatedTimeToMerge\b)(?=[^]*\bpullRequest\s*\{[^}]*\bisInMergeQueue\b)[^]*\}/
    );
    expect(q, "Expected no top-level pullRequest selection on the payload (it would fail GitHub's validation)").not.toMatch(/enqueuePullRequest\(input:\s*\$input\)\s*\{\s*pullRequest|dequeuePullRequest\(input:\s*\$input\)\s*\{\s*pullRequest/);
  });

  // dequeuePullRequest names the pull request `id` (not pullRequestId): "The ID of the pull request to be dequeued".
  it("dequeues with $input: DequeuePullRequestInput! { id: <pull request id> }", () => {
    const req = dequeueMutation("PR_1");
    expectMutation(req, "DequeuePullRequestInput", "dequeuePullRequest");
    expect(req.variables, "Expected variables { input: { id: 'PR_1' } } (the schema calls the pull request id `id`)").toEqual({ input: { id: "PR_1" } });
  });

  it.each(NASTY)("keeps %j out of both query texts", (v) => {
    const a = enqueueMutation({ pullRequestId: v, expectedHeadOid: v });
    const b = dequeueMutation(v);
    expectNotInQuery(a, [v]);
    expectNotInQuery(b, [v]);
    expect(a.variables, "Expected the enqueue ids to travel in variables").toEqual({ input: { pullRequestId: v, expectedHeadOid: v } });
    expect(b.variables, "Expected the dequeue id to travel in variables").toEqual({ input: { id: v } });
  });
});

describe("CI-4: queuePositionText", () => {
  // Given position 3 and an estimate of 720 seconds, the text is "#3 in the merge queue · about 12 min".
  it("reads '#3 in the merge queue · about 12 min' for position 3 and 720 seconds", () => {
    expect(queuePositionText({ position: 3, estimatedTimeToMerge: 720 }), "Expected the agreed wording, with a middle dot").toBe("#3 in the merge queue · about 12 min");
  });

  it.each([null, 0])("omits the time when the estimate is %s", (estimatedTimeToMerge) => {
    expect(queuePositionText({ position: 1, estimatedTimeToMerge }), "Expected no time part without an estimate").toBe("#1 in the merge queue");
  });

  it("says 'In the merge queue' when the position is not known", () => {
    expect(queuePositionText({ position: null, estimatedTimeToMerge: 720 }), "Expected no position, and still the time").toBe("In the merge queue · about 12 min");
    expect(queuePositionText({ position: null, estimatedTimeToMerge: null }), "Expected the bare text with neither").toBe("In the merge queue");
  });

  it.each([
    [30, "under a minute"],
    [59, "under a minute"],
    [60, "about 1 min"],
    [90, "about 2 min"],
    [3540, "about 59 min"],
    [3600, "about 1 hr"],
    [5400, "about 1 hr 30 min"],
    [7200, "about 2 hr"],
  ])("renders %i seconds as '%s'", (seconds, text) => {
    expect(queuePositionText({ position: 2, estimatedTimeToMerge: seconds }), `Expected ${seconds} s to read '${text}'`).toBe(`#2 in the merge queue · ${text}`);
  });
});

describe("CI-4: with no merge queue, mergeQueueDecision is exactly mergeDecision", () => {
  it.each(["CLEAN", "HAS_HOOKS", "UNSTABLE", "BLOCKED", "BEHIND", "DIRTY", "UNKNOWN"])("returns mergeDecision's answer unchanged for %s when the base has no queue", (status) => {
    const i = base({ isMergeQueueEnabled: false, mergeStateStatus: status, autoMergeAllowed: true });
    expect(mergeQueueDecision(i), `Expected no queue to leave the ${status} decision untouched`).toEqual(mergeDecision(policyPart(i)));
  });

  it.each(["CLOSED", "MERGED"] as const)("returns mergeDecision's answer (no action) for a %s pull request even when the base has a queue", (state) => {
    const i = base({ state });
    expect(mergeQueueDecision(i), `Expected a ${state} PR to offer no queue action`).toEqual(mergeDecision(policyPart(i)));
  });

  it("keeps publish for a draft even when the base has a queue", () => {
    const i = base({ isDraft: true });
    expect(mergeQueueDecision(i), "Expected a draft to keep the Publish action").toEqual(mergeDecision(policyPart(i)));
  });
});

describe("CI-4: with a merge queue, Complete becomes 'Merge when ready'", () => {
  // Given an open, clean pull request whose base requires a queue, the primary action is enqueue labelled "Merge when ready".
  it.each(["CLEAN", "HAS_HOOKS", "UNSTABLE"])("turns the complete action into enqueue for %s", (status) => {
    const d = mergeQueueDecision(base({ mergeStateStatus: status }));
    expect(d.primaryAction, `Expected enqueue (Merge when ready) for ${status}`).toBe("enqueue");
    expect(d.primaryLabel, "Expected the label 'Merge when ready'").toBe("Merge when ready");
    expect(d.canComplete, "Expected the pull request to remain completable").toBe(true);
    expect(d.blockers, "Expected no blockers").toEqual([]);
    expect(d, "Expected no queue text before the pull request is queued").not.toHaveProperty("queueText");
  });

  it("keeps the rest of mergeDecision's answer (auto-complete flags) when it enqueues", () => {
    const i = base({ autoMergeAllowed: true });
    const { primaryAction: _p, ...rest } = mergeQueueDecision(i);
    const { primaryAction: _q, ...expected } = mergeDecision(policyPart(i));
    expect(rest, "Expected canAutoComplete, autoCompleteEnabled and blockers to match mergeDecision").toMatchObject(expected);
  });

  it.each(["BLOCKED", "BEHIND"])("keeps mergeDecision's autoComplete for a %s pull request that allows auto-merge (GitHub queues it when ready)", (status) => {
    const i = base({ mergeStateStatus: status, autoMergeAllowed: true });
    const d = mergeQueueDecision(i);
    expect(d.primaryAction, `Expected ${status} with auto-merge allowed to keep autoComplete`).toBe("autoComplete");
    expect(d, "Expected the whole decision (blockers, flags) to match mergeDecision").toMatchObject(mergeDecision(policyPart(i)));
  });

  it.each(["DIRTY", "UNKNOWN"])("offers no action for %s", (status) => {
    expect(mergeQueueDecision(base({ mergeStateStatus: status })).primaryAction, `Expected no action for ${status}`).toBe("none");
  });
});

describe("CI-4: a queued pull request offers 'Remove from queue'", () => {
  it("makes dequeue the primary action, labelled 'Remove from queue', with the position text", () => {
    const d = mergeQueueDecision(queued());
    expect(d.primaryAction, "Expected dequeue as the primary action while queued").toBe("dequeue");
    expect(d.primaryLabel, "Expected the label 'Remove from queue'").toBe("Remove from queue");
    expect(d.queueText, "Expected '#3 in the merge queue · about 12 min'").toBe("#3 in the merge queue · about 12 min");
  });

  it("cannot be completed or auto-completed and has no blockers while queued", () => {
    const d = mergeQueueDecision(queued({ autoMergeAllowed: true, mergeStateStatus: "BLOCKED" }));
    expect(d.canComplete, "Expected canComplete false while queued").toBe(false);
    expect(d.canAutoComplete, "Expected canAutoComplete false while queued").toBe(false);
    expect(d.blockers, "Expected no blockers while queued").toEqual([]);
  });

  it("still offers remove from queue when the entry is not yet known (isInMergeQueue is true, the entry null)", () => {
    const d = mergeQueueDecision(queued({ mergeQueueEntry: null }));
    expect(d.primaryAction, "Expected dequeue from isInMergeQueue alone").toBe("dequeue");
    expect(d.queueText, "Expected the bare text without an entry").toBe("In the merge queue");
  });

  it("offers it whatever the merge state while queued (the queue's own check is running)", () => {
    expect(mergeQueueDecision(queued({ mergeStateStatus: "UNKNOWN" })).primaryAction, "Expected dequeue for UNKNOWN too").toBe("dequeue");
  });
});

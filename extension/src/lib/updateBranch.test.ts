import { describe, it, expect } from "vitest";
import { updateBranchMutation, updateBranchOptions, withUpdateBranchAction, type UpdateBranchInput } from "./updateBranch";
import { policyRows, type PolicyInput } from "./policies";
import { expectMutation, expectNotInQuery, NASTY } from "./ciTestHelpers";

// Module under test: src/lib/updateBranch.ts (updateBranchMutation, updateBranchOptions, withUpdateBranchAction).
// Requirement CI-3: "Update branch": GraphQL updatePullRequestBranch(input: { pullRequestId, expectedHeadOid, updateMethod: MERGE | REBASE });
// offered when mergeStateStatus is BEHIND, or the PR's base has moved (viewerCanUpdateBranch if that flag exists); labels "Update branch (merge)" and
// "Update branch (rebase)"; REBASE disabled with a reason when the head is in a fork the viewer can't push to; the policies panel's "behind" row gains an action.
//
// Schema (checked live): PullRequest.viewerCanUpdateBranch exists and is false when the head is up to date OR the viewer cannot update it.
// PullRequest.maintainerCanModify and headRepository.viewerPermission exist for the fork test.
// Decisions fixed by these tests:
//  - not OPEN: not offered.
//  - viewerCanUpdateBranch present: it decides (true offers, even when the status is not BEHIND; false does not, even when BEHIND, because the viewer cannot do it).
//  - viewerCanUpdateBranch absent: BEHIND offers, anything else does not.
//  - offered gives methods [MERGE, REBASE]; not offered gives methods [] and a reason.
//  - REBASE needs a pushable head: same-repository heads are pushable; a fork is pushable when the viewer has WRITE, MAINTAIN or ADMIN on the fork, or
//    maintainerCanModify is on and the viewer has WRITE, MAINTAIN or ADMIN on the base repository. MERGE is never disabled by the fork rule.

const same: UpdateBranchInput = {
  state: "OPEN",
  mergeStateStatus: "BEHIND",
  viewerCanUpdateBranch: true,
  isCrossRepository: false,
  maintainerCanModify: false,
  headRepositoryViewerPermission: "WRITE",
  viewerPermission: "WRITE",
};
const input = (over: Partial<UpdateBranchInput> = {}): UpdateBranchInput => ({ ...same, ...over });
const fork = (over: Partial<UpdateBranchInput> = {}) => input({ isCrossRepository: true, headRepositoryViewerPermission: "READ", maintainerCanModify: false, ...over });
const rebase = (o: ReturnType<typeof updateBranchOptions>) => o.methods.find((m) => m.method === "REBASE");
const merge = (o: ReturnType<typeof updateBranchOptions>) => o.methods.find((m) => m.method === "MERGE");

describe("CI-3: updateBranchMutation calls updatePullRequestBranch with $input", () => {
  // Given a PR id, the head oid the viewer saw and a method, the input is { pullRequestId, expectedHeadOid, updateMethod }.
  it("takes $input: UpdatePullRequestBranchInput! and sends { pullRequestId, expectedHeadOid, updateMethod }", () => {
    const req = updateBranchMutation({ pullRequestId: "PR_1", expectedHeadOid: "abc123", updateMethod: "REBASE" });
    expectMutation(req, "UpdatePullRequestBranchInput", "updatePullRequestBranch");
    expect(req.variables, "Expected variables { input: { pullRequestId, expectedHeadOid, updateMethod: 'REBASE' } }").toEqual({
      input: { pullRequestId: "PR_1", expectedHeadOid: "abc123", updateMethod: "REBASE" },
    });
  });

  it("sends MERGE as given", () => {
    const req = updateBranchMutation({ pullRequestId: "PR_1", expectedHeadOid: "abc123", updateMethod: "MERGE" });
    expect((req.variables.input as Record<string, unknown>).updateMethod, "Expected updateMethod MERGE").toBe("MERGE");
  });

  it("selects the pull request's new head and merge state so the UI can refresh", () => {
    const q = updateBranchMutation({ pullRequestId: "PR_1", expectedHeadOid: "abc", updateMethod: "MERGE" }).query.replace(/\s+/g, " ");
    expect(q, "Expected pullRequest { id headRefOid mergeStateStatus viewerCanUpdateBranch } in the selection").toMatch(
      /pullRequest\s*\{(?=[^}]*\bheadRefOid\b)(?=[^}]*\bmergeStateStatus\b)(?=[^}]*\bviewerCanUpdateBranch\b)[^}]*\}/
    );
  });

  it.each(["", "   "])("throws on a blank expectedHeadOid %j, so the update is refused if the head moved", (blank) => {
    expect(() => updateBranchMutation({ pullRequestId: "PR_1", expectedHeadOid: blank, updateMethod: "MERGE" }), "Expected an error mentioning expectedHeadOid").toThrow(/expectedHeadOid/);
  });

  it.each(NASTY)("keeps %j out of the query text", (v) => {
    const req = updateBranchMutation({ pullRequestId: v, expectedHeadOid: v, updateMethod: "MERGE" });
    expectNotInQuery(req, [v]);
    expect(req.variables, "Expected the awkward id and oid to travel in variables").toEqual({ input: { pullRequestId: v, expectedHeadOid: v, updateMethod: "MERGE" } });
  });
});

describe("CI-3: updateBranchOptions decides when Update branch is offered", () => {
  it("offers it for an open PR the viewer can update, with the two labelled methods in order", () => {
    const o = updateBranchOptions(input());
    expect(o.offered, "Expected Update branch to be offered when the base has moved and the viewer can update").toBe(true);
    expect(o.methods.map((m) => [m.method, m.label]), "Expected MERGE then REBASE with the agreed labels").toEqual([
      ["MERGE", "Update branch (merge)"],
      ["REBASE", "Update branch (rebase)"],
    ]);
    expect(o, "Expected no reason when offered").not.toHaveProperty("reason");
  });

  it("offers it when the base has moved but the status is not BEHIND (viewerCanUpdateBranch is true)", () => {
    expect(updateBranchOptions(input({ mergeStateStatus: "BLOCKED", viewerCanUpdateBranch: true })).offered, "Expected viewerCanUpdateBranch to decide, not the status").toBe(true);
  });

  it("does not offer it when viewerCanUpdateBranch is false, even for a BEHIND branch (the viewer cannot do it)", () => {
    const o = updateBranchOptions(input({ mergeStateStatus: "BEHIND", viewerCanUpdateBranch: false }));
    expect(o.offered, "Expected no Update branch when GitHub says the viewer cannot update").toBe(false);
    expect(o.methods, "Expected no methods when not offered").toEqual([]);
    expect(o.reason, "Expected a reason when not offered").toBeTruthy();
  });

  it("falls back to BEHIND when viewerCanUpdateBranch was not fetched", () => {
    expect(updateBranchOptions(input({ viewerCanUpdateBranch: undefined, mergeStateStatus: "BEHIND" })).offered, "Expected BEHIND to offer it without the flag").toBe(true);
    expect(updateBranchOptions(input({ viewerCanUpdateBranch: undefined, mergeStateStatus: "CLEAN" })).offered, "Expected CLEAN not to offer it without the flag").toBe(false);
  });

  it.each(["CLOSED", "MERGED"] as const)("does not offer it on a %s pull request", (state) => {
    const o = updateBranchOptions(input({ state }));
    expect(o.offered, `Expected no Update branch on a ${state} PR`).toBe(false);
    expect(o.reason, "Expected a reason when not offered").toBeTruthy();
  });
});

describe("CI-3: REBASE is disabled when the head is in a fork the viewer cannot push to", () => {
  // Given a fork the viewer only has READ on, MERGE stays enabled and REBASE is disabled with a reason mentioning the fork.
  it("disables REBASE, with a reason, for a fork the viewer cannot push to; MERGE stays enabled", () => {
    const o = updateBranchOptions(fork());
    expect(rebase(o)?.disabled, "Expected REBASE to be disabled for a fork the viewer cannot push to").toBe(true);
    expect(rebase(o)?.reason, "Expected a reason mentioning the fork").toMatch(/fork/i);
    expect(merge(o)?.disabled, "Expected MERGE to stay enabled").toBe(false);
    expect(merge(o), "Expected an enabled method to carry no reason").not.toHaveProperty("reason");
  });

  it("enables REBASE on a same-repository head", () => {
    expect(rebase(updateBranchOptions(input()))?.disabled, "Expected REBASE enabled when the head is in the same repository").toBe(false);
  });

  it.each(["WRITE", "MAINTAIN", "ADMIN"])("enables REBASE for a fork the viewer has %s on", (permission) => {
    expect(rebase(updateBranchOptions(fork({ headRepositoryViewerPermission: permission })))?.disabled, `Expected REBASE enabled with ${permission} on the fork`).toBe(false);
  });

  it("enables REBASE when maintainerCanModify is on and the viewer has write access to the base repository", () => {
    expect(rebase(updateBranchOptions(fork({ maintainerCanModify: true, viewerPermission: "WRITE" })))?.disabled, "Expected maintainer edits to make the fork pushable").toBe(false);
  });

  it("keeps REBASE disabled when maintainerCanModify is on but the viewer only has READ on the base repository", () => {
    expect(rebase(updateBranchOptions(fork({ maintainerCanModify: true, viewerPermission: "READ" })))?.disabled, "Expected maintainer edits to need write access on the base").toBe(true);
  });

  it("keeps REBASE disabled when the fork's permission is unknown (a deleted fork) and maintainer edits are off", () => {
    expect(rebase(updateBranchOptions(fork({ headRepositoryViewerPermission: null })))?.disabled, "Expected an unknown fork to count as not pushable").toBe(true);
  });
});

describe("CI-3: the policies panel's behind row gains the update action", () => {
  // Given policyRows for a BEHIND pull request and offered options, the behind row carries { kind: 'updateBranch', methods }.
  const prInput: PolicyInput = { state: "OPEN", isDraft: false, mergeStateStatus: "BEHIND", reviewDecision: null, checks: [], autoMergeAllowed: false, autoMergeRequest: null };

  it("adds the update-branch action, with the offered methods, to the behind row only", () => {
    const rows = policyRows(prInput);
    const options = updateBranchOptions(input());
    const out = withUpdateBranchAction(rows, options);
    expect(out.map((r) => r.kind), "Expected the rows to keep their order").toEqual(rows.map((r) => r.kind));
    expect(out.find((r) => r.kind === "behind")?.action, "Expected the behind row to carry the update-branch action").toEqual({ kind: "updateBranch", methods: options.methods });
    expect(out.filter((r) => r.kind !== "behind").every((r) => !("action" in r)), "Expected no other row to gain an action").toBe(true);
  });

  it("leaves the rows unchanged when update branch is not offered", () => {
    const rows = policyRows(prInput);
    expect(withUpdateBranchAction(rows, updateBranchOptions(input({ viewerCanUpdateBranch: false }))), "Expected the behind row to have no action when not offered").toEqual(rows);
  });

  it("leaves the rows unchanged when there is no behind row", () => {
    const rows = policyRows({ ...prInput, mergeStateStatus: "CLEAN" });
    expect(withUpdateBranchAction(rows, updateBranchOptions(input())), "Expected no change when no row is the behind row").toEqual(rows);
  });
});

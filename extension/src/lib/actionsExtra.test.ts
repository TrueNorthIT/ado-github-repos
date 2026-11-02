import { describe, it, expect } from "vitest";
import { subscriptionMutation, updateBaseMutation, branchesQuery, mergeMessageQuery, type PrActionsNode } from "./actionsQuery";
import { deriveActions } from "./prActions";

// Follow / Unfollow, Change target branch, and the wiring-layer rule for the delete-branch box. Caller text travels in variables.
const norm = (s: string) => s.replace(/\s+/g, " ");

describe("subscriptionMutation (Follow / Unfollow)", () => {
  it.each(["SUBSCRIBED", "UNSUBSCRIBED"] as const)("sends updateSubscription { subscribableId, state: %s }", (state) => {
    const r = subscriptionMutation("PR_1", state);
    expect(norm(r.query)).toMatch(/\$input:\s*UpdateSubscriptionInput!/);
    expect(norm(r.query)).toMatch(/updateSubscription\(input:\s*\$input\)/);
    expect(r.variables).toEqual({ input: { subscribableId: "PR_1", state } });
  });
});

describe("updateBaseMutation (Change target branch)", () => {
  it("sends updatePullRequest { pullRequestId, baseRefName } with the name in variables", () => {
    const r = updateBaseMutation("PR_1", 'release/"1" {x}');
    expect(norm(r.query)).toMatch(/\$input:\s*UpdatePullRequestInput!/);
    expect(r.variables).toEqual({ input: { pullRequestId: "PR_1", baseRefName: 'release/"1" {x}' } });
    expect(r.query).toBe(updateBaseMutation("PR_2", "main").query);
  });
  it.each(["", "  "])("rejects the blank branch %j, naming baseRefName", (b) => {
    expect(() => updateBaseMutation("PR_1", b)).toThrow(/baseRefName/);
  });
});

describe("read queries", () => {
  it("branchesQuery and mergeMessageQuery keep text in variables", () => {
    expect(branchesQuery({ owner: "a", name: "b" }).variables).toEqual({ owner: "a", name: "b" });
    expect(branchesQuery({ owner: '"', name: "{" }).query).toBe(branchesQuery({ owner: "a", name: "b" }).query);
    const q = norm(mergeMessageQuery({ owner: "a", name: "b", number: 3 }).query);
    expect(q).toMatch(/viewerMergeHeadlineText\(mergeType: MERGE\)/);
    expect(q).toMatch(/viewerMergeBodyText\(mergeType: SQUASH\)/);
  });
});

describe("deriveActions", () => {
  const repo = (state: "OPEN" | "MERGED", viewerPermission: string, canDelete = false): NonNullable<PrActionsNode["repository"]> => ({
    mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true, autoMergeAllowed: true, deleteBranchOnMerge: false, viewerPermission,
    defaultBranchRef: { name: "main" },
    pullRequest: {
      id: "PR_1", state, isDraft: false, merged: state === "MERGED", mergeStateStatus: "BLOCKED", reviewDecision: null, baseRefName: "main", headRefName: "feature/x", headRefOid: "abc",
      isCrossRepository: false, headRepository: null, headRef: { id: "REF_1", name: "feature/x", branchProtectionRule: null }, viewerSubscription: null, viewerDidAuthor: false,
      viewerCanUpdate: true, viewerCanClose: true, viewerCanReopen: false, viewerCanDeleteHeadRef: canDelete, viewerCanEnableAutoMerge: true, viewerCanDisableAutoMerge: false,
      viewerCanMergeAsAdmin: false, viewerLatestReview: null, autoMergeRequest: null, statusCheckRollup: null,
    },
  });

  // GitHub reports viewerCanDeleteHeadRef false on every open PR (checked live), so push access decides while it is open.
  it("lets a writer tick delete-branch on an open PR although GitHub says viewerCanDeleteHeadRef false", () => {
    expect(deriveActions(repo("OPEN", "WRITE")).defaults.deleteSourceBranch).toBe(true);
    expect(deriveActions(repo("OPEN", "READ")).deleteChoice.available).toBe(false);
  });
  it("hides Set auto-complete when the viewer cannot enable auto-merge, even if the repository allows it", () => {
    const r = repo("OPEN", "WRITE");
    expect(deriveActions(r).main.kind).toBe("autoComplete");
    r.pullRequest!.viewerCanEnableAutoMerge = false;
    expect(deriveActions(r).main.kind).toBe("none");
  });
});

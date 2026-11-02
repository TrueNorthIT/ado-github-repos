import { describe, it, expect } from "vitest";
import {
  allowedMergeMethods,
  defaultMergeMethod,
  mergeMethodLabel,
  supportsCustomMessage,
  deleteBranchDefault,
  defaultCompleteOptions,
  type RepoMergeSettings,
  type DeleteBranchContext,
  type MergeMethod,
} from "./mergeOptions";

// Module under test: src/lib/mergeOptions.ts. Requirement A-2: "Complete: a merge-type choice limited to the repo's allowed methods".
// GitHub names: Repository.mergeCommitAllowed / squashMergeAllowed / rebaseMergeAllowed, enum PullRequestMergeMethod { MERGE, SQUASH, REBASE },
// PullRequest.isCrossRepository / headRefName / viewerCanDeleteHeadRef, Repository.defaultBranchRef.name, Ref.branchProtectionRule.allowsDeletions.
// Decisions fixed by these tests:
//  - the dropdown lists allowed methods in native order MERGE, SQUASH, REBASE; the default is the first allowed in the order SQUASH, MERGE, REBASE.
//  - deleting the source branch is ticked by default unless the head is in another repository (fork), is the default branch, or matches
//    a branch protection rule. A protection rule that forbids deletions (allowsDeletions false) disables the checkbox; one that allows them
//    leaves it available but unticked. Without viewerCanDeleteHeadRef the checkbox is disabled. Whenever the box is disabled or unticked
//    by default, `reason` explains why.
//  - "Complete associated work items" and "Customize merge commit message" start unticked (native: only the delete-branch box starts ticked).

const settings = (merge: boolean, squash: boolean, rebase: boolean): RepoMergeSettings => ({ mergeCommitAllowed: merge, squashMergeAllowed: squash, rebaseMergeAllowed: rebase });
const ALL = settings(true, true, true);
const branch = (over: Partial<DeleteBranchContext> = {}): DeleteBranchContext => ({
  isCrossRepository: false,
  headRefName: "feature/widget",
  defaultBranchName: "main",
  branchProtectionRule: null,
  viewerCanDeleteHeadRef: true,
  ...over,
});

describe("A-2: allowedMergeMethods is limited to what the repository allows", () => {
  it.each<[RepoMergeSettings, MergeMethod[]]>([
    [settings(true, true, true), ["MERGE", "SQUASH", "REBASE"]],
    [settings(true, false, false), ["MERGE"]],
    [settings(false, true, false), ["SQUASH"]],
    [settings(false, false, true), ["REBASE"]],
    [settings(true, false, true), ["MERGE", "REBASE"]],
    [settings(false, true, true), ["SQUASH", "REBASE"]],
    [settings(true, true, false), ["MERGE", "SQUASH"]],
    [settings(false, false, false), []],
  ])("%j -> %j (native dropdown order)", (s, expected) => {
    expect(allowedMergeMethods(s), `Expected ${JSON.stringify(expected)} for ${JSON.stringify(s)}`).toEqual(expected);
  });
});

describe("A-2: defaultMergeMethod picks the first allowed in the order squash, merge, rebase", () => {
  it.each<[RepoMergeSettings, MergeMethod | null]>([
    [settings(true, true, true), "SQUASH"],
    [settings(true, true, false), "SQUASH"],
    [settings(true, false, true), "MERGE"],
    [settings(false, false, true), "REBASE"],
    [settings(true, false, false), "MERGE"],
    [settings(false, true, true), "SQUASH"],
    [settings(false, false, false), null],
  ])("%j -> %s", (s, expected) => {
    expect(defaultMergeMethod(s), `Expected default ${String(expected)} for ${JSON.stringify(s)}`).toBe(expected);
  });
});

describe("A-2: mergeMethodLabel uses the native wording", () => {
  it.each<[MergeMethod, string]>([
    ["MERGE", "Merge (no fast forward)"],
    ["SQUASH", "Squash commit"],
    ["REBASE", "Rebase and fast-forward"],
  ])("%s -> %s", (m, label) => {
    expect(mergeMethodLabel(m), `Expected the native label for ${m}`).toBe(label);
  });
});

describe("A-2: a custom merge commit message exists only for MERGE and SQUASH", () => {
  it.each<[MergeMethod, boolean]>([["MERGE", true], ["SQUASH", true], ["REBASE", false]])("%s -> %s", (m, expected) => {
    expect(supportsCustomMessage(m), `Expected supportsCustomMessage(${m}) to be ${expected}`).toBe(expected);
  });
});

describe("A-2: deleteBranchDefault", () => {
  it("is available and ticked for a same-repository, unprotected, non-default head branch", () => {
    const c = deleteBranchDefault(branch());
    expect(c.available, "Expected the checkbox to be available").toBe(true);
    expect(c.checked, "Expected the checkbox to be ticked by default").toBe(true);
    expect(c.reason, "Expected no reason when it is simply deletable").toBeUndefined();
  });

  it("is unavailable and unticked when the head branch is in a fork, saying so", () => {
    const c = deleteBranchDefault(branch({ isCrossRepository: true }));
    expect(c.available, "Expected the checkbox to be disabled for a fork head").toBe(false);
    expect(c.checked, "Expected the checkbox to be unticked for a fork head").toBe(false);
    expect(c.reason, "Expected a reason that mentions the fork").toMatch(/fork|another repository/i);
  });

  it("is unavailable and unticked when the head branch is the default branch, saying so", () => {
    const c = deleteBranchDefault(branch({ headRefName: "main", defaultBranchName: "main" }));
    expect(c.available, "Expected the checkbox to be disabled for the default branch").toBe(false);
    expect(c.checked, "Expected the checkbox to be unticked for the default branch").toBe(false);
    expect(c.reason, "Expected a reason that mentions the default branch").toMatch(/default/i);
  });

  it("is unavailable and unticked when a protection rule forbids deleting the head branch, saying so", () => {
    const c = deleteBranchDefault(branch({ branchProtectionRule: { allowsDeletions: false } }));
    expect(c.available, "Expected the checkbox to be disabled when the rule forbids deletion").toBe(false);
    expect(c.checked, "Expected the checkbox to be unticked").toBe(false);
    expect(c.reason, "Expected a reason that mentions protection").toMatch(/protect/i);
  });

  it("is available but unticked when a protection rule allows deletions, saying why it starts unticked", () => {
    const c = deleteBranchDefault(branch({ branchProtectionRule: { allowsDeletions: true } }));
    expect(c.available, "Expected the checkbox to stay available when the rule allows deletion").toBe(true);
    expect(c.checked, "Expected a protected branch not to be deleted by default").toBe(false);
    expect(c.reason, "Expected a reason that mentions protection").toMatch(/protect/i);
  });

  it("is unavailable and unticked when the viewer cannot delete the head ref, with a non-empty reason", () => {
    const c = deleteBranchDefault(branch({ viewerCanDeleteHeadRef: false }));
    expect(c.available, "Expected the checkbox to be disabled without permission").toBe(false);
    expect(c.checked, "Expected the checkbox to be unticked without permission").toBe(false);
    expect((c.reason ?? "").length, "Expected a non-empty reason").toBeGreaterThan(0);
  });

  it("compares the head branch with the default branch exactly (a branch merely containing 'main' is deletable)", () => {
    const c = deleteBranchDefault(branch({ headRefName: "feature/main-menu", defaultBranchName: "main" }));
    expect(c.checked, "Expected feature/main-menu to be ticked by default").toBe(true);
  });
});

describe("A-2: defaultCompleteOptions is the initial state of the Complete panel", () => {
  it("picks the default merge method, ticks delete-branch, and leaves work items and custom message unticked", () => {
    expect(defaultCompleteOptions(ALL, branch()), "Expected squash, delete ticked, the rest off").toEqual({
      mergeMethod: "SQUASH",
      deleteSourceBranch: true,
      completeWorkItems: false,
      customizeMessage: false,
    });
  });

  it("follows the repository's allowed methods", () => {
    expect(defaultCompleteOptions(settings(true, false, true), branch()).mergeMethod, "Expected MERGE when squash is not allowed").toBe("MERGE");
  });

  it("has a null merge method when the repository allows none", () => {
    expect(defaultCompleteOptions(settings(false, false, false), branch()).mergeMethod, "Expected null when no method is allowed").toBeNull();
  });

  it("starts delete-branch unticked when deleteBranchDefault says it is not ticked by default", () => {
    expect(defaultCompleteOptions(ALL, branch({ isCrossRepository: true })).deleteSourceBranch, "Expected a fork head to start unticked").toBe(false);
    expect(defaultCompleteOptions(ALL, branch({ branchProtectionRule: { allowsDeletions: true } })).deleteSourceBranch, "Expected a protected head to start unticked").toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  FORK_REASON, PROTECTED_REASON, SEMI_LINEAR_POLL_MS, SEMI_LINEAR_TIMEOUT_MS, SemiLinearError, headCompareRequest, mergeFailureText, pullRequestRequest,
  rebaseStatus, runSemiLinear, semiLinearChoice, semiLinearMergeRequest, type RestPull, type SemiLinearDeps, type SemiLinearInput, type SemiLinearStep,
} from "./semiLinear";
import { actionsDetailQuery } from "./actionsQuery";

// Module under test: src/lib/semiLinear.ts. Native ADO's "Semi-linear merge" = rebase the source onto the target, then a merge commit.
// GitHub has no single call: updatePullRequestBranch(REBASE), wait for the new head on REST, then PUT /pulls/{n}/merge with merge_method "merge" and `sha`.

const base: SemiLinearInput = { mergeCommitAllowed: true, isCrossRepository: false, headPushable: true, classicRule: null, headRules: [] };
const choice = (over: Partial<SemiLinearInput> = {}) => semiLinearChoice({ ...base, ...over });

describe("semiLinearChoice: offered only with merge commits, disabled when the head can't be rewritten", () => {
  it("is offered and enabled for a same-repository head with no protection", () => {
    expect(choice()).toEqual({ offered: true, disabled: false });
  });
  it("is not offered when the repository refuses merge commits", () => {
    expect(choice({ mergeCommitAllowed: false }).offered).toBe(false);
  });
  it("is disabled for a fork without maintainer edits (not pushable)", () => {
    expect(choice({ isCrossRepository: true, headPushable: false })).toEqual({ offered: true, disabled: true, reason: FORK_REASON });
  });
  it("is enabled for a fork the viewer may push to", () => {
    expect(choice({ isCrossRepository: true, headPushable: true }).disabled).toBe(false);
  });
  it("is disabled when classic protection refuses force pushes", () => {
    expect(choice({ classicRule: { allowsForcePushes: false } })).toEqual({ offered: true, disabled: true, reason: PROTECTED_REASON });
  });
  it("stays enabled when classic protection allows force pushes, or its flag is unknown", () => {
    expect(choice({ classicRule: { allowsForcePushes: true } }).disabled).toBe(false);
    expect(choice({ classicRule: {} }).disabled).toBe(false);
  });
  it("is disabled by a ruleset's non_fast_forward or update rule", () => {
    expect(choice({ headRules: [{ type: "non_fast_forward" }] }).reason).toBe(PROTECTED_REASON);
    expect(choice({ headRules: [{ type: "update" }] }).reason).toBe(PROTECTED_REASON);
  });
  it("ignores other rules, and unknown (null) rules", () => {
    expect(choice({ headRules: [{ type: "deletion" }, { type: "pull_request", parameters: {} }] }).disabled).toBe(false);
    expect(choice({ headRules: null }).disabled).toBe(false);
  });
});

describe("the REST requests", () => {
  it("compares the target branch with the head sha, keeping the branch's slashes", () => {
    expect(headCompareRequest("o/r", "release/1.0", "abc")).toEqual({ method: "GET", path: "/repos/o/r/compare/release/1.0...abc?per_page=1" });
    expect(headCompareRequest("o/r", "a b", "abc").path).toBe("/repos/o/r/compare/a%20b...abc?per_page=1");
  });
  it("reads the pull request", () => {
    expect(pullRequestRequest("o/r", 7)).toEqual({ method: "GET", path: "/repos/o/r/pulls/7" });
  });
  it("merges with merge_method merge and the expected sha", () => {
    expect(semiLinearMergeRequest("o/r", 7, { sha: "def" })).toEqual({ method: "PUT", path: "/repos/o/r/pulls/7/merge", body: { merge_method: "merge", sha: "def" } });
  });
  it("sends a custom title and message only when a title is given", () => {
    expect(semiLinearMergeRequest("o/r", 7, { sha: "def", commitTitle: "T", commitMessage: "M" }).body).toEqual({ merge_method: "merge", sha: "def", commit_title: "T", commit_message: "M" });
    expect(semiLinearMergeRequest("o/r", 7, { sha: "def", commitTitle: " ", commitMessage: "M" }).body).toEqual({ merge_method: "merge", sha: "def" });
  });
  it("refuses a blank sha", () => {
    expect(() => semiLinearMergeRequest("o/r", 7, { sha: " " })).toThrow("sha is required");
  });
});

const pull = (over: Partial<RestPull> = {}): RestPull => ({ state: "open", merged: false, head: { sha: "new" }, mergeable: true, mergeable_state: "clean", ...over });

describe("rebaseStatus", () => {
  it("waits while the head is still the old one", () => expect(rebaseStatus(pull({ head: { sha: "old" } }), "old")).toBe("waiting"));
  it("waits while mergeability is unknown", () => {
    expect(rebaseStatus(pull({ mergeable: null }), "old")).toBe("waiting");
    expect(rebaseStatus(pull({ mergeable_state: "unknown" }), "old")).toBe("waiting");
  });
  it("is ready once the head moved and it merges, even while blocked by re-running checks", () => {
    expect(rebaseStatus(pull(), "old")).toBe("ready");
    expect(rebaseStatus(pull({ mergeable_state: "blocked" }), "old")).toBe("ready");
  });
  it("reports conflicts", () => expect(rebaseStatus(pull({ mergeable: false, mergeable_state: "dirty" }), "old")).toBe("conflicts"));
  it("reports a closed or merged pull request", () => {
    expect(rebaseStatus(pull({ state: "closed" }), "old")).toBe("closed");
    expect(rebaseStatus(pull({ merged: true }), "old")).toBe("closed");
  });
});

/** Fake deps: `pulls` are answered in turn (the last repeats); the clock advances by each sleep. */
function deps(o: { behind?: number; pulls?: RestPull[]; rebase?: () => Promise<void>; merge?: (sha: string) => Promise<void> } = {}) {
  let t = 0;
  const calls: string[] = [];
  const steps: SemiLinearStep[] = [];
  const pulls = o.pulls ?? [pull()];
  let i = 0;
  const d: SemiLinearDeps = {
    behindBy: async () => (calls.push("compare"), o.behind ?? 0),
    rebase: async () => (calls.push("rebase"), o.rebase?.()),
    getPull: async () => (calls.push("poll"), pulls[Math.min(i++, pulls.length - 1)]),
    merge: async (sha) => (calls.push(`merge ${sha}`), o.merge?.(sha)),
    sleep: async (ms) => void (t += ms),
    now: () => t,
    onStep: (s) => steps.push(s),
  };
  return { d, calls, steps, elapsed: () => t };
}

describe("runSemiLinear", () => {
  it("merges straight away, expecting the loaded head, when the head isn't behind", async () => {
    const f = deps({ behind: 0 });
    await expect(runSemiLinear(f.d, "old")).resolves.toEqual({ rebased: false, mergedSha: "old" });
    expect(f.calls).toEqual(["compare", "merge old"]);
    expect(f.steps).toEqual(["checking", "merging"]);
  });

  it("rebases, polls until the new head is mergeable, then merges expecting the new head", async () => {
    const f = deps({ behind: 3, pulls: [pull({ head: { sha: "old" }, mergeable: null }), pull({ mergeable: null }), pull({ head: { sha: "new" } })] });
    await expect(runSemiLinear(f.d, "old")).resolves.toEqual({ rebased: true, mergedSha: "new" });
    expect(f.calls).toEqual(["compare", "rebase", "poll", "poll", "poll", "merge new"]);
    expect(f.steps).toEqual(["checking", "rebasing", "waiting", "merging"]);
    expect(f.elapsed()).toBe(2 * SEMI_LINEAR_POLL_MS);
  });

  it("never merges when the rebase is refused (the caller's error passes through)", async () => {
    const f = deps({ behind: 1, rebase: async () => { throw new Error("Head branch was modified"); } });
    await expect(runSemiLinear(f.d, "old")).rejects.toThrow("Head branch was modified");
    expect(f.calls.some((c) => c.startsWith("merge"))).toBe(false);
  });

  it("gives up after the timeout without merging", async () => {
    const f = deps({ behind: 1, pulls: [pull({ head: { sha: "old" } })] });
    await expect(runSemiLinear(f.d, "old")).rejects.toBeInstanceOf(SemiLinearError);
    expect(f.calls.some((c) => c.startsWith("merge"))).toBe(false);
    expect(f.elapsed()).toBeGreaterThanOrEqual(SEMI_LINEAR_TIMEOUT_MS);
  });

  it("stops with a clear message on conflicts or a closed pull request", async () => {
    await expect(runSemiLinear(deps({ behind: 1, pulls: [pull({ mergeable: false })] }).d, "old")).rejects.toThrow(/conflicts/);
    await expect(runSemiLinear(deps({ behind: 1, pulls: [pull({ state: "closed" })] }).d, "old")).rejects.toThrow(/closed or merged/);
  });
});

describe("mergeFailureText", () => {
  it("explains a 409 as a head that moved", () => {
    expect(mergeFailureText(409, "Head branch was modified.", true)).toMatch(/changed after it was rebased, so it wasn't merged/);
  });
  it("passes GitHub's reason on a 405 and says the branch was rebased", () => {
    const t = mergeFailureText(405, 'Required status check "build" is expected.', true);
    expect(t).toContain('Required status check "build" is expected');
    expect(t).toContain("has been rebased");
  });
  it("doesn't claim a rebase that didn't happen", () => {
    expect(mergeFailureText(405, "Pull Request is not mergeable", false)).not.toContain("rebased");
  });
});

describe("actionsDetailQuery asks for what semi-linear merge and the reviewer groups need", () => {
  const q = actionsDetailQuery({ owner: "o", name: "r", number: 1 }).query.replace(/\s+/g, " ");
  it("selects allowsForcePushes on the head ref's protection rule", () => expect(q).toMatch(/headRef \{[^}]*branchProtectionRule \{[^}]*\ballowsForcePushes\b/));
  it("selects requiresCodeOwnerReviews on the base ref's protection rule", () => expect(q).toMatch(/baseRef \{ branchProtectionRule \{ requiresCodeOwnerReviews \} \}/));
});

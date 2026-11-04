import { describe, expect, it } from "vitest";
import {
  addContext, changedPolicies, EMPTY_FORM, findOwnedSummary, formErrors, formFromRules, isLocked, isOwnedRuleset, lockPlan, ownedBranchOf,
  ownedRulesetName, ownedSummaries, policyWriteError, removeContext, rulesFromForm, rulesetsListRequest, savePlan, setPrPolicy, setReviewersOn,
  type PolicyForm, type Ruleset, type RulesetRule,
} from "./policyEdit";

const R = "o/r";
const owned = (rules: RulesetRule[], over: Partial<Ruleset> = {}): Ruleset => ({
  id: 7, name: ownedRulesetName("main"), target: "branch", source_type: "Repository", enforcement: "active",
  conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } }, rules, ...over,
});
const FULL: RulesetRule[] = [
  { type: "pull_request", parameters: { required_approving_review_count: 2, dismiss_stale_reviews_on_push: true, require_code_owner_review: true, require_last_push_approval: false, required_review_thread_resolution: true, allowed_merge_methods: ["squash", "rebase"], automatic_copilot_code_review_enabled: true } },
  { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: true, required_status_checks: [{ context: "CI / build", integration_id: 15368 }, { context: "lint" }] } },
  { type: "non_fast_forward" },
  { type: "deletion" },
  { type: "required_signatures" },
  { type: "update", parameters: { update_allows_fetch_and_merge: false } },
  { type: "merge_queue", parameters: { merge_method: "SQUASH" } },
];
const clone = (f: PolicyForm): PolicyForm => JSON.parse(JSON.stringify(f));

describe("ownership", () => {
  it("names the ruleset after the branch and reads the branch back", () => {
    expect(ownedRulesetName("release/1.0")).toBe("Azure DevOps policies: release/1.0");
    expect(ownedBranchOf("Azure DevOps policies: release/1.0")).toBe("release/1.0");
    expect(ownedBranchOf("Azure DevOps policies: ")).toBeNull();
    expect(ownedBranchOf("Protect main")).toBeNull();
  });
  it("owns only its own name, a branch target in the repository, with exactly the one branch", () => {
    expect(isOwnedRuleset(owned([]), "main")).toBe(true);
    expect(isOwnedRuleset(owned([]), "develop")).toBe(false);
    expect(isOwnedRuleset(owned([], { name: "Protect main" }), "main")).toBe(false);
    expect(isOwnedRuleset(owned([], { target: "tag" }), "main")).toBe(false);
    expect(isOwnedRuleset(owned([], { source_type: "Organization" }), "main")).toBe(false);
    expect(isOwnedRuleset(owned([], { conditions: { ref_name: { include: ["refs/heads/main", "refs/heads/dev"] } } }), "main")).toBe(false);
    expect(isOwnedRuleset(owned([], { conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } } }), "main")).toBe(false);
    expect(isOwnedRuleset(owned([], { conditions: { ref_name: { include: ["refs/heads/main"], exclude: ["refs/heads/x"] } } }), "main")).toBe(false);
    expect(isOwnedRuleset(null, "main")).toBe(false);
  });
  it("accepts a summary without conditions and finds it in a list", () => {
    const list = [{ id: 1, name: "Protect main", target: "branch" }, { id: 2, name: ownedRulesetName("main"), target: "branch", source_type: "Repository" }];
    expect(findOwnedSummary(list, "main")?.id).toBe(2);
    expect(findOwnedSummary(list, "dev")).toBeUndefined();
    expect(findOwnedSummary({ message: "nope" }, "main")).toBeUndefined();
  });
  it("lists the owned summaries with their branches", () => {
    expect(ownedSummaries([
      { id: 2, name: ownedRulesetName("main"), target: "branch", source_type: "Repository" },
      { id: 3, name: ownedRulesetName("v1"), target: "tag" },
      { id: 4, name: "Other" },
      { id: 5, name: ownedRulesetName("a/b"), source_type: "Organization" },
      { id: 6, name: ownedRulesetName("feature/x") },
    ])).toEqual([{ id: 2, branch: "main" }, { id: 6, branch: "feature/x" }]);
    expect(ownedSummaries(null)).toEqual([]);
  });
  it("lists only the repository's own branch rulesets", () => {
    expect(rulesetsListRequest(R).path).toBe("/repos/o/r/rulesets?includes_parents=false&targets=branch&per_page=100");
  });
});

describe("formFromRules", () => {
  it("is the empty form without a ruleset", () => {
    expect(formFromRules(undefined)).toEqual(EMPTY_FORM);
    expect(formFromRules([])).not.toBe(EMPTY_FORM);
  });
  it("reads every policy the form edits", () => {
    expect(formFromRules(FULL)).toEqual({
      reviewers: { on: true, count: 2, dismissStale: true, lastPushApproval: false, codeOwners: true },
      commentResolution: true,
      mergeTypes: { on: true, methods: ["squash", "rebase"] },
      checks: { contexts: ["CI / build", "lint"], strict: true },
      blockForcePush: true, restrictDeletion: true, requireSignatures: true,
    });
  });
  it("treats all three merge methods, or none, as not limited", () => {
    expect(formFromRules([{ type: "pull_request", parameters: { allowed_merge_methods: ["merge", "squash", "rebase"] } }]).mergeTypes.on).toBe(false);
    expect(formFromRules([{ type: "pull_request", parameters: { allowed_merge_methods: [] } }]).mergeTypes.on).toBe(false);
    expect(formFromRules([{ type: "pull_request", parameters: { allowed_merge_methods: ["rebase", "merge"] } }]).mergeTypes.methods).toEqual(["merge", "rebase"]);
  });
  it("keeps a pull request rule with no approval as reviewers on with count 0, and clamps odd counts", () => {
    expect(formFromRules([{ type: "pull_request", parameters: { required_approving_review_count: 0 } }]).reviewers).toMatchObject({ on: true, count: 0 });
    expect(formFromRules([{ type: "pull_request", parameters: { required_approving_review_count: 99 } }]).reviewers.count).toBe(10);
    expect(formFromRules([{ type: "pull_request" }]).reviewers.count).toBe(0);
  });
  it("drops blank and repeated status checks", () => {
    expect(formFromRules([{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "a" }, { context: "" }, {}, { context: "a" }] } }]).checks.contexts).toEqual(["a"]);
  });
});

describe("rulesFromForm", () => {
  it("round-trips the full ruleset, keeping the lock, other rules and unknown parameters", () => {
    const out = rulesFromForm(formFromRules(FULL), FULL);
    expect(out).toEqual(FULL);
  });
  it("writes nothing for the empty form", () => {
    expect(rulesFromForm(EMPTY_FORM)).toEqual([]);
  });
  it("removes the form's rules that were turned off, but not the lock", () => {
    const out = rulesFromForm(EMPTY_FORM, FULL);
    expect(out.map((r) => r.type)).toEqual(["update", "merge_queue"]);
  });
  it("drops allowed_merge_methods when merge types are no longer limited", () => {
    const f = { ...formFromRules(FULL), mergeTypes: { on: false, methods: ["squash" as const] } };
    const pr = rulesFromForm(f, FULL).find((r) => r.type === "pull_request")!;
    expect(pr.parameters).not.toHaveProperty("allowed_merge_methods");
    expect(pr.parameters!.automatic_copilot_code_review_enabled).toBe(true);
  });
  it("orders merge methods as GitHub lists them", () => {
    const f = clone(EMPTY_FORM);
    f.reviewers.on = true;
    f.mergeTypes = { on: true, methods: ["rebase", "merge"] };
    expect(rulesFromForm(f)[0].parameters!.allowed_merge_methods).toEqual(["merge", "rebase"]);
  });
  it("builds a new pull request rule with every required parameter", () => {
    const f = setReviewersOn(clone(EMPTY_FORM), true);
    expect(rulesFromForm(f)).toEqual([{ type: "pull_request", parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } }]);
  });
  it("keeps integration ids of checks still listed and adds new checks without one", () => {
    const f = removeContext(addContext(formFromRules(FULL), "deploy"), "lint");
    const rsc = rulesFromForm(f, FULL).find((r) => r.type === "required_status_checks")!;
    expect(rsc.parameters).toEqual({ strict_required_status_checks_policy: true, do_not_enforce_on_create: true, required_status_checks: [{ context: "CI / build", integration_id: 15368 }, { context: "deploy" }] });
  });
  it("drops the status checks rule when the last check is removed", () => {
    let f = formFromRules(FULL);
    f = removeContext(removeContext(f, "lint"), "CI / build");
    expect(rulesFromForm(f, FULL).some((r) => r.type === "required_status_checks")).toBe(false);
  });
});

describe("form helpers", () => {
  it("adds a trimmed check once", () => {
    let f = addContext(clone(EMPTY_FORM), "  CI / build ");
    f = addContext(f, "CI / build");
    f = addContext(f, "   ");
    expect(f.checks.contexts).toEqual(["CI / build"]);
  });
  it("turning reviewers on starts at one reviewer, or keeps the count", () => {
    expect(setReviewersOn(clone(EMPTY_FORM), true).reviewers).toMatchObject({ on: true, count: 1 });
    const f = clone(EMPTY_FORM);
    f.reviewers.count = 3;
    expect(setReviewersOn(f, true).reviewers.count).toBe(3);
  });
  it("turning reviewers off turns off what lives in the same rule", () => {
    const f = setReviewersOn(formFromRules(FULL), false);
    expect(f.reviewers.on).toBe(false);
    expect(f.reviewers.codeOwners).toBe(false);
    expect(f.commentResolution).toBe(false);
    expect(f.mergeTypes.on).toBe(false);
    expect(f.blockForcePush).toBe(true);
  });
  it("turning on a pull request policy with reviewers off requires a pull request with no approval", () => {
    for (const k of ["commentResolution", "mergeTypes", "codeOwners"] as const) {
      const f = setPrPolicy(clone(EMPTY_FORM), k, true);
      expect(f.reviewers).toMatchObject({ on: true, count: 0 });
      expect(formFromRules(rulesFromForm(f))).toEqual(f);
    }
    const on = setReviewersOn(clone(EMPTY_FORM), true);
    expect(setPrPolicy(on, "commentResolution", true).reviewers.count).toBe(1);
    expect(setPrPolicy(on, "commentResolution", false).commentResolution).toBe(false);
  });
  it("finds a bad count and no merge type", () => {
    const f = setReviewersOn(clone(EMPTY_FORM), true);
    expect(formErrors(f)).toEqual([]);
    expect(formErrors({ ...f, reviewers: { ...f.reviewers, count: 11 } })).toHaveLength(1);
    expect(formErrors({ ...f, reviewers: { ...f.reviewers, count: 1.5 } })).toHaveLength(1);
    expect(formErrors({ ...f, mergeTypes: { on: true, methods: [] } })).toEqual(["Choose at least one merge type."]);
    expect(formErrors({ ...f, reviewers: { ...f.reviewers, on: false, count: 99 } })).toEqual([]);
  });
});

describe("changedPolicies", () => {
  const base = formFromRules(FULL);
  it("is empty for the same form", () => expect(changedPolicies(base, clone(base))).toEqual([]));
  it("names each changed policy", () => {
    const f = clone(base);
    f.reviewers.count = 3;
    f.blockForcePush = false;
    f.checks.strict = false;
    f.reviewers.codeOwners = false;
    expect(changedPolicies(base, f)).toEqual(["Minimum number of reviewers", "Build validation", "Code owners", "Block force pushes"]);
  });
  it("ignores merge method order and settings of a policy that stays off", () => {
    const f = clone(base);
    f.mergeTypes.methods = ["rebase", "squash"];
    expect(changedPolicies(base, f)).toEqual([]);
    const off = clone(EMPTY_FORM);
    const off2 = clone(EMPTY_FORM);
    off2.reviewers.count = 5;
    off2.mergeTypes.methods = ["merge"];
    off2.checks.strict = true;
    expect(changedPolicies(off, off2)).toEqual([]);
  });
});

describe("savePlan", () => {
  const rules: RulesetRule[] = [{ type: "deletion" }];
  it("creates the owned ruleset, active, on the one branch", () => {
    expect(savePlan(R, "release/1.0", null, rules)).toEqual({
      kind: "create",
      req: { method: "POST", path: "/repos/o/r/rulesets", body: { name: "Azure DevOps policies: release/1.0", target: "branch", enforcement: "active", conditions: { ref_name: { include: ["refs/heads/release/1.0"], exclude: [] } }, rules } },
    });
  });
  it("does nothing when there is nothing to create", () => expect(savePlan(R, "main", null, [])).toEqual({ kind: "none" }));
  it("replaces the rules of the existing ruleset, leaving enforcement alone", () => {
    const p = savePlan(R, "main", owned([], { enforcement: "evaluate" }), rules);
    expect(p.kind).toBe("update");
    if (p.kind !== "update") return;
    expect(p.req.method).toBe("PUT");
    expect(p.req.path).toBe("/repos/o/r/rulesets/7");
    expect(p.req.body).not.toHaveProperty("enforcement");
    expect(p.req.body).not.toHaveProperty("bypass_actors");
    expect(p.req.body!.rules).toBe(rules);
  });
  it("deletes the owned ruleset when nothing is left in it", () => {
    expect(savePlan(R, "main", owned(rules), [])).toEqual({ kind: "delete", req: { method: "DELETE", path: "/repos/o/r/rulesets/7" } });
  });
});

describe("lock", () => {
  it("reads the lock from the update rule", () => {
    expect(isLocked(owned(FULL))).toBe(true);
    expect(isLocked(owned([{ type: "deletion" }]))).toBe(false);
    expect(isLocked(null)).toBe(false);
  });
  it("creates the ruleset to lock a branch with none", () => {
    const p = lockPlan(R, "main", null, true);
    expect(p.kind).toBe("create");
    if (p.kind === "create") expect(p.req.body!.rules).toEqual([{ type: "update" }]);
  });
  it("adds the update rule beside the policies", () => {
    const p = lockPlan(R, "main", owned([{ type: "deletion" }]), true);
    expect(p.kind === "update" && p.req.body!.rules).toEqual([{ type: "deletion" }, { type: "update" }]);
  });
  it("removes it on unlock, deleting a ruleset that held only the lock", () => {
    const p = lockPlan(R, "main", owned([{ type: "deletion" }, { type: "update" }]), false);
    expect(p.kind === "update" && p.req.body!.rules).toEqual([{ type: "deletion" }]);
    expect(lockPlan(R, "main", owned([{ type: "update" }]), false).kind).toBe("delete");
  });
  it("does nothing when already in that state", () => {
    expect(lockPlan(R, "main", owned([{ type: "update" }]), true)).toEqual({ kind: "none" });
    expect(lockPlan(R, "main", null, false)).toEqual({ kind: "none" });
  });
});

describe("policyWriteError", () => {
  it("words 403 and 404 as missing admin rights, with GitHub's words", () => {
    expect(policyWriteError(403, "Resource not accessible by integration")).toEqual({ admin: true, text: "You need admin rights on this repository. GitHub said: Resource not accessible by integration" });
    expect(policyWriteError(404)).toEqual({ admin: true, text: "You need admin rights on this repository." });
  });
  it("gives GitHub's message for 422", () => {
    expect(policyWriteError(422, "Validation Failed: Name must be unique")).toEqual({ admin: false, text: "Validation Failed: Name must be unique" });
    expect(policyWriteError(422)?.admin).toBe(false);
  });
  it("leaves other failures to the generic error", () => expect(policyWriteError(500, "boom")).toBeNull());
});

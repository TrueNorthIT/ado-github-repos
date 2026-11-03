import { describe, it, expect } from "vitest";
import { classicState, hasPolicies, reviewerSummary, sourceHref, sourceText, toPolicies, EMPTY_POLICIES, type PolicySource } from "./branchPolicies";
import { parsePolicies, serializePolicies } from "./policyHash";
import { NASTY } from "./ciTestHelpers";

const REPO = "octo/demo";
const rs = (id: number, scope = "Repository") => ({ ruleset_id: id, ruleset_source_type: scope, ruleset_source: REPO });
const R12: PolicySource = { kind: "ruleset", id: 12, scope: "Repository" };
const CLASSIC: PolicySource = { kind: "classic" };

describe("toPolicies: ruleset rules", () => {
  it("is empty for no rules and no classic rule", () => {
    expect(toPolicies([], { t: "none" })).toEqual(EMPTY_POLICIES);
    expect(hasPolicies(toPolicies([], { t: "none" }))).toBe(false);
  });
  it("maps a pull_request rule to minimum reviewers, comment resolution and merge types", () => {
    const p = toPolicies([{ type: "pull_request", ...rs(12), parameters: { required_approving_review_count: 2, dismiss_stale_reviews_on_push: true, require_code_owner_review: true, require_last_push_approval: false, required_review_thread_resolution: true, allowed_merge_methods: ["squash"] } }], { t: "none" });
    expect(p.reviewers).toEqual({ count: 2, dismissStale: true, codeOwners: true, lastPushApproval: false, sources: [R12] });
    expect(p.commentResolution).toEqual([R12]);
    expect(p.mergeTypes).toEqual({ methods: ["squash"], linear: false, sources: [R12] });
  });
  it("does not limit merge types when every method is allowed", () => {
    const p = toPolicies([{ type: "pull_request", ...rs(12), parameters: { required_approving_review_count: 0, allowed_merge_methods: ["merge", "squash", "rebase"] } }], { t: "none" });
    expect(p.mergeTypes).toBeNull();
    expect(p.reviewers?.count).toBe(0);
  });
  it("maps required_status_checks to build validation rows, with strict as the expiration", () => {
    const p = toPolicies([{ type: "required_status_checks", ...rs(12), parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "ci/build" }, { context: "lint" }] } }], { t: "none" });
    expect(p.checks).toEqual([{ context: "ci/build", strict: true, source: R12 }, { context: "lint", strict: true, source: R12 }]);
  });
  it("turns required_linear_history into a merge type limit", () => {
    expect(toPolicies([{ type: "required_linear_history", ...rs(12) }], { t: "none" }).mergeTypes).toEqual({ methods: [], linear: true, sources: [R12] });
  });
  it("lists the GitHub-only rules under their ADO-style names, with parameters as detail", () => {
    const p = toPolicies([
      { type: "non_fast_forward", ...rs(12) },
      { type: "deletion", ...rs(12) },
      { type: "required_signatures", ...rs(7, "Organization") },
      { type: "required_deployments", ...rs(12), parameters: { required_deployment_environments: ["staging", "prod"] } },
      { type: "some_future_rule", ...rs(12) },
    ], { t: "none" });
    expect(p.other.map((o) => o.title)).toEqual(["Block force pushes", "Restrict deletions", "Require signed commits", "Require deployments to succeed", "Some future rule"]);
    expect(p.other[2].sources).toEqual([{ kind: "ruleset", id: 7, scope: "Organization" }]);
    expect(p.other[3].detail).toBe("staging, prod");
  });
  it("merges rules of one kind: highest count, any flag, methods both allow, each check once", () => {
    const p = toPolicies([
      { type: "pull_request", ...rs(12), parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, allowed_merge_methods: ["squash", "rebase"] } },
      { type: "pull_request", ...rs(13), parameters: { required_approving_review_count: 3, allowed_merge_methods: ["squash", "merge"] } },
      { type: "required_status_checks", ...rs(12), parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: "a" }] } },
      { type: "required_status_checks", ...rs(13), parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "a" }, { context: "b" }] } },
    ], { t: "none" });
    expect(p.reviewers?.count).toBe(3);
    expect(p.reviewers?.dismissStale).toBe(true);
    expect(p.reviewers?.sources.length).toBe(2);
    expect(p.mergeTypes?.methods).toEqual(["squash"]);
    expect(p.checks.map((c) => [c.context, c.strict])).toEqual([["a", true], ["b", true]]);
  });
  it("survives junk", () => {
    expect(toPolicies(null as any, { t: "none" })).toEqual(EMPTY_POLICIES);
    expect(toPolicies([null, {}, { type: 3 }] as any, { t: "none" })).toEqual(EMPTY_POLICIES);
  });
});

describe("toPolicies: classic protection", () => {
  const body = {
    required_status_checks: { strict: true, contexts: ["old"], checks: [{ context: "ci/build" }] },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: false, require_code_owner_reviews: true, require_last_push_approval: true },
    required_conversation_resolution: { enabled: true },
    required_linear_history: { enabled: false },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: true },
    required_signatures: { enabled: true },
  };
  it("maps the readable rule", () => {
    const p = toPolicies([], { t: "read", body });
    expect(p.reviewers).toEqual({ count: 1, dismissStale: false, codeOwners: true, lastPushApproval: true, sources: [CLASSIC] });
    expect(p.commentResolution).toEqual([CLASSIC]);
    expect(p.mergeTypes).toBeNull();
    expect(p.checks).toEqual([{ context: "ci/build", strict: true, source: CLASSIC }]);
    expect(p.other.map((o) => o.id)).toEqual(["non_fast_forward", "required_signatures", "enforce_admins"]);
  });
  it("falls back to the older contexts list", () => {
    expect(toPolicies([], { t: "read", body: { required_status_checks: { strict: false, contexts: ["x"] } } }).checks.map((c) => c.context)).toEqual(["x"]);
  });
  it("combines with ruleset rules", () => {
    const p = toPolicies([{ type: "pull_request", ...rs(12), parameters: { required_approving_review_count: 2 } }], { t: "read", body });
    expect(p.reviewers?.count).toBe(2);
    expect(p.reviewers?.sources).toEqual([R12, CLASSIC]);
  });
  it("when denied, lists the required checks readers see on the branch", () => {
    const branch = { protected: true, protection: { enabled: true, required_status_checks: { enforcement_level: "non_admins", contexts: ["ci/build"], checks: [{ context: "ci/build" }] } } };
    expect(toPolicies([], { t: "denied" }, branch).checks).toEqual([{ context: "ci/build", strict: null, source: CLASSIC }]);
    expect(toPolicies([], { t: "denied" }, { protection: { required_status_checks: { enforcement_level: "off", contexts: ["x"] } } }).checks).toEqual([]);
  });
});

describe("classicState", () => {
  it("reads 200 as the rule", () => expect(classicState({ ok: true, body: { a: 1 } }, true)).toEqual({ t: "read", body: { a: 1 } }));
  it("reads 404 on an unprotected branch as none", () => expect(classicState({ ok: false, status: 404 }, false)).toEqual({ t: "none" }));
  it("reads 404 on a protected branch, and 403, as needing admin", () => {
    expect(classicState({ ok: false, status: 404 }, true)).toEqual({ t: "denied" });
    expect(classicState({ ok: false, status: 403 }, false)).toEqual({ t: "denied" });
  });
});

describe("wording and links", () => {
  it("names sources", () => {
    expect(sourceText(R12)).toBe("Ruleset 12");
    expect(sourceText({ kind: "ruleset", id: 7, scope: "Organization" })).toBe("Organisation ruleset 7");
    expect(sourceText(CLASSIC)).toBe("Branch protection rule");
  });
  it("links each source to where it is edited", () => {
    expect(sourceHref(REPO, R12)).toBe("https://github.com/octo/demo/rules/12");
    expect(sourceHref(REPO, { kind: "ruleset", id: 7, scope: "Organization" })).toBe("https://github.com/octo/demo/settings/rules");
    expect(sourceHref(REPO, CLASSIC)).toBe("https://github.com/octo/demo/settings/branches");
  });
  it("says how many reviews are needed", () => {
    const base = { dismissStale: false, codeOwners: false, lastPushApproval: false, sources: [] };
    expect(reviewerSummary({ ...base, count: 1 })).toMatch(/1 approving review before/);
    expect(reviewerSummary({ ...base, count: 2 })).toMatch(/2 approving reviews/);
    expect(reviewerSummary({ ...base, count: 0 })).toMatch(/No approval is required/);
  });
});

describe("policyHash", () => {
  it("writes repo, view=policies and polBranch", () => {
    expect(serializePolicies({ repo: REPO, branch: "release/1.0" })).toBe("#repo=octo%2Fdemo&view=policies&polBranch=release%2F1.0");
  });
  it("round trips awkward branch names", () => {
    for (const v of NASTY) {
      if (!v.trim()) continue;
      const s = { repo: REPO, branch: v.trim() };
      expect(parsePolicies(serializePolicies(s)), v).toEqual(s);
    }
  });
  it("is null without the view, a valid repo or a branch", () => {
    expect(parsePolicies("#repo=octo%2Fdemo&polBranch=main")).toBeNull();
    expect(parsePolicies("#repo=..%2Fx&view=policies&polBranch=main")).toBeNull();
    expect(parsePolicies("#repo=octo%2Fdemo&view=policies")).toBeNull();
    expect(parsePolicies("%E0%A4%A")).toBeNull();
  });
});

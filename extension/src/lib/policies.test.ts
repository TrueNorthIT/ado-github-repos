import { describe, it, expect } from "vitest";
import { policyRows, mergeDecision, type PolicyInput, type CheckContext, type PolicyRow } from "./policies";

// Module under test: src/lib/policies.ts (policyRows, mergeDecision). Requirement A-3: "Can it merge? / policies panel".
// GitHub names: PullRequest.mergeStateStatus (MergeStateStatus: CLEAN, HAS_HOOKS, UNSTABLE, BLOCKED, BEHIND, DIRTY, UNKNOWN),
// PullRequest.reviewDecision (PullRequestReviewDecision: APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or null),
// statusCheckRollup.contexts (CheckRun { name status conclusion detailsUrl isRequired }, StatusContext { context state targetUrl isRequired }),
// PullRequest.autoMergeRequest and Repository.autoMergeAllowed. The current schema has no DRAFT merge state; isDraft is authoritative
// and a "DRAFT" status string is treated the same.
//
// Decisions fixed by these tests (the brief left them open):
//  ROWS
//  - reviews: one row (kind "reviews", required: true, a non-empty detail) when reviewDecision is non-null:
//    APPROVED -> success, CHANGES_REQUESTED -> failure, REVIEW_REQUIRED -> pending. No row when it is null (no review policy).
//  - conflicts: a required row whose title mentions "conflict": DIRTY -> failure, UNKNOWN -> pending, any other status except DRAFT -> success.
//    (A draft's conflict state is not reported, so no row.)
//  - behind: a required row (title mentions "behind" or "up to date") with state failure, only when mergeStateStatus is BEHIND.
//  - draft: a required row (title mentions "draft") with state pending, only when the PR is a draft.
//  - check: one row per context, title = CheckRun.name or StatusContext.context, required = isRequired, url = detailsUrl / targetUrl
//    (the key is absent when GitHub sends null). State mapping:
//      CheckRun not COMPLETED (QUEUED, IN_PROGRESS, WAITING, PENDING, REQUESTED) -> pending
//      CheckRun COMPLETED: SUCCESS -> success; NEUTRAL, SKIPPED -> neutral; FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED -> failure
//      StatusContext: SUCCESS -> success; FAILURE, ERROR -> failure; PENDING, EXPECTED -> pending
//  - sorting, over ALL rows: required before optional; within each group failure, then pending, then success; stable otherwise (input order).
//  DECISION
//  - CLOSED or MERGED: primaryAction "none", canComplete false, canAutoComplete false, no blockers.
//  - open draft (isDraft, or status "DRAFT"): primaryAction "publish", cannot complete or auto-complete, a blocker mentioning "draft".
//  - open, not draft: GitHub's mergeStateStatus is authoritative. CLEAN, HAS_HOOKS and UNSTABLE -> canComplete, primaryAction "complete", no blockers,
//    canAutoComplete false (native shows Complete, not Set auto-complete).
//    BLOCKED and BEHIND -> cannot complete; canAutoComplete and primaryAction "autoComplete" when autoMergeAllowed, otherwise "none".
//    DIRTY and UNKNOWN -> cannot complete, cannot auto-complete, primaryAction "none".
//  - blockers: the title of each REQUIRED row that is not success or neutral, plus a "conflicts"/"behind" row when applicable; when the state is
//    blocked but every row passes (other branch protection), a single generic blocker so the list is never empty.
//  - autoCompleteEnabled (an addition to the brief's shape) is true when autoMergeRequest is set. It never changes canComplete, but once
//    auto-complete is enabled canAutoComplete is false and primaryAction is "none" for a blocked PR (the UI offers Cancel auto-complete instead).

const checkRun = (name: string, status: string, conclusion: string | null, over: Partial<Extract<CheckContext, { __typename: "CheckRun" }>> = {}): CheckContext => ({
  __typename: "CheckRun",
  name,
  status,
  conclusion,
  detailsUrl: null,
  isRequired: false,
  ...over,
});
const statusCtx = (context: string, state: string, over: Partial<Extract<CheckContext, { __typename: "StatusContext" }>> = {}): CheckContext => ({
  __typename: "StatusContext",
  context,
  state,
  targetUrl: null,
  isRequired: false,
  ...over,
});
const input = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  state: "OPEN",
  isDraft: false,
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  checks: [],
  autoMergeAllowed: false,
  autoMergeRequest: null,
  ...over,
});
const rows = (over: Partial<PolicyInput> = {}) => policyRows(input(over));
const ofKind = (r: PolicyRow[], kind: PolicyRow["kind"]) => r.filter((x) => x.kind === kind);
const rank = { failure: 0, pending: 1, success: 2, neutral: 2 } as const;

describe("A-3: reviews row from reviewDecision", () => {
  it.each([
    ["APPROVED", "success"],
    ["CHANGES_REQUESTED", "failure"],
    ["REVIEW_REQUIRED", "pending"],
  ] as const)("%s -> a required reviews row in state %s with a detail", (decision, state) => {
    const r = ofKind(rows({ reviewDecision: decision }), "reviews");
    expect(r, `Expected exactly one reviews row for ${decision}`).toHaveLength(1);
    expect(r[0].state, `Expected ${decision} to map to ${state}`).toBe(state);
    expect(r[0].required, "Expected the reviews policy to be required").toBe(true);
    expect((r[0].detail ?? "").length, "Expected a human detail").toBeGreaterThan(0);
    expect(r[0].title, "Expected the title to mention reviews").toMatch(/review/i);
  });

  it("has no reviews row when reviewDecision is null (no review policy)", () => {
    expect(ofKind(rows({ reviewDecision: null }), "reviews"), "Expected no reviews row").toHaveLength(0);
  });
});

describe("A-3: conflicts, behind and draft rows from mergeStateStatus and isDraft", () => {
  it("DIRTY -> a required failing conflicts row", () => {
    const r = ofKind(rows({ mergeStateStatus: "DIRTY" }), "conflicts");
    expect(r, "Expected one conflicts row").toHaveLength(1);
    expect(r[0], "Expected a required failure titled with 'conflict'").toMatchObject({ state: "failure", required: true });
    expect(r[0].title, "Expected the title to mention conflicts").toMatch(/conflict/i);
  });

  it.each(["CLEAN", "HAS_HOOKS", "UNSTABLE", "BLOCKED", "BEHIND"])("%s -> a required passing conflicts row", (status) => {
    const r = ofKind(rows({ mergeStateStatus: status }), "conflicts");
    expect(r, `Expected one conflicts row for ${status}`).toHaveLength(1);
    expect(r[0], `Expected ${status} to report no conflicts`).toMatchObject({ state: "success", required: true });
  });

  it("UNKNOWN -> a pending conflicts row (GitHub is still working it out)", () => {
    expect(ofKind(rows({ mergeStateStatus: "UNKNOWN" }), "conflicts")[0], "Expected pending while mergeability is unknown").toMatchObject({ state: "pending", required: true });
  });

  it("BEHIND -> a required failing behind row", () => {
    const r = ofKind(rows({ mergeStateStatus: "BEHIND" }), "behind");
    expect(r, "Expected one behind row").toHaveLength(1);
    expect(r[0], "Expected a required failure").toMatchObject({ state: "failure", required: true });
    expect(r[0].title, "Expected the title to mention being behind / up to date").toMatch(/behind|up to date/i);
  });

  it.each(["CLEAN", "HAS_HOOKS", "UNSTABLE", "BLOCKED", "DIRTY", "UNKNOWN"])("%s -> no behind row", (status) => {
    expect(ofKind(rows({ mergeStateStatus: status }), "behind"), `Expected no behind row for ${status}`).toHaveLength(0);
  });

  it("a draft pull request -> a required pending draft row", () => {
    const r = ofKind(rows({ isDraft: true, mergeStateStatus: "BLOCKED" }), "draft");
    expect(r, "Expected one draft row").toHaveLength(1);
    expect(r[0], "Expected a required pending row").toMatchObject({ state: "pending", required: true });
    expect(r[0].title, "Expected the title to mention draft").toMatch(/draft/i);
  });

  it("a non-draft pull request has no draft row", () => {
    expect(ofKind(rows({ isDraft: false }), "draft"), "Expected no draft row").toHaveLength(0);
  });

  it("a draft pull request reports no conflicts row (its conflict state is not reported)", () => {
    expect(ofKind(rows({ isDraft: true, mergeStateStatus: "DRAFT" }), "conflicts"), "Expected no conflicts row for a draft").toHaveLength(0);
  });
});

describe("A-3: a check row per rollup context", () => {
  const checks = (...c: CheckContext[]) => ofKind(rows({ checks: c }), "check");

  it.each([
    ["SUCCESS", "success"],
    ["NEUTRAL", "neutral"],
    ["SKIPPED", "neutral"],
    ["FAILURE", "failure"],
    ["CANCELLED", "failure"],
    ["TIMED_OUT", "failure"],
    ["ACTION_REQUIRED", "failure"],
  ] as const)("a COMPLETED CheckRun concluding %s -> %s", (conclusion, state) => {
    expect(checks(checkRun("build", "COMPLETED", conclusion))[0]?.state, `Expected conclusion ${conclusion} to map to ${state}`).toBe(state);
  });

  it.each(["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"])("a CheckRun with status %s (not yet completed) -> pending", (status) => {
    expect(checks(checkRun("build", status, null))[0]?.state, `Expected status ${status} to be pending`).toBe("pending");
  });

  it.each([
    ["SUCCESS", "success"],
    ["FAILURE", "failure"],
    ["ERROR", "failure"],
    ["PENDING", "pending"],
    ["EXPECTED", "pending"],
  ] as const)("a StatusContext in state %s -> %s", (state, expected) => {
    expect(checks(statusCtx("ci/legacy", state))[0]?.state, `Expected StatusContext ${state} to map to ${expected}`).toBe(expected);
  });

  it("titles a CheckRun by name and a StatusContext by context", () => {
    const r = checks(checkRun("unit tests", "COMPLETED", "SUCCESS"), statusCtx("ci/legacy", "SUCCESS"));
    expect(r.map((x) => x.title).sort(), "Expected one row titled by name and one by context").toEqual(["ci/legacy", "unit tests"]);
  });

  it("carries isRequired into required", () => {
    const r = checks(checkRun("must", "COMPLETED", "SUCCESS", { isRequired: true }), checkRun("nice", "COMPLETED", "SUCCESS", { isRequired: false }), statusCtx("ctx", "SUCCESS", { isRequired: true }));
    const by = Object.fromEntries(r.map((x) => [x.title, x.required]));
    expect(by, "Expected required to follow isRequired for both context types").toEqual({ must: true, nice: false, ctx: true });
  });

  it("carries detailsUrl / targetUrl into url, and omits url when GitHub sends null", () => {
    const r = checks(
      checkRun("a", "COMPLETED", "SUCCESS", { detailsUrl: "https://example.test/runs/1" }),
      statusCtx("b", "SUCCESS", { targetUrl: "https://example.test/status/2" }),
      checkRun("c", "COMPLETED", "SUCCESS", { detailsUrl: null }),
      statusCtx("d", "SUCCESS", { targetUrl: null }),
    );
    const by = Object.fromEntries(r.map((x) => [x.title, x.url]));
    expect(by, "Expected urls for a and b, undefined for c and d").toEqual({ a: "https://example.test/runs/1", b: "https://example.test/status/2", c: undefined, d: undefined });
  });

  it("produces no check rows when the head commit has no contexts", () => {
    expect(checks(), "Expected no check rows").toHaveLength(0);
  });
});

describe("A-3: row ordering", () => {
  it("sorts required checks first, then by failure, pending, success", () => {
    const r = ofKind(
      rows({
        checks: [
          checkRun("opt-ok", "COMPLETED", "SUCCESS"),
          checkRun("opt-fail", "COMPLETED", "FAILURE"),
          checkRun("req-ok", "COMPLETED", "SUCCESS", { isRequired: true }),
          statusCtx("opt-pending", "PENDING"),
          checkRun("req-pending", "IN_PROGRESS", null, { isRequired: true }),
          checkRun("req-fail", "COMPLETED", "TIMED_OUT", { isRequired: true }),
        ],
      }),
      "check",
    ).map((x) => x.title);
    expect(r, "Expected required (failure, pending, success) then optional (failure, pending, success)").toEqual(["req-fail", "req-pending", "req-ok", "opt-fail", "opt-pending", "opt-ok"]);
  });

  it("keeps input order between rows of the same requirement and state", () => {
    const r = ofKind(rows({ checks: [checkRun("b", "COMPLETED", "SUCCESS"), checkRun("a", "COMPLETED", "SUCCESS"), checkRun("c", "COMPLETED", "SUCCESS")] }), "check").map((x) => x.title);
    expect(r, "Expected a stable sort").toEqual(["b", "a", "c"]);
  });

  it("applies the same ordering to every row kind, not just checks", () => {
    const all = rows({
      mergeStateStatus: "BEHIND",
      reviewDecision: "APPROVED",
      checks: [checkRun("opt-fail", "COMPLETED", "FAILURE"), checkRun("req-ok", "COMPLETED", "SUCCESS", { isRequired: true })],
    });
    const firstOptional = all.findIndex((x) => !x.required);
    expect(firstOptional, "Expected an optional row in the list").toBeGreaterThan(-1);
    expect(all.slice(firstOptional).every((x) => !x.required), "Expected every required row before every optional row").toBe(true);
    const requiredRanks = all.filter((x) => x.required).map((x) => rank[x.state]);
    expect(requiredRanks, "Expected the required rows ordered failure, pending, success").toEqual([...requiredRanks].sort((a, b) => a - b));
  });
});

describe("A-3: mergeDecision for closed, merged and draft pull requests", () => {
  it.each(["CLOSED", "MERGED"] as const)("a %s pull request gets primaryAction none whatever GitHub says", (state) => {
    const d = mergeDecision(input({ state, mergeStateStatus: "CLEAN", autoMergeAllowed: true }));
    expect(d, `Expected nothing to do for a ${state} PR`).toMatchObject({ canComplete: false, canAutoComplete: false, primaryAction: "none", blockers: [] });
  });

  it.each([
    ["isDraft with BLOCKED", { isDraft: true, mergeStateStatus: "BLOCKED" }],
    ["isDraft with CLEAN", { isDraft: true, mergeStateStatus: "CLEAN" }],
    ["isDraft with the legacy DRAFT status", { isDraft: true, mergeStateStatus: "DRAFT" }],
    ["the legacy DRAFT status alone", { isDraft: false, mergeStateStatus: "DRAFT" }],
  ] as const)("a draft (%s) gets primaryAction publish and cannot complete", (_n, over) => {
    const d = mergeDecision(input({ ...over, autoMergeAllowed: true }));
    expect(d, "Expected Publish as the primary action for a draft").toMatchObject({ canComplete: false, canAutoComplete: false, primaryAction: "publish" });
    expect(d.blockers.some((b) => /draft/i.test(b)), "Expected a blocker that mentions the draft").toBe(true);
  });
});

describe("A-3: mergeDecision for an open pull request follows mergeStateStatus", () => {
  it.each(["CLEAN", "HAS_HOOKS", "UNSTABLE"])("%s -> canComplete, primaryAction complete, no blockers (auto-merge not offered)", (status) => {
    for (const autoMergeAllowed of [false, true]) {
      const d = mergeDecision(input({ mergeStateStatus: status, autoMergeAllowed }));
      expect(d, `Expected ${status} (autoMergeAllowed ${autoMergeAllowed}) to be completable now`).toMatchObject({ canComplete: true, canAutoComplete: false, primaryAction: "complete", blockers: [] });
    }
  });

  it.each(["BLOCKED", "BEHIND"])("%s with auto-merge allowed -> Set auto-complete", (status) => {
    const d = mergeDecision(input({ mergeStateStatus: status, autoMergeAllowed: true }));
    expect(d, `Expected ${status} to offer auto-complete when the repository allows auto-merge`).toMatchObject({ canComplete: false, canAutoComplete: true, primaryAction: "autoComplete" });
    expect(d.blockers.length, "Expected at least one blocker").toBeGreaterThan(0);
  });

  it.each(["BLOCKED", "BEHIND"])("%s with auto-merge not allowed -> primaryAction none", (status) => {
    const d = mergeDecision(input({ mergeStateStatus: status, autoMergeAllowed: false }));
    expect(d, `Expected ${status} to offer nothing when the repository forbids auto-merge`).toMatchObject({ canComplete: false, canAutoComplete: false, primaryAction: "none" });
    expect(d.blockers.length, "Expected at least one blocker").toBeGreaterThan(0);
  });

  it.each(["DIRTY", "UNKNOWN"])("%s -> nothing to do, even when auto-merge is allowed", (status) => {
    const d = mergeDecision(input({ mergeStateStatus: status, autoMergeAllowed: true }));
    expect(d, `Expected ${status} to offer neither complete nor auto-complete`).toMatchObject({ canComplete: false, canAutoComplete: false, primaryAction: "none" });
    expect(d.blockers.length, "Expected at least one blocker").toBeGreaterThan(0);
  });

  it("DIRTY lists the merge conflicts as a blocker", () => {
    const d = mergeDecision(input({ mergeStateStatus: "DIRTY" }));
    expect(d.blockers.some((b) => /conflict/i.test(b)), "Expected a blocker that mentions conflicts").toBe(true);
  });

  it("BEHIND lists the out-of-date branch as a blocker", () => {
    const d = mergeDecision(input({ mergeStateStatus: "BEHIND" }));
    expect(d.blockers.some((b) => /behind|up to date/i.test(b)), "Expected a blocker that mentions being behind the base").toBe(true);
  });
});

describe("A-3: mergeDecision blockers name the unmet required policies", () => {
  it("lists each required failing or pending check by title, and the review row, but not optional or passing ones", () => {
    const d = mergeDecision(
      input({
        mergeStateStatus: "BLOCKED",
        reviewDecision: "REVIEW_REQUIRED",
        checks: [
          checkRun("req-fail", "COMPLETED", "FAILURE", { isRequired: true }),
          checkRun("req-pending", "QUEUED", null, { isRequired: true }),
          checkRun("req-ok", "COMPLETED", "SUCCESS", { isRequired: true }),
          checkRun("opt-fail", "COMPLETED", "FAILURE", { isRequired: false }),
        ],
      }),
    );
    const mentions = (t: string) => d.blockers.some((b) => b.includes(t));
    expect(mentions("req-fail"), "Expected the required failing check as a blocker").toBe(true);
    expect(mentions("req-pending"), "Expected the required pending check as a blocker").toBe(true);
    expect(d.blockers.some((b) => /review/i.test(b)), "Expected the outstanding review as a blocker").toBe(true);
    expect(mentions("req-ok"), "Expected the passing required check not to be a blocker").toBe(false);
    expect(mentions("opt-fail"), "Expected an optional failing check not to be a blocker").toBe(false);
  });

  it("lists changes requested as a blocker", () => {
    const d = mergeDecision(input({ mergeStateStatus: "BLOCKED", reviewDecision: "CHANGES_REQUESTED" }));
    expect(d.blockers.some((b) => /review|changes/i.test(b)), "Expected the requested changes as a blocker").toBe(true);
  });

  it("gives a generic blocker when GitHub blocks the merge but every row passes (other branch protection)", () => {
    const d = mergeDecision(input({ mergeStateStatus: "BLOCKED", reviewDecision: "APPROVED", checks: [checkRun("req-ok", "COMPLETED", "SUCCESS", { isRequired: true })] }));
    expect(d.blockers.length, "Expected a non-empty blockers list so the UI can say why").toBeGreaterThan(0);
    expect(d.blockers.every((b) => b.trim().length > 0), "Expected every blocker to be a non-empty string").toBe(true);
  });

  it("has no blockers when the pull request can be completed", () => {
    expect(mergeDecision(input({ mergeStateStatus: "UNSTABLE", checks: [checkRun("opt-fail", "COMPLETED", "FAILURE")] })).blockers, "Expected an optional failure not to block an UNSTABLE merge").toEqual([]);
  });
});

describe("A-3: auto-complete already enabled", () => {
  it("reports autoCompleteEnabled true when autoMergeRequest is set, and false otherwise", () => {
    expect(mergeDecision(input({ mergeStateStatus: "BLOCKED", autoMergeAllowed: true, autoMergeRequest: { mergeMethod: "SQUASH" } })).autoCompleteEnabled, "Expected true with an autoMergeRequest").toBe(true);
    expect(mergeDecision(input({ mergeStateStatus: "BLOCKED", autoMergeAllowed: true, autoMergeRequest: null })).autoCompleteEnabled, "Expected false without one").toBe(false);
  });

  it("does not offer Set auto-complete again once it is enabled", () => {
    const d = mergeDecision(input({ mergeStateStatus: "BLOCKED", autoMergeAllowed: true, autoMergeRequest: { mergeMethod: "SQUASH" } }));
    expect(d, "Expected auto-complete not to be offered a second time").toMatchObject({ canComplete: false, canAutoComplete: false, primaryAction: "none" });
  });

  it("still lets a clean pull request be completed by hand while auto-complete is enabled", () => {
    const d = mergeDecision(input({ mergeStateStatus: "CLEAN", autoMergeRequest: { mergeMethod: "MERGE" } }));
    expect(d, "Expected CLEAN to remain completable").toMatchObject({ canComplete: true, primaryAction: "complete", autoCompleteEnabled: true });
  });
});

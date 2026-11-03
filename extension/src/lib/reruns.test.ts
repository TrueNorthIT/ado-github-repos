import { describe, it, expect } from "vitest";
import { rerunChecksQuery, rerunFailedJobsRequest, rerunAllRequest, rerunTargets, checkRerun, type RerunCheck } from "./reruns";
import { expectNotInQuery, expectPrQuery, norm, NASTY } from "./ciTestHelpers";

// Module under test: src/lib/reruns.ts (rerunChecksQuery, rerunFailedJobsRequest, rerunAllRequest, rerunTargets, checkRerun).
// Requirement CI-2: "Re-run failed checks": for a CheckRun belonging to a GitHub Actions workflow run (checkSuite.workflowRun.databaseId) build
// REST POST /repos/{o}/{r}/actions/runs/{run_id}/rerun-failed-jobs, plus "re-run all" (/rerun); offered only when the run has at least one failed
// or cancelled job and is completed; non-Actions checks (third-party apps or status contexts) cannot be re-run, with a reason given;
// de-duplicate run ids across checks, so one button re-runs a workflow once.
//
// Decisions fixed by these tests:
//  - REST paths come from the OpenAPI spec (operations actions/re-run-workflow-failed-jobs and actions/re-run-workflow): POST, no body (201, empty).
//  - "failed" is a job conclusion of FAILURE, CANCELLED or TIMED_OUT. Jobs that are SUCCESS, SKIPPED, NEUTRAL or ACTION_REQUIRED are not failed.
//  - "completed" means every CheckRun of the run has status COMPLETED; a queued or in-progress sibling job holds the whole run back.
//  - both buttons share one gate (the run's target): re-run all is not offered on a run with no failed job either.
//  - a passing job of a run that has a failed job can be re-run (it shares the run's buttons); a StatusContext, or a CheckRun with no workflowRun, cannot, with a reason.

const job = (name: string, conclusion: string | null, runId: number | null = 100, over: Partial<Extract<RerunCheck, { __typename: "CheckRun" }>> = {}): RerunCheck => ({
  __typename: "CheckRun",
  name,
  status: conclusion === null ? "IN_PROGRESS" : "COMPLETED",
  conclusion,
  checkSuite: runId === null ? { workflowRun: null } : { workflowRun: { databaseId: runId, workflow: { name: "CI" } } },
  ...over,
});
const ctx = (context: string): RerunCheck => ({ __typename: "StatusContext", context });

describe("CI-2: rerunChecksQuery fetches the workflow run id of each check", () => {
  it("takes { owner, name, number } as variables on repository.pullRequest", () => {
    const req = rerunChecksQuery({ owner: "octo", name: "repo", number: 3 });
    expectPrQuery(req);
    expect(req.variables, "Expected variables { owner, name, number } and nothing else").toEqual({ owner: "octo", name: "repo", number: 3 });
  });

  it("selects name, status, conclusion and checkSuite { workflowRun { databaseId workflow { name } } } per CheckRun, and context per StatusContext", () => {
    const q = norm(rerunChecksQuery({ owner: "o", name: "r", number: 1 }).query);
    expect(q, "Expected the head commit's statusCheckRollup contexts").toMatch(/statusCheckRollup\s*\{\s*contexts\(/);
    expect(q, "Expected CheckRun fields name, status and conclusion").toMatch(/\.\.\.\s*on CheckRun\s*\{[^]*\bname\b[^]*\bstatus\b[^]*\bconclusion\b/);
    expect(q, "Expected checkSuite { workflowRun { databaseId ... } } (actionsQuery.ts does not select databaseId)").toMatch(/checkSuite\s*\{\s*workflowRun\s*\{[^}]*\bdatabaseId\b/);
    expect(q, "Expected workflow { name } for the button label").toMatch(/workflow\s*\{\s*name\s*\}/);
    expect(q, "Expected ... on StatusContext { context }").toMatch(/\.\.\.\s*on StatusContext\s*\{[^}]*\bcontext\b/);
  });

  it.each(NASTY)("keeps %j out of the query text", (v) => {
    const req = rerunChecksQuery({ owner: v, name: v, number: 1 });
    expectNotInQuery(req, [v]);
    expect(req.variables, "Expected the awkward owner and name to travel in variables").toMatchObject({ owner: v, name: v });
  });
});

describe("CI-2: the REST requests for re-running a workflow run", () => {
  // Given repo "octo/repo" and run 4242, the failed-jobs request is POST /repos/octo/repo/actions/runs/4242/rerun-failed-jobs with no body.
  it("builds POST .../actions/runs/{run_id}/rerun-failed-jobs with no body", () => {
    expect(rerunFailedJobsRequest("octo/repo", 4242), "Expected a bodiless POST to the rerun-failed-jobs endpoint").toEqual({ method: "POST", path: "/repos/octo/repo/actions/runs/4242/rerun-failed-jobs" });
  });

  it("builds POST .../actions/runs/{run_id}/rerun with no body for re-run all", () => {
    expect(rerunAllRequest("octo/repo", 4242), "Expected a bodiless POST to the rerun endpoint").toEqual({ method: "POST", path: "/repos/octo/repo/actions/runs/4242/rerun" });
  });
});

describe("CI-2: rerunTargets offers a run only when it is completed and has a failed or cancelled job", () => {
  // Given a completed run with one failed job, there is one target naming the run and the failed job.
  it("offers a completed run with a failed job", () => {
    expect(rerunTargets([job("build", "SUCCESS"), job("test", "FAILURE")]), "Expected run 100 to be offered with test as its failed job").toEqual([
      { runId: 100, workflowName: "CI", failedJobs: ["test"] },
    ]);
  });

  it.each(["FAILURE", "CANCELLED", "TIMED_OUT"])("treats a %s job as failed", (conclusion) => {
    expect(rerunTargets([job("test", conclusion)]).map((t) => t.failedJobs), `Expected a ${conclusion} job to make the run re-runnable`).toEqual([["test"]]);
  });

  it.each(["SUCCESS", "SKIPPED", "NEUTRAL", "ACTION_REQUIRED"])("does not offer a run whose only non-passing job is %s", (conclusion) => {
    expect(rerunTargets([job("a", "SUCCESS"), job("b", conclusion)]), `Expected no target when no job failed (a ${conclusion} job does not count)`).toEqual([]);
  });

  it("does not offer a run that is still in progress, even when one job has already failed", () => {
    expect(rerunTargets([job("test", "FAILURE"), job("deploy", null)]), "Expected no target while a job of the run is still running").toEqual([]);
  });

  it("lists every failed job of the run, in input order", () => {
    expect(rerunTargets([job("a", "FAILURE"), job("b", "SUCCESS"), job("c", "CANCELLED")])[0].failedJobs, "Expected failedJobs [a, c]").toEqual(["a", "c"]);
  });

  it("uses an empty workflow name when GitHub sends none", () => {
    const c = job("test", "FAILURE", 100, { checkSuite: { workflowRun: { databaseId: 100, workflow: null } } });
    expect(rerunTargets([c])[0].workflowName, "Expected an empty workflowName when workflow is null").toBe("");
  });
});

describe("CI-2: one run id gives one button, however many checks belong to it", () => {
  // Given three jobs of run 100 that all failed, there is a single target, so the workflow is re-run once.
  it("de-duplicates run ids across checks", () => {
    const targets = rerunTargets([job("a", "FAILURE"), job("b", "FAILURE"), job("c", "CANCELLED")]);
    expect(targets.map((t) => t.runId), "Expected one target for run 100, not one per failed job").toEqual([100]);
  });

  it("keeps separate runs separate, in order of first appearance", () => {
    const targets = rerunTargets([job("x", "FAILURE", 300), job("y", "FAILURE", 200), job("z", "FAILURE", 300)]);
    expect(targets.map((t) => t.runId), "Expected runs 300 then 200").toEqual([300, 200]);
    expect(targets[0].failedJobs, "Expected run 300 to list both its failed jobs").toEqual(["x", "z"]);
  });

  it("offers a failed run next to a passing run only for the failed one", () => {
    expect(rerunTargets([job("ok", "SUCCESS", 1), job("bad", "FAILURE", 2)]).map((t) => t.runId), "Expected only run 2").toEqual([2]);
  });
});

describe("CI-2: checkRerun says whether re-running is offered on one check, and why not", () => {
  it("offers the failed job of a re-runnable run, with its run id", () => {
    const failed = job("test", "FAILURE");
    expect(checkRerun(failed, [failed]), "Expected the failed job to offer re-run of run 100").toEqual({ canRerun: true, runId: 100 });
  });

  it("offers a passing job whose run has a failed job, because the buttons act on the whole run", () => {
    const ok = job("build", "SUCCESS");
    expect(checkRerun(ok, [ok, job("test", "FAILURE")]), "Expected the passing job to share its run's re-run").toEqual({ canRerun: true, runId: 100 });
  });

  it("says a status context cannot be re-run, with a reason", () => {
    const r = checkRerun(ctx("ci/legacy"), [ctx("ci/legacy")]);
    expect(r.canRerun, "Expected a status context to be not re-runnable").toBe(false);
    expect(r.canRerun === false && r.reason, "Expected a reason that names GitHub Actions").toMatch(/GitHub Actions/i);
  });

  it("says a check run from a third-party app (no workflow run) cannot be re-run, with a reason", () => {
    const c = job("sonar", "FAILURE", null);
    const r = checkRerun(c, [c]);
    expect(r.canRerun, "Expected a check run with no workflow run to be not re-runnable").toBe(false);
    expect(r.canRerun === false && r.reason, "Expected a reason that names GitHub Actions").toMatch(/GitHub Actions/i);
  });

  it("says a run still in progress cannot be re-run yet, with a reason that mentions it", () => {
    const running = job("deploy", null);
    const r = checkRerun(running, [job("test", "FAILURE"), running]);
    expect(r.canRerun, "Expected no re-run while the run is in progress").toBe(false);
    expect(r.canRerun === false && r.reason, "Expected a reason saying the run is still running or in progress").toMatch(/in progress|running|not (yet )?(finished|complete)/i);
  });

  it("says a run with no failed job has nothing to re-run, with a reason that mentions it", () => {
    const ok = job("build", "SUCCESS");
    const r = checkRerun(ok, [ok]);
    expect(r.canRerun, "Expected no re-run when every job passed").toBe(false);
    expect(r.canRerun === false && r.reason, "Expected a reason saying no job failed").toMatch(/no failed|nothing to re-run|passed|succeeded/i);
  });
});

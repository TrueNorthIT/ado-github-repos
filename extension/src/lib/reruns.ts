// CI-2: re-run failed checks. STUBS: the developer implements them.
// REST (OpenAPI operations actions/re-run-workflow-failed-jobs and actions/re-run-workflow): POST /repos/{o}/{r}/actions/runs/{run_id}/rerun-failed-jobs
// and POST .../rerun. Both answer 201 with no body and accept an optional { enable_debug_logging } body (not used here).
// The run id is CheckRun.checkSuite.workflowRun.databaseId (GraphQL WorkflowRun.databaseId: Int), which actionsQuery.ts does not select, hence rerunChecksQuery.
import type { GraphQlRequest } from "./prQuery";
import type { RestRequest } from "./restRequest";

/** One CheckRun or StatusContext of the head commit's rollup, with the workflow run it belongs to. */
export type RerunCheck =
  | {
      __typename: "CheckRun";
      name: string;
      status: string;
      conclusion: string | null;
      /** workflowRun is null for third-party apps: only GitHub Actions jobs belong to a workflow run. */
      checkSuite: { workflowRun: { databaseId: number; workflow: { name: string } | null } | null } | null;
    }
  | { __typename: "StatusContext"; context: string };

/** The head commit's check contexts with checkSuite { workflowRun { databaseId workflow { name } } }. Variables { owner, name, number }. */
export function rerunChecksQuery({ owner, name, number }: { owner: string; name: string; number: number }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      statusCheckRollup { contexts(first: 100) { nodes { __typename
        ... on CheckRun { name status conclusion checkSuite { workflowRun { databaseId workflow { name } } } }
        ... on StatusContext { context }
      } } }
    }
  }
}`,
    variables: { owner, name, number },
  };
}

/** `POST /repos/{repo}/actions/runs/{runId}/rerun-failed-jobs`, no body. `repo` is "owner/name". */
export function rerunFailedJobsRequest(repo: string, runId: number): RestRequest {
  return { method: "POST", path: `/repos/${repo}/actions/runs/${runId}/rerun-failed-jobs` };
}

/** `POST /repos/{repo}/actions/runs/{runId}/rerun`, no body. */
export function rerunAllRequest(repo: string, runId: number): RestRequest {
  return { method: "POST", path: `/repos/${repo}/actions/runs/${runId}/rerun` };
}

export interface RerunTarget {
  runId: number;
  /** workflowRun.workflow.name; "" when GitHub sent none. */
  workflowName: string;
  /** Names of the jobs whose conclusion is FAILURE, CANCELLED or TIMED_OUT, in input order. */
  failedJobs: string[];
}

/**
 * One target per workflow run id, in order of first appearance, so one button re-runs a workflow once however many of its jobs are checks.
 * A run is a target only when it is completed (every one of its CheckRuns has status COMPLETED) and at least one job is failed, cancelled or timed out.
 */
export function rerunTargets(checks: RerunCheck[]): RerunTarget[] {
  const FAILED = ["FAILURE", "CANCELLED", "TIMED_OUT"];
  const runs = new Map<number, { workflowName: string; jobs: Extract<RerunCheck, { __typename: "CheckRun" }>[] }>();
  for (const c of checks) {
    if (c.__typename !== "CheckRun" || !c.checkSuite?.workflowRun) continue;
    const w = c.checkSuite.workflowRun;
    const r = runs.get(w.databaseId) ?? { workflowName: w.workflow?.name ?? "", jobs: [] };
    runs.set(w.databaseId, r);
    r.jobs.push(c);
  }
  const out: RerunTarget[] = [];
  for (const [runId, r] of runs) {
    const failedJobs = r.jobs.filter((j) => j.conclusion !== null && FAILED.includes(j.conclusion)).map((j) => j.name);
    if (failedJobs.length && r.jobs.every((j) => j.status === "COMPLETED")) out.push({ runId, workflowName: r.workflowName, failedJobs });
  }
  return out;
}

export type CheckRerun = { canRerun: true; runId: number } | { canRerun: false; reason: string };

/** Whether the re-run buttons are offered on this check, and if not, why: a status context or a third-party app check cannot be re-run; a run still in progress, or with no failed job, is not offered. A passing job of a run that has a failed job can (it shares the run's target). */
export function checkRerun(check: RerunCheck, all: RerunCheck[]): CheckRerun {
  const run = check.__typename === "CheckRun" ? check.checkSuite?.workflowRun : null;
  if (!run) return { canRerun: false, reason: "Only GitHub Actions jobs can be re-run from here." };
  if (rerunTargets(all).some((t) => t.runId === run.databaseId)) return { canRerun: true, runId: run.databaseId };
  const inProgress = all.some((c) => c.__typename === "CheckRun" && c.checkSuite?.workflowRun?.databaseId === run.databaseId && c.status !== "COMPLETED");
  return { canRerun: false, reason: inProgress ? "This workflow run is still in progress." : "No job in this workflow run failed, so there is nothing to re-run." };
}

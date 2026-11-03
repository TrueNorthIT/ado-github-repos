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
export function rerunChecksQuery(_p: { owner: string; name: string; number: number }): GraphQlRequest {
  throw new Error("Not implemented");
}

/** `POST /repos/{repo}/actions/runs/{runId}/rerun-failed-jobs`, no body. `repo` is "owner/name". */
export function rerunFailedJobsRequest(_repo: string, _runId: number): RestRequest {
  throw new Error("Not implemented");
}

/** `POST /repos/{repo}/actions/runs/{runId}/rerun`, no body. */
export function rerunAllRequest(_repo: string, _runId: number): RestRequest {
  throw new Error("Not implemented");
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
export function rerunTargets(_checks: RerunCheck[]): RerunTarget[] {
  throw new Error("Not implemented");
}

export type CheckRerun = { canRerun: true; runId: number } | { canRerun: false; reason: string };

/** Whether the re-run buttons are offered on this check, and if not, why: a status context or a third-party app check cannot be re-run; a run still in progress, or with no failed job, is not offered. A passing job of a run that has a failed job can (it shares the run's target). */
export function checkRerun(_check: RerunCheck, _all: RerunCheck[]): CheckRerun {
  throw new Error("Not implemented");
}

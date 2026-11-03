// Actions area (ACT-*): workflows, runs, jobs, artifacts, annotations, deployments, dispatch inputs and the job graph.
// FROZEN CONTRACT (2026-11-03). Types and signatures are shared by the lists side and the run/log side; change them only by agreement.
// Bodies marked "not implemented" are filled in against src/lib/workflows.test.ts.
//
// Facts checked live (gh api, 2026-11-03):
//  - The App (devops-github-repo-view) has actions=write and deployments=write: re-run, cancel, dispatch and pending-deployment reviews work.
//  - GET .../actions/jobs/{id}/logs and .../actions/artifacts/{id}/zip 302 to *.blob.core.windows.net; both hops send ACAO * (restText/restBlob).
//  - A job's id is also its check-run id: annotations are GET /repos/{repo}/check-runs/{job_id}/annotations.
//  - REST lists page with `Link: <...>; rel="next"` (restJson returns it); runs and jobs pages take per_page up to 100.
//  - Job dependencies (`needs`) and workflow_dispatch inputs exist only in the workflow YAML (parsed with js-yaml).
import type { RestRequest } from "./restRequest";
import type { Person } from "./commitsQuery";

/** ADO Pipelines' status vocabulary, which drives the icon and colour. */
export type RunState = "queued" | "waiting" | "inProgress" | "succeeded" | "failed" | "cancelled" | "skipped" | "neutral";

/** Maps GitHub's status + conclusion. status queued|requested|pending -> queued; waiting -> waiting; in_progress -> inProgress;
 *  completed + success -> succeeded; failure|timed_out|startup_failure -> failed; cancelled -> cancelled; skipped -> skipped;
 *  neutral|stale|action_required|null -> neutral. Unknown values -> neutral. */
export function runState(status: string | null | undefined, conclusion: string | null | undefined): RunState {
  throw new Error("not implemented");
}

/** ADO-style duration: "0s", "45s", "2m 14s", "1h 3m" (seconds dropped from an hour up). Negative or NaN -> "0s". */
export function formatDuration(ms: number): string {
  throw new Error("not implemented");
}

/** Duration between two ISO times, or from `start` to `now` when `end` is absent (a running job). undefined when start is absent. */
export function elapsedMs(start: string | null | undefined, end: string | null | undefined, now: Date): number | undefined {
  throw new Error("not implemented");
}

export interface Workflow {
  id: number;
  name: string;
  /** ".github/workflows/publish.yml". */
  path: string;
  /** active | disabled_manually | disabled_inactivity | disabled_fork | deleted ... */
  state: string;
  disabled: boolean;
  htmlUrl: string;
}

export interface WorkflowRun {
  id: number;
  workflowId: number;
  /** The workflow's name at run time. */
  name: string;
  /** display_title (the commit or PR title). */
  title: string;
  runNumber: number;
  attempt: number;
  event: string;
  status: string;
  conclusion: string | null;
  state: RunState;
  branch: string | null;
  headSha: string;
  actor?: Person;
  createdAt: Date;
  /** run_started_at, when present. */
  startedAt?: Date;
  updatedAt: Date;
  htmlUrl: string;
  /** Workflow file path at the run's commit (for the graph); from `path`, minus any "@ref" suffix. */
  path: string;
  /** pull_requests[].number. */
  prNumbers: number[];
}

export interface JobStep {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
  state: RunState;
  startedAt?: Date;
  completedAt?: Date;
}

export interface Job {
  id: number;
  runId: number;
  attempt: number;
  name: string;
  status: string;
  conclusion: string | null;
  state: RunState;
  startedAt?: Date;
  completedAt?: Date;
  steps: JobStep[];
  htmlUrl: string;
  runnerName?: string;
  labels: string[];
}

export interface Artifact {
  id: number;
  name: string;
  sizeInBytes: number;
  expired: boolean;
  expiresAt?: Date;
}

export interface Annotation {
  path: string;
  startLine: number;
  endLine: number;
  level: "failure" | "warning" | "notice";
  title?: string;
  message: string;
}

export interface PendingDeployment {
  environmentId: number;
  environmentName: string;
  /** The viewer may approve or reject this environment. */
  canApprove: boolean;
  waitTimer: number;
}

// ---------- mappers (REST JSON -> models) ----------

export function toWorkflow(raw: unknown): Workflow { throw new Error("not implemented"); }
export function toRun(raw: unknown): WorkflowRun { throw new Error("not implemented"); }
export function toJob(raw: unknown): Job { throw new Error("not implemented"); }
export function toArtifact(raw: unknown): Artifact { throw new Error("not implemented"); }
export function toAnnotation(raw: unknown): Annotation { throw new Error("not implemented"); }
export function toPendingDeployment(raw: unknown): PendingDeployment { throw new Error("not implemented"); }

/** The `page` number of the rel="next" URL in a Link header, or undefined. */
export function nextPage(link: string | null): number | undefined { throw new Error("not implemented"); }

// ---------- request builders ----------

export interface RunFilters {
  branch?: string;
  /** A RunStatusFilter value. */
  status?: string;
  actor?: string;
  event?: string;
}

/** GET /repos/{repo}/actions/workflows?per_page=100&page=N */
export function listWorkflowsRequest(repo: string, page = 1): RestRequest { throw new Error("not implemented"); }
/** GET /repos/{repo}/actions/runs (workflowId absent) or /actions/workflows/{id}/runs, per_page=25, page, and the filters as query
 *  parameters (branch, status, actor, event), each URL-encoded; blank filters are left out. */
export function listRunsRequest(repo: string, opts: { workflowId?: number; page?: number; perPage?: number } & RunFilters): RestRequest { throw new Error("not implemented"); }
/** GET /repos/{repo}/actions/runs/{id}, or /actions/runs/{id}/attempts/{attempt} when an attempt is given. */
export function getRunRequest(repo: string, runId: number, attempt?: number): RestRequest { throw new Error("not implemented"); }
/** GET /repos/{repo}/actions/runs/{id}/attempts/{attempt}/jobs?per_page=100&page=N (attempt given) or /actions/runs/{id}/jobs?filter=latest&per_page=100&page=N. */
export function listJobsRequest(repo: string, runId: number, attempt?: number, page = 1): RestRequest { throw new Error("not implemented"); }
/** GET /repos/{repo}/actions/jobs/{id}/logs (text via restText). */
export function jobLogsPath(repo: string, jobId: number): string { throw new Error("not implemented"); }
/** GET /repos/{repo}/actions/runs/{id}/artifacts?per_page=100 */
export function listArtifactsRequest(repo: string, runId: number): RestRequest { throw new Error("not implemented"); }
/** GET /repos/{repo}/actions/artifacts/{id}/zip (blob via restBlob). */
export function artifactZipPath(repo: string, artifactId: number): string { throw new Error("not implemented"); }
/** GET /repos/{repo}/check-runs/{jobId}/annotations?per_page=100 */
export function annotationsRequest(repo: string, jobId: number): RestRequest { throw new Error("not implemented"); }
/** POST .../actions/runs/{id}/rerun, .../rerun-failed-jobs, or .../actions/jobs/{jobId}/rerun. No body. */
export function rerunRequest(repo: string, target: { runId: number; failedOnly?: boolean } | { jobId: number }): RestRequest { throw new Error("not implemented"); }
/** POST .../actions/runs/{id}/cancel. */
export function cancelRequest(repo: string, runId: number): RestRequest { throw new Error("not implemented"); }
/** POST .../actions/workflows/{id}/dispatches with { ref, inputs } (inputs omitted when empty). */
export function dispatchRequest(repo: string, workflowId: number, ref: string, inputs: Record<string, string>): RestRequest { throw new Error("not implemented"); }
/** GET .../actions/runs/{id}/pending_deployments */
export function pendingDeploymentsRequest(repo: string, runId: number): RestRequest { throw new Error("not implemented"); }
/** POST .../actions/runs/{id}/pending_deployments with { environment_ids, state: "approved" | "rejected", comment }. */
export function reviewDeploymentsRequest(repo: string, runId: number, environmentIds: number[], state: "approved" | "rejected", comment: string): RestRequest { throw new Error("not implemented"); }

// ---------- the workflow file ----------

export interface WorkflowJobDef {
  /** The YAML key under `jobs:`. */
  id: string;
  /** The job's `name:`, when set (may contain ${{ }} expressions, kept verbatim). */
  name?: string;
  needs: string[];
  /** The job has a `strategy.matrix`. */
  matrix: boolean;
}

/** Jobs from a workflow file. Throws on invalid YAML or when `jobs` is missing; the caller then shows the flat list. `needs` may be a string or a list. */
export function parseWorkflowJobs(yamlText: string): WorkflowJobDef[] { throw new Error("not implemented"); }

export type DispatchInputType = "string" | "choice" | "boolean" | "environment" | "number";

export interface DispatchInput {
  key: string;
  description?: string;
  required: boolean;
  type: DispatchInputType;
  /** Default as a string ("true"/"false" for booleans); undefined when none. */
  default?: string;
  /** choice only. */
  options?: string[];
}

/** workflow_dispatch inputs in file order; [] when it has none; null when the workflow has no workflow_dispatch trigger.
 *  `on` may be a string, a list or a map. A missing type is "string". */
export function parseDispatchInputs(yamlText: string): DispatchInput[] | null { throw new Error("not implemented"); }

/** Errors by input key: required and blank -> "Required"; choice not among options -> "Pick one of the options"; number not numeric -> "Enter a number". */
export function validateInputs(inputs: DispatchInput[], values: Record<string, string>): Record<string, string> { throw new Error("not implemented"); }

/** The `inputs` body for dispatchRequest: every input with a value (defaults applied for untouched ones), booleans as "true"/"false". */
export function inputsBody(inputs: DispatchInput[], values: Record<string, string>): Record<string, string> { throw new Error("not implemented"); }

// ---------- the job graph ----------

export interface JobGroup {
  /** A YAML job id when matched, otherwise the job's display name. */
  key: string;
  /** Card title: the job name without its matrix suffix ("test (18, ubuntu)" -> "test"). */
  title: string;
  jobs: Job[];
  /** Worst state of its jobs: failed > cancelled > inProgress > waiting > queued > succeeded > neutral > skipped. */
  state: RunState;
  /** Keys of the groups it needs. */
  needs: string[];
}

/** The worst of several states, by the order above. [] -> "neutral". */
export function worstState(states: RunState[]): RunState { throw new Error("not implemented"); }

/** Columns of job groups, left to right: a group sits one column right of the furthest group it needs. API jobs are matched to YAML jobs by
 *  `name` (or id when unnamed), ignoring a matrix suffix " (...)"; a job that matches nothing gets its own group in column 0 with no needs.
 *  Within a column, groups keep the order the API returned their first job. With no defs (YAML unavailable), every group is in column 0. */
export function jobGraph(jobs: Job[], defs: WorkflowJobDef[] | null): JobGroup[][] { throw new Error("not implemented"); }

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
import { load } from "js-yaml";

/** ADO Pipelines' status vocabulary, which drives the icon and colour. */
export type RunState = "queued" | "waiting" | "inProgress" | "succeeded" | "failed" | "cancelled" | "skipped" | "neutral";

/** Maps GitHub's status + conclusion. status queued|requested|pending -> queued; waiting -> waiting; in_progress -> inProgress;
 *  completed + success -> succeeded; failure|timed_out|startup_failure -> failed; cancelled -> cancelled; skipped -> skipped;
 *  neutral|stale|action_required|null -> neutral. Unknown values -> neutral. */
export function runState(status: string | null | undefined, conclusion: string | null | undefined): RunState {
  const st = (status ?? "").toLowerCase();
  const c = (conclusion ?? "").toLowerCase();
  if (st === "queued" || st === "requested" || st === "pending") return "queued";
  if (st === "waiting") return "waiting";
  if (st === "in_progress") return "inProgress";
  if (st !== "completed") return "neutral";
  if (c === "success") return "succeeded";
  if (c === "failure" || c === "timed_out" || c === "startup_failure") return "failed";
  if (c === "cancelled") return "cancelled";
  if (c === "skipped") return "skipped";
  return "neutral";
}

/** ADO-style duration: "0s", "45s", "2m 14s", "1h 3m" (seconds dropped from an hour up). Negative or NaN -> "0s". */
export function formatDuration(ms: number): string {
  if (!(ms > 0)) return "0s";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return s >= 60 ? `${m}m ${s % 60}s` : `${s}s`;
}

/** Duration between two ISO times, or from `start` to `now` when `end` is absent (a running job). undefined when start is absent. */
export function elapsedMs(start: string | null | undefined, end: string | null | undefined, now: Date): number | undefined {
  if (!start) return undefined;
  const to = end ? Date.parse(end) : now.getTime();
  return Math.max(0, to - Date.parse(start));
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

// ---------- helpers ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
const asRaw = (x: unknown): Raw => (x && typeof x === "object" ? (x as Raw) : {});
const date = (x: unknown): Date | undefined => (typeof x === "string" && x ? new Date(x) : undefined);
const q = (v: string | number) => encodeURIComponent(String(v));
const A = (repo: string) => `/repos/${repo}/actions`;
const WORST: RunState[] = ["failed", "cancelled", "inProgress", "waiting", "queued", "succeeded", "neutral", "skipped"];


export function toWorkflow(raw: unknown): Workflow { const r = asRaw(raw);
  const state = String(r.state ?? "");
  return { id: r.id, name: r.name, path: r.path, state, disabled: state.startsWith("disabled"), htmlUrl: r.html_url };
}
export function toRun(raw: unknown): WorkflowRun { const r = asRaw(raw);
  const a = r.actor ? asRaw(r.actor) : null;
  return {
    id: r.id,
    workflowId: r.workflow_id,
    name: r.name ?? "",
    title: r.display_title ?? r.name ?? "",
    runNumber: r.run_number,
    attempt: r.run_attempt ?? 1,
    event: r.event,
    status: r.status,
    conclusion: r.conclusion ?? null,
    state: runState(r.status, r.conclusion),
    branch: r.head_branch ?? null,
    headSha: r.head_sha,
    actor: a ? { name: a.login, login: a.login, avatarUrl: a.avatar_url } : undefined,
    createdAt: new Date(r.created_at),
    startedAt: date(r.run_started_at),
    updatedAt: new Date(r.updated_at),
    htmlUrl: r.html_url,
    path: String(r.path ?? "").replace(/@.*$/, ""),
    prNumbers: Array.isArray(r.pull_requests) ? r.pull_requests.map((p: Raw) => p.number) : [],
  };
}
export function toJob(raw: unknown): Job { const r = asRaw(raw);
  return {
    id: r.id,
    runId: r.run_id,
    attempt: r.run_attempt ?? 1,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion ?? null,
    state: runState(r.status, r.conclusion),
    startedAt: date(r.started_at),
    completedAt: date(r.completed_at),
    steps: (Array.isArray(r.steps) ? r.steps : []).map((x: Raw) => ({
      number: x.number,
      name: x.name,
      status: x.status,
      conclusion: x.conclusion ?? null,
      state: runState(x.status, x.conclusion),
      startedAt: date(x.started_at),
      completedAt: date(x.completed_at),
    })),
    htmlUrl: r.html_url,
    runnerName: r.runner_name ?? undefined,
    labels: Array.isArray(r.labels) ? r.labels : [],
  };
}
export function toArtifact(raw: unknown): Artifact { const r = asRaw(raw);
  return { id: r.id, name: r.name, sizeInBytes: r.size_in_bytes, expired: !!r.expired, expiresAt: date(r.expires_at) };
}
export function toAnnotation(raw: unknown): Annotation { const r = asRaw(raw);
  return { path: r.path, startLine: r.start_line, endLine: r.end_line, level: r.annotation_level, title: r.title ?? undefined, message: r.message };
}
export function toPendingDeployment(raw: unknown): PendingDeployment { const r = asRaw(raw);
  return { environmentId: asRaw(r.environment).id, environmentName: asRaw(r.environment).name, canApprove: !!r.current_user_can_approve, waitTimer: r.wait_timer ?? 0 };
}

/** The `page` number of the rel="next" URL in a Link header, or undefined. */
export function nextPage(link: string | null): number | undefined { const m = /<([^>]+)>\s*;\s*rel="next"/.exec(link ?? "");
  const n = m ? Number(new URL(m[1]).searchParams.get("page")) : NaN;
  return n > 0 ? n : undefined;
}

// ---------- request builders ----------

export interface RunFilters {
  branch?: string;
  /** A RunStatusFilter value. */
  status?: string;
  actor?: string;
  event?: string;
}

/** GET /repos/{repo}/actions/workflows?per_page=100&page=N */
export function listWorkflowsRequest(repo: string, page = 1): RestRequest { return { method: "GET", path: `${A(repo)}/workflows?per_page=100&page=${page}` };
}
/** GET /repos/{repo}/actions/runs (workflowId absent) or /actions/workflows/{id}/runs, per_page=25, page, and the filters as query
 *  parameters (branch, status, actor, event), each URL-encoded; blank filters are left out. */
export function listRunsRequest(repo: string, opts: { workflowId?: number; page?: number; perPage?: number } & RunFilters): RestRequest { const qs = [`per_page=${opts.perPage ?? 25}`, `page=${opts.page ?? 1}`];
  for (const k of ["branch", "status", "actor", "event"] as const) {
    const v = (opts[k] ?? "").trim();
    if (v) qs.push(`${k}=${q(v)}`);
  }
  const base = opts.workflowId ? `/workflows/${opts.workflowId}/runs` : "/runs";
  return { method: "GET", path: `${A(repo)}${base}?${qs.join("&")}` };
}
/** GET /repos/{repo}/actions/runs/{id}, or /actions/runs/{id}/attempts/{attempt} when an attempt is given. */
export function getRunRequest(repo: string, runId: number, attempt?: number): RestRequest { return { method: "GET", path: `${A(repo)}/runs/${runId}${attempt ? `/attempts/${attempt}` : ""}` };
}
/** GET /repos/{repo}/actions/runs/{id}/attempts/{attempt}/jobs?per_page=100&page=N (attempt given) or /actions/runs/{id}/jobs?filter=latest&per_page=100&page=N. */
export function listJobsRequest(repo: string, runId: number, attempt?: number, page = 1): RestRequest { const path = attempt ? `${A(repo)}/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}` : `${A(repo)}/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`;
  return { method: "GET", path };
}
/** GET /repos/{repo}/actions/jobs/{id}/logs (text via restText). */
export function jobLogsPath(repo: string, jobId: number): string { return `${A(repo)}/jobs/${jobId}/logs`;
}
/** GET /repos/{repo}/actions/runs/{id}/artifacts?per_page=100 */
export function listArtifactsRequest(repo: string, runId: number): RestRequest { return { method: "GET", path: `${A(repo)}/runs/${runId}/artifacts?per_page=100` };
}
/** GET /repos/{repo}/actions/artifacts/{id}/zip (blob via restBlob). */
export function artifactZipPath(repo: string, artifactId: number): string { return `${A(repo)}/artifacts/${artifactId}/zip`;
}
/** GET /repos/{repo}/check-runs/{jobId}/annotations?per_page=100 */
export function annotationsRequest(repo: string, jobId: number): RestRequest { return { method: "GET", path: `/repos/${repo}/check-runs/${jobId}/annotations?per_page=100` };
}
/** POST .../actions/runs/{id}/rerun, .../rerun-failed-jobs, or .../actions/jobs/{jobId}/rerun. No body. */
export function rerunRequest(repo: string, target: { runId: number; failedOnly?: boolean } | { jobId: number }): RestRequest { if ("jobId" in target) return { method: "POST", path: `${A(repo)}/jobs/${target.jobId}/rerun` };
  return { method: "POST", path: `${A(repo)}/runs/${target.runId}/${target.failedOnly ? "rerun-failed-jobs" : "rerun"}` };
}
/** POST .../actions/runs/{id}/cancel. */
export function cancelRequest(repo: string, runId: number): RestRequest { return { method: "POST", path: `${A(repo)}/runs/${runId}/cancel` };
}
/** POST .../actions/workflows/{id}/dispatches with { ref, inputs } (inputs omitted when empty). */
export function dispatchRequest(repo: string, workflowId: number, ref: string, inputs: Record<string, string>): RestRequest { return { method: "POST", path: `${A(repo)}/workflows/${workflowId}/dispatches`, body: Object.keys(inputs).length ? { ref, inputs } : { ref } };
}
/** GET .../actions/runs/{id}/pending_deployments */
export function pendingDeploymentsRequest(repo: string, runId: number): RestRequest { return { method: "GET", path: `${A(repo)}/runs/${runId}/pending_deployments` };
}
/** POST .../actions/runs/{id}/pending_deployments with { environment_ids, state: "approved" | "rejected", comment }. */
export function reviewDeploymentsRequest(repo: string, runId: number, environmentIds: number[], state: "approved" | "rejected", comment: string): RestRequest { return { method: "POST", path: `${A(repo)}/runs/${runId}/pending_deployments`, body: { environment_ids: environmentIds, state, comment } };
}

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
export function parseWorkflowJobs(yamlText: string): WorkflowJobDef[] { const doc = asRaw(load(yamlText));
  const jobs = doc.jobs;
  if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) throw new Error("The workflow has no jobs");
  return Object.entries(jobs as Raw).map(([id, j]) => {
    const job = asRaw(j);
    const needs = job.needs == null ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
    return { id, name: typeof job.name === "string" ? job.name : undefined, needs: needs.map(String), matrix: !!asRaw(job.strategy).matrix };
  });
}

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
export function parseDispatchInputs(yamlText: string): DispatchInput[] | null { const doc = asRaw(load(yamlText));
  const on = doc.on ?? doc.true; // a YAML 1.1 reader turns the key `on` into true
  const isMap = !!on && typeof on === "object" && !Array.isArray(on);
  const hasTrigger = typeof on === "string" ? on === "workflow_dispatch" : Array.isArray(on) ? on.includes("workflow_dispatch") : isMap && "workflow_dispatch" in on;
  if (!hasTrigger) return null;
  const inputs = asRaw(asRaw(isMap ? on.workflow_dispatch : null).inputs);
  return Object.entries(inputs).map(([key, v]) => {
    const i = asRaw(v);
    const type: DispatchInputType = ["choice", "boolean", "environment", "number"].includes(i.type) ? i.type : "string";
    const out: DispatchInput = { key, required: i.required === true, type };
    if (i.description != null) out.description = String(i.description);
    if (i.default != null) out.default = String(i.default);
    if (type === "choice") out.options = (Array.isArray(i.options) ? i.options : []).map(String);
    return out;
  });
}

/** Errors by input key: required and blank -> "Required"; choice not among options -> "Pick one of the options"; number not numeric -> "Enter a number". */
export function validateInputs(inputs: DispatchInput[], values: Record<string, string>): Record<string, string> { const errors: Record<string, string> = {};
  for (const i of inputs) {
    const v = (values[i.key] ?? i.default ?? "").trim();
    if (!v) {
      if (i.required) errors[i.key] = "Required";
    } else if (i.type === "choice" && !(i.options ?? []).includes(v)) errors[i.key] = "Pick one of the options";
    else if (i.type === "number" && !Number.isFinite(Number(v))) errors[i.key] = "Enter a number";
  }
  return errors;
}

/** The `inputs` body for dispatchRequest: every input with a value (defaults applied for untouched ones), booleans as "true"/"false". */
export function inputsBody(inputs: DispatchInput[], values: Record<string, string>): Record<string, string> { const body: Record<string, string> = {};
  for (const i of inputs) {
    const v = values[i.key];
    const out = v !== undefined && v.trim() !== "" ? v : i.default ?? (i.type === "boolean" ? "false" : undefined);
    if (out !== undefined) body[i.key] = out;
  }
  return body;
}

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
export function worstState(states: RunState[]): RunState { if (!states.length) return "neutral";
  return states.reduce((w, x) => (WORST.indexOf(x) < WORST.indexOf(w) ? x : w));
}

/** Columns of job groups, left to right: a group sits one column right of the furthest group it needs. API jobs are matched to YAML jobs by
 *  `name` (or id when unnamed), ignoring a matrix suffix " (...)"; a job that matches nothing gets its own group in column 0 with no needs.
 *  Within a column, groups keep the order the API returned their first job. With no defs (YAML unavailable), every group is in column 0. */
export function jobGraph(jobs: Job[], defs: WorkflowJobDef[] | null): JobGroup[][] { const stripSuffix = (n: string) => n.replace(/\s+\(.*\)$/, "");
  const ds = defs ?? [];
  const label = (d: WorkflowJobDef) => (d.name && !d.name.includes("${{") ? d.name : d.id);
  const defFor = (name: string) => ds.find((d) => label(d) === name || label(d) === stripSuffix(name));
  const groups = new Map<string, JobGroup>();
  for (const j of jobs) {
    const d = defFor(j.name);
    const key = d ? d.id : stripSuffix(j.name);
    const g = groups.get(key) ?? { key, title: d ? label(d) : stripSuffix(j.name), jobs: [], state: "neutral" as RunState, needs: [] };
    g.jobs.push(j);
    groups.set(key, g);
  }
  const column = (id: string, seen: string[]): number => {
    const d = ds.find((x) => x.id === id);
    if (!d || seen.includes(id)) return 0;
    const deps = d.needs.filter((n) => ds.some((x) => x.id === n));
    return deps.length ? 1 + Math.max(...deps.map((n) => column(n, [...seen, id]))) : 0;
  };
  const cols: JobGroup[][] = [];
  for (const g of groups.values()) {
    const d = ds.find((x) => x.id === g.key);
    g.state = worstState(g.jobs.map((j) => j.state));
    g.needs = d ? d.needs.filter((n) => groups.has(n)) : [];
    const c = d ? column(d.id, []) : 0;
    while (cols.length <= c) cols.push([]);
    cols[c].push(g);
  }
  return cols;
}

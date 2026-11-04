// Actions API wrappers. The lists side (actions-lists) owns the top half; the run page (actions-runs) appends below the marker.
import * as React from "react";
import { getRaw, rest, restJson } from "./githubBrowse";
import {
  dispatchRequest,
  listRunsRequest,
  listWorkflowsRequest,
  nextPage,
  parseDispatchInputs,
  toRun,
  toWorkflow,
  type DispatchInput,
  type RunFilters,
  type Workflow,
  type WorkflowRun,
} from "./lib/workflows";

export async function listWorkflows(repo: string): Promise<Workflow[]> {
  const out: Workflow[] = [];
  for (let page: number | undefined = 1; page && out.length < 500; ) {
    const { body, link } = await restJson(listWorkflowsRequest(repo, page));
    out.push(...(body.workflows ?? []).map(toWorkflow));
    page = nextPage(link);
  }
  return out;
}

export interface RunsPage {
  runs: WorkflowRun[];
  next?: number;
}

export async function listRuns(repo: string, opts: { workflowId?: number; page?: number; perPage?: number } & RunFilters): Promise<RunsPage> {
  const { body, link } = await restJson(listRunsRequest(repo, opts));
  return { runs: (body.workflow_runs ?? []).map(toRun), next: nextPage(link) };
}

/** The most recent run of a workflow, or undefined when it has never run. */
export async function latestRun(repo: string, workflowId: number): Promise<WorkflowRun | undefined> {
  return (await listRuns(repo, { workflowId, page: 1 })).runs[0];
}

/** The workflow file's dispatch inputs at `ref`: null when it has no workflow_dispatch (or cannot be read). */
export async function getDispatchInputs(repo: string, ref: string, path: string): Promise<DispatchInput[] | null> {
  try {
    return parseDispatchInputs(new TextDecoder().decode(await getRaw(repo, ref, path)));
  } catch {
    return null;
  }
}

export const dispatchWorkflow = (repo: string, workflowId: number, ref: string, inputs: Record<string, string>) => rest(dispatchRequest(repo, workflowId, ref, inputs));

/** Names of the repository's environments ([] when none or not readable). */
export async function listEnvironments(repo: string): Promise<string[]> {
  try {
    const { body } = await restJson({ method: "GET", path: `/repos/${repo}/environments?per_page=100` });
    return (body.environments ?? []).map((e: { name: string }) => e.name);
  } catch {
    return [];
  }
}

/** The repository's default branch and whether the viewer can push (GET /repos/{repo} permissions.push). */
export async function getRepoAccess(repo: string): Promise<{ defaultBranch: string; canWrite: boolean }> {
  const { body } = await restJson({ method: "GET", path: `/repos/${repo}` });
  return { defaultBranch: body.default_branch, canWrite: !!body.permissions?.push };
}

/** Whether the viewer may write to the repository (dispatch, re-run, cancel, approve). False until known. */
export function useCanWriteActions(repo: string): boolean {
  const [can, setCan] = React.useState(false);
  React.useEffect(() => {
    let dead = false;
    setCan(false);
    getRepoAccess(repo).then((a) => !dead && setCan(a.canWrite), () => {});
    return () => {
      dead = true;
    };
  }, [repo]);
  return can;
}

// ---------- run page (actions-runs) ----------

import { restBlob, restText } from "./githubBrowse";
import {
  annotationsRequest,
  artifactZipPath,
  cancelRequest,
  getRunRequest,
  jobLogsPath,
  listArtifactsRequest,
  listJobsRequest,
  pendingDeploymentsRequest,
  rerunRequest,
  reviewDeploymentsRequest,
  toAnnotation,
  toArtifact,
  toJob,
  toPendingDeployment,
  type Annotation,
  type Artifact,
  type Job,
  type PendingDeployment,
} from "./lib/workflows";

export async function getRun(repo: string, runId: number, attempt?: number): Promise<WorkflowRun> {
  return toRun((await restJson(getRunRequest(repo, runId, attempt))).body);
}

export async function listJobs(repo: string, runId: number, attempt?: number): Promise<Job[]> {
  const out: Job[] = [];
  for (let page: number | undefined = 1; page && out.length < 1000; ) {
    const { body, link } = await restJson(listJobsRequest(repo, runId, attempt, page));
    out.push(...(body.jobs ?? []).map(toJob));
    page = nextPage(link);
  }
  return out;
}

export async function listArtifacts(repo: string, runId: number): Promise<Artifact[]> {
  return ((await restJson(listArtifactsRequest(repo, runId))).body.artifacts ?? []).map(toArtifact);
}

export async function listJobAnnotations(repo: string, jobId: number): Promise<Annotation[]> {
  return ((await restJson(annotationsRequest(repo, jobId))).body ?? []).map(toAnnotation);
}

/** Pending deployment reviews; [] when there are none or the viewer cannot see them. */
export async function listPendingDeployments(repo: string, runId: number): Promise<PendingDeployment[]> {
  try {
    return ((await restJson(pendingDeploymentsRequest(repo, runId))).body ?? []).map(toPendingDeployment);
  } catch {
    return [];
  }
}

/** The workflow file at the run's commit, or null when it cannot be read (the graph then falls back to a flat list). */
export async function getWorkflowYaml(repo: string, sha: string, path: string): Promise<string | null> {
  try {
    return new TextDecoder().decode(await getRaw(repo, sha, path));
  } catch {
    return null;
  }
}

export const getJobLog = (repo: string, jobId: number) => restText(jobLogsPath(repo, jobId));
export const downloadArtifact = (repo: string, artifactId: number) => restBlob(artifactZipPath(repo, artifactId));
export const rerunAll = (repo: string, runId: number) => rest(rerunRequest(repo, { runId }));
export const rerunFailed = (repo: string, runId: number) => rest(rerunRequest(repo, { runId, failedOnly: true }));
export const rerunJob = (repo: string, jobId: number) => rest(rerunRequest(repo, { jobId }));
export const cancelRun = (repo: string, runId: number) => rest(cancelRequest(repo, runId));
export const reviewDeployments = (repo: string, runId: number, ids: number[], state: "approved" | "rejected", comment: string) =>
  rest(reviewDeploymentsRequest(repo, runId, ids, state, comment));

// ---------- workflow and run housekeeping, schedules, environments ----------

import { deleteRunRequest, parseScheduleCrons, setWorkflowEnabledRequest } from "./lib/workflows";
import { latestStatusRequest, listDeploymentsRequest, listEnvironmentsRequest, toDeployment, toDeploymentStatus, toEnvironment, type Deployment, type Environment } from "./lib/environments";

export const setWorkflowEnabled = (repo: string, workflowId: number, enabled: boolean) => rest(setWorkflowEnabledRequest(repo, workflowId, enabled));
export const deleteRun = (repo: string, runId: number) => rest(deleteRunRequest(repo, runId));
export const deleteRunLogs = (repo: string, runId: number) => rest(deleteRunRequest(repo, runId, true));

/** The workflow file's schedules at `ref` (scheduled runs use the default branch's file). Throws when the file cannot be read or parsed. */
export async function getScheduleCrons(repo: string, ref: string, path: string): Promise<string[]> {
  return parseScheduleCrons(new TextDecoder().decode(await getRaw(repo, ref, path)));
}

/** The repository's environments with their protection rules. Throws on failure (the Environments tab shows the error). */
export async function listEnvironmentDetails(repo: string): Promise<Environment[]> {
  return ((await restJson(listEnvironmentsRequest(repo))).body.environments ?? []).map(toEnvironment);
}

async function withLatestStatus(repo: string, raw: unknown): Promise<Deployment> {
  try {
    const statuses = (await restJson(latestStatusRequest(repo, (raw as { id: number }).id))).body;
    return toDeployment(raw, Array.isArray(statuses) && statuses.length ? toDeploymentStatus(statuses[0]) : undefined);
  } catch {
    return toDeployment(raw);
  }
}

/** One page of an environment's deployments, newest first, each with its latest status. */
export async function listDeployments(repo: string, environment: string, page = 1, perPage = 30): Promise<{ deployments: Deployment[]; next?: number }> {
  const { body, link } = await restJson(listDeploymentsRequest(repo, environment, { page, perPage }));
  const deployments = await Promise.all((Array.isArray(body) ? body : []).map((d: unknown) => withLatestStatus(repo, d)));
  return { deployments, next: nextPage(link) };
}

// ---------- test results from artifacts (the run page's Tests tab) ----------

import { isReportFile, parseTestReport, pickArtifacts, type TestReport } from "./lib/testResults";
import { listZipEntries, readZipEntry } from "./lib/zip";

/** Each zip entry read is capped (uncompressed), and so is the number of report files per artifact. */
const MAX_REPORT_BYTES = 50 * 1024 * 1024;
const MAX_REPORT_FILES = 200;

export interface TestResultsLoad {
  reports: TestReport[];
  /** Artifacts that were not read, with why. */
  skipped: { name: string; reason: "expired" | "tooLarge" | "unreadable" }[];
  /** Names of the artifacts that were read. */
  scanned: string[];
}

/** Downloads the run's likely artifacts (up to 20 MB in all), unzips them in the browser and parses every JUnit or TRX file in them. */
export async function loadTestResults(repo: string, artifacts: Artifact[]): Promise<TestResultsLoad> {
  const { read, skipped } = pickArtifacts(artifacts);
  const results = await Promise.all(read.map(async (a): Promise<TestReport[] | null> => {
    try {
      const zip = new Uint8Array(await (await downloadArtifact(repo, a.id)).arrayBuffer());
      const entries = listZipEntries(zip).filter((e) => isReportFile(e.name) && e.size <= MAX_REPORT_BYTES).slice(0, MAX_REPORT_FILES);
      const reports: TestReport[] = [];
      for (const e of entries) {
        try {
          const report = parseTestReport(new TextDecoder().decode(await readZipEntry(zip, e)), `${a.name}/${e.name}`);
          if (report) reports.push(report);
        } catch {
          // A damaged or encrypted entry: skip it, keep the rest.
        }
      }
      return reports;
    } catch {
      return null;
    }
  }));
  return {
    reports: results.flatMap((r) => r ?? []),
    scanned: read.filter((_a, i) => results[i]).map((a) => a.name),
    skipped: [...skipped.map((s) => ({ name: s.artifact.name, reason: s.reason })), ...read.filter((_a, i) => !results[i]).map((a) => ({ name: a.name, reason: "unreadable" as const }))],
  };
}

/** The latest deployment of an environment, with its status; undefined when there is none or it cannot be read. */
export async function latestDeployment(repo: string, environment: string): Promise<Deployment | undefined> {
  try {
    return (await listDeployments(repo, environment, 1, 1)).deployments[0];
  } catch {
    return undefined;
  }
}

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

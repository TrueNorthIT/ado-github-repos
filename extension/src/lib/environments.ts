// Actions > Environments (native ADO: Pipelines > Environments): the repository's environments and each one's deployment history, over REST.
//  - GET /repos/{repo}/environments: { total_count, environments: [{ id, name, html_url, created_at, updated_at, protection_rules: [{ type, wait_timer?, reviewers? }],
//    deployment_branch_policy: { protected_branches, custom_branch_policies } | null }] }.
//  - GET /repos/{repo}/deployments?environment=<name>&per_page=N&page=N: newest first; { id, sha, ref, task, environment, description, creator, created_at, updated_at }.
//  - GET /repos/{repo}/deployments/{id}/statuses?per_page=1: newest first, so the first is the latest; { state, log_url, target_url, environment_url, description, created_at, creator }.
//    state: error | failure | inactive | pending | success | queued | in_progress (the docs list no "waiting"; Actions shows a deployment awaiting review as "waiting").
//  - A deployment made by an Actions job carries a status whose log_url (and target_url) is https://github.com/{repo}/actions/runs/{run}/job/{job}.
import type { RestRequest } from "./restRequest";
import type { Person } from "./commitsQuery";
import type { RunState } from "./workflows";

export interface Environment {
  id: number;
  name: string;
  htmlUrl: string;
  /** Short words for the protection rules, e.g. ["Required reviewers", "Wait timer 5m", "Protected branches"]. */
  protections: string[];
}

export interface DeploymentStatus {
  /** GitHub's raw state (lower-case). */
  state: string;
  description: string;
  logUrl: string | null;
  targetUrl: string | null;
  environmentUrl: string | null;
  createdAt: Date;
}

export interface Deployment {
  id: number;
  sha: string;
  ref: string;
  task: string;
  environment: string;
  description: string;
  creator?: Person;
  createdAt: Date;
  /** The latest status; undefined when it has none (or it could not be read). */
  status?: DeploymentStatus;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
const asRaw = (x: unknown): Raw => (x && typeof x === "object" ? (x as Raw) : {});
const str = (x: unknown) => (typeof x === "string" ? x : "");

function waitText(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function toEnvironment(raw: unknown): Environment {
  const r = asRaw(raw);
  const protections: string[] = [];
  for (const p of Array.isArray(r.protection_rules) ? r.protection_rules : []) {
    const rule = asRaw(p);
    if (rule.type === "required_reviewers") protections.push("Required reviewers");
    else if (rule.type === "wait_timer" && Number(rule.wait_timer) > 0) protections.push(`Wait timer ${waitText(Number(rule.wait_timer))}`);
  }
  const policy = r.deployment_branch_policy ? asRaw(r.deployment_branch_policy) : null;
  if (policy?.protected_branches) protections.push("Protected branches");
  else if (policy?.custom_branch_policies) protections.push("Selected branches");
  return { id: r.id, name: str(r.name), htmlUrl: str(r.html_url), protections };
}

export function toDeploymentStatus(raw: unknown): DeploymentStatus {
  const r = asRaw(raw);
  return {
    state: str(r.state).toLowerCase(),
    description: str(r.description),
    logUrl: str(r.log_url) || null,
    targetUrl: str(r.target_url) || null,
    environmentUrl: str(r.environment_url) || null,
    createdAt: new Date(r.created_at),
  };
}

export function toDeployment(raw: unknown, status?: DeploymentStatus): Deployment {
  const r = asRaw(raw);
  const c = r.creator ? asRaw(r.creator) : null;
  return {
    id: r.id,
    sha: str(r.sha),
    ref: str(r.ref),
    task: str(r.task) || "deploy",
    environment: str(r.environment),
    description: str(r.description),
    creator: c ? { name: str(c.login), login: str(c.login), avatarUrl: str(c.avatar_url) } : undefined,
    createdAt: new Date(r.created_at),
    status,
  };
}

/** A deployment status state in the Pipelines vocabulary: success -> succeeded; failure, error -> failed; in_progress -> inProgress;
 *  queued, pending -> queued; waiting -> waiting; inactive, anything else or no status -> neutral. */
export function deploymentState(state: string | null | undefined): RunState {
  switch ((state ?? "").toLowerCase()) {
    case "success":
      return "succeeded";
    case "failure":
    case "error":
      return "failed";
    case "in_progress":
      return "inProgress";
    case "queued":
    case "pending":
      return "queued";
    case "waiting":
      return "waiting";
    default:
      return "neutral";
  }
}

/** The words shown next to the status icon. */
export function deploymentStateText(state: string | null | undefined): string {
  const s = (state ?? "").toLowerCase();
  if (!s) return "No status";
  if (s === "inactive") return "Inactive";
  if (s === "in_progress") return "In progress";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The Actions run a deployment status points at, from its log_url, else its target_url: https://github.com/{repo}/actions/runs/{id}[/...].
 *  Only runs of `repo` itself count (compared case-insensitively); anything else gives undefined. */
export function runIdOfStatus(status: Pick<DeploymentStatus, "logUrl" | "targetUrl"> | undefined, repo: string): number | undefined {
  for (const url of [status?.logUrl, status?.targetUrl]) {
    if (!url) continue;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    if (u.hostname !== "github.com") continue;
    const m = /^\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/|$)/.exec(u.pathname);
    if (!m || m[1].toLowerCase() !== repo.toLowerCase()) continue;
    const id = Number(m[2]);
    if (Number.isSafeInteger(id) && id > 0) return id;
  }
  return undefined;
}

const q = encodeURIComponent;

/** GET /repos/{repo}/environments?per_page=100 */
export function listEnvironmentsRequest(repo: string): RestRequest {
  return { method: "GET", path: `/repos/${repo}/environments?per_page=100` };
}

/** GET /repos/{repo}/deployments?environment=<name>&per_page=N&page=N (the name URL-encoded). */
export function listDeploymentsRequest(repo: string, environment: string, opts: { page?: number; perPage?: number } = {}): RestRequest {
  return { method: "GET", path: `/repos/${repo}/deployments?environment=${q(environment)}&per_page=${opts.perPage ?? 30}&page=${opts.page ?? 1}` };
}

/** GET /repos/{repo}/deployments/{id}/statuses?per_page=1 (the latest status). */
export function latestStatusRequest(repo: string, deploymentId: number): RestRequest {
  return { method: "GET", path: `/repos/${repo}/deployments/${deploymentId}/statuses?per_page=1` };
}

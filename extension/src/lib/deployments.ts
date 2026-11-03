// CI-5: latest deployment per environment for a pull request. STUBS: the developer implements them.
// Source decision (checked live): PullRequest.timelineItems(itemTypes: [DEPLOYED_EVENT]), not Repository.deployments(first: 20).
//  - The timeline is scoped to the PR. Repository.deployments(first: 20) is repo-wide: on vercel/next.js the newest 20 are all canary and release
//    deployments, and on nodejs/nodejs.org they cover about a dozen PRs, so a PR's own deployment falls out of the window on a busy repository.
//  - Deployment.ref is null for deployments made by Vercel (nodejs/nodejs.org, every one), so "filter by ref" finds nothing. Only commitOid is reliable.
//  - DeployedEvent { deployment { environment state commitOid createdAt updatedAt creator latestStatus { state environmentUrl logUrl updatedAt } } } returned the
//    preview URL for nodejs/nodejs.org#9298. DEPLOYMENT_ENVIRONMENT_CHANGED_EVENT is not needed: deployment.latestStatus is the current status.
//  - Caveat: PullRequestTimelineItemsConnection.totalCount ignores itemTypes (it was 6 where one DeployedEvent came back), so never use it here.
// Two enums are involved: Deployment.state (ABANDONED ACTIVE DESTROYED ERROR FAILURE INACTIVE PENDING SUCCESS QUEUED IN_PROGRESS WAITING) and
// DeploymentStatus.state (PENDING SUCCESS FAILURE INACTIVE ERROR QUEUED IN_PROGRESS WAITING). The status is the truth when present.
// Rule shared with feedQuery.ts / prQuery.ts: every caller-supplied value travels in `variables`, never in the query text.
import type { GraphQlRequest } from "./prQuery";

/** The PR's last 50 DeployedEvents, oldest first as GitHub orders them. Variables { owner, name, number }. Selects, per event, deployment { environment state commitOid createdAt updatedAt creator { login } latestStatus { state environmentUrl logUrl updatedAt creator { login } } }. */
export function deploymentsQuery(_p: { owner: string; name: string; number: number }): GraphQlRequest {
  throw new Error("Not implemented");
}

export type DeploymentTone = "success" | "failure" | "pending" | "neutral";

/** The deployment inside a DeployedEvent. */
export interface DeploymentNode {
  environment: string | null;
  /** Deployment.state; used only when latestStatus is null. */
  state: string | null;
  commitOid: string | null;
  createdAt: string;
  updatedAt: string;
  creator: { login: string } | null;
  latestStatus: { state: string; environmentUrl: string | null; logUrl: string | null; updatedAt: string; creator?: { login: string } | null } | null;
}

/**
 * Raw state to ADO-like tone: SUCCESS and ACTIVE -> success; FAILURE and ERROR -> failure; PENDING, QUEUED, IN_PROGRESS and WAITING -> pending;
 * INACTIVE, ABANDONED, DESTROYED, an unknown value, null -> neutral.
 */
export function deploymentTone(_rawState: string | null | undefined): DeploymentTone {
  throw new Error("Not implemented");
}

export interface DeploymentRow {
  /** "" is never returned: a deployment with no environment is shown as "Unknown environment". */
  environment: string;
  tone: DeploymentTone;
  /** environmentUrl, else logUrl; the key is absent when both are null or blank. */
  url?: string;
  /** latestStatus.updatedAt, else the deployment's updatedAt. */
  updatedAt: string;
  /** Deployment creator's login; the key is absent when null. */
  creator?: string;
  commitOid?: string;
}

/**
 * One row per environment: its newest deployment (greatest createdAt; a tie goes to the later node), tone from latestStatus.state, else the deployment's state.
 * Inactive deployments (INACTIVE, ABANDONED, DESTROYED) are dropped first, so an environment that has only inactive deployments is hidden while any other
 * deployment exists; when every deployment is inactive, the newest inactive one per environment is returned instead. Rows are newest first by createdAt.
 */
export function latestDeployments(_nodes: DeploymentNode[]): DeploymentRow[] {
  throw new Error("Not implemented");
}

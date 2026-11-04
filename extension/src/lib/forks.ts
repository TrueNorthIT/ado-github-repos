// Forks (native Repos lists a repository's forks, creates one, and opens a pull request from one). All REST:
//  - GET /repos/{o}/{r}/forks?sort=newest&per_page=100 lists the forks the viewer can see (paged with Link);
//  - GET /repos/{o}/{r}/compare/{base}...{forkOwner}:{branch} compares across the network (GitHub's `owner:branch` head syntax), giving
//    ahead_by / behind_by against the parent's default branch, and the commits of a pull request from the fork (oldest first);
//  - GET /repos/{o}/{r}/pulls?head={forkOwner}:{branch}&base={base}&state=open finds a pull request that already exists from it;
//  - POST /repos/{o}/{r}/forks { organization?, default_branch_only? } creates one (202: GitHub finishes copying in the background).
// The New pull request page creates the pull request with GraphQL createPullRequest's headRepositoryId (createPrPlan.ts).
// Hash keys (sitting beside browseState.ts like compareHash.ts): `view=forks` for the Forks page, and `sourceRepo` on the New pull request page.
import { serialize } from "./browseState";
import type { NewPrCommit, NewPrCompare } from "./newPr";
import type { RestRequest } from "./restRequest";

const REPO = /^[\w.-]+\/[\w.-]+$/;
const validRepo = (r: string | null): r is string => !!r && REPO.test(r) && !r.split("/").some((s) => s === "." || s === "..");
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export interface Fork {
  /** "owner/name". */
  fullName: string;
  owner: string;
  ownerAvatar?: string;
  /** "User" or "Organization". */
  ownerType: string;
  defaultBranch: string;
  /** The last push to any branch; null when GitHub doesn't say. */
  pushedAt: Date | null;
  htmlUrl: string;
  /** GraphQL node id: createPullRequest's headRepositoryId. */
  nodeId: string;
  isPrivate: boolean;
}

export const forksRequest = (repo: string, page = 1): RestRequest => ({ method: "GET", path: `/repos/${repo}/forks?sort=newest&per_page=100&page=${page}` });

/** One REST repository as a Fork; null for anything without a full_name. */
export function toFork(r: any): Fork | null {
  if (!r || typeof r.full_name !== "string" || !validRepo(r.full_name)) return null;
  const pushed = typeof r.pushed_at === "string" ? new Date(r.pushed_at) : null;
  return {
    fullName: r.full_name,
    owner: r.owner?.login ?? r.full_name.split("/")[0],
    ownerAvatar: r.owner?.avatar_url,
    ownerType: r.owner?.type ?? "User",
    defaultBranch: r.default_branch ?? "main",
    pushedAt: pushed && !isNaN(pushed.getTime()) ? pushed : null,
    htmlUrl: typeof r.html_url === "string" && r.html_url.startsWith("https://") ? r.html_url : `https://github.com/${r.full_name}`,
    nodeId: r.node_id ?? "",
    isPrivate: !!r.private,
  };
}

export const toForks = (body: unknown): Fork[] => (Array.isArray(body) ? body.map(toFork).filter((f): f is Fork => !!f) : []);

/** Cross-repository compare: `base...owner:branch` on the parent. per_page caps the commits returned (counts are always whole). */
export function forkCompareRequest(repo: string, base: string, forkOwner: string, branch: string, perPage = 1): RestRequest {
  if (!base.trim() || !forkOwner.trim() || !branch.trim()) throw new Error("base, forkOwner and branch are required");
  return { method: "GET", path: `/repos/${repo}/compare/${encPath(base)}...${encodeURIComponent(forkOwner)}:${encPath(branch)}?per_page=${perPage}` };
}

export function openPullsFromRequest(repo: string, base: string, forkOwner: string, branch: string): RestRequest {
  const q = new URLSearchParams({ head: `${forkOwner}:${branch}`, base, state: "open", per_page: "5" });
  return { method: "GET", path: `/repos/${repo}/pulls?${q}` };
}

/** POST create. `organization` only when forking into an organisation (absent: the viewer's own account). */
export function createForkRequest(repo: string, p: { organization?: string; defaultBranchOnly?: boolean } = {}): RestRequest {
  const body: Record<string, unknown> = {};
  if (p.organization?.trim()) body.organization = p.organization.trim();
  if (p.defaultBranchOnly) body.default_branch_only = true;
  return { method: "POST", path: `/repos/${repo}/forks`, body };
}

/** GitHub's own fork page, the fallback when the extension isn't allowed to create one. */
export const githubForkUrl = (repo: string) => `https://github.com/${repo}/fork`;

const STATUS: Record<string, NewPrCompare["status"]> = { ahead: "AHEAD", behind: "BEHIND", diverged: "DIVERGED", identical: "IDENTICAL" };

/**
 * The New pull request comparison for a fork's branch, from three REST answers: the parent repository (`repo`: node_id, default_branch,
 * allow_auto_merge), the compare (null when GitHub answered 404: the branch doesn't exist) and the open pulls from that head.
 */
export function mapForkCompare(repo: any, cmp: any | null, pulls: unknown): NewPrCompare {
  const commits: NewPrCommit[] = (Array.isArray(cmp?.commits) ? cmp.commits : []).filter(Boolean).map((c: any) => {
    const msg: string = c.commit?.message ?? "";
    const nl = msg.indexOf("\n");
    return { oid: c.sha, subject: nl < 0 ? msg : msg.slice(0, nl), body: nl < 0 ? "" : msg.slice(nl + 1).replace(/^\s*\n/, "").trim() };
  });
  const open = Array.isArray(pulls) ? pulls.find((p: any) => p && typeof p.number === "number") : undefined;
  return {
    repoId: typeof repo?.node_id === "string" ? repo.node_id : "",
    defaultBranch: repo?.default_branch ?? null,
    autoMergeAllowed: repo?.allow_auto_merge === true,
    baseExists: true,
    headExists: !!cmp,
    headOid: commits.length ? commits[commits.length - 1].oid : undefined,
    ahead: cmp?.ahead_by ?? 0,
    behind: cmp?.behind_by ?? 0,
    status: STATUS[cmp?.status as string] ?? null,
    commits,
    commitCount: cmp?.total_commits ?? commits.length,
    existingPr: open ? { number: open.number, title: open.title ?? "", url: open.html_url ?? "", isDraft: !!open.draft } : null,
  };
}

// ---------- hash ----------

export interface ForksHashState {
  repo: string;
}

/** The Forks page state of a hash: view=forks and a valid repo, else null. Never throws. */
export function parseForks(hash: string): ForksHashState | null {
  try {
    const p = new URLSearchParams(hash.replace(/^#+/, ""));
    const repo = p.get("repo");
    return p.get("view") === "forks" && validRepo(repo) ? { repo } : null;
  } catch {
    return null;
  }
}

export const serializeForks = (repo: string): string => `${serialize({ repo })}&view=forks`;

/** The New pull request page's source repository (a fork), from `sourceRepo`; undefined when absent or not a valid "owner/name". */
export function parseSourceRepo(hash: string): string | undefined {
  try {
    const r = new URLSearchParams(hash.replace(/^#+/, "")).get("sourceRepo");
    return validRepo(r) ? r : undefined;
  } catch {
    return undefined;
  }
}

/** `hash` with sourceRepo replaced (removed when `repo` is undefined); the other segments keep their order. Starts with "#". */
export function applySourceRepo(hash: string, repo: string | undefined): string {
  const kept = hash.replace(/^#+/, "").split("&").filter((x) => x && x.split("=")[0] !== "sourceRepo");
  if (repo && validRepo(repo)) kept.push(`sourceRepo=${encodeURIComponent(repo)}`);
  return "#" + kept.join("&");
}

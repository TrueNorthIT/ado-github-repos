// GitHub REST calls for the file browser. Every call carries the signed-in user's token.
import { getTokens } from "./auth";
import { tokenAction } from "./lib/tokens";
import { listFolder, listFromFolderTree, needsFolderFetch, pathExists, type GitTree, type TreeEntry } from "./lib/tree";
import type { GitHubTokenSet } from "../../shared/contract";

const API = "https://api.github.com";
const MAX_BRANCHES = 1000;

export type GhErrorKind = "auth" | "access" | "rateLimit" | "other";

export class GhError extends Error {
  constructor(public kind: GhErrorKind, public status = 0, public resetAt?: Date) {
    super(`${kind} (${status})`);
  }
}

export const repoPath = (repo: string) => `/repos/${repo}`; // repo is a validated "owner/name"
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

let cached: GitHubTokenSet | null = null;
async function token(force = false): Promise<string> {
  if (force || !cached || tokenAction(cached) !== "use") cached = await getTokens();
  if (!cached) throw new GhError("auth", 401);
  return cached.accessToken;
}

async function request(url: string, accept: string, retry = true): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url.startsWith("http") ? url : API + url, { headers: { Authorization: `Bearer ${await token(!retry)}`, Accept: accept } });
  } catch (e) {
    if (e instanceof GhError) throw e;
    throw new GhError("other");
  }
  if (res.ok) return res;
  if (res.status === 401) {
    if (retry) return request(url, accept, false); // token may have been revoked or just expired: refresh once
    cached = null;
    throw new GhError("auth", 401);
  }
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    throw new GhError("rateLimit", 403, reset ? new Date(reset * 1000) : undefined);
  }
  if (res.status === 403 || res.status === 404) throw new GhError("access", res.status);
  throw new GhError("other", res.status);
}

const json = async <T>(url: string): Promise<T> => (await request(url, "application/vnd.github+json")).json();

export interface RepoInfo {
  defaultBranch: string;
  isPrivate: boolean;
}

export async function getRepo(repo: string): Promise<RepoInfo> {
  const j = await json<{ default_branch: string; private: boolean }>(repoPath(repo));
  return { defaultBranch: j.default_branch, isPrivate: j.private };
}

/** Branch names, following Link pagination up to 1000. */
export async function listBranches(repo: string): Promise<string[]> {
  const names: string[] = [];
  let url: string | undefined = `${repoPath(repo)}/branches?per_page=100`;
  while (url && names.length < MAX_BRANCHES) {
    const res = await request(url, "application/vnd.github+json");
    names.push(...(await res.json()).map((b: { name: string }) => b.name));
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1];
  }
  return names.slice(0, MAX_BRANCHES);
}

// In-memory caches. ponytail: unbounded; fine for one browsing session, add eviction if memory shows up.
const trees = new Map<string, Promise<GitTree>>();
const folderTrees = new Map<string, Promise<GitTree>>();
const memo = <T>(m: Map<string, Promise<T>>, key: string, make: () => Promise<T>) => {
  let p = m.get(key);
  if (!p) m.set(key, (p = make().catch((e) => (m.delete(key), Promise.reject(e)))));
  return p;
};

export const clearCache = () => {
  trees.clear();
  folderTrees.clear();
  cached = null;
};

/** The recursive tree for a ref (GitHub may truncate it; see needsFolderFetch). Cached per repo and ref. */
export const getTree = (repo: string, ref: string) =>
  memo(trees, `${repo}@${ref}`, () => json<GitTree>(`${repoPath(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`));

const getFolderTree = (repo: string, sha: string) => memo(folderTrees, `${repo}#${sha}`, () => json<GitTree>(`${repoPath(repo)}/git/trees/${sha}`));

/** Children of a folder, from the cached recursive tree or, when that was truncated, folder by folder. */
export async function listDir(repo: string, tree: GitTree, folder: string): Promise<TreeEntry[]> {
  if (!needsFolderFetch(tree, folder)) return listFolder(tree, folder);
  let sha = tree.sha;
  for (const seg of folder.split("/").filter(Boolean)) {
    const item = (await getFolderTree(repo, sha)).tree.find((i) => i.path === seg && i.type === "tree");
    if (!item) return [];
    sha = item.sha;
  }
  return listFromFolderTree(await getFolderTree(repo, sha), folder);
}

const parentOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));

/** The entry at a path (undefined when missing); "" has no entry. */
export async function findEntry(repo: string, tree: GitTree, path: string): Promise<TreeEntry | undefined> {
  return (await listDir(repo, tree, parentOf(path))).find((e) => e.path === path);
}

/** pathExists that also works for truncated trees. */
export async function pathExistsOn(repo: string, tree: GitTree, path: string): Promise<boolean> {
  return needsFolderFetch(tree, path) ? path === "" || !!(await findEntry(repo, tree, path)) : pathExists(tree, path);
}

const contents = (repo: string, ref: string, path: string) => `${repoPath(repo)}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`;

export async function getRaw(repo: string, ref: string, path: string): Promise<ArrayBuffer> {
  return (await request(contents(repo, ref, path), "application/vnd.github.raw")).arrayBuffer();
}

export async function getRenderedMarkdown(repo: string, ref: string, path: string): Promise<string> {
  return (await request(contents(repo, ref, path), "application/vnd.github.html")).text();
}

const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml" };

/** Fetches a file as a Blob (images get a proper type so SVG renders). The caller owns, and must revoke, any object URL made from it. */
export async function getBlob(repo: string, ref: string, path: string): Promise<Blob> {
  const blob = await (await request(contents(repo, ref, path), "application/vnd.github.raw")).blob();
  const mime = IMAGE_MIME[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
  return mime ? new Blob([blob], { type: mime }) : blob;
}

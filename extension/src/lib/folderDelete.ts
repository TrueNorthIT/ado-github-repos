// Deleting a folder from the Files page, through the REST Git data API (createCommitOnBranch needs every path as a GraphQL
// input, and GraphQL is not reachable from every network). Steps: a tree on the head's tree with each file under the folder set
// to sha: null, a commit of that tree on the head, then the branch moved to it without force (or a new branch created at it).
import type { RestRequest } from "./restRequest";
import type { GitTreeItem } from "./tree";

export interface DeleteEntry {
  path: string;
  mode: string;
  type: "blob" | "commit";
}

/** The files and submodules at or under `folder` in a RECURSIVE tree's items (folders themselves go when they are empty). */
export function filesUnder(items: GitTreeItem[], folder: string): DeleteEntry[] {
  const prefix = `${folder.replace(/\/+$/, "")}/`;
  return items
    .filter((i) => i.type !== "tree" && i.path.startsWith(prefix))
    .map((i) => ({ path: i.path, type: i.type as "blob" | "commit", mode: i.mode ?? (i.type === "commit" ? "160000" : "100644") }));
}

/** The items of a folder's own recursive tree (paths relative to it) as repo paths. */
export const underFolder = (items: GitTreeItem[], folder: string): GitTreeItem[] => items.map((i) => ({ ...i, path: `${folder}/${i.path}` }));

export function deleteTreeRequest(repo: string, baseTree: string, entries: DeleteEntry[]): RestRequest {
  if (!entries.length) throw new Error("nothing to delete");
  return { method: "POST", path: `/repos/${repo}/git/trees`, body: { base_tree: baseTree, tree: entries.map((e) => ({ path: e.path, mode: e.mode, type: e.type, sha: null })) } };
}

export const commitMessage = (m: { headline: string; body?: string }) => (m.body?.trim() ? `${m.headline}\n\n${m.body.trim()}` : m.headline);

export function commitRequest(repo: string, p: { message: { headline: string; body?: string }; tree: string; parent: string }): RestRequest {
  return { method: "POST", path: `/repos/${repo}/git/commits`, body: { message: commitMessage(p.message), tree: p.tree, parents: [p.parent] } };
}

const refPath = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");

/** Moves `branch` to `sha`; GitHub refuses (422, "Update is not a fast forward") when the branch has moved past the commit's parent. */
export const updateRefRequest = (repo: string, branch: string, sha: string): RestRequest => ({ method: "PATCH", path: `/repos/${repo}/git/refs/heads/${refPath(branch)}`, body: { sha, force: false } });

export const createRefRequest = (repo: string, branch: string, sha: string): RestRequest => ({ method: "POST", path: `/repos/${repo}/git/refs`, body: { ref: `refs/heads/${branch}`, sha } });

/** GitHub's refusal when the branch is no longer at the parent the commit was made on. */
export const isNotFastForward = (apiMessage: string | undefined) => /not a fast.?forward/i.test(apiMessage ?? "");

/** The default commit message. */
export const deleteFolderMessage = (folder: string) => `Delete ${folder}`;

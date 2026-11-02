/** Branch switching and the branch picker's search (B-7). */
import { pathExists, type GitTree } from "./tree";

/** Path to land on after switching branch: currentPath if it exists in newTree (file or folder), otherwise "" (root). */
export function pathAfterSwitch(currentPath: string, newTree: GitTree): string {
  return pathExists(newTree, currentPath) ? currentPath : "";
}

/** Case-insensitive substring filter; defaultBranch (if it matches) is pinned first, the rest keep input order. */
export function filterBranches(branches: string[], query: string, defaultBranch?: string): string[] {
  const q = query.trim().toLowerCase();
  const hits = branches.filter((b) => b.toLowerCase().includes(q));
  return defaultBranch && hits.includes(defaultBranch) ? [defaultBranch, ...hits.filter((b) => b !== defaultBranch)] : hits;
}

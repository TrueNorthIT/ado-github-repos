import type { TreeEntry } from "./tree";

export const formatSize = (n?: number) =>
  n === undefined ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/** Folders (and submodules) always first; each group by name, case-insensitive, ascending or descending. */
export function sortListing(entries: TreeEntry[], dir: "asc" | "desc"): TreeEntry[] {
  const sign = dir === "asc" ? 1 : -1;
  const rank = (e: TreeEntry) => (e.kind === "file" ? 1 : 0);
  return [...entries].sort((a, b) => rank(a) - rank(b) || sign * a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

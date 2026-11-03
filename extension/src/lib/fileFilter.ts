// Batch 4, changed-file filter (VW-5).
//
// Facts: fuzzy.ts fuzzyFind(paths, query, limit = 50) returns [] for a blank query and caps results at `limit`, so a caller that wants every match passes paths.length as the limit. prFiles.ts buildFileTree
// derives folders from file paths, so a tree built from the filtered files already has only the folders that hold matches. ChangeType (prFiles.ts) is ADDED | MODIFIED | DELETED | RENAMED | COPIED | CHANGED.
//
// Decisions fixed by the tests (fileFilter.test.ts):
//  - The query is fuzzy over the file's CURRENT path (previousPath is not searched).
//  - Extensions are matched against the end of the path, case-insensitively, with or without the leading dot (".ts", "ts" and ".TS" are the same; ".test.ts" works); blank entries are ignored.
//  - Statuses: ADDED and COPIED are "added", MODIFIED and CHANGED are "modified", DELETED is "removed", RENAMED is "renamed".
//  - Each kind is an OR within itself (any listed extension, any listed status) and the three kinds are ANDed. An empty kind restricts nothing.
//  - Files keep the input order (the tree sorts itself; the flat list is not re-ranked by fuzzy score).
import type { ChangeType, PrFileInput, PrFileNode, PrTreeNode } from "./prFiles";
import { fuzzyFind } from "./fuzzy";

/** Normalised extension suffixes: lower case, leading dot, blanks dropped. */
const exts = (f: FileFilter) => f.extensions.map((e) => e.trim().toLowerCase()).filter(Boolean).map((e) => (e.startsWith(".") ? e : "." + e));

export type FileStatus = "added" | "modified" | "removed" | "renamed";

export interface FileFilter {
  /** Fuzzy path query; blank means no restriction. */
  query: string;
  extensions: string[];
  statuses: FileStatus[];
}

export const EMPTY_FILE_FILTER: FileFilter = { query: "", extensions: [], statuses: [] };

/** ChangeType to the status the filter chips use (see the header). */
export function statusOf(changeType: ChangeType): FileStatus {
  return { ADDED: "added", COPIED: "added", MODIFIED: "modified", CHANGED: "modified", DELETED: "removed", RENAMED: "renamed" }[changeType] as FileStatus;
}

/** True when the filter restricts anything: a non-blank query, or at least one non-blank extension, or at least one status. */
export function isFilterActive(filter: FileFilter): boolean {
  return !!filter.query.trim() || exts(filter).length > 0 || filter.statuses.length > 0;
}

/** The files that pass the filter, in input order. An inactive filter returns every file. */
export function filterFiles<T extends Pick<PrFileInput, "path" | "changeType">>(files: T[], filter: FileFilter): T[] {
  if (!isFilterActive(filter)) return files;
  const q = filter.query.trim();
  const hits = q ? new Set(fuzzyFind(files.map((f) => f.path), q, files.length).map((h) => h.path)) : null;
  const es = exts(filter);
  return files.filter(
    (f) =>
      (!hits || hits.has(f.path)) &&
      (!es.length || es.some((e) => f.path.toLowerCase().endsWith(e))) &&
      (!filter.statuses.length || filter.statuses.includes(statusOf(f.changeType))),
  );
}

/**
 * The tree with only the files that pass the filter and the folders that contain at least one (at any depth); empty folders are dropped. Order is unchanged and the result equals
 * buildFileTree(filterFiles(files, filter)) for the same files. An inactive filter returns the tree as it is.
 */
export function filterTree(tree: PrTreeNode[], filter: FileFilter): PrTreeNode[] {
  if (!isFilterActive(filter)) return tree;
  const files: PrFileNode[] = [];
  const walk = (nodes: PrTreeNode[]) => nodes.forEach((n) => (n.kind === "file" ? files.push(n) : walk(n.children)));
  walk(tree);
  const keep = new Set(filterFiles(files, filter).map((f) => f.path));
  const prune = (nodes: PrTreeNode[]): PrTreeNode[] =>
    nodes.flatMap((n): PrTreeNode[] => {
      if (n.kind === "file") return keep.has(n.path) ? [n] : [];
      const children = prune(n.children);
      return children.length ? [{ ...n, children }] : [];
    });
  return prune(tree);
}

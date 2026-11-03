// Batch 4, changed-file filter (VW-5). STUBS: the developer implements them. Every function throws "Not implemented" except the constants.
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
import type { ChangeType, PrFileInput, PrTreeNode } from "./prFiles";

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
  throw new Error("Not implemented");
}

/** True when the filter restricts anything: a non-blank query, or at least one non-blank extension, or at least one status. */
export function isFilterActive(filter: FileFilter): boolean {
  throw new Error("Not implemented");
}

/** The files that pass the filter, in input order. An inactive filter returns every file. */
export function filterFiles<T extends Pick<PrFileInput, "path" | "changeType">>(files: T[], filter: FileFilter): T[] {
  throw new Error("Not implemented");
}

/**
 * The tree with only the files that pass the filter and the folders that contain at least one (at any depth); empty folders are dropped. Order is unchanged and the result equals
 * buildFileTree(filterFiles(files, filter)) for the same files. An inactive filter returns the tree as it is.
 */
export function filterTree(tree: PrTreeNode[], filter: FileFilter): PrTreeNode[] {
  throw new Error("Not implemented");
}

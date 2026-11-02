/** Folder listings from GitHub git-tree responses (B-3, B-4, B-12). */
export interface GitTreeItem {
  path: string;
  mode?: string;
  /** "commit" means a submodule. */
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export interface GitTree {
  sha: string;
  truncated?: boolean;
  tree: GitTreeItem[];
}

export type EntryKind = "folder" | "file" | "submodule";

export interface TreeEntry {
  /** Last path segment. */
  name: string;
  /** Full repo-relative path, no leading slash. */
  path: string;
  kind: EntryKind;
  size?: number;
}

const toEntry = (item: GitTreeItem, name: string, path: string): TreeEntry => {
  if (item.type === "tree") return { name, path, kind: "folder" };
  if (item.type === "commit") return { name, path, kind: "submodule" };
  return item.size === undefined ? { name, path, kind: "file" } : { name, path, kind: "file", size: item.size };
};

// Folders (and submodules, which GitHub lists among them) first, then files; each case-insensitive A-Z, ties broken ordinally.
function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  const rank = (e: TreeEntry) => (e.kind === "file" ? 1 : 0);
  return entries.sort((a, b) => {
    const la = a.name.toLowerCase();
    const lb = b.name.toLowerCase();
    return rank(a) - rank(b) || (la < lb ? -1 : la > lb ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  });
}

/** Children of folderPath ("" = root) from a RECURSIVE tree, sorted folders first then files, each case-insensitive A-Z. */
export function listFolder(tree: GitTree, folderPath: string): TreeEntry[] {
  const prefix = folderPath ? folderPath + "/" : "";
  const out: TreeEntry[] = [];
  for (const item of tree.tree) {
    if (!item.path.startsWith(prefix)) continue;
    const name = item.path.slice(prefix.length);
    if (name && !name.includes("/")) out.push(toEntry(item, name, item.path));
  }
  return sortEntries(out);
}

/** Same listing shape from a NON-recursive single-folder response (item paths are bare names). */
export function listFromFolderTree(tree: GitTree, folderPath: string): TreeEntry[] {
  const prefix = folderPath ? folderPath + "/" : "";
  return sortEntries(tree.tree.map((item) => toEntry(item, item.path, prefix + item.path)));
}

/** True when the recursive data cannot be trusted for folderPath and a non-recursive fetch is needed. */
export function needsFolderFetch(tree: GitTree, _folderPath: string): boolean {
  return !!tree.truncated;
}

/** True for the root ("") and for any file, folder or submodule path present in the tree. Case-sensitive. */
export function pathExists(tree: GitTree, path: string): boolean {
  return path === "" || tree.tree.some((i) => i.path === path);
}

/** The README to render below a listing, preferring .md; undefined when there is none. */
export function findReadme(entries: TreeEntry[]): TreeEntry | undefined {
  for (const re of [/^readme\.md$/i, /^readme\.markdown$/i, /^readme$/i]) {
    const hit = entries.find((e) => e.kind === "file" && re.test(e.name));
    if (hit) return hit;
  }
  return undefined;
}

/** One segment per path component (root excluded), each with the path up to and including it. */
export function breadcrumbs(path: string): { name: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join("/") }));
}

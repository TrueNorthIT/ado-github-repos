// Changed-files tree for a pull request (PR-8).

export type ChangeType = "ADDED" | "MODIFIED" | "DELETED" | "RENAMED" | "COPIED" | "CHANGED";

export interface PrFileInput {
  path: string;
  additions: number;
  deletions: number;
  changeType: ChangeType;
  /** Old path. GraphQL does not return it; the caller supplies it (REST previous_filename) for renames. */
  previousPath?: string;
}

export interface PrFileNode {
  kind: "file";
  name: string;
  path: string;
  additions: number;
  deletions: number;
  changeType: ChangeType;
  /** "-x+y", e.g. "-2+10". */
  stat: string;
  /** Only on RENAMED files. */
  previousPath?: string;
}

export interface PrFolderNode {
  kind: "folder";
  name: string;
  /** Full path, no trailing slash. */
  path: string;
  children: PrTreeNode[];
}

export type PrTreeNode = PrFileNode | PrFolderNode;

const cmp = (a: PrTreeNode, b: PrTreeNode) => {
  const rank = (n: PrTreeNode) => (n.kind === "file" ? 1 : 0);
  const la = a.name.toLowerCase(), lb = b.name.toLowerCase();
  return rank(a) - rank(b) || (la < lb ? -1 : la > lb ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
};

/** Nested tree, folders first then files, each case-insensitive A-Z (ties ordinal). Single-child folders are NOT collapsed. */
export function buildFileTree(files: PrFileInput[]): PrTreeNode[] {
  const root: PrTreeNode[] = [];
  const folders = new Map<string, PrFolderNode>();
  for (const f of files) {
    const segs = f.path.split("/");
    let level = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const path = segs.slice(0, i + 1).join("/");
      let folder = folders.get(path);
      if (!folder) {
        folder = { kind: "folder", name: segs[i], path, children: [] };
        folders.set(path, folder);
        level.push(folder);
      }
      level = folder.children;
    }
    const file: PrFileNode = { kind: "file", name: segs[segs.length - 1], path: f.path, additions: f.additions, deletions: f.deletions, changeType: f.changeType, stat: `-${f.deletions}+${f.additions}` };
    if (f.changeType === "RENAMED" && f.previousPath) file.previousPath = f.previousPath;
    level.push(file);
  }
  const sort = (nodes: PrTreeNode[]) => { nodes.sort(cmp); nodes.forEach((n) => n.kind === "folder" && sort(n.children)); };
  sort(root);
  return root;
}

/** One entry of GitHub REST GET /pulls/{n}/files. */
export interface RestPrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  previous_filename?: string;
  /** Absent for binary and very large diffs. */
  patch?: string;
}

export interface PrFile extends PrFileInput {
  patch?: string;
}

const CHANGE: Record<string, ChangeType> = { added: "ADDED", removed: "DELETED", modified: "MODIFIED", renamed: "RENAMED", copied: "COPIED", changed: "CHANGED" };

export const fromRestFile = (f: RestPrFile): PrFile => ({
  path: f.filename,
  additions: f.additions,
  deletions: f.deletions,
  changeType: CHANGE[f.status] ?? "CHANGED",
  previousPath: f.previous_filename,
  patch: f.patch,
});

import { describe, it, expect } from "vitest";
import { EMPTY_FILE_FILTER, statusOf, isFilterActive, filterFiles, filterTree, type FileFilter } from "./fileFilter";
import { buildFileTree, type PrFileInput, type PrTreeNode, type ChangeType } from "./prFiles";
import { fuzzyFind } from "./fuzzy";

// Module under test: src/lib/fileFilter.ts (stubs until the developer implements them). Requirement VW-5: "File filter. Filter the changed-file tree by a fuzzy path query (reuse fuzzy.ts), plus
// extension filters (.ts) and status filters (added/modified/removed/renamed). Keep folders that contain matches." Decisions are in the header of src/lib/fileFilter.ts.

const f = (path: string, changeType: ChangeType = "MODIFIED", previousPath?: string): PrFileInput => ({ path, additions: 1, deletions: 0, changeType, ...(previousPath ? { previousPath } : {}) });
const FILES: PrFileInput[] = [
  f("src/app/main.ts"),
  f("src/app/util.ts", "ADDED"),
  f("src/app/view.tsx", "MODIFIED"),
  f("src/lib/old.ts", "DELETED"),
  f("src/lib/fresh.ts", "RENAMED", "src/lib/stale.ts"),
  f("test/main.test.ts", "ADDED"),
  f("docs/readme.md"),
  f("package.json"),
];
const filt = (p: Partial<FileFilter>): FileFilter => ({ ...EMPTY_FILE_FILTER, ...p });
const paths = (files: { path: string }[]) => files.map((x) => x.path);
const treePaths = (nodes: PrTreeNode[]): string[] => nodes.flatMap((n) => (n.kind === "file" ? [n.path] : [`${n.path}/`, ...treePaths(n.children)]));

describe("VW-5: statusOf maps GitHub's change types to the filter's four statuses", () => {
  it.each([
    ["ADDED", "added"],
    ["MODIFIED", "modified"],
    ["DELETED", "removed"],
    ["RENAMED", "renamed"],
    ["COPIED", "added"],
    ["CHANGED", "modified"],
  ] as const)("%s is %s", (change, status) => {
    expect(statusOf(change), `Expected ${change} to count as ${status}`).toBe(status);
  });
});

describe("VW-5: isFilterActive", () => {
  it("is false for the empty filter, a blank query and blank extensions", () => {
    expect(isFilterActive(EMPTY_FILE_FILTER), "Expected the empty filter to be inactive").toBe(false);
    expect(isFilterActive(filt({ query: "   ", extensions: ["", " "] })), "Expected blank entries to restrict nothing").toBe(false);
  });

  it("is true for a query, an extension or a status", () => {
    expect(isFilterActive(filt({ query: "x" })), "Expected a query to be active").toBe(true);
    expect(isFilterActive(filt({ extensions: [".ts"] })), "Expected an extension to be active").toBe(true);
    expect(isFilterActive(filt({ statuses: ["added"] })), "Expected a status to be active").toBe(true);
  });
});

describe("VW-5: filterFiles by fuzzy path query", () => {
  it("returns every file, in order, when nothing restricts", () => {
    expect(paths(filterFiles(FILES, EMPTY_FILE_FILTER)), "Expected all files in input order").toEqual(paths(FILES));
    expect(paths(filterFiles(FILES, filt({ query: "  " }))), "Expected a blank query to restrict nothing").toEqual(paths(FILES));
  });

  it("keeps exactly the files fuzzyFind matches, in input order", () => {
    const expected = new Set(fuzzyFind(paths(FILES), "main", FILES.length).map((h) => h.path));
    expect(expected.size, "Fixture check: 'main' should match more than one file").toBeGreaterThan(1);
    expect(paths(filterFiles(FILES, filt({ query: "main" }))), "Expected the fuzzy matches, not re-ranked").toEqual(paths(FILES).filter((p) => expected.has(p)));
  });

  it("matches a subsequence across the path, case-insensitively", () => {
    expect(paths(filterFiles(FILES, filt({ query: "SAU" }))), "Expected 'SAU' to find src/app/util.ts").toContain("src/app/util.ts");
  });

  it("matches nothing for a query that is no subsequence of any path", () => {
    expect(filterFiles(FILES, filt({ query: "zzzq" })), "Expected no files").toEqual([]);
  });

  it("searches the current path, not the previous name of a renamed file", () => {
    expect(paths(filterFiles(FILES, filt({ query: "stale" }))), "Expected the old name 'stale' not to find the renamed file").toEqual([]);
    expect(paths(filterFiles(FILES, filt({ query: "fresh" }))), "Expected the new name to find it").toEqual(["src/lib/fresh.ts"]);
  });
});

describe("VW-5: filterFiles by extension", () => {
  it("keeps files ending in the extension, and not look-alikes such as .tsx", () => {
    expect(paths(filterFiles(FILES, filt({ extensions: [".ts"] }))), "Expected only .ts files").toEqual(["src/app/main.ts", "src/app/util.ts", "src/lib/old.ts", "src/lib/fresh.ts", "test/main.test.ts"]);
  });

  it("treats '.ts', 'ts' and '.TS' alike", () => {
    const want = paths(filterFiles(FILES, filt({ extensions: [".ts"] })));
    expect(paths(filterFiles(FILES, filt({ extensions: ["ts"] }))), "Expected 'ts' to equal '.ts'").toEqual(want);
    expect(paths(filterFiles(FILES, filt({ extensions: [".TS"] }))), "Expected '.TS' to equal '.ts'").toEqual(want);
  });

  it("ORs several extensions", () => {
    expect(paths(filterFiles(FILES, filt({ extensions: [".md", ".json"] }))), "Expected the .md and the .json file").toEqual(["docs/readme.md", "package.json"]);
  });

  it("supports a multi-dot extension", () => {
    expect(paths(filterFiles(FILES, filt({ extensions: [".test.ts"] }))), "Expected only the test file").toEqual(["test/main.test.ts"]);
  });

  it("ignores blank entries", () => {
    expect(paths(filterFiles(FILES, filt({ extensions: ["", ".md"] }))), "Expected the blank entry not to match everything or nothing").toEqual(["docs/readme.md"]);
  });
});

describe("VW-5: filterFiles by status", () => {
  it.each([
    ["added", ["src/app/util.ts", "test/main.test.ts"]],
    ["removed", ["src/lib/old.ts"]],
    ["renamed", ["src/lib/fresh.ts"]],
    ["modified", ["src/app/main.ts", "src/app/view.tsx", "docs/readme.md", "package.json"]],
  ] as const)("%s", (status, want) => {
    expect(paths(filterFiles(FILES, filt({ statuses: [status] }))), `Expected the ${status} files`).toEqual(want);
  });

  it("ORs several statuses", () => {
    expect(paths(filterFiles(FILES, filt({ statuses: ["added", "removed"] }))), "Expected added and removed files").toEqual(["src/app/util.ts", "src/lib/old.ts", "test/main.test.ts"]);
  });
});

describe("VW-5: the three kinds of filter are ANDed", () => {
  it("applies query, extension and status together", () => {
    expect(paths(filterFiles(FILES, filt({ query: "main", extensions: [".ts"], statuses: ["added"] }))), "Expected only the added .ts file matching 'main'").toEqual(["test/main.test.ts"]);
  });

  it("gives nothing when the kinds contradict each other", () => {
    expect(filterFiles(FILES, filt({ extensions: [".md"], statuses: ["removed"] })), "Expected no removed markdown files").toEqual([]);
  });
});

describe("VW-5: filterTree keeps folders that contain matches", () => {
  const tree = buildFileTree(FILES);

  it("returns the tree unchanged for an inactive filter", () => {
    expect(filterTree(tree, EMPTY_FILE_FILTER), "Expected the same tree").toEqual(tree);
  });

  it("keeps a folder, at any depth, when one of its files matches, and drops the folders and files that do not", () => {
    const out = filterTree(tree, filt({ statuses: ["removed", "renamed"] }));
    expect(treePaths(out), "Expected src and src/lib with the two matching files; no src/app, test or docs").toEqual(["src/", "src/lib/", "src/lib/fresh.ts", "src/lib/old.ts"]);
  });

  it("keeps a deep folder chain down to the match", () => {
    const deep = buildFileTree([f("a/b/c/hit.ts"), f("a/b/miss.md"), f("a/other.md")]);
    expect(treePaths(filterTree(deep, filt({ extensions: [".ts"] }))), "Expected a, a/b and a/b/c with only hit.ts").toEqual(["a/", "a/b/", "a/b/c/", "a/b/c/hit.ts"]);
  });

  it("gives [] when nothing matches", () => {
    expect(filterTree(tree, filt({ query: "zzzq" })), "Expected an empty tree").toEqual([]);
  });

  it("equals the tree built from the filtered files, for any filter", () => {
    for (const filter of [filt({ extensions: [".ts"] }), filt({ query: "main" }), filt({ statuses: ["added"], extensions: [".ts"] })]) {
      expect(filterTree(tree, filter), `Expected filterTree to equal buildFileTree(filterFiles(...)) for ${JSON.stringify(filter)}`).toEqual(buildFileTree(filterFiles(FILES, filter)));
    }
  });

  it("does not change the tree it was given", () => {
    const copy = JSON.parse(JSON.stringify(tree));
    filterTree(tree, filt({ extensions: [".md"] }));
    expect(tree, "Expected the input tree to be left alone").toEqual(copy);
  });
});

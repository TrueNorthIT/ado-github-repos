import { describe, it, expect } from "vitest";
import { buildFileTree, PrFileInput, PrTreeNode } from "./prFiles";

// Module under test: src/lib/prFiles.ts (buildFileTree).
// PR-8: "Files: a file tree of changed files, plus per-file '-x+y'."
// Output shape: folders { kind: "folder", name, path, children }, files { kind: "file", name, path, additions,
// deletions, changeType, stat, previousPath? }. Ordering matches tree.ts: folders first, then files, each
// case-insensitive A-Z with ordinal tie-break. Single-child folders are NOT collapsed (native shows client/ then package.json).

const f = (path: string, over: Partial<PrFileInput> = {}): PrFileInput => ({ path, additions: 1, deletions: 0, changeType: "MODIFIED", ...over });
const names = (nodes: PrTreeNode[]) => nodes.map((n) => n.name);
const folder = (nodes: PrTreeNode[], name: string) => {
  const hit = nodes.find((n) => n.kind === "folder" && n.name === name);
  if (!hit || hit.kind !== "folder") throw new Error(`Expected a folder called ${name}, got ${names(nodes).join(", ")}`);
  return hit;
};

describe("PR-8: changed files form a nested tree", () => {
  it("returns an empty tree for no files", () => {
    expect(buildFileTree([]), "Expected [] for a PR with no changed files").toEqual([]);
  });

  it("puts a root file at the top level", () => {
    const [n] = buildFileTree([f("README.md")]);
    expect(n, "Expected a file node README.md at the root").toMatchObject({ kind: "file", name: "README.md", path: "README.md" });
  });

  it("nests files under their folders, each carrying its full path", () => {
    const tree = buildFileTree([f("src/lib/a.ts"), f("src/b.ts")]);
    const src = folder(tree, "src");
    expect(src.path, "Expected the folder to carry its full path").toBe("src");
    const lib = folder(src.children, "lib");
    expect(lib.path, "Expected the nested folder path src/lib").toBe("src/lib");
    expect(lib.children[0], "Expected a.ts under src/lib").toMatchObject({ kind: "file", name: "a.ts", path: "src/lib/a.ts" });
    expect(names(src.children), "Expected src to hold lib and b.ts").toEqual(["lib", "b.ts"]);
  });

  // Native Azure DevOps shows client/ then package.json even though client has a single child.
  it("does not collapse a folder that has a single child", () => {
    const tree = buildFileTree([f("client/package.json")]);
    expect(tree, "Expected one top-level folder").toHaveLength(1);
    const client = folder(tree, "client");
    expect(client.children, "Expected package.json inside client/").toHaveLength(1);
    expect(client.children[0], "Expected the file, not a collapsed 'client/package.json' folder").toMatchObject({ kind: "file", name: "package.json" });
  });

  it("does not collapse a chain of single-child folders", () => {
    const tree = buildFileTree([f("a/b/c/d.txt")]);
    const c = folder(folder(folder(tree, "a").children, "b").children, "c");
    expect(c.children[0], "Expected a > b > c > d.txt as separate levels").toMatchObject({ kind: "file", name: "d.txt" });
  });
});

describe("PR-8: ordering matches the file browser", () => {
  it("lists folders before files at every level", () => {
    const tree = buildFileTree([f("a.txt"), f("z/x.ts"), f("m/y.ts"), f("b.txt")]);
    expect(names(tree), "Expected folders m, z then files a.txt, b.txt").toEqual(["m", "z", "a.txt", "b.txt"]);
  });

  it("sorts case-insensitively A-Z", () => {
    const tree = buildFileTree([f("zebra.txt"), f("Apple.txt"), f("banana.txt"), f("Docs/x.md"), f("alpha/y.md")]);
    expect(names(tree), "Expected alpha, Docs, then Apple, banana, zebra").toEqual(["alpha", "Docs", "Apple.txt", "banana.txt", "zebra.txt"]);
  });

  it("breaks case-insensitive ties ordinally", () => {
    const tree = buildFileTree([f("b.txt"), f("B.txt")]);
    expect(names(tree), "Expected B.txt before b.txt (ordinal tie-break, as tree.ts)").toEqual(["B.txt", "b.txt"]);
  });

  it("does not depend on the input order", () => {
    const a = buildFileTree([f("x/2.ts"), f("x/1.ts"), f("w.ts")]);
    const b = buildFileTree([f("w.ts"), f("x/1.ts"), f("x/2.ts")]);
    expect(a, "Expected the same tree whatever order GitHub returns the files in").toEqual(b);
  });
});

describe("PR-8: per-file -x+y", () => {
  it("shows deletions then additions as -x+y", () => {
    const [n] = buildFileTree([f("a.ts", { additions: 10, deletions: 2 })]);
    expect(n, "Expected a file node with stat '-2+10'").toMatchObject({ additions: 10, deletions: 2, stat: "-2+10" });
  });

  it("shows zeros explicitly", () => {
    const [added] = buildFileTree([f("new.ts", { additions: 5, deletions: 0, changeType: "ADDED" })]);
    const [removed] = buildFileTree([f("old.ts", { additions: 0, deletions: 7, changeType: "DELETED" })]);
    expect(added, "Expected an added file to read -0+5").toMatchObject({ stat: "-0+5" });
    expect(removed, "Expected a deleted file to read -7+0").toMatchObject({ stat: "-7+0" });
  });

  it("keeps the change type on each file", () => {
    const [n] = buildFileTree([f("new.ts", { changeType: "ADDED" })]);
    expect(n, "Expected changeType ADDED to be carried through").toMatchObject({ changeType: "ADDED" });
  });
});

describe("PR-8: renamed files carry their old path", () => {
  it("sits at the new path and keeps previousPath", () => {
    const tree = buildFileTree([f("src/new/name.ts", { changeType: "RENAMED", previousPath: "src/old/name.ts" })]);
    const leaf = folder(folder(tree, "src").children, "new").children[0];
    expect(leaf, "Expected the renamed file under its NEW folder with the OLD path attached").toMatchObject({
      kind: "file", path: "src/new/name.ts", changeType: "RENAMED", previousPath: "src/old/name.ts",
    });
  });

  it("does not attach previousPath to files that were not renamed", () => {
    const [n] = buildFileTree([f("a.ts", { changeType: "MODIFIED", previousPath: "stale.ts" })]);
    expect(n, "Expected no previousPath on a modified file").not.toHaveProperty("previousPath");
  });
});

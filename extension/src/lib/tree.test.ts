import { describe, it, expect } from "vitest";
import { listFolder, listFromFolderTree, needsFolderFetch, pathExists, findReadme, breadcrumbs, GitTree, GitTreeItem, TreeEntry } from "./tree";

// Module under test: src/lib/tree.ts. Shapes follow GitHub's GET /repos/{o}/{r}/git/trees/{ref}?recursive=1.

const blob = (path: string, size = 10): GitTreeItem => ({ path, mode: "100644", type: "blob", sha: "s-" + path, size });
const dir = (path: string): GitTreeItem => ({ path, mode: "040000", type: "tree", sha: "s-" + path });
const sub = (path: string): GitTreeItem => ({ path, mode: "160000", type: "commit", sha: "s-" + path });
const mk = (tree: GitTreeItem[], truncated = false): GitTree => ({ sha: "root", truncated, tree });
const names = (e: TreeEntry[]) => e.map((x) => x.name);
const file = (name: string): TreeEntry => ({ name, path: name, kind: "file" });
const folder = (name: string): TreeEntry => ({ name, path: name, kind: "folder" });

const repoTree = mk([
  blob("README.md"), blob("zebra.txt"), blob("Apple.txt"), dir("src"), dir("Docs"), dir(".github"),
  blob("src/index.ts", 1234), blob("src/Util.ts"), dir("src/lib"), blob("src/lib/deep.ts"),
  blob("Docs/guide.md"), blob(".github/workflows.yml"), sub("vendor-lib"),
]);

describe("B-3: Listings show folders first, then files, each A-Z", () => {
  // listFolder(tree, "") lists only the direct children of the root, folders before files, case-insensitive A-Z.
  it("lists root children with folders first then files, each case-insensitively A-Z", () => {
    const entries = listFolder(repoTree, "");
    const folders = entries.filter((e) => e.kind === "folder");
    const files = entries.filter((e) => e.kind === "file");
    expect(names(folders), "Expected root folders A-Z ignoring case").toEqual([".github", "Docs", "src"]);
    expect(names(files), "Expected root files A-Z ignoring case").toEqual(["Apple.txt", "README.md", "zebra.txt"]);
    const lastFolder = entries.map((e) => e.kind).lastIndexOf("folder");
    const firstFile = entries.map((e) => e.kind).indexOf("file");
    expect(lastFolder < firstFile, `Expected every folder before every file, got ${names(entries).join(", ")}`).toBe(true);
  });

  it("lists only direct children of a sub-folder, with full paths and the last segment as name", () => {
    const entries = listFolder(repoTree, "src");
    expect(entries, "Expected src to list lib first, then index.ts and Util.ts A-Z ignoring case").toEqual([
      { name: "lib", path: "src/lib", kind: "folder" },
      { name: "index.ts", path: "src/index.ts", kind: "file", size: 1234 },
      { name: "Util.ts", path: "src/Util.ts", kind: "file", size: 10 },
    ]);
  });

  it("lists a nested folder", () => {
    expect(listFolder(repoTree, "src/lib"), "Expected src/lib to contain deep.ts").toEqual([{ name: "deep.ts", path: "src/lib/deep.ts", kind: "file", size: 10 }]);
  });

  it("breaks case-insensitive ties stably, whatever the input order", () => {
    const a = listFolder(mk([blob("readme"), blob("Readme"), blob("README")]), "");
    const b = listFolder(mk([blob("README"), blob("Readme"), blob("readme")]), "");
    expect(names(a), "Expected the same order for the same names regardless of input order").toEqual(names(b));
    expect(names(a), "Expected the ordinal tie-break (uppercase before lowercase)").toEqual(["README", "Readme", "readme"]);
  });

  it("gives an empty listing for a folder that is not in the tree", () => {
    expect(listFolder(repoTree, "nope"), "Expected no entries for a missing folder").toEqual([]);
  });

  it("gives an empty listing when the path is a file", () => {
    expect(listFolder(repoTree, "README.md"), "Expected no entries when the path is a file").toEqual([]);
  });

  it("does not list a folder's contents as children of a folder with a similar name prefix", () => {
    const t = mk([dir("doc"), dir("docs"), blob("doc/a.md"), blob("docs/b.md")]);
    expect(names(listFolder(t, "doc")), "Expected 'doc' to contain only a.md, not docs/b.md").toEqual(["a.md"]);
  });
});

describe("B-3: A submodule is listed but not navigable", () => {
  // A tree item of type "commit" is a submodule: listed with kind "submodule" and no size.
  it("reports a commit-type item as kind 'submodule'", () => {
    const entry = listFolder(repoTree, "").find((e) => e.name === "vendor-lib");
    expect(entry, "Expected the submodule to appear in the listing").toBeDefined();
    expect(entry?.kind, "Expected a 'commit' tree item to have kind 'submodule', not 'folder' or 'file'").toBe("submodule");
    expect(entry?.path, "Expected the submodule's path").toBe("vendor-lib");
  });
});

describe("B-12: Very large repos can still be browsed folder by folder", () => {
  // listFromFolderTree takes GitHub's non-recursive response for one folder (bare names) and returns the same shape as listFolder.
  it("builds the same listing shape from a non-recursive folder response", () => {
    const response = mk([blob("b.ts", 5), dir("zeta"), blob("A.ts", 7), dir("alpha")]);
    expect(listFromFolderTree(response, "src/big"), "Expected folders first (A-Z), then files, with full paths prefixed by the folder").toEqual([
      { name: "alpha", path: "src/big/alpha", kind: "folder" },
      { name: "zeta", path: "src/big/zeta", kind: "folder" },
      { name: "A.ts", path: "src/big/A.ts", kind: "file", size: 7 },
      { name: "b.ts", path: "src/big/b.ts", kind: "file", size: 5 },
    ]);
  });

  it("reports a submodule in a non-recursive response as kind 'submodule'", () => {
    const entry = listFromFolderTree(mk([sub("mod"), blob("a.txt")]), "src").find((e) => e.name === "mod");
    expect(entry, "Expected the submodule in the non-recursive listing").toEqual({ name: "mod", path: "src/mod", kind: "submodule" });
  });

  it("uses bare names as paths when the folder is the root", () => {
    expect(listFromFolderTree(mk([blob("a.txt", 1), dir("d")]), ""), "Expected root paths to have no leading slash").toEqual([
      { name: "d", path: "d", kind: "folder" },
      { name: "a.txt", path: "a.txt", kind: "file", size: 1 },
    ]);
  });

  it("gives the same entries from a recursive and a non-recursive response of the same folder", () => {
    const recursive = listFolder(repoTree, "src");
    const nonRecursive = listFromFolderTree(mk([blob("index.ts", 1234), blob("Util.ts"), dir("lib")]), "src");
    expect(nonRecursive, "Expected the two code paths to give identical listings").toEqual(recursive);
  });

  // needsFolderFetch: a truncated recursive response cannot be trusted for any folder, so a non-recursive fetch is needed.
  it("says a non-recursive fetch is needed for the root and sub-folders when the recursive tree is truncated", () => {
    const truncated = mk([blob("a.txt"), dir("src"), blob("src/a.ts")], true);
    expect(needsFolderFetch(truncated, ""), "Expected a truncated tree to need a folder fetch for the root").toBe(true);
    expect(needsFolderFetch(truncated, "src"), "Expected a truncated tree to need a folder fetch for src").toBe(true);
  });

  it("says no fetch is needed when the recursive tree is complete", () => {
    expect(needsFolderFetch(repoTree, ""), "Expected a complete tree to be trusted for the root").toBe(false);
    expect(needsFolderFetch(repoTree, "src"), "Expected a complete tree to be trusted for src").toBe(false);
  });

  it("treats a missing truncated flag as complete", () => {
    expect(needsFolderFetch({ sha: "x", tree: [blob("a")] }, ""), "Expected undefined truncated to mean trustworthy").toBe(false);
  });
});

describe("B-7: pathExists (used to keep the path when switching branch)", () => {
  it("is true for the root", () => {
    expect(pathExists(repoTree, ""), "Expected the root to always exist").toBe(true);
  });
  it("is true for a file and for a folder", () => {
    expect(pathExists(repoTree, "src/index.ts"), "Expected an existing file to exist").toBe(true);
    expect(pathExists(repoTree, "src/lib"), "Expected an existing folder to exist").toBe(true);
  });
  it("is false for a missing path", () => {
    expect(pathExists(repoTree, "src/missing.ts"), "Expected a missing file not to exist").toBe(false);
    expect(pathExists(repoTree, "nope"), "Expected a missing folder not to exist").toBe(false);
  });
  it("is case-sensitive, as git paths are", () => {
    expect(pathExists(repoTree, "SRC"), "Expected 'SRC' not to match 'src'").toBe(false);
    expect(pathExists(repoTree, "docs"), "Expected 'docs' not to match 'Docs'").toBe(false);
  });
  it("does not match a partial segment", () => {
    expect(pathExists(repoTree, "sr"), "Expected a prefix of a segment not to exist").toBe(false);
  });
});

describe("B-4: A folder with a README shows it rendered below the listing (findReadme)", () => {
  it("finds README.md", () => {
    expect(findReadme([file("a.txt"), file("README.md")])?.name, "Expected README.md to be found").toBe("README.md");
  });
  it.each(["README.md", "readme.md", "Readme.MD", "README", "readme", "README.markdown"])("finds %s", (n) => {
    expect(findReadme([file("other.txt"), file(n)])?.name, `Expected ${n} to be recognised as a README`).toBe(n);
  });
  it("prefers a .md README over README and README.markdown", () => {
    expect(findReadme([file("README"), file("README.markdown"), file("readme.md")])?.name, "Expected the .md README to win").toBe("readme.md");
  });
  it("returns the entry itself, with its path, so it can be fetched", () => {
    const e: TreeEntry = { name: "README.md", path: "docs/README.md", kind: "file", size: 3 };
    expect(findReadme([folder("x"), e]), "Expected the same entry back").toEqual(e);
  });
  it("returns undefined when there is no README", () => {
    expect(findReadme([file("index.ts"), file("README.txt"), file("README.rst"), file("README-old.md")]), "Expected no README").toBeUndefined();
    expect(findReadme([]), "Expected no README in an empty folder").toBeUndefined();
  });
  it("ignores a folder called README", () => {
    expect(findReadme([folder("README"), folder("readme.md")]), "Expected folders not to count as READMEs").toBeUndefined();
  });
});

describe("B-3: breadcrumb segments for a path", () => {
  it("gives one segment per component with the cumulative path", () => {
    expect(breadcrumbs("docs/api/a.md"), "Expected a crumb for each folder and the file").toEqual([
      { name: "docs", path: "docs" },
      { name: "api", path: "docs/api" },
      { name: "a.md", path: "docs/api/a.md" },
    ]);
  });
  it("gives a single segment for a top-level item", () => {
    expect(breadcrumbs("src"), "Expected one crumb").toEqual([{ name: "src", path: "src" }]);
  });
  it("gives no segments for the root", () => {
    expect(breadcrumbs(""), "Expected the root to have no crumbs (the UI adds the repo crumb)").toEqual([]);
  });
  it("keeps spaces and unicode in names untouched", () => {
    expect(breadcrumbs("my docs/café.md"), "Expected raw, unencoded names").toEqual([
      { name: "my docs", path: "my docs" },
      { name: "café.md", path: "my docs/café.md" },
    ]);
  });
});

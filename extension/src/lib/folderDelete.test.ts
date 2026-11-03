import { describe, it, expect } from "vitest";
import { commitMessage, commitRequest, createRefRequest, deleteFolderMessage, deleteTreeRequest, filesUnder, isNotFastForward, updateRefRequest } from "./folderDelete";
import type { GitTreeItem } from "./tree";

const items: GitTreeItem[] = [
  { path: "docs", type: "tree", sha: "t1", mode: "040000" },
  { path: "docs/a.md", type: "blob", sha: "b1", mode: "100644" },
  { path: "docs/img", type: "tree", sha: "t2", mode: "040000" },
  { path: "docs/img/x.png", type: "blob", sha: "b2", mode: "100644" },
  { path: "docs/run.sh", type: "blob", sha: "b3", mode: "100755" },
  { path: "docs/vendor", type: "commit", sha: "c1" },
  { path: "docsite/index.md", type: "blob", sha: "b4", mode: "100644" },
  { path: "README.md", type: "blob", sha: "b5" },
];

describe("filesUnder", () => {
  it("takes every file and submodule under the folder, at any depth, with its mode", () => {
    expect(filesUnder(items, "docs")).toEqual([
      { path: "docs/a.md", type: "blob", mode: "100644" },
      { path: "docs/img/x.png", type: "blob", mode: "100644" },
      { path: "docs/run.sh", type: "blob", mode: "100755" },
      { path: "docs/vendor", type: "commit", mode: "160000" },
    ]);
  });
  it("does not take a sibling whose name starts the same, nor the folder entries", () => {
    expect(filesUnder(items, "docs").some((e) => e.path.startsWith("docsite"))).toBe(false);
    expect(filesUnder(items, "docs/img")).toEqual([{ path: "docs/img/x.png", type: "blob", mode: "100644" }]);
  });
});

describe("the requests", () => {
  it("a tree on the base with each file set to sha: null", () => {
    expect(deleteTreeRequest("a/b", "base", [{ path: "docs/a.md", type: "blob", mode: "100644" }])).toEqual({
      method: "POST", path: "/repos/a/b/git/trees", body: { base_tree: "base", tree: [{ path: "docs/a.md", mode: "100644", type: "blob", sha: null }] },
    });
    expect(() => deleteTreeRequest("a/b", "base", [])).toThrow();
  });
  it("a commit with the head as its one parent; the description goes after a blank line", () => {
    expect(commitRequest("a/b", { message: { headline: "Delete docs", body: " why \n" }, tree: "t", parent: "h" })).toEqual({
      method: "POST", path: "/repos/a/b/git/commits", body: { message: "Delete docs\n\nwhy", tree: "t", parents: ["h"] },
    });
    expect(commitMessage({ headline: "x", body: "  " })).toBe("x");
  });
  it("moves the branch without force, encoding each segment; or creates the new branch", () => {
    expect(updateRefRequest("a/b", "feature/x y", "c")).toEqual({ method: "PATCH", path: "/repos/a/b/git/refs/heads/feature/x%20y", body: { sha: "c", force: false } });
    expect(createRefRequest("a/b", "me-patch-1", "c")).toEqual({ method: "POST", path: "/repos/a/b/git/refs", body: { ref: "refs/heads/me-patch-1", sha: "c" } });
  });
  it("knows GitHub's stale-branch refusal", () => {
    expect(isNotFastForward("Update is not a fast forward")).toBe(true);
    expect(isNotFastForward("Reference does not exist")).toBe(false);
    expect(isNotFastForward(undefined)).toBe(false);
  });
  it("the default message", () => {
    expect(deleteFolderMessage("docs/img")).toBe("Delete docs/img");
  });
});

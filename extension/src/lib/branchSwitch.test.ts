import { describe, it, expect } from "vitest";
import { pathAfterSwitch, filterBranches } from "./branchSwitch";
import type { GitTree } from "./tree";

// Module under test: src/lib/branchSwitch.ts.

const newTree: GitTree = {
  sha: "r",
  truncated: false,
  tree: [
    { path: "src", type: "tree", sha: "1", mode: "040000" },
    { path: "src/index.ts", type: "blob", sha: "2", mode: "100644", size: 1 },
    { path: "docs", type: "tree", sha: "3", mode: "040000" },
  ],
};

describe("B-7: Switching branch keeps the same path if it exists on the new branch, otherwise goes to the root", () => {
  // pathAfterSwitch(currentPath, newBranchTree)
  it("keeps a file path that exists on the new branch", () => {
    expect(pathAfterSwitch("src/index.ts", newTree), "Expected to stay on src/index.ts").toBe("src/index.ts");
  });
  it("keeps a folder path that exists on the new branch", () => {
    expect(pathAfterSwitch("docs", newTree), "Expected to stay in docs").toBe("docs");
  });
  it("goes to the root when the path does not exist on the new branch", () => {
    expect(pathAfterSwitch("src/removed.ts", newTree), "Expected the root ('') for a missing file").toBe("");
    expect(pathAfterSwitch("gone/deep/dir", newTree), "Expected the root ('') for a missing folder").toBe("");
  });
  it("stays at the root when already at the root", () => {
    expect(pathAfterSwitch("", newTree), "Expected the root to stay the root").toBe("");
  });
});

describe("B-7: A branch picker lists branches with search (filterBranches)", () => {
  const branches = ["develop", "feature/Login", "feature/logout", "main", "release/1.0"];

  it("returns every branch for an empty query", () => {
    expect(filterBranches(branches, "", "main"), "Expected all branches, default first, rest in input order").toEqual(["main", "develop", "feature/Login", "feature/logout", "release/1.0"]);
  });
  it("matches a case-insensitive substring", () => {
    expect(filterBranches(branches, "LOG", undefined), "Expected 'LOG' to match Login and logout").toEqual(["feature/Login", "feature/logout"]);
  });
  it("matches anywhere in the name, not just the start", () => {
    expect(filterBranches(branches, "ease/1", undefined), "Expected a mid-string match").toEqual(["release/1.0"]);
  });
  it("ignores leading and trailing whitespace in the query", () => {
    expect(filterBranches(branches, "  main ", undefined), "Expected the query to be trimmed").toEqual(["main"]);
  });
  it("pins the default branch first when it matches", () => {
    expect(filterBranches(["a-feature", "z-main", "m-feature"], "", "z-main")[0], "Expected the default branch first").toBe("z-main");
    expect(filterBranches(["a-x", "default-x", "b-x"], "x", "default-x"), "Expected the default pinned first among matches").toEqual(["default-x", "a-x", "b-x"]);
  });
  it("leaves out the default branch when it does not match the query", () => {
    expect(filterBranches(branches, "feature", "main"), "Expected main to be filtered out like any other branch").toEqual(["feature/Login", "feature/logout"]);
  });
  it("gives an empty list when nothing matches", () => {
    expect(filterBranches(branches, "zzz", "main"), "Expected no matches").toEqual([]);
  });
  it("does not duplicate or invent a default branch that is not in the list", () => {
    expect(filterBranches(["a", "b"], "", "missing"), "Expected only real branches").toEqual(["a", "b"]);
  });
  it("does not mutate its input", () => {
    const input = ["b", "a", "main"];
    filterBranches(input, "", "main");
    expect(input, "Expected the input array to be unchanged").toEqual(["b", "a", "main"]);
  });
});

import { describe, it, expect } from "vitest";
import { compareRefOptions, refKind, renameBranchRequest, renameErrorText, renameInPrefs, setDefaultBranchRequest } from "./branches";

const REPO = "octo/demo";

describe("rename and set as default requests", () => {
  it("renames with POST .../branches/{branch}/rename and new_name, the branch encoded", () => {
    expect(renameBranchRequest(REPO, "feature/a b", "feature/c")).toEqual({ method: "POST", path: "/repos/octo/demo/branches/feature%2Fa%20b/rename", body: { new_name: "feature/c" } });
  });
  it("sets the default with PATCH /repos/{repo}", () => {
    expect(setDefaultBranchRequest(REPO, "develop")).toEqual({ method: "PATCH", path: "/repos/octo/demo", body: { default_branch: "develop" } });
  });
});

describe("renameErrorText", () => {
  const plain = { isDefault: false, protected: false };
  it("explains a 403 on the default or a protected branch as needing admin", () => {
    expect(renameErrorText(403, undefined, { isDefault: true, protected: true })).toMatch(/default branch needs admin/);
    expect(renameErrorText(403, undefined, { isDefault: false, protected: true })).toMatch(/protected branch needs admin/);
    expect(renameErrorText(403, undefined, plain)).toMatch(/write access/);
  });
  it("passes on GitHub's message for a 422, and words a 404", () => {
    expect(renameErrorText(422, "Branch x already exists.", plain)).toBe("GitHub said: Branch x already exists.");
    expect(renameErrorText(404, undefined, plain)).toMatch(/wasn't found/);
  });
  it("leaves anything else to the generic wording", () => {
    expect(renameErrorText(500, "boom", plain)).toBeNull();
    expect(renameErrorText(422, undefined, plain)).toBeNull();
  });
});

describe("renameInPrefs", () => {
  const prefs = { graph: true, favourites: { [REPO]: ["a", "b"], "o/other": ["a"] }, compareBase: { [REPO]: "a", "o/other": "a" } };
  it("renames the favourite and the compare branch in this repo only", () => {
    const out = renameInPrefs(prefs, REPO, "a", "z");
    expect(out.favourites).toEqual({ [REPO]: ["z", "b"], "o/other": ["a"] });
    expect(out.compareBase).toEqual({ [REPO]: "z", "o/other": "a" });
    expect(out.graph).toBe(true);
  });
  it("renames only what names the branch", () => {
    const out = renameInPrefs(prefs, REPO, "b", "y");
    expect(out.favourites[REPO]).toEqual(["a", "y"]);
    expect(out.compareBase).toBe(prefs.compareBase);
  });
  it("hands back the same object when nothing names it", () => {
    expect(renameInPrefs(prefs, REPO, "nope", "x")).toBe(prefs);
    expect(renameInPrefs({ favourites: {} }, REPO, "a", "x")).toEqual({ favourites: {} });
  });
});

describe("compare refs", () => {
  const branches = ["main", "develop", "feature/x", "cafe1234"];
  const tags = ["v1.0.0", "v2.0.0-beta.1"];
  it("refKind: a known branch, then a tag, then a SHA, else a branch", () => {
    expect(refKind("develop", branches, tags)).toBe("branch");
    expect(refKind("cafe1234", branches, tags)).toBe("branch");
    expect(refKind("v1.0.0", branches, tags)).toBe("tag");
    expect(refKind("ABCDEF0", branches, tags)).toBe("commit");
    expect(refKind("unknown/branch", branches, tags)).toBe("branch");
  });
  it("lists matching branches (default first) and tags", () => {
    expect(compareRefOptions(branches, tags, "", "develop")).toEqual({ branches: ["develop", "main", "feature/x", "cafe1234"], tags });
    expect(compareRefOptions(branches, tags, " V2 ")).toEqual({ branches: [], tags: ["v2.0.0-beta.1"] });
  });
  it("offers a typed SHA of 7 to 40 hex as a commit unless a branch or tag has that name", () => {
    expect(compareRefOptions(branches, tags, "ABCDEF0").commit).toBe("abcdef0");
    expect(compareRefOptions(branches, tags, "abcdef").commit).toBeUndefined();
    expect(compareRefOptions(branches, tags, "cafe1234").commit).toBeUndefined();
    expect(compareRefOptions(branches, tags, "a".repeat(41)).commit).toBeUndefined();
  });
});

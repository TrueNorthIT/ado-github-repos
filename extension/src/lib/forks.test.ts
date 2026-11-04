import { describe, it, expect } from "vitest";
import {
  applySourceRepo, createForkRequest, forkCompareRequest, forksRequest, githubForkUrl, mapForkCompare, openPullsFromRequest, parseForks, parseSourceRepo,
  serializeForks, toFork, toForks,
} from "./forks";
import { createPullRequestMutation } from "./createPrPlan";
import { applyNewPr } from "./newPrHash";

// Module under test: src/lib/forks.ts (REST forks, cross-repository compare `base...owner:branch`, create a fork, and the hash keys).

const rest = (over: Record<string, unknown> = {}) => ({
  full_name: "alice/repo", node_id: "R_1", private: false, default_branch: "trunk", pushed_at: "2026-10-01T10:00:00Z",
  html_url: "https://github.com/alice/repo", owner: { login: "alice", type: "User", avatar_url: "https://avatars/a" }, ...over,
});

describe("the REST requests", () => {
  it("lists forks newest first, 100 a page", () => expect(forksRequest("o/r", 2)).toEqual({ method: "GET", path: "/repos/o/r/forks?sort=newest&per_page=100&page=2" }));
  it("compares across repositories with owner:branch", () => {
    expect(forkCompareRequest("o/r", "main", "alice", "feature/x")).toEqual({ method: "GET", path: "/repos/o/r/compare/main...alice:feature/x?per_page=1" });
    expect(forkCompareRequest("o/r", "main", "alice", "a b", 100).path).toBe("/repos/o/r/compare/main...alice:a%20b?per_page=100");
    expect(() => forkCompareRequest("o/r", "main", "", "x")).toThrow();
  });
  it("finds open pulls from the fork's branch", () => {
    expect(openPullsFromRequest("o/r", "main", "alice", "fix/1").path).toBe("/repos/o/r/pulls?head=alice%3Afix%2F1&base=main&state=open&per_page=5");
  });
  it("creates a fork in the viewer's account, or an organisation", () => {
    expect(createForkRequest("o/r")).toEqual({ method: "POST", path: "/repos/o/r/forks", body: {} });
    expect(createForkRequest("o/r", { organization: " acme ", defaultBranchOnly: true }).body).toEqual({ organization: "acme", default_branch_only: true });
  });
  it("links GitHub's own fork page", () => expect(githubForkUrl("o/r")).toBe("https://github.com/o/r/fork"));
});

describe("toFork", () => {
  it("maps a REST repository", () => {
    expect(toFork(rest())).toEqual({
      fullName: "alice/repo", owner: "alice", ownerAvatar: "https://avatars/a", ownerType: "User", defaultBranch: "trunk",
      pushedAt: new Date("2026-10-01T10:00:00Z"), htmlUrl: "https://github.com/alice/repo", nodeId: "R_1", isPrivate: false,
    });
  });
  it("drops entries without a valid full_name, keeps safe defaults, and refuses a non-https html_url", () => {
    expect(toForks([rest(), null, { full_name: "../x" }, rest({ full_name: "bob/r", pushed_at: null, html_url: "javascript:alert(1)", owner: undefined })]).map((f) => [f.fullName, f.owner, f.pushedAt, f.htmlUrl])).toEqual([
      ["alice/repo", "alice", new Date("2026-10-01T10:00:00Z"), "https://github.com/alice/repo"],
      ["bob/r", "bob", null, "https://github.com/bob/r"],
    ]);
    expect(toForks({ message: "Not Found" })).toEqual([]);
  });
});

describe("mapForkCompare", () => {
  const repo = { node_id: "R_parent", default_branch: "main", allow_auto_merge: true };
  const cmp = { status: "diverged", ahead_by: 2, behind_by: 5, total_commits: 2, commits: [{ sha: "a1", commit: { message: "Fix typo\n\nIn the readme." } }, { sha: "b2", commit: { message: "Follow-up" } }] };
  it("maps the comparison, oldest commit first, with the head as the last commit", () => {
    expect(mapForkCompare(repo, cmp, [])).toEqual({
      repoId: "R_parent", defaultBranch: "main", autoMergeAllowed: true, baseExists: true, headExists: true, headOid: "b2", ahead: 2, behind: 5, status: "DIVERGED",
      commits: [{ oid: "a1", subject: "Fix typo", body: "In the readme." }, { oid: "b2", subject: "Follow-up", body: "" }], commitCount: 2, existingPr: null,
    });
  });
  it("says the head is missing when the compare was a 404 (null)", () => {
    const m = mapForkCompare(repo, null, []);
    expect([m.headExists, m.ahead, m.commits]).toEqual([false, 0, []]);
  });
  it("reports an open pull request from the same head", () => {
    expect(mapForkCompare(repo, cmp, [{ number: 9, title: "T", html_url: "https://github.com/o/r/pull/9", draft: true }]).existingPr).toEqual({ number: 9, title: "T", url: "https://github.com/o/r/pull/9", isDraft: true });
  });
});

describe("hash keys", () => {
  it("routes view=forks with a valid repo", () => {
    expect(parseForks(serializeForks("o/r"))).toEqual({ repo: "o/r" });
    expect(parseForks("#repo=o%2Fr")).toBeNull();
    expect(parseForks("#repo=..%2Fx&view=forks")).toBeNull();
  });
  it("keeps sourceRepo beside the New pull request keys", () => {
    const h = applySourceRepo(applyNewPr("#repo=o%2Fr", { source: "main" }), "alice/repo");
    expect(parseSourceRepo(h)).toBe("alice/repo");
    expect(parseSourceRepo(applyNewPr(h, { source: "dev" }))).toBe("alice/repo"); // applyNewPr keeps it
    expect(parseSourceRepo(applySourceRepo(h, undefined))).toBeUndefined();
    expect(parseSourceRepo("#sourceRepo=not-a-repo")).toBeUndefined();
  });
});

describe("createPullRequestMutation from a fork", () => {
  const p = { repositoryId: "R_parent", baseRefName: "main", headRefName: "fix", title: "Fix" };
  it("adds headRepositoryId only when given", () => {
    expect(createPullRequestMutation({ ...p, headRepositoryId: "R_fork" }).variables.input).toMatchObject({ headRepositoryId: "R_fork", headRefName: "fix" });
    expect(createPullRequestMutation(p).variables.input).not.toHaveProperty("headRepositoryId");
  });
});

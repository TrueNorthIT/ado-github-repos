import { describe, expect, it } from "vitest";
import { connectedRepos, myWorkSearchPath, onlyConnected, projectIndex, PROJECT_CACHE_TTL, readProjectCache, toMyWorkRows, type MyWorkRow } from "./myWork";

describe("myWorkSearchPath", () => {
  it("searches open pull requests by the viewer, newest activity first", () => {
    const u = new URL(`https://api.github.com${myWorkSearchPath("created")}`);
    expect(u.pathname).toBe("/search/issues");
    expect(u.searchParams.get("q")).toBe("is:pr is:open archived:false author:@me");
    expect(u.searchParams.get("sort")).toBe("updated");
    expect(u.searchParams.get("per_page")).toBe("100");
  });
  it("asks for review requests in the other section", () => {
    expect(new URL(`https://x${myWorkSearchPath("review-requested")}`).searchParams.get("q")).toContain("review-requested:@me");
  });
});

describe("toMyWorkRows", () => {
  it("reads the repository from repository_url and keeps only pull requests", () => {
    const { total, rows } = toMyWorkRows({
      total_count: 42,
      items: [
        { number: 3, title: "Greeting", html_url: "https://github.com/o/r/pull/3", repository_url: "https://api.github.com/repos/o/r", pull_request: {}, draft: true, user: { login: "ann", avatar_url: "a" }, updated_at: "2026-11-01T00:00:00Z" },
        { number: 4, title: "An issue", repository_url: "https://api.github.com/repos/o/r", user: { login: "ann" } },
        { number: 5, title: "No repo", pull_request: {} },
      ],
    });
    expect(total).toBe(42);
    expect(rows).toEqual([{ repo: "o/r", number: 3, title: "Greeting", url: "https://github.com/o/r/pull/3", draft: true, authorLogin: "ann", avatarUrl: "a", updatedAt: new Date("2026-11-01T00:00:00Z") }]);
  });
  it("copes with a deleted author and an empty answer", () => {
    expect(toMyWorkRows({ items: [{ number: 1, repository_url: "https://api.github.com/repos/o/r", pull_request: {}, user: null }] }).rows[0].authorLogin).toBe("ghost");
    expect(toMyWorkRows({})).toEqual({ total: 0, rows: [] });
  });
});

describe("connectedRepos", () => {
  it("keeps github.com owner/name once each, whatever the URL's case, .git or trailing slash", () => {
    expect(
      connectedRepos([
        { repos: [{ gitHubRepositoryUrl: "https://github.com/TrueNorthIT/TrueTunes" }, { gitHubRepositoryUrl: "https://github.com/truenorthit/truetunes.git" }, { errorMessage: "x" } as never] },
        { repos: [{ gitHubRepositoryUrl: "https://github.com/o/r/" }, { gitHubRepositoryUrl: "https://ghe.example.com/o/r" }, { gitHubRepositoryUrl: "https://github.com/o/r/tree/main" }] },
      ])
    ).toEqual(["truenorthit/truetunes", "o/r"]);
  });
});

describe("projectIndex and onlyConnected", () => {
  const row = (repo: string): MyWorkRow => ({ repo, number: 1, title: "t", url: "u", draft: false, authorLogin: "a", updatedAt: new Date(0) });
  const index = projectIndex([
    { project: "Alpha", repos: ["TrueNorthIT/TrueTunes", "o/shared"] },
    { project: "Beta", repos: ["o/Shared"] },
  ]);
  it("lists every project that connects a repository, matching case-insensitively", () => {
    expect(index.get("o/shared")).toEqual(["Alpha", "Beta"]);
    expect(onlyConnected([row("truenorthit/truetunes"), row("O/SHARED"), row("x/unconnected")], index).map((r) => [r.repo, r.projects])).toEqual([
      ["truenorthit/truetunes", ["Alpha"]],
      ["O/SHARED", ["Alpha", "Beta"]],
    ]);
  });
});

describe("readProjectCache", () => {
  const list = [{ project: "Alpha", repos: ["o/r"] }];
  it("reads a stored scan and says whether it is fresh", () => {
    expect(readProjectCache(JSON.stringify({ at: 1000, list }), 1000 + PROJECT_CACHE_TTL - 1)).toEqual({ list, fresh: true });
    expect(readProjectCache(JSON.stringify({ at: 1000, list }), 1000 + PROJECT_CACHE_TTL)?.fresh).toBe(false);
  });
  it("ignores anything else", () => {
    for (const raw of [null, "", "not json", "{}", JSON.stringify({ at: 1, list: [{ project: 1, repos: [] }] }), JSON.stringify({ at: 1, list: [{ project: "a", repos: [2] }] })]) expect(readProjectCache(raw, 0)).toBeUndefined();
  });
});

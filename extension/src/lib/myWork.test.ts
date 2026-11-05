import { describe, expect, it } from "vitest";
import { myWorkSearchPath, toMyWorkRows } from "./myWork";

describe("myWorkSearchPath", () => {
  it("searches open pull requests by the viewer, newest activity first", () => {
    const u = new URL(`https://api.github.com${myWorkSearchPath("created")}`);
    expect(u.pathname).toBe("/search/issues");
    expect(u.searchParams.get("q")).toBe("is:pr is:open archived:false author:@me");
    expect(u.searchParams.get("sort")).toBe("updated");
    expect(u.searchParams.get("per_page")).toBe("20");
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

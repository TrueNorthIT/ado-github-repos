import { describe, it, expect } from "vitest";
import { mapCompareCommits, mergeCompare, compareSummary } from "./branchCompare";

const rc = (sha: string, over: Record<string, unknown> = {}) => ({
  sha,
  commit: { message: `Title ${sha}\n\nBody`, author: { name: "Ann", date: "2026-01-02T00:00:00Z" }, committer: { date: "2026-01-03T00:00:00Z" } },
  author: { login: "ann", avatar_url: "https://example.test/a.png" },
  parents: [{ sha: "p" + sha }],
  ...over,
});

describe("mapCompareCommits", () => {
  it("maps REST commits to commit rows, newest first (REST lists oldest first)", () => {
    const rows = mapCompareCommits([rc("aaaaaaaaaa"), rc("bbbbbbbbbb")]);
    expect(rows.map((r) => r.sha)).toEqual(["bbbbbbbbbb", "aaaaaaaaaa"]);
    expect(rows[1]).toMatchObject({ shortSha: "aaaaaaaa", title: "Title aaaaaaaaaa", parents: ["paaaaaaaaaa"], prNumber: null, status: null });
    expect(rows[1].message).toContain("Body");
    expect(rows[1].author).toEqual({ name: "Ann", login: "ann", avatarUrl: "https://example.test/a.png" });
    expect(rows[1].date.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(rows[1].committedDate.toISOString()).toBe("2026-01-03T00:00:00.000Z");
  });
  it("copes with an author that has no GitHub account", () => {
    const [r] = mapCompareCommits([rc("cccccccccc", { author: null })]);
    expect(r.author.login).toBeNull();
    expect(r.author.name).toBe("Ann");
  });
  it("copes with missing fields", () => {
    expect(() => mapCompareCommits([{ sha: "dddddddddd" } as any])).not.toThrow();
    expect(mapCompareCommits([{ sha: "dddddddddd" } as any])[0].title).toBe("");
  });
  it("gives [] for nothing", () => {
    expect(mapCompareCommits(undefined)).toEqual([]);
  });
});

describe("mergeCompare", () => {
  it("takes the counts from the first page and concatenates commits across pages", () => {
    const m = mergeCompare([
      { ahead_by: 3, behind_by: 1, status: "diverged", total_commits: 3, commits: [rc("aaaaaaaaaa"), rc("bbbbbbbbbb")] },
      { ahead_by: 3, behind_by: 1, status: "diverged", total_commits: 3, commits: [rc("cccccccccc")] },
    ]);
    expect(m).toMatchObject({ ahead: 3, behind: 1, status: "diverged", total: 3 });
    expect(m.commits.map((c) => c.sha)).toEqual(["cccccccccc", "bbbbbbbbbb", "aaaaaaaaaa"]);
  });
  it("defaults the counts to 0 and throws for no pages", () => {
    expect(mergeCompare([{}])).toMatchObject({ ahead: 0, behind: 0, total: 0, commits: [] });
    expect(() => mergeCompare([])).toThrow();
  });
});

describe("compareSummary", () => {
  it("says identical when nothing differs", () => {
    expect(compareSummary("main", "feat", 0, 0)).toBe("feat and main are identical.");
  });
  it("describes ahead and behind, singular and plural", () => {
    expect(compareSummary("main", "feat", 1, 0)).toBe("feat is 1 commit ahead of main.");
    expect(compareSummary("main", "feat", 3, 0)).toBe("feat is 3 commits ahead of main.");
    expect(compareSummary("main", "feat", 0, 2)).toBe("feat is 2 commits behind main.");
    expect(compareSummary("main", "feat", 3, 1)).toBe("feat is 3 commits ahead of and 1 commit behind main.");
  });
});

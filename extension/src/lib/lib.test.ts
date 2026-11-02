import { describe, it, expect } from "vitest";
import { parseRepoUrl } from "./repoUrl";
import { mergeRows, filterRows, MetaResult } from "./rows";
import { tokenAction, relativeTime } from "./tokens";

describe("parseRepoUrl", () => {
  it("handles plain, trailing slash, .git, GHES, junk", () => {
    expect(parseRepoUrl("https://github.com/o/r")).toEqual({ host: "github.com", owner: "o", repo: "r" });
    expect(parseRepoUrl("https://github.com/o/r/")?.repo).toBe("r");
    expect(parseRepoUrl("https://github.com/o/r.git")?.repo).toBe("r");
    expect(parseRepoUrl("https://ghe.corp.com/o/r.git/")).toEqual({ host: "ghe.corp.com", owner: "o", repo: "r" });
    expect(parseRepoUrl("https://github.com/o")).toBeNull();
    expect(parseRepoUrl("nope")).toBeNull();
    expect(parseRepoUrl(undefined)).toBeNull();
  });
});

const repo = (o: string, r: string, errorMessage?: string) => ({ gitHubRepositoryUrl: `https://github.com/${o}/${r}`, errorMessage });
const meta = { description: "d", language: "C#", private: true, pushedAt: "2026-01-01T00:00:00Z" };

describe("mergeRows", () => {
  it("sorts A-Z and de-duplicates across connections", () => {
    const { rows } = mergeRows([
      { id: "1", repos: [repo("b", "z"), repo("a", "x")] },
      { id: "2", repos: [repo("A", "X"), repo("a", "c")] },
    ]);
    expect(rows.map((r) => r.label)).toEqual(["a/c", "a/x", "b/z"]);
  });
  it("per-row 404/403 -> unavailable, others keep metadata", () => {
    const md: Record<string, MetaResult> = {
      "github.com/a/x": { ok: true, meta },
      "github.com/a/y": { ok: false, status: 404 },
      "github.com/a/z": { ok: false, status: 500 },
    };
    const { rows } = mergeRows([{ id: "1", repos: [repo("a", "x"), repo("a", "y"), repo("a", "z")] }], md);
    expect(rows.map((r) => [r.unavailable, !!r.meta])).toEqual([[false, true], [true, false], [false, false]]);
  });
  it("connection problems become warnings, not failures", () => {
    const { rows, warnings } = mergeRows([
      { id: "1", isConnectionValid: false, repos: [repo("a", "x", "boom")] },
      { id: "2", fetchError: "403", repos: [] },
    ]);
    expect(rows).toHaveLength(1);
    expect(warnings).toHaveLength(3);
  });
});

describe("filterRows", () => {
  it("matches case-insensitively on owner/repo", () => {
    const { rows } = mergeRows([{ id: "1", repos: [repo("Acme", "Web"), repo("acme", "api")] }]);
    expect(filterRows(rows, "  WEB").map((r) => r.label)).toEqual(["Acme/Web"]);
    expect(filterRows(rows, "")).toHaveLength(2);
  });
});

describe("tokenAction", () => {
  const now = Date.parse("2026-06-01T12:00:00Z");
  const t = (exp: string, rexp: string) => ({ accessToken: "a", expiresAt: exp, refreshToken: "r", refreshTokenExpiresAt: rexp });
  it("decides use / refresh / signedOut", () => {
    expect(tokenAction(null, now)).toBe("signedOut");
    expect(tokenAction(t("2026-06-01T13:00:00Z", "2026-12-01T00:00:00Z"), now)).toBe("use");
    expect(tokenAction(t("2026-06-01T12:01:00Z", "2026-12-01T00:00:00Z"), now)).toBe("refresh");
    expect(tokenAction(t("2026-06-01T11:00:00Z", "2026-12-01T00:00:00Z"), now)).toBe("refresh");
    expect(tokenAction(t("2026-06-01T11:00:00Z", "2026-06-01T11:30:00Z"), now)).toBe("signedOut");
  });
});

describe("relativeTime", () => {
  it("formats", () => {
    const now = Date.parse("2026-06-01T12:00:00Z");
    expect(relativeTime("2026-06-01T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-05-31T12:00:00Z", now)).toBe("1 day ago");
    expect(relativeTime("2026-03-01T12:00:00Z", now)).toBe("3 months ago");
    expect(relativeTime(null, now)).toBe("");
  });
});

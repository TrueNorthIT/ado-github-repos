import { describe, expect, it } from "vitest";
import {
  applyCommitFilters, commitExtrasQuery, commitsRestPath, dayBounds, formatDayText, hasServerFilters, mapCommitExtras, matchesKeyword, nextPageOf,
  noMatchText, normalizeCommitFilters, parseCommitFilters, parseDayText, withExtras,
} from "./commitsRest";
import type { CommitRow } from "./commitsQuery";

const row = (over: Partial<CommitRow> = {}): CommitRow => ({
  sha: "a".repeat(40), shortSha: "aaaaaaaa", title: "Fix login", message: "Fix login\n\nAB#12", author: { name: "Ann Author", login: "ann", avatarUrl: "u" },
  date: new Date(0), committedDate: new Date(0), parents: [], prNumber: null, status: null, ...over,
});

describe("parseDayText", () => {
  it("reads dd/mm/yyyy (UK) and yyyy-mm-dd", () => {
    expect(parseDayText("03/11/2026")).toBe("2026-11-03");
    expect(parseDayText("3/1/2026")).toBe("2026-01-03");
    expect(parseDayText("03.11.2026")).toBe("2026-11-03");
    expect(parseDayText("2026-11-03")).toBe("2026-11-03");
  });
  it("gives \"\" for blank text and null for something that is not a real date", () => {
    expect(parseDayText("  ")).toBe("");
    expect(parseDayText("31/02/2026")).toBeNull();
    expect(parseDayText("11/31/2026")).toBeNull();
    expect(parseDayText("yesterday")).toBeNull();
  });
  it("formatDayText turns it back into dd/mm/yyyy", () => {
    expect(formatDayText("2026-11-03")).toBe("03/11/2026");
    expect(formatDayText(undefined)).toBe("");
  });
});

describe("dayBounds", () => {
  it("is the local start of `from` and the local end of `to`", () => {
    const { since, until } = dayBounds("2026-11-01", "2026-11-03");
    expect(new Date(since!).getTime()).toBe(new Date(2026, 10, 1).getTime());
    expect(new Date(until!).getTime()).toBe(new Date(2026, 10, 3, 23, 59, 59, 999).getTime());
  });
  it("leaves out a missing or invalid day", () => {
    expect(dayBounds(undefined, "2026-02-30")).toEqual({});
  });
});

describe("commitsRestPath", () => {
  it("asks for the ref, 50 a page, and nothing else when unfiltered", () => {
    expect(commitsRestPath("acme/web", "main")).toBe("/repos/acme/web/commits?sha=main&per_page=50");
  });
  it("sends path, author, since, until and the page, encoded", () => {
    const p = commitsRestPath("acme/web", "feature/x y", { author: " ann ", path: "./src/app/", from: "2026-11-01", to: "2026-11-03" }, 3);
    const u = new URL("https://api.github.com" + p);
    expect(u.pathname).toBe("/repos/acme/web/commits");
    expect(u.searchParams.get("sha")).toBe("feature/x y");
    expect(u.searchParams.get("page")).toBe("3");
    expect(u.searchParams.get("path")).toBe("src/app");
    expect(u.searchParams.get("author")).toBe("ann");
    expect(u.searchParams.get("since")).toBe(dayBounds("2026-11-01").since);
    expect(u.searchParams.get("until")).toBe(dayBounds(undefined, "2026-11-03").until);
  });
  it("ignores the keyword: it narrows loaded rows only", () => {
    expect(commitsRestPath("acme/web", "main", { text: "retry" })).toBe("/repos/acme/web/commits?sha=main&per_page=50");
  });
});

describe("nextPageOf", () => {
  it("reads rel=next's page", () => {
    expect(nextPageOf('<https://api.github.com/repositories/1/commits?sha=main&page=2>; rel="next", <https://api.github.com/repositories/1/commits?page=9>; rel="last"')).toBe(2);
  });
  it("is undefined on the last page", () => {
    expect(nextPageOf('<https://api.github.com/x?page=1>; rel="prev"')).toBeUndefined();
    expect(nextPageOf(null)).toBeUndefined();
  });
});

describe("hash keys", () => {
  it("round-trips the filters and keeps other segments in order", () => {
    const h = applyCommitFilters("#repo=acme/web&ref=dev", { author: "ann", from: "2026-11-01", to: "2026-11-03", path: "src/a b", text: "retry" });
    expect(h).toBe("#repo=acme/web&ref=dev&cAuthor=ann&cFrom=2026-11-01&cTo=2026-11-03&cPath=src%2Fa%20b&cText=retry");
    expect(parseCommitFilters(h)).toEqual({ author: "ann", from: "2026-11-01", to: "2026-11-03", path: "src/a b", text: "retry" });
  });
  it("replaces earlier values and drops blank ones", () => {
    expect(applyCommitFilters("#repo=a/b&cAuthor=old&cFrom=2026-01-01", { author: "new" })).toBe("#repo=a/b&cAuthor=new");
  });
  it("drops a day that is not a real date", () => {
    expect(parseCommitFilters("#repo=a/b&cFrom=2026-13-01&cTo=nope")).toEqual({});
  });
  it("hasServerFilters is false for the keyword alone", () => {
    expect(hasServerFilters({ text: "x" })).toBe(false);
    expect(hasServerFilters({ to: "2026-11-03" })).toBe(true);
    expect(normalizeCommitFilters({ author: "  ", path: "/" })).toEqual({});
  });
});

describe("commit extras (PR, status, signature) over GraphQL", () => {
  it("puts every sha in variables, aliased c0, c1...", () => {
    const q = commitExtrasQuery({ owner: "acme", name: "web", shas: ["s0", "s1"] });
    expect(q.variables).toEqual({ owner: "acme", name: "web", o0: "s0", o1: "s1" });
    expect(q.aliases).toEqual({ c0: "s0", c1: "s1" });
    expect(q.query).not.toContain("s0");
    expect(q.query).toContain("GitObjectID");
  });
  it("maps an open or merged PR, the rollup and a signature, and merges them into rows", () => {
    const body = { data: { repository: {
      c0: { oid: "s0", statusCheckRollup: { state: "FAILURE" }, associatedPullRequests: { nodes: [{ number: 7, state: "MERGED" }] }, signature: { isValid: true, state: "VALID" } },
      c1: { oid: "s1", statusCheckRollup: null, associatedPullRequests: { nodes: [{ number: 8, state: "CLOSED" }] }, signature: null },
    } } };
    const x = mapCommitExtras(body, { c0: "s0", c1: "s1" });
    expect(x.s0).toEqual({ prNumber: 7, status: "failed", signature: { isValid: true, state: "VALID" } });
    expect(x.s1).toEqual({ prNumber: null, status: null });
    const rows = withExtras([row({ sha: "s0" }), row({ sha: "zz" })], x);
    expect(rows[0].prNumber).toBe(7);
    expect(rows[1].prNumber).toBeNull();
  });
});

describe("keyword and empty-state text", () => {
  it("matches the whole message, the author's name or login", () => {
    expect(matchesKeyword(row(), "ab#12")).toBe(true);
    expect(matchesKeyword(row(), "ANN")).toBe(true);
    expect(matchesKeyword(row(), "retry")).toBe(false);
  });
  it("says what was asked", () => {
    expect(noMatchText("main", { author: "ann", from: "2026-11-01", to: "2026-11-03", path: "src" }, "retry")).toBe(
      "No commits on main by ann from 01/11/2026 to 03/11/2026 touching src match “retry” among those loaded."
    );
    expect(noMatchText("main", { from: "2026-11-01" })).toBe("No commits on main since 01/11/2026.");
  });
});

import { describe, it, expect } from "vitest";
import { blameQuery, mapBlame, blameBlocks, heatBucket, lineCountOf, type BlameRange } from "./blame";

const commit = (oid: string, date = "2026-01-01T00:00:00Z") => ({
  oid,
  abbreviatedOid: oid.slice(0, 7),
  messageHeadline: `msg ${oid}`,
  committedDate: date,
  author: { name: "Ann Author", user: { login: "ann", avatarUrl: "https://example.test/a.png" } },
});
const raw = (startingLine: number, endingLine: number, oid: string, age = 5) => ({ startingLine, endingLine, age, commit: commit(oid) });
const range = (startingLine: number, endingLine: number, oid: string, age = 5): BlameRange => ({
  startingLine, endingLine, age,
  commit: { oid, abbreviatedOid: oid.slice(0, 7), messageHeadline: `msg ${oid}`, committedDate: "2026-01-01T00:00:00Z", author: { name: "Ann Author", login: "ann", avatarUrl: "https://example.test/a.png" } },
});

describe("blameQuery", () => {
  it("sends every caller value as a variable, never in the query text", () => {
    const q = blameQuery({ owner: "o", name: "n", ref: 'refs/heads/we"ird', path: "src/$x.ts" });
    expect(q.variables, "Expected owner, name, ref and path as variables").toEqual({ owner: "o", name: "n", ref: 'refs/heads/we"ird', path: "src/$x.ts" });
    expect(q.query).not.toContain('we"ird');
    expect(q.query).not.toContain("src/$x.ts");
    expect(q.query).toMatch(/blame\(path: \$path\)/);
    expect(q.query).toMatch(/startingLine endingLine age/);
  });
  it("normalises the path like history(path:)", () => {
    expect(blameQuery({ owner: "o", name: "n", ref: "main", path: "/a/b.ts" }).variables.path).toBe("a/b.ts");
  });
});

describe("mapBlame", () => {
  it("reads ranges from data.repository.ref.target.blame", () => {
    const body = { data: { repository: { ref: { target: { blame: { ranges: [raw(1, 2, "aaa1111")] } } } } } };
    const r = mapBlame(body);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ startingLine: 1, endingLine: 2, age: 5 });
    expect(r[0].commit).toMatchObject({ oid: "aaa1111", abbreviatedOid: "aaa1111", messageHeadline: "msg aaa1111" });
    expect(r[0].commit.author).toEqual({ name: "Ann Author", login: "ann", avatarUrl: "https://example.test/a.png" });
  });
  it("maps an author with no linked account to a null login", () => {
    const c = { ...commit("bbb2222"), author: { name: "Bob", user: null } };
    const r = mapBlame({ data: { repository: { ref: { target: { blame: { ranges: [{ startingLine: 1, endingLine: 1, age: 1, commit: c }] } } } } } });
    expect(r[0].commit.author.login).toBeNull();
    expect(r[0].commit.author.name).toBe("Bob");
  });
  it("gives [] for a missing ref, file or body", () => {
    expect(mapBlame(null)).toEqual([]);
    expect(mapBlame({ data: { repository: { ref: null } } })).toEqual([]);
    expect(mapBlame({ data: { repository: { ref: { target: {} } } } })).toEqual([]);
  });
});

describe("lineCountOf", () => {
  it("does not count the line after a final newline", () => {
    expect(lineCountOf("a\nb\n")).toBe(2);
    expect(lineCountOf("a\nb")).toBe(2);
    expect(lineCountOf("a\r\nb\r\n")).toBe(2);
  });
  it("counts an empty file as one line (as the editor does)", () => {
    expect(lineCountOf("")).toBe(1);
    expect(lineCountOf("\n")).toBe(1);
  });
});

describe("heatBucket", () => {
  it("uses GitHub's own 1 to 10 age, clamped and rounded", () => {
    expect(heatBucket(1)).toBe(1);
    expect(heatBucket(10)).toBe(10);
    expect(heatBucket(0)).toBe(1);
    expect(heatBucket(42)).toBe(10);
    expect(heatBucket(3.6)).toBe(4);
  });
  it("is 1 (newest) for a missing or non-numeric age", () => {
    expect(heatBucket(undefined)).toBe(1);
    expect(heatBucket(NaN)).toBe(1);
  });
});

describe("blameBlocks", () => {
  it("maps ranges onto line spans in order", () => {
    const b = blameBlocks([range(1, 3, "aaa1111"), range(4, 5, "bbb2222")], 5);
    expect(b.map((x) => [x.startLine, x.endLine, x.commit?.oid])).toEqual([[1, 3, "aaa1111"], [4, 5, "bbb2222"]]);
  });
  it("sorts ranges that arrive out of order", () => {
    const b = blameBlocks([range(4, 5, "bbb2222"), range(1, 3, "aaa1111")], 5);
    expect(b.map((x) => x.startLine)).toEqual([1, 4]);
  });
  it("groups consecutive ranges from the same commit into one block", () => {
    const b = blameBlocks([range(1, 2, "aaa1111"), range(3, 4, "aaa1111"), range(5, 5, "bbb2222"), range(6, 6, "aaa1111")], 6);
    expect(b.map((x) => [x.startLine, x.endLine, x.commit?.oid]), "Expected only adjacent same-commit ranges to merge").toEqual([[1, 4, "aaa1111"], [5, 5, "bbb2222"], [6, 6, "aaa1111"]]);
  });
  it("fills a gap with a block that has no commit", () => {
    const b = blameBlocks([range(1, 2, "aaa1111"), range(5, 6, "bbb2222")], 6);
    expect(b.map((x) => [x.startLine, x.endLine, x.commit?.oid ?? null])).toEqual([[1, 2, "aaa1111"], [3, 4, null], [5, 6, "bbb2222"]]);
    expect(b[1].heat, "Expected no heat for lines without blame").toBe(0);
  });
  it("covers lines before the first range and after the last", () => {
    const b = blameBlocks([range(2, 3, "aaa1111")], 5);
    expect(b.map((x) => [x.startLine, x.endLine, x.commit?.oid ?? null])).toEqual([[1, 1, null], [2, 3, "aaa1111"], [4, 5, null]]);
  });
  it("cuts a range that runs past the end of the file and drops one wholly outside it", () => {
    const b = blameBlocks([range(1, 10, "aaa1111"), range(11, 12, "bbb2222")], 4);
    expect(b.map((x) => [x.startLine, x.endLine, x.commit?.oid])).toEqual([[1, 4, "aaa1111"]]);
  });
  it("ignores malformed ranges (end before start, below line 1)", () => {
    const b = blameBlocks([range(3, 2, "bad0000"), range(0, 2, "aaa1111")], 3);
    expect(b.map((x) => [x.startLine, x.endLine, x.commit?.oid ?? null])).toEqual([[1, 2, "aaa1111"], [3, 3, null]]);
  });
  it("trims overlapping ranges so no line is in two blocks", () => {
    const b = blameBlocks([range(1, 4, "aaa1111"), range(3, 6, "bbb2222")], 6);
    expect(b.map((x) => [x.startLine, x.endLine, x.commit?.oid])).toEqual([[1, 4, "aaa1111"], [5, 6, "bbb2222"]]);
  });
  it("gives one commit-less block for a file with no ranges", () => {
    expect(blameBlocks([], 3).map((x) => [x.startLine, x.endLine, x.commit])).toEqual([[1, 3, null]]);
  });
  it("gives no blocks for a file of no lines", () => {
    expect(blameBlocks([range(1, 2, "aaa1111")], 0)).toEqual([]);
  });
  it("carries the heat of the range", () => {
    const b = blameBlocks([range(1, 1, "aaa1111", 7), range(2, 2, "aaa1111", 7)], 2);
    expect(b[0].heat).toBe(7);
  });
  it("covers every line exactly once for any input", () => {
    const ranges = [range(2, 4, "a", 1), range(3, 9, "b", 2), range(12, 13, "c", 3), range(-1, 1, "d", 4)];
    const b = blameBlocks(ranges, 15);
    let next = 1;
    for (const x of b) {
      expect(x.startLine).toBe(next);
      next = x.endLine + 1;
    }
    expect(next).toBe(16);
  });
});

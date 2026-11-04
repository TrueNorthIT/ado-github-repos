import { describe, it, expect } from "vitest";
import { buildQueries, commitUrl, mapResponse, shortSha, CHUNK_SIZE } from "./commits";
import type { TreeEntry } from "./tree";

const e = (path: string, kind: TreeEntry["kind"] = "file"): TreeEntry => ({ name: path.split("/").pop()!, path, kind });
const node = (over: Record<string, unknown> = {}) => ({
  nodes: [{ oid: "0123456789abcdef0123456789abcdef01234567", messageHeadline: "Fix thing", committedDate: "2025-10-29T09:30:00Z", author: { name: "Ann Author", user: { name: "Ann Display", login: "ann" } }, ...over }],
});

describe("shortSha / commitUrl", () => {
  it("is 8 characters", () => expect(shortSha("0123456789abcdef")).toBe("01234567"));
  it("builds the github commit link", () => expect(commitUrl("o/r", "abc")).toBe("https://github.com/o/r/commit/abc"));
});

describe("buildQueries", () => {
  it("aliases map back to entry paths and values travel as variables", () => {
    const [q] = buildQueries("o/r", "main", [e("src", "folder"), e("README.md")]);
    expect(q.aliases).toEqual({ e0: "src", e1: "README.md" });
    expect(q.variables).toMatchObject({ owner: "o", name: "r", ref: "main", p0: "src", p1: "README.md" });
    expect(q.query).toContain("e0: history(first: 1, path: $p0)");
    expect(q.query).toContain("$p1: String!");
  });
  it("never puts a path in the query text", () => {
    const weird = ['a"b', "back\slash", "ünï/cødé 日本", "sp ace/#hash", "q{uery}"];
    const [q] = buildQueries("o/r", "main", weird.map((p) => e(p)));
    weird.forEach((p, i) => expect(q.variables[`p${i}`]).toBe(p));
    weird.forEach((p) => expect(q.query).not.toContain(p));
  });
  it("chunks large folders", () => {
    const many = Array.from({ length: CHUNK_SIZE * 2 + 1 }, (_, i) => e(`f${i}`));
    const qs = buildQueries("o/r", "main", many);
    expect(qs.map((q) => Object.keys(q.aliases).length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 1]);
    expect(qs[2].aliases).toEqual({ e0: `f${CHUNK_SIZE * 2}` });
  });
  it("excludes submodules and yields nothing when empty", () => {
    const qs = buildQueries("o/r", "main", [e("vendor", "submodule"), e("a")]);
    expect(qs[0].aliases).toEqual({ e0: "a" });
    expect(buildQueries("o/r", "main", [e("vendor", "submodule")])).toEqual([]);
  });
});

describe("mapResponse", () => {
  const aliases = { e0: "src", e1: "README.md" };
  const body = (obj: unknown, errors?: unknown) => ({ data: { repository: { object: obj } }, errors });
  it("maps aliases to path keyed commits", () => {
    const r = mapResponse(body({ e0: node(), e1: node({ oid: "ffffffffffffffffffffffffffffffffffffffff", messageHeadline: "Docs" }) }), aliases);
    expect(r.src).toEqual({ sha: "0123456789abcdef0123456789abcdef01234567", shortSha: "01234567", headline: "Fix thing", date: new Date("2025-10-29T09:30:00Z"), author: "Ann Display", login: "ann" });
    expect(r["README.md"].shortSha).toBe("ffffffff");
  });
  it("skips missing or empty history", () => {
    const r = mapResponse(body({ e0: { nodes: [] }, e1: null }), aliases);
    expect(r).toEqual({});
  });
  it("keeps partial data despite errors", () => {
    const r = mapResponse(body({ e0: node(), e1: null }, [{ message: "boom" }]), aliases);
    expect(Object.keys(r)).toEqual(["src"]);
  });
  it("tolerates a missing repository or object", () => {
    expect(mapResponse({ data: { repository: null } }, aliases)).toEqual({});
    expect(mapResponse({ data: null, errors: [{}] }, aliases)).toEqual({});
    expect(mapResponse(body(null), aliases)).toEqual({});
  });
  it("keeps the git email, the login (null when unlinked) and an avatar for the hover card", () => {
    const r = mapResponse(body({ e0: node({ author: { name: "Bogdan", email: "b@example.com", avatarUrl: "https://example.test/g.png", user: null } }) }), aliases).src;
    expect([r.author, r.login, r.email, r.avatarUrl]).toEqual(["Bogdan", null, "b@example.com", "https://example.test/g.png"]);
  });
  it("author falls back display name, commit author name, login", () => {
    const a = (author: unknown) => mapResponse(body({ e0: node({ author }) }), aliases).src.author;
    expect(a({ name: "Commit Name", user: { name: null, login: "ann" } })).toBe("Commit Name");
    expect(a({ name: "Commit Name", user: { name: "Display", login: "ann" } })).toBe("Display");
    expect(a({ name: null, user: { name: null, login: "ann" } })).toBe("ann");
    expect(a({ name: "", user: null })).toBe("");
    expect(a(null)).toBe("");
  });
});

import { describe, it, expect } from "vitest";
import { MAX_BATCHES, QUERY_MAX, RateWindow, classifyFailure, findHitRanges, fragmentLines, githubSearchUrl, mergeBatches, normaliseRanges, planSearch, splitBatch, stripScope, toHit, type RawSearchItem } from "./codeSearch";
import { applySearch, clearSearch, parseSearch, serializeSearch, splitHit } from "./searchHash";
import { parse } from "./browseState";

describe("planSearch", () => {
  it("puts the terms, path and extension before the repo qualifier", () => {
    const p = planSearch({ text: "greet", repos: ["octo/demo"], path: "src/util", ext: "ts" });
    expect(p.batches).toEqual([{ q: "greet path:src/util extension:ts repo:octo/demo", repos: ["octo/demo"] }]);
    expect(p.skipped).toEqual([]);
  });
  it("quotes a path with spaces", () => {
    expect(planSearch({ text: "x", repos: ["a/b"], path: "my docs" }).batches[0].q).toBe('x path:"my docs" repo:a/b');
  });
  it("drops repo:, org: and user: qualifiers the user typed, so the page sets the scope", () => {
    expect(stripScope('greet repo:evil/other org:x -user:"y z" path:src')).toBe("greet path:src");
    expect(planSearch({ text: "repo:evil/other greet", repos: ["octo/demo"] }).batches[0].q).toBe("greet repo:octo/demo");
  });
  it("refuses blank text and qualifiers alone", () => {
    expect(planSearch({ text: "  ", repos: ["a/b"] }).problem).toMatch(/Enter some text/);
    expect(planSearch({ text: "path:src extension:ts", repos: ["a/b"] }).problem).toMatch(/Enter some text/);
    expect(planSearch({ text: "x", repos: [] }).problem).toMatch(/no repositories/);
  });
  it("refuses text that leaves no room for a repository", () => {
    expect(planSearch({ text: "a".repeat(250), repos: ["octo/demo"] }).problem).toMatch(/too long/);
  });
  it("splits many repositories into batches that each stay within the limit", () => {
    const repos = Array.from({ length: 30 }, (_, i) => `truenorthit/repository-number-${i}`);
    const p = planSearch({ text: "greet", repos });
    expect(p.batches.length).toBeGreaterThan(1);
    expect(p.batches.length).toBeLessThanOrEqual(MAX_BATCHES);
    p.batches.forEach((b) => {
      expect(b.q.length).toBeLessThanOrEqual(QUERY_MAX);
      expect(b.q.startsWith("greet repo:")).toBe(true);
    });
    expect([...p.batches.flatMap((b) => b.repos), ...p.skipped].sort()).toEqual([...repos].sort());
  });
  it("leaves out what doesn't fit in MAX_BATCHES and says so", () => {
    const repos = Array.from({ length: 80 }, (_, i) => `truenorthit/a-rather-long-repository-name-${i}`);
    const p = planSearch({ text: "greet", repos });
    expect(p.batches).toHaveLength(MAX_BATCHES);
    expect(p.skipped.length).toBeGreaterThan(0);
  });
  it("de-duplicates repositories", () => {
    expect(planSearch({ text: "x", repos: ["a/b", "a/b"] }).batches[0].repos).toEqual(["a/b"]);
  });
});

describe("splitBatch", () => {
  it("halves the repositories and keeps the terms", () => {
    expect(splitBatch({ q: "greet path:src repo:a/b repo:c/d repo:e/f", repos: ["a/b", "c/d", "e/f"] })).toEqual([
      { q: "greet path:src repo:a/b repo:c/d", repos: ["a/b", "c/d"] },
      { q: "greet path:src repo:e/f", repos: ["e/f"] },
    ]);
    expect(splitBatch({ q: "x repo:a/b", repos: ["a/b"] })).toBeUndefined();
  });
});

const item = (over: Partial<RawSearchItem> = {}): RawSearchItem => ({
  name: "greet.ts",
  path: "src/util/greet.ts",
  sha: "abc",
  url: "https://api.github.com/repositories/1/contents/src/util/greet.ts?ref=0123456789abcdef0123456789abcdef01234567",
  html_url: "https://github.com/octo/demo/blob/0123/src/util/greet.ts",
  repository: { full_name: "octo/demo" },
  text_matches: [
    { object_type: "FileContent", property: "content", fragment: "// hi\nexport const greet = (n) => `Hello, ${n}`;\n", matches: [{ text: "greet", indices: [19, 24] }, { text: "Hello", indices: [35, 40] }] },
    { object_type: "FileContent", property: "path", fragment: "src/util/greet.ts", matches: [{ text: "greet", indices: [9, 14] }] },
  ],
  ...over,
});

describe("toHit", () => {
  it("maps a result: key, ref from the contents URL, content fragments only, terms and match count", () => {
    const h = toHit(item());
    expect(h.key).toBe("octo/demo/src/util/greet.ts");
    expect(h.ref).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(h.fragments).toHaveLength(1);
    expect(h.fragments[0].ranges).toEqual([[19, 24], [35, 40]]);
    expect(h.terms).toEqual(["greet", "hello"]);
    expect(h.matchCount).toBe(2);
  });
  it("copes with no text_matches and a bad URL", () => {
    const h = toHit(item({ text_matches: undefined, url: "not a url" }));
    expect(h.fragments).toEqual([]);
    expect(h.ref).toBe("");
    expect(h.matchCount).toBe(0);
  });
});

describe("normaliseRanges", () => {
  it("sorts, clamps, merges and drops junk", () => {
    expect(normaliseRanges([[10, 12], [0, 3], [2, 5], [8, 8], [20, 99], undefined, [1]], 25)).toEqual([[0, 5], [10, 12], [20, 25]]);
  });
});

describe("fragmentLines", () => {
  it("keeps only lines with a match, splits them into segments and trims indentation", () => {
    const text = "line one\n    const greet = 1; // greet\nline three";
    const a = text.indexOf("greet");
    const b = text.lastIndexOf("greet");
    expect(fragmentLines({ text, ranges: [[a, a + 5], [b, b + 5]] })).toEqual([[
      { text: "const ", hit: false }, { text: "greet", hit: true }, { text: " = 1; // ", hit: false }, { text: "greet", hit: true },
    ]]);
  });
  it("caps the number of lines", () => {
    const text = "a\na\na\na\na";
    const ranges = [0, 2, 4, 6, 8].map((i) => [i, i + 1] as [number, number]);
    expect(fragmentLines({ text, ranges }, 2)).toHaveLength(2);
  });
});

describe("findHitRanges", () => {
  it("finds every case-insensitive occurrence, 1-based, longest term first without overlaps", () => {
    const r = findHitRanges("Greet me\nno\nsay greeting greet", ["greet", "greeting"]);
    expect(r).toEqual([
      { line: 1, startColumn: 1, endColumn: 6 },
      { line: 3, startColumn: 5, endColumn: 13 },
      { line: 3, startColumn: 14, endColumn: 19 },
    ]);
  });
  it("is empty without terms and capped", () => {
    expect(findHitRanges("abc", [])).toEqual([]);
    expect(findHitRanges("a a a a", ["a"], 2)).toHaveLength(2);
  });
});

describe("mergeBatches", () => {
  it("adds up counts, de-duplicates hits and lists failed batches", () => {
    const ok = { total_count: 3, incomplete_results: false, items: [item(), item()] };
    const out = mergeBatches([
      { batch: { q: "a", repos: ["octo/demo"] }, ok },
      { batch: { q: "b", repos: ["x/y", "x/z"] }, err: { kind: "validation", message: "Validation Failed" } },
      { batch: { q: "c", repos: ["p/q"] }, ok: { total_count: 1, incomplete_results: true, items: [item({ repository: { full_name: "p/q" } })] } },
    ]);
    expect(out.hits.map((h) => h.key)).toEqual(["octo/demo/src/util/greet.ts", "p/q/src/util/greet.ts"]);
    expect(out.total).toBe(4);
    expect(out.incomplete).toBe(true);
    expect(out.failed).toEqual([{ repos: ["x/y", "x/z"], err: { kind: "validation", message: "Validation Failed" } }]);
  });
});

describe("classifyFailure", () => {
  const at = new Date(0);
  it.each([
    [{ kind: "auth", status: 401 }, "auth"],
    [{ kind: "rateLimit", status: 403, resetAt: at }, "rateLimit"],
    [{ kind: "access", status: 403, apiMessage: "You have exceeded a secondary rate limit." }, "rateLimit"],
    [{ kind: "other", status: 429 }, "rateLimit"],
    [{ kind: "other", status: 422, apiMessage: "Validation Failed" }, "validation"],
    [{ kind: "access", status: 403, apiMessage: "Resource not accessible" }, "access"],
    [{ kind: "other", status: 500 }, "other"],
    [{}, "other"],
  ])("%j -> %s", (e, kind) => expect(classifyFailure(e).kind).toBe(kind));
  it("keeps the reset time and the message", () => {
    expect(classifyFailure({ kind: "rateLimit", resetAt: at })).toEqual({ kind: "rateLimit", resetAt: at });
    expect(classifyFailure({ status: 422, apiMessage: "m" })).toEqual({ kind: "validation", message: "m" });
  });
});

describe("RateWindow", () => {
  it("allows the limit in the window, then says when there's room again", () => {
    const w = new RateWindow(3, 1000);
    expect(w.canSpend(3, 0)).toBe(true);
    w.spend(2, 0);
    w.spend(1, 500);
    expect(w.canSpend(1, 600)).toBe(false);
    expect(w.freeAt(1, 600).getTime()).toBe(1000);
    expect(w.freeAt(3, 600).getTime()).toBe(1500);
    expect(w.canSpend(2, 1000)).toBe(true);
    expect(w.canSpend(3, 1500)).toBe(true);
  });
});

describe("githubSearchUrl", () => {
  it("scopes one repo and keeps the filters", () => {
    expect(githubSearchUrl({ text: "greet", repos: ["octo/demo"], ext: "ts" })).toBe(`https://github.com/search?type=code&q=${encodeURIComponent("repo:octo/demo greet path:*.ts")}`);
  });
});

describe("searchHash", () => {
  it("round-trips through serialize and parse", () => {
    const s = { repo: "octo/demo", text: "greet me", all: true, path: "src/util", ext: "ts", hit: "octo/demo/src/util/greet.ts" };
    const h = serializeSearch(s);
    expect(h).toBe("#repo=octo%2Fdemo&search=greet%20me&searchAll=1&searchPath=src%2Futil&searchExt=ts&searchHit=octo%2Fdemo%2Fsrc%2Futil%2Fgreet.ts");
    expect(parseSearch(h)).toEqual(s);
  });
  it("is null without the search key or a valid repo; a blank search still opens the view", () => {
    expect(parseSearch("#repo=octo%2Fdemo")).toBeNull();
    expect(parseSearch("#search=x")).toBeNull();
    expect(parseSearch("#repo=..%2Fx&search=x")).toBeNull();
    expect(parseSearch("#repo=octo%2Fdemo&search=")).toEqual({ repo: "octo/demo", text: "" });
  });
  it("cleans the filters and drops a bad hit", () => {
    expect(parseSearch("#repo=a%2Fb&search=x&searchExt=.ts&searchPath=%2Fsrc%2F&searchHit=nope&searchAll=yes")).toEqual({ repo: "a/b", text: "x", ext: "ts", path: "src" });
    expect(parseSearch("#repo=a%2Fb&search=x&searchExt=t%20s&searchPath=..%2Fetc")).toEqual({ repo: "a/b", text: "x" });
  });
  it("keeps the other segments, and browseState still sees the repo and ref", () => {
    const h = applySearch("#repo=a%2Fb&ref=dev&search=old&searchExt=md", { text: "new" });
    expect(h).toBe("#repo=a%2Fb&ref=dev&search=new");
    expect(parse(h)).toEqual({ repo: "a/b", ref: "dev" });
    expect(clearSearch(h)).toBe("#repo=a%2Fb&ref=dev");
  });
  it("splits a hit into repo and path", () => {
    expect(splitHit("a/b/c/d.ts")).toEqual({ repo: "a/b", path: "c/d.ts" });
    expect(splitHit("a/b")).toBeUndefined();
    expect(splitHit("a/b/../x")).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { fuzzyFind } from "./fuzzy";

// Module under test: src/lib/fuzzy.ts. fuzzyFind(paths, query, limit?) returns { path, indices }[] best first;
// indices are positions in path of the matched characters. An empty (or whitespace) query returns [].

const paths = (hits: { path: string }[]) => hits.map((h) => h.path);

describe("fuzzyFind", () => {
  it("matches a case-insensitive subsequence and drops non-matches", () => {
    expect(paths(fuzzyFind(["src/Browser.tsx", "README.md", "src/App.tsx"], "BRWS"))).toEqual(["src/Browser.tsx"]);
    expect(paths(fuzzyFind(["a/b.ts"], "ba"))).toEqual([]); // order matters
  });

  it("returns the matched indices for highlighting", () => {
    const [hit] = fuzzyFind(["src/index.ts"], "idx");
    expect(hit.indices.map((i) => hit.path[i]).join("")).toBe("idx");
    expect(hit.indices).toEqual([...hit.indices].sort((a, b) => a - b));
  });

  it("indices are honest for the best alignment, not the first greedy one", () => {
    const [hit] = fuzzyFind(["a/xa/ab"], "ab");
    expect(hit.indices).toEqual([5, 6]); // consecutive "ab" at the end, not "a" at 0 and "b" at 6
  });

  it("prefers a basename match over a directory match", () => {
    expect(paths(fuzzyFind(["config/other.ts", "src/config.ts"], "config"))[0]).toBe("src/config.ts");
  });

  it("prefers consecutive runs over scattered matches", () => {
    expect(paths(fuzzyFind(["a_b_c_d.ts", "abcd.ts"], "abcd"))[0]).toBe("abcd.ts");
  });

  it("prefers word and slash boundaries", () => {
    expect(paths(fuzzyFind(["src/xgreeting.ts", "src/x-greeting.ts"], "g"))[0]).toBe("src/x-greeting.ts");
    expect(paths(fuzzyFind(["lib/zutil.ts", "util/z.ts"], "u"))[0]).toBe("util/z.ts");
  });

  it("breaks ties by shorter path, then alphabetically", () => {
    expect(paths(fuzzyFind(["a/b/c/index.ts", "index.ts", "a/index.ts"], "index"))).toEqual(["index.ts", "a/index.ts", "a/b/c/index.ts"]);
    expect(paths(fuzzyFind(["b.ts", "a.ts"], "ts"))).toEqual(["a.ts", "b.ts"]);
  });

  it("caps the results, default 50", () => {
    const many = Array.from({ length: 200 }, (_, i) => `f${i}.ts`);
    expect(fuzzyFind(many, "f")).toHaveLength(50);
    expect(fuzzyFind(many, "f", 5)).toHaveLength(5);
  });

  it("the cap keeps the best, not the first", () => {
    const list = [...Array.from({ length: 10 }, (_, i) => `dir${i}/x/y/zzz-readme.txt`), "README.md"];
    expect(paths(fuzzyFind(list, "readme", 1))).toEqual(["README.md"]);
  });

  it("returns nothing for an empty or blank query", () => {
    expect(fuzzyFind(["a.ts"], "")).toEqual([]);
    expect(fuzzyFind(["a.ts"], "   ")).toEqual([]);
  });

  it("returns nothing when the query is longer than any path", () => {
    expect(fuzzyFind(["a"], "abc")).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { parseCompare, serializeCompare, applyCompare, branchCompareHash, compareBaseFor, withCompareBase } from "./compareHash";
import { parse, serialize } from "./browseState";
import { applyNewPr, parseNewPr } from "./newPrHash";
import { NASTY } from "./ciTestHelpers";

const REPO = "octo/demo";
const ENC = "repo=octo%2Fdemo";

describe("serializeCompare / parseCompare", () => {
  it("writes repo, view=compare, cmpBase and cmpHead, encoded", () => {
    expect(serializeCompare({ repo: REPO, base: "main", head: "feature/x" })).toBe(`#${ENC}&view=compare&cmpBase=main&cmpHead=feature%2Fx`);
  });
  it("adds the tab only when it is not the default", () => {
    expect(serializeCompare({ repo: REPO, base: "a", head: "b", tab: "files" })).toBe(`#${ENC}&view=compare&cmpBase=a&cmpHead=b&cmpTab=files`);
    expect(serializeCompare({ repo: REPO, base: "a", head: "b", tab: "commits" })).toBe(`#${ENC}&view=compare&cmpBase=a&cmpHead=b`);
  });
  it("round trips awkward ref names", () => {
    for (const v of NASTY) {
      const s = { repo: REPO, base: v, head: v + "2", tab: "files" as const };
      expect(parseCompare(serializeCompare(s)), v).toEqual(s);
    }
  });
  it("reads a hash with no # or several", () => {
    expect(parseCompare(`${ENC}&view=compare&cmpBase=a&cmpHead=b`)).toEqual({ repo: REPO, base: "a", head: "b", tab: "commits" });
    expect(parseCompare(`##${ENC}&view=compare&cmpBase=a&cmpHead=b`)).toEqual({ repo: REPO, base: "a", head: "b", tab: "commits" });
  });
  it("is null unless the view is compare with a valid repo and both refs", () => {
    expect(parseCompare(`#${ENC}&cmpBase=a&cmpHead=b`)).toBeNull();
    expect(parseCompare(`#${ENC}&view=prs&cmpBase=a&cmpHead=b`)).toBeNull();
    expect(parseCompare("#view=compare&cmpBase=a&cmpHead=b")).toBeNull();
    expect(parseCompare("#repo=../x&view=compare&cmpBase=a&cmpHead=b")).toBeNull();
    expect(parseCompare(`#${ENC}&view=compare&cmpBase=a`)).toBeNull();
    expect(parseCompare(`#${ENC}&view=compare&cmpBase=%20&cmpHead=b`)).toBeNull();
  });
  it("ignores an unknown tab", () => {
    expect(parseCompare(`#${ENC}&view=compare&cmpBase=a&cmpHead=b&cmpTab=zzz`)?.tab).toBe("commits");
  });
  it("caps refs at 255 characters", () => {
    const s = parseCompare(serializeCompare({ repo: REPO, base: "a".repeat(400), head: "b" }));
    expect(s?.base).toHaveLength(255);
  });
  it("never throws", () => {
    for (const bad of ["#%E0%A4%A", `#${ENC}&view=compare&cmpBase=%E0%A4%A`, "#&&&", "=", "#repo=%"]) expect(() => parseCompare(bad), bad).not.toThrow();
  });
});

describe("applyCompare", () => {
  it("keeps other segments, drops earlier view and compare keys, appends its own", () => {
    expect(applyCompare(`#${ENC}&branchTab=all&view=prs&cmpBase=old&cmpHead=old&cmpTab=files`, { base: "a", head: "b" })).toBe(`#${ENC}&branchTab=all&view=compare&cmpBase=a&cmpHead=b`);
  });
  it("is superseded cleanly by the New pull request keys", () => {
    const h = applyNewPr(serializeCompare({ repo: REPO, base: "main", head: "x" }), { source: "x", target: "main" });
    expect(parseCompare(h), "Expected view=newpr to supersede view=compare").toBeNull();
    expect(parseNewPr(h)).toEqual({ repo: REPO, source: "x", target: "main" });
  });
});

describe("browseState interplay", () => {
  it("browseState keeps the repo and drops the view and compare keys", () => {
    expect(parse(serializeCompare({ repo: REPO, base: "a", head: "b" }))).toEqual({ repo: REPO });
  });
  it("applyCompare restores a hash browseState rewrote", () => {
    const original = serializeCompare({ repo: REPO, base: "a", head: "b", tab: "files" });
    expect(applyCompare(serialize(parse(original)), { base: "a", head: "b", tab: "files" })).toBe(original);
  });
});

describe("branchCompareHash", () => {
  it("compares the branch (head) against the base", () => {
    expect(parseCompare(branchCompareHash(REPO, "feature/x", "main"))).toEqual({ repo: REPO, base: "main", head: "feature/x", tab: "commits" });
  });
});

describe("compareBaseFor", () => {
  it("uses the remembered base when there is one", () => {
    expect(compareBaseFor("develop", "main", "feature")).toBe("develop");
  });
  it("uses the default branch otherwise", () => {
    expect(compareBaseFor(undefined, "main", "feature")).toBe("main");
    expect(compareBaseFor("", "main", "feature")).toBe("main");
  });
  it("ignores a remembered base that is the branch itself", () => {
    expect(compareBaseFor("feature", "main", "feature")).toBe("main");
  });
  it("is null when nothing usable is known", () => {
    expect(compareBaseFor(undefined, undefined, "feature")).toBeNull();
    expect(compareBaseFor(undefined, "main", "main")).toBeNull();
  });
});

describe("withCompareBase", () => {
  it("remembers a base for one repo without touching the others, and does not mutate", () => {
    const before = { "a/b": "dev" };
    const after = withCompareBase(before, "c/d", "main");
    expect(after).toEqual({ "a/b": "dev", "c/d": "main" });
    expect(before).toEqual({ "a/b": "dev" });
  });
  it("replaces an earlier base", () => {
    expect(withCompareBase({ "a/b": "dev" }, "a/b", "main")).toEqual({ "a/b": "main" });
  });
  it("forgets it for null", () => {
    expect(withCompareBase({ "a/b": "dev", "c/d": "x" }, "a/b", null)).toEqual({ "c/d": "x" });
  });
  it("starts from nothing", () => {
    expect(withCompareBase(undefined, "a/b", "dev")).toEqual({ "a/b": "dev" });
  });
});

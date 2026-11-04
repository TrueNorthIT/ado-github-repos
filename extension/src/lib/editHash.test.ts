import { describe, it, expect } from "vitest";
import { applyEditFlag, parseEditFlag } from "./editHash";
import { parse, serialize } from "./browseState";

describe("editHash", () => {
  it("reads edit=true (and 1), nothing else", () => {
    expect(parseEditFlag("#repo=a%2Fb&path=x&edit=true")).toBe(true);
    expect(parseEditFlag("edit=1")).toBe(true);
    expect(parseEditFlag("#repo=a%2Fb&edit=false")).toBe(false);
    expect(parseEditFlag("#repo=a%2Fb&editor=true")).toBe(false);
    expect(parseEditFlag("")).toBe(false);
  });

  it("sets and removes the key, keeping the rest in order", () => {
    const base = serialize({ repo: "a/b", ref: "main", path: ".github/workflows/ci.yml" });
    const on = applyEditFlag(base, true);
    expect(on).toBe(`${base}&edit=true`);
    expect(applyEditFlag(on, true)).toBe(on);
    expect(applyEditFlag(on, false)).toBe(base);
    expect(applyEditFlag("", false)).toBe("#");
  });

  it("is ignored by browseState, which keeps the file's place", () => {
    const base = serialize({ repo: "a/b", ref: "main", path: ".github/workflows/ci.yml" });
    expect(parse(applyEditFlag(base, true))).toEqual(parse(base));
  });
});

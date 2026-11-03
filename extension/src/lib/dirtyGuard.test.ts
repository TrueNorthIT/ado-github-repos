import { describe, expect, it } from "vitest";
import { decideNav } from "./dirtyGuard";

const at = { repo: "o/r", ref: "main", path: "a.md", tab: "contents" };

describe("decideNav", () => {
  it("allows everything while clean", () => {
    expect(decideNav(false, at, { ...at, path: "b.md" })).toBe("allow");
  });
  it("asks when dirty and the path, ref, repo, tab or view changes", () => {
    expect(decideNav(true, at, { ...at, path: "b.md" })).toBe("ask");
    expect(decideNav(true, at, { ...at, path: "" })).toBe("ask");
    expect(decideNav(true, at, { ...at, ref: "dev" })).toBe("ask");
    expect(decideNav(true, at, { ...at, repo: "o/x", ref: undefined, path: undefined })).toBe("ask");
    expect(decideNav(true, at, { ...at, tab: "history" })).toBe("ask");
    expect(decideNav(true, at, { repo: "o/r", view: "prs" })).toBe("ask");
    expect(decideNav(true, at, { view: "repos" })).toBe("ask");
  });
  it("allows a navigation to where the editor already is", () => {
    expect(decideNav(true, at, { ...at })).toBe("allow");
    expect(decideNav(true, { repo: "o/r", path: "" }, { repo: "o/r" })).toBe("allow");
    expect(decideNav(true, { repo: "o/r", tab: "contents" }, { repo: "o/r" })).toBe("allow");
  });
});

import { describe, it, expect } from "vitest";
import { parse, serialize, BrowseState } from "./browseState";

// Module under test: src/lib/browseState.ts (parse, serialize).
// Hash format the tests rely on when they hand-write a hash: "#key=value&key=value" with keys repo, ref, path
// and values percent-encoded as encodeURIComponent would. Everything else goes through serialize/parse.

const roundTrip = (s: BrowseState) => parse(serialize(s));
const hasDotDot = (p: string) => p.split("/").includes("..");

describe("B-8: The address bar reflects the repo, branch and path", () => {
  // Given a state with repo, ref and path, serialize() gives a "#..." hash and parse() returns the same state.
  it("serialize gives a hash that parse turns back into the same repo, ref and path", () => {
    const state = { repo: "acme/web", ref: "main", path: "src/index.ts" };
    const hash = serialize(state);
    expect(hash.startsWith("#"), `Expected serialize to return a hash starting "#", got "${hash}"`).toBe(true);
    expect(parse(hash), "Expected parse(serialize(state)) to equal the original state").toEqual(state);
  });

  it("parse accepts the hash with or without the leading #", () => {
    const state = { repo: "acme/web", ref: "main", path: "docs" };
    const hash = serialize(state);
    expect(parse(hash.replace(/^#/, "")), "Expected a hash without '#' to parse the same").toEqual(state);
  });

  it("round-trips a repo with no ref or path (repo root on the default branch)", () => {
    expect(roundTrip({ repo: "acme/web" }), "Expected repo-only state to survive a round trip").toEqual({ repo: "acme/web" });
  });

  it("round-trips a branch name containing slashes (feature/x)", () => {
    const state = { repo: "acme/web", ref: "feature/x/y", path: "a/b.txt" };
    expect(roundTrip(state), "Expected ref 'feature/x/y' to stay a single ref, separate from the path").toEqual(state);
  });

  it.each([
    ["spaces", "my docs/read me.md"],
    ["hash", "notes/c#/file#1.cs"],
    ["ampersand", "a&b/c&d.txt"],
    ["percent", "100%/50%25.txt"],
    ["plus", "c++/a+b.cpp"],
    ["equals", "k=v/a=b.txt"],
    ["unicode", "docs/café/日本語/🚀.md"],
    ["nested folders", "a/b/c/d/e/f.txt"],
  ])("round-trips a path containing %s", (_label, path) => {
    const state = { repo: "acme/web", ref: "main", path };
    expect(roundTrip(state), `Expected path "${path}" to survive serialize then parse unchanged`).toEqual(state);
  });

  it("round-trips a branch name containing awkward characters", () => {
    const state = { repo: "acme/web", ref: "release/1.0 #&=%+rc", path: "x" };
    expect(roundTrip(state), "Expected an awkward ref to survive serialize then parse unchanged").toEqual(state);
  });

  it("parses a hand-written percent-encoded hash", () => {
    const hash = `#repo=${encodeURIComponent("acme/web")}&ref=${encodeURIComponent("feature/x")}&path=${encodeURIComponent("docs/a b.md")}`;
    expect(parse(hash), "Expected the encoded repo, ref and path to be decoded").toEqual({ repo: "acme/web", ref: "feature/x", path: "docs/a b.md" });
  });

  it.each(["", "#", "#garbage", "#%%%", "#=&=&", "#repo", "#unknown=1&other=2", "#repo=%E0%A4%A", "#ref=%ZZ"])(
    "gives the list view (no repo) and does not throw for hash %j",
    (hash) => {
      let state: BrowseState | undefined;
      expect(() => (state = parse(hash)), `Expected parse(${JSON.stringify(hash)}) not to throw`).not.toThrow();
      expect(state?.repo, `Expected no repo for hash ${JSON.stringify(hash)}`).toBeUndefined();
    }
  );

  it("ignores unknown keys but keeps the known ones", () => {
    expect(parse("#repo=acme%2Fweb&foo=bar&ref=main"), "Expected unknown key 'foo' to be dropped").toEqual({ repo: "acme/web", ref: "main" });
  });

  it.each(["justname", "a/b/c", "a/", "/b", "a b/c", "../x", ""])("ignores a repo that is not owner/name: %j", (repo) => {
    const state = parse(`#repo=${encodeURIComponent(repo)}&ref=main&path=src`);
    expect(state.repo, `Expected repo ${JSON.stringify(repo)} to be ignored`).toBeUndefined();
    expect(state, "Expected ref and path to be dropped too when there is no valid repo (list view)").toEqual({});
  });

  it("accepts owner/name with dots, dashes and underscores", () => {
    expect(parse("#repo=my-org%2Fmy_repo.js").repo, "Expected a valid owner/name to be kept").toBe("my-org/my_repo.js");
  });

  it("never lets a path with .. segments through", () => {
    for (const path of ["../../etc/passwd", "a/../../b", "..", "a/../b/..", "docs/.."]) {
      const state = parse(`#repo=acme%2Fweb&path=${encodeURIComponent(path)}`);
      expect(
        state.path === undefined || !hasDotDot(state.path),
        `Expected path ${JSON.stringify(path)} to be rejected or normalised, got ${JSON.stringify(state.path)}`
      ).toBe(true);
    }
  });

  it("normalises an inner .. that stays inside the repo (or rejects it)", () => {
    const state = parse(`#repo=acme%2Fweb&path=${encodeURIComponent("a/../b")}`);
    expect([undefined, "b"], `Expected 'a/../b' to become 'b' or be rejected, got ${JSON.stringify(state.path)}`).toContain(state.path);
  });

  it("never lets a leading slash through", () => {
    const state = parse(`#repo=acme%2Fweb&path=${encodeURIComponent("/etc/passwd")}`);
    expect(
      state.path === undefined || !state.path.startsWith("/"),
      `Expected a leading-slash path to be rejected or normalised, got ${JSON.stringify(state.path)}`
    ).toBe(true);
  });

  it("does not emit a hash that parses back with .. segments when serialising a hostile path", () => {
    const state = roundTrip({ repo: "acme/web", path: "../../secret" });
    expect(state.path === undefined || !hasDotDot(state.path), `Expected no '..' after round trip, got ${JSON.stringify(state.path)}`).toBe(true);
  });

  it("treats an empty path as the repo root", () => {
    expect(roundTrip({ repo: "acme/web", ref: "main", path: "" }).path, "Expected empty path to parse as the root (no path)").toBeUndefined();
  });
});

describe("tab in the hash", () => {
  it("round-trips a tab", () => {
    const s = { repo: "acme/web", path: "README.md", tab: "contents" };
    expect(roundTrip(s)).toEqual(s);
    expect(serialize(s)).toContain("tab=contents");
  });
  it("omits the tab when absent and leaves other fields alone", () => {
    expect(serialize({ repo: "acme/web", path: "a" })).not.toContain("tab");
    expect(roundTrip({ repo: "acme/web", ref: "x/y", path: "a b", tab: "preview" })).toEqual({ repo: "acme/web", ref: "x/y", path: "a b", tab: "preview" });
  });
  it("parse ignores an empty or unknown-shaped tab", () => {
    expect(parse("#repo=acme%2Fweb&tab=")).toEqual({ repo: "acme/web" });
    expect(parse("#repo=acme%2Fweb&tab=" + encodeURIComponent("<x>"))).toEqual({ repo: "acme/web" });
  });
});

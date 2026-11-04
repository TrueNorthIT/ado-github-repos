import { describe, it, expect } from "vitest";
import { githubSearchUrl, stripScope } from "./codeSearch";

describe("stripScope", () => {
  it("drops repo:, org: and user: qualifiers the user typed, so the caller sets the scope", () => {
    expect(stripScope('greet repo:evil/other org:x -user:"y z" path:src')).toBe("greet path:src");
  });
});

describe("githubSearchUrl", () => {
  it("scopes one repo and keeps the filters", () => {
    expect(githubSearchUrl({ text: "greet", repos: ["octo/demo"], ext: "ts" })).toBe(`https://github.com/search?type=code&q=${encodeURIComponent("repo:octo/demo greet path:*.ts")}`);
  });
  it("replaces a typed repo: with the current one", () => {
    expect(githubSearchUrl({ text: "repo:evil/other greet", repos: ["octo/demo"] })).toBe(`https://github.com/search?type=code&q=${encodeURIComponent("repo:octo/demo greet")}`);
  });
});

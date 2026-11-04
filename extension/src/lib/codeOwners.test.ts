import { describe, it, expect } from "vitest";
import { codeOwnerRequirement, codeOwnerSet, ownersOf, parseCodeOwners, patternRegExp, reviewerGroups, type CodeOwnerSet, type GroupReviewer } from "./codeOwners";

// Module under test: src/lib/codeOwners.ts. Required reviewers = code owners of the changed files when the target branch requires a code
// owner's review; everyone else Optional. Unknown anywhere: the single "Requested" list ({ kind: "single" }).

describe("patternRegExp follows CODEOWNERS' gitignore rules", () => {
  it.each<[string, string, boolean]>([
    ["*", "a/b/c.ts", true],
    ["*.js", "src/app.js", true],
    ["*.js", "src/app.ts", false],
    ["/docs/", "docs/a.md", true],
    ["/docs/", "src/docs/a.md", false],
    ["docs/", "src/docs/a.md", true], // only a trailing slash: still unanchored, as in gitignore
    ["apps/", "apps/x.ts", true],
    ["/build/logs/", "build/logs/x.log", true],
    ["docs/*", "docs/getting-started.md", true],
    ["docs/*", "docs/build-app/troubleshooting.md", false],
    ["**/logs", "deeply/nested/logs/x.txt", true],
    ["/scripts/**", "scripts/a/b.sh", true],
    ["README.md", "sub/README.md", true],
    ["/README.md", "sub/README.md", false],
    ["a?c.txt", "abc.txt", true],
    ["file.txt", "fileXtxt", false],
  ])("%s on %s -> %s", (pattern, path, expected) => {
    expect(patternRegExp(pattern).test(path), `${pattern} vs ${path}`).toBe(expected);
  });
});

describe("parseCodeOwners and ownersOf", () => {
  const rules = parseCodeOwners("# owners\n\n*       @ann @bob\n*.md    @carol   # docs people\n/docs/  @org/docs-team\n/vendor/\n");
  it("skips comments and blank lines, and cuts a trailing comment", () => {
    expect(rules.map((r) => [r.pattern, r.owners])).toEqual([["*", ["@ann", "@bob"]], ["*.md", ["@carol"]], ["/docs/", ["@org/docs-team"]], ["/vendor/", []]]);
  });
  it("lets the last matching line win", () => {
    expect(ownersOf(rules, "src/a.ts")).toEqual(["@ann", "@bob"]);
    expect(ownersOf(rules, "README.md")).toEqual(["@carol"]);
    expect(ownersOf(rules, "docs/x.md")).toEqual(["@org/docs-team"]);
    expect(ownersOf(rules, "vendor/lib.js")).toEqual([]);
  });
  it("copes with CRLF files", () => {
    expect(parseCodeOwners("* @ann\r\n*.md @carol\r\n").map((r) => r.owners)).toEqual([["@ann"], ["@carol"]]);
  });
});

describe("codeOwnerSet", () => {
  it("collects users, teams and whether an email owns something, for the changed files only", () => {
    const rules = parseCodeOwners("* @Ann\n*.md @org/Docs\n/legal/ lawyer@example.com\n");
    const s = codeOwnerSet(rules, ["src/a.ts", "README.md"]);
    expect([...s.users]).toEqual(["ann"]);
    expect([...s.teams]).toEqual(["org/docs"]);
    expect(s.emails).toBe(false);
    expect(codeOwnerSet(rules, ["legal/terms.txt"]).emails).toBe(true);
  });
});

describe("codeOwnerRequirement", () => {
  it("is true when either classic protection or a ruleset requires it", () => {
    expect(codeOwnerRequirement({ requiresCodeOwnerReviews: true }, undefined)).toBe(true);
    expect(codeOwnerRequirement(undefined, [{ type: "pull_request", parameters: { require_code_owner_review: true } }])).toBe(true);
  });
  it("is false only when both are known and neither does", () => {
    expect(codeOwnerRequirement(null, [])).toBe(false);
    expect(codeOwnerRequirement({ requiresCodeOwnerReviews: false }, [{ type: "pull_request", parameters: {} }])).toBe(false);
  });
  it("is undefined when either is unknown and the other says no", () => {
    expect(codeOwnerRequirement(undefined, [])).toBeUndefined();
    expect(codeOwnerRequirement(null, null)).toBeUndefined();
    expect(codeOwnerRequirement({}, [])).toBeUndefined();
  });
});

const owners = (users: string[], teams: string[] = [], emails = false): CodeOwnerSet => ({ users: new Set(users), teams: new Set(teams), emails });
const user = (login: string, codeOwner?: boolean): GroupReviewer => ({ login, ...(codeOwner === undefined ? {} : { request: { kind: "user" as const, login, codeOwner } }) });

describe("reviewerGroups", () => {
  it("keeps the single list while the requirement is unknown", () => {
    expect(reviewerGroups([user("ann")], undefined, owners(["ann"]), "org")).toEqual({ kind: "single" });
  });
  it("puts everyone under Optional when no code owner review is required", () => {
    expect(reviewerGroups([user("ann"), user("bob")], false, undefined, "org")).toEqual({ kind: "grouped", required: [], optional: ["ann", "bob"] });
  });
  it("splits by asCodeOwner requests and CODEOWNERS, keeping the order", () => {
    const list = [user("ann"), user("bob", true), user("carol", false), user("Dave")];
    expect(reviewerGroups(list, true, owners(["ann", "dave"]), "org")).toEqual({ kind: "grouped", required: ["ann", "bob", "Dave"], optional: ["carol"] });
  });
  it("places a team reviewer by its slug against org/slug owners", () => {
    const team = (slug: string): GroupReviewer => ({ login: slug.toUpperCase(), request: { kind: "team", login: slug, codeOwner: false } });
    expect(reviewerGroups([team("docs"), team("core")], true, owners([], ["org/docs"]), "Org")).toEqual({ kind: "grouped", required: ["DOCS"], optional: ["CORE"] });
  });
  it("trusts asCodeOwner even before CODEOWNERS has loaded, but needs it for the rest", () => {
    expect(reviewerGroups([user("bob", true)], true, undefined, "org")).toEqual({ kind: "grouped", required: ["bob"], optional: [] });
    expect(reviewerGroups([user("bob", true), user("ann")], true, undefined, "org")).toEqual({ kind: "single" });
  });
  it("treats a branch without CODEOWNERS as having no code owners", () => {
    expect(reviewerGroups([user("ann")], true, null, "org")).toEqual({ kind: "grouped", required: [], optional: ["ann"] });
  });
  it("falls back to the single list when a team or email owner could be the reviewer", () => {
    expect(reviewerGroups([user("ann")], true, owners([], ["org/docs"]), "org")).toEqual({ kind: "single" });
    expect(reviewerGroups([user("ann")], true, owners([], [], true), "org")).toEqual({ kind: "single" });
  });
  it("never counts a bot as a code owner", () => {
    expect(reviewerGroups([user("copilot-pull-request-reviewer"), user("dependabot[bot]")], true, owners([], ["org/docs"]), "org")).toEqual({ kind: "grouped", required: [], optional: ["copilot-pull-request-reviewer", "dependabot[bot]"] });
  });
});

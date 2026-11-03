import { describe, it, expect } from "vitest";
import { commitDetailQuery, mapCommitDetail, commitFilesPath, comparePath, parentOptions, defaultParentOption, diffPath, type GqlCommitDetailNode } from "./commitDetail";
import { GHOST_AVATAR } from "./commitsQuery";

// Module under test: src/lib/commitDetail.ts, C-3 "Commit detail". It also owns comparePath, used by the Pushes (C-4) and Branches (B-4) pages.
// Conventions fixed by these tests:
//  - commitDetailQuery variables are { owner, name, sha }; the sha (a hash or prefix) never enters the query text.
//  - REST paths start with `/repos/{owner}/{name}` (as githubBrowse.ts builds them); `repo` is "owner/name".
//  - comparePath percent-encodes base and head separately, so a branch's `/` becomes %2F and the `...` stays literal. Live check on cli/cli: GitHub
//    resolves both `compare/trunk...wm-kw%2Fretryableexec` and the unencoded form to the same comparison.
//  - the changed files come from the REST commit (`files[]` with status, additions, deletions, patch, previous_filename): map them with the existing fromRestFile (prFiles.ts).
//  - a root commit has no base, so its "diff" is the REST commit itself.
// GitHub names (public GraphQL reference): Commit.messageBody, Commit.committer (GitActor), Commit.parents, Commit.associatedPullRequests, Commit.statusCheckRollup.

const norm = (s: string) => s.replace(/\s+/g, " ");
const NASTY = ['we"ird', "back\\slash", "ünï cødé 日本", "sp ace #hash", "q{uery}", "$var"];
const OID = "0123456789abcdef0123456789abcdef01234567";

describe("C-3: commitDetailQuery fetches one commit", () => {
  it("sends owner, name and sha as variables", () => {
    expect(commitDetailQuery({ owner: "acme", name: "web", sha: OID }).variables, "Expected variables { owner, name, sha }").toEqual({ owner: "acme", name: "web", sha: OID });
  });

  it("looks the commit up by object(expression: $sha) as a Commit", () => {
    const q = norm(commitDetailQuery({ owner: "o", name: "n", sha: OID }).query);
    expect(q, "Expected $sha: String!").toMatch(/\$sha:\s*String!/);
    expect(q, "Expected object(expression: $sha)").toMatch(/object\(expression:\s*\$sha\)/);
    expect(q, "Expected a Commit fragment").toMatch(/\.\.\.\s*on Commit/);
  });

  it.each(["oid", "messageHeadline", "messageBody", "message", "authoredDate", "committedDate"])("selects %s", (field) => {
    expect(norm(commitDetailQuery({ owner: "o", name: "n", sha: OID }).query), `Expected ${field} to be selected`).toMatch(new RegExp(`\\b${field}\\b`));
  });

  it("selects author and committer with name and linked user", () => {
    const q = norm(commitDetailQuery({ owner: "o", name: "n", sha: OID }).query);
    expect(q, "Expected author { name user { login avatarUrl } }").toMatch(/author\s*\{\s*name\s+user\s*\{\s*login\s+avatarUrl\s*\}\s*\}/);
    expect(q, "Expected committer { name user { login avatarUrl } }").toMatch(/committer\s*\{\s*name\s+user\s*\{\s*login\s+avatarUrl\s*\}\s*\}/);
  });

  it("selects the parents, the status and the first associated pull request", () => {
    const q = norm(commitDetailQuery({ owner: "o", name: "n", sha: OID }).query);
    expect(q, "Expected parents(first: 10) { nodes { oid } }").toMatch(/parents\(first:\s*10\)\s*\{\s*nodes\s*\{\s*oid\s*\}\s*\}/);
    expect(q, "Expected statusCheckRollup { state }").toMatch(/statusCheckRollup\s*\{\s*state\s*\}/);
    expect(q, "Expected associatedPullRequests(first: 1) { nodes { number title state } }").toMatch(/associatedPullRequests\(first:\s*1\)\s*\{\s*nodes\s*\{\s*number\s+title\s+state\s*\}\s*\}/);
  });

  it.each(NASTY)("never puts caller text in the query string: %s", (nasty) => {
    expect(commitDetailQuery({ owner: nasty, name: nasty, sha: nasty }).query, "Expected the query text to be constant").toBe(commitDetailQuery({ owner: "o", name: "n", sha: OID }).query);
  });
});

const node = (over: Partial<GqlCommitDetailNode> = {}): GqlCommitDetailNode => ({
  oid: OID,
  messageHeadline: "Add retry to the sync job",
  messageBody: "Retries three times with backoff.",
  message: "Add retry to the sync job\n\nRetries three times with backoff.",
  authoredDate: "2026-03-04T09:00:00Z",
  committedDate: "2026-03-05T10:30:00Z",
  author: { name: "Alex Example", user: { login: "alex", avatarUrl: "https://example.test/a.png" } },
  committer: { name: "GitHub", user: null },
  parents: { nodes: [{ oid: "1".repeat(40) }] },
  associatedPullRequests: { nodes: [] },
  statusCheckRollup: null,
  ...over,
});
const wrap = (object: GqlCommitDetailNode | null) => ({ data: { repository: { object } } });

describe("C-3: mapCommitDetail builds the detail header and Details tab", () => {
  it("maps the title, body, full message and short SHA", () => {
    const d = mapCommitDetail(wrap(node()))!;
    expect(d.sha, "Expected the full oid").toBe(OID);
    expect(d.shortSha, "Expected the first 8 characters").toBe("01234567");
    expect(d.title, "Expected messageHeadline as the title").toBe("Add retry to the sync job");
    expect(d.body, "Expected messageBody as the body").toBe("Retries three times with backoff.");
    expect(d.message, "Expected the full message").toBe("Add retry to the sync job\n\nRetries three times with backoff.");
  });

  it("maps author, committer and both dates", () => {
    const d = mapCommitDetail(wrap(node()))!;
    expect(d.author, "Expected the linked author").toEqual({ name: "Alex Example", login: "alex", avatarUrl: "https://example.test/a.png" });
    expect(d.committer, "Expected the committer without a linked user to keep its name, null login and the ghost avatar").toEqual({ name: "GitHub", login: null, avatarUrl: GHOST_AVATAR });
    expect(d.authoredDate, "Expected authoredDate as a Date").toEqual(new Date("2026-03-04T09:00:00Z"));
    expect(d.committedDate, "Expected committedDate as a Date").toEqual(new Date("2026-03-05T10:30:00Z"));
  });

  it("flattens the parents in order", () => {
    const d = mapCommitDetail(wrap(node({ parents: { nodes: [{ oid: "a".repeat(40) }, { oid: "b".repeat(40) }] } })))!;
    expect(d.parents, "Expected parents as oids, first parent first").toEqual(["a".repeat(40), "b".repeat(40)]);
  });

  it("maps the build status and shows null without checks", () => {
    expect(mapCommitDetail(wrap(node({ statusCheckRollup: { state: "SUCCESS" } })))!.status, "Expected SUCCESS to be succeeded").toBe("succeeded");
    expect(mapCommitDetail(wrap(node()))!.status, "Expected no checks to give null").toBeNull();
  });

  it.each(["MERGED", "OPEN"] as const)("includes the associated %s pull request", (state) => {
    const d = mapCommitDetail(wrap(node({ associatedPullRequests: { nodes: [{ number: 412, title: "Retry sync", state }] } })))!;
    expect(d.pullRequest, `Expected the ${state} PR number and title`).toEqual({ number: 412, title: "Retry sync" });
  });

  it("leaves the pull request null when the associated one is closed unmerged or absent", () => {
    expect(mapCommitDetail(wrap(node({ associatedPullRequests: { nodes: [{ number: 9, title: "Abandoned", state: "CLOSED" }] } })))!.pullRequest, "Expected a closed PR to be hidden").toBeNull();
    expect(mapCommitDetail(wrap(node()))!.pullRequest, "Expected null when none is associated").toBeNull();
  });

  it("returns null when no commit has that SHA", () => {
    expect(mapCommitDetail(wrap(null)), "Expected null for an unknown commit").toBeNull();
  });
});

describe("C-3: REST paths for the changed files", () => {
  it("builds the REST commit path that carries the files", () => {
    expect(commitFilesPath("acme/web", OID), "Expected /repos/{o}/{r}/commits/{sha}").toBe(`/repos/acme/web/commits/${OID}`);
  });

  it("builds the compare path as base...head", () => {
    expect(comparePath("acme/web", "a".repeat(40), "b".repeat(40)), "Expected /repos/{o}/{r}/compare/{base}...{head}").toBe(`/repos/acme/web/compare/${"a".repeat(40)}...${"b".repeat(40)}`);
  });

  // Also B-4 (default...branch) and C-4 (before...after): branch names may contain "/".
  it("percent-encodes a slash in a branch name", () => {
    expect(comparePath("acme/web", "main", "feature/jdp/tooling"), "Expected the head's / to be %2F").toBe("/repos/acme/web/compare/main...feature%2Fjdp%2Ftooling");
    expect(comparePath("acme/web", "release/1.0", "main"), "Expected the base's / to be %2F").toBe("/repos/acme/web/compare/release%2F1.0...main");
  });

  it.each([
    ["with space", "with%20space"],
    ["hash#tag", "hash%23tag"],
    ["q?x", "q%3Fx"],
    ["100%", "100%25"],
  ])("percent-encodes %j in a branch name as %s", (branch, encoded) => {
    expect(comparePath("acme/web", "main", branch), `Expected "${branch}" to be encoded`).toBe(`/repos/acme/web/compare/main...${encoded}`);
  });
});

describe("C-3: 'Parent N → This commit' options", () => {
  it("offers one option labelled Parent 1 for a single-parent commit", () => {
    expect(parentOptions(["a".repeat(40)]), "Expected a single Parent 1 option").toEqual([{ label: "Parent 1", baseSha: "a".repeat(40) }]);
  });

  it("offers one option per parent of a merge commit, numbered from 1", () => {
    expect(parentOptions(["a".repeat(40), "b".repeat(40), "c".repeat(40)]), "Expected Parent 1, Parent 2 and Parent 3 in order").toEqual([
      { label: "Parent 1", baseSha: "a".repeat(40) },
      { label: "Parent 2", baseSha: "b".repeat(40) },
      { label: "Parent 3", baseSha: "c".repeat(40) },
    ]);
  });

  it("offers a single 'Initial commit' option with no base for a root commit", () => {
    expect(parentOptions([]), "Expected one Initial commit option and no base").toEqual([{ label: "Initial commit", baseSha: null }]);
  });

  it("defaults to parent 1 for a merge commit", () => {
    expect(defaultParentOption(["a".repeat(40), "b".repeat(40)]), "Expected the default to be Parent 1").toEqual({ label: "Parent 1", baseSha: "a".repeat(40) });
  });

  it("defaults to the initial commit option for a root commit", () => {
    expect(defaultParentOption([]), "Expected the default to be Initial commit").toEqual({ label: "Initial commit", baseSha: null });
  });
});

describe("C-3: the diff base for the chosen parent", () => {
  it("compares the chosen parent to this commit", () => {
    const [, second] = parentOptions(["a".repeat(40), "b".repeat(40)]);
    expect(diffPath("acme/web", OID, second), "Expected compare/{parent 2}...{sha}").toBe(`/repos/acme/web/compare/${"b".repeat(40)}...${OID}`);
  });

  it("uses the REST commit itself when there is no base (initial commit)", () => {
    expect(diffPath("acme/web", OID, defaultParentOption([])), "Expected /commits/{sha} for a root commit").toBe(`/repos/acme/web/commits/${OID}`);
  });
});

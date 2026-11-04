import { describe, it, expect } from "vitest";
import {
  commitsQuery,
  commitsByPathQuery,
  normalizeHistoryPath,
  commitSearchQuery,
  isShaPrefix,
  mapCheckState,
  mapPerson,
  mapCommitNode,
  mapCommitsPage,
  mapCommitSearch,
  GHOST_AVATAR,
  type GqlCommitNode,
} from "./commitsQuery";

// Module under test: src/lib/commitsQuery.ts (C-1 "Commits list").
// Shared rule, as in feedQuery.ts / prQuery.ts: caller-supplied values (owner, name, ref, cursor, sha) travel in `variables`; the query text is constant.
// Conventions fixed by these tests:
//  - commitsQuery variables are { owner, name, ref, after }; an absent cursor is sent as null. It reads history from `ref(qualifiedName: $ref)`'s target commit.
//  - commitSearchQuery THROWS an Error mentioning "SHA" for anything that is not 4 to 40 hex characters; no request object exists then.
//  - the response `parents` is a connection: parents.nodes[].oid. CommitRow.parents is the plain oid array.
//  - CommitRow.date is authoredDate (the author's name sits beside it); committedDate is kept separately.
//  - a null author is the ghost (name and login "ghost", GHOST_AVATAR). An author whose email has no GitHub account keeps its name, has login null and the ghost avatar.
// GitHub names (public GraphQL reference): Repository.ref, Commit.history, Commit.parents, Commit.associatedPullRequests, Commit.statusCheckRollup, StatusState, PullRequestState.
// Validated live against cli/cli with `gh api graphql` on 2026-11-02.

const base = { owner: "acme", name: "web", ref: "main" };
const norm = (s: string) => s.replace(/\s+/g, " ");
const NASTY = ['we"ird', "back\\slash", "ünï cødé 日本", "sp ace #hash", "q{uery}", "$var"];
const OID = "0123456789abcdef0123456789abcdef01234567";

describe("C-1: commitsQuery reads one page of history for a ref", () => {
  // Given owner, name and ref, commitsQuery sends them as variables with a null cursor on the first page.
  it("sends owner, name, ref and a null after cursor as variables", () => {
    expect(commitsQuery(base).variables, "Expected variables { owner, name, ref, after: null } for the first page").toEqual({ owner: "acme", name: "web", ref: "main", after: null });
  });

  it("sends the supplied cursor in the after variable", () => {
    expect(commitsQuery({ ...base, after: "abc 49" }).variables.after, "Expected the history cursor to be passed as variables.after").toBe("abc 49");
  });

  it("declares typed variables and reads history from the ref's target commit", () => {
    const q = norm(commitsQuery(base).query);
    expect(q, "Expected $owner: String!").toMatch(/\$owner:\s*String!/);
    expect(q, "Expected $name: String!").toMatch(/\$name:\s*String!/);
    expect(q, "Expected $ref: String!").toMatch(/\$ref:\s*String!/);
    expect(q, "Expected $after: String (nullable)").toMatch(/\$after:\s*String(?!!)/);
    expect(q, "Expected repository(owner: $owner, name: $name)").toMatch(/repository\(owner:\s*\$owner,\s*name:\s*\$name\)/);
    expect(q, "Expected ref(qualifiedName: $ref)").toMatch(/ref\(qualifiedName:\s*\$ref\)/);
    expect(q, "Expected the history on the target's Commit fragment").toMatch(/target\s*\{\s*\.\.\.\s*on Commit\s*\{[^]*history\(/);
    expect(q, "Expected history(first: 50, after: $after)").toMatch(/history\(first:\s*50,\s*after:\s*\$after\)/);
  });

  it("asks for the page info needed to fetch the next page", () => {
    expect(norm(commitsQuery(base).query), "Expected pageInfo { hasNextPage endCursor }").toMatch(/pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/);
  });

  it.each(["oid", "messageHeadline", "message", "committedDate", "authoredDate"])("selects the commit field %s", (field) => {
    expect(norm(commitsQuery(base).query), `Expected the commit field ${field} to be selected`).toMatch(new RegExp(`\\b${field}\\b`));
  });

  it("selects the author name and linked user login and avatarUrl", () => {
    expect(norm(commitsQuery(base).query), "Expected author { name email user { login avatarUrl } }").toMatch(/author\s*\{\s*name\s+email\s+user\s*\{\s*login\s+avatarUrl\s*\}\s*\}/);
  });

  it("selects up to five parents by oid", () => {
    expect(norm(commitsQuery(base).query), "Expected parents(first: 5) { nodes { oid } }").toMatch(/parents\(first:\s*5\)\s*\{\s*nodes\s*\{\s*oid\s*\}\s*\}/);
  });

  it("selects the first associated pull request's number, title and state", () => {
    expect(norm(commitsQuery(base).query), "Expected associatedPullRequests(first: 1) { nodes { number title state } }").toMatch(
      /associatedPullRequests\(first:\s*1\)\s*\{\s*nodes\s*\{\s*number\s+title\s+state\s*\}\s*\}/
    );
  });

  it("selects the status check rollup state", () => {
    expect(norm(commitsQuery(base).query), "Expected statusCheckRollup { state }").toMatch(/statusCheckRollup\s*\{\s*state\s*\}/);
  });

  it.each(NASTY)("never puts caller text in the query string: %s", (nasty) => {
    const a = commitsQuery({ owner: nasty, name: nasty, ref: nasty, after: nasty });
    expect(a.query, "Expected the query text to be identical whatever the caller supplies").toBe(commitsQuery(base).query);
    expect(a.variables, "Expected the caller's text to travel in variables").toMatchObject({ owner: nasty, name: nasty, ref: nasty, after: nasty });
  });

  it("is a single query operation", () => {
    const q = norm(commitsQuery(base).query);
    expect(q, "Expected the text to start with a query operation").toMatch(/^\s*query\b/);
    expect(q.match(/\b(query|mutation|subscription)\b\s*[\w]*\s*\(/g), "Expected exactly one operation").toHaveLength(1);
  });
});

describe("C-1: commit search takes a hex prefix of 4 to 40 characters", () => {
  it.each(["abcd", "ABCD", "0123456", OID, "a1B2c3"])("accepts %s as a SHA prefix", (text) => {
    expect(isShaPrefix(text), `Expected "${text}" to be a valid SHA prefix`).toBe(true);
  });

  it.each(["", "abc", "a".repeat(41), "ghij", "abcd ef", " abcd", "abcd\n", "main", "abc-def", "0x1234"])("rejects %j as a SHA prefix", (text) => {
    expect(isShaPrefix(text), `Expected ${JSON.stringify(text)} not to be a valid SHA prefix`).toBe(false);
  });

  it("fetches object(expression: $sha) as a Commit, sending the prefix as a variable", () => {
    const req = commitSearchQuery({ owner: "acme", name: "web", sha: "a1b2c3d" });
    const q = norm(req.query);
    expect(req.variables, "Expected variables { owner, name, sha }").toEqual({ owner: "acme", name: "web", sha: "a1b2c3d" });
    expect(q, "Expected $sha: String!").toMatch(/\$sha:\s*String!/);
    expect(q, "Expected object(expression: $sha)").toMatch(/object\(expression:\s*\$sha\)/);
    expect(q, "Expected a Commit fragment").toMatch(/\.\.\.\s*on Commit/);
    expect(q, "Expected the same commit fields as the list (headline, parents, status, PR)").toMatch(/messageHeadline[^]*parents[^]*associatedPullRequests[^]*statusCheckRollup/);
  });

  it("does not put the prefix in the query text", () => {
    const a = commitSearchQuery({ owner: "o", name: "n", sha: "abcd" });
    const b = commitSearchQuery({ owner: "x", name: "y", sha: "ffff0000" });
    expect(a.query, "Expected the query text to be independent of the prefix").toBe(b.query);
  });

  it.each(["abc", "main", "a".repeat(41), "abcd; drop", '" } }', ""])("throws a SHA error and builds no request for %j", (sha) => {
    expect(() => commitSearchQuery({ owner: "o", name: "n", sha }), `Expected ${JSON.stringify(sha)} to be rejected as not a SHA prefix`).toThrow(/SHA/);
  });
});

describe("C-1: build status is mapped from the check rollup state", () => {
  it.each([
    ["SUCCESS", "succeeded"],
    ["FAILURE", "failed"],
    ["ERROR", "failed"],
    ["PENDING", "running"],
    ["EXPECTED", "running"],
  ])("maps %s to %s", (state, expected) => {
    expect(mapCheckState(state), `Expected ${state} to map to ${expected}`).toBe(expected);
  });

  it.each([null, undefined])("maps %s (no checks) to null", (state) => {
    expect(mapCheckState(state), "Expected no rollup to give a null status").toBeNull();
  });
});

describe("C-1: authors fall back to the ghost", () => {
  it("maps a linked user to name, login and avatar", () => {
    expect(mapPerson({ name: "Alex Example", user: { login: "alex", avatarUrl: "https://example.test/a.png" } }), "Expected the linked user's details").toEqual({
      name: "Alex Example",
      login: "alex",
      avatarUrl: "https://example.test/a.png",
    });
  });

  it("maps a null author to the ghost", () => {
    expect(mapPerson(null), "Expected a null author to be the ghost").toEqual({ name: "ghost", login: "ghost", avatarUrl: GHOST_AVATAR });
  });

  it("keeps the git name, with no login and the ghost avatar, when the email has no GitHub account", () => {
    expect(mapPerson({ name: "Sam Unlinked", user: null }), "Expected the name kept and the login null").toEqual({ name: "Sam Unlinked", login: null, avatarUrl: GHOST_AVATAR });
  });
});

const node = (over: Partial<GqlCommitNode> = {}): GqlCommitNode => ({
  oid: OID,
  messageHeadline: "Add retry to the sync job",
  message: "Add retry to the sync job\n\nRetries three times with backoff.",
  committedDate: "2026-03-05T10:30:00Z",
  authoredDate: "2026-03-04T09:00:00Z",
  author: { name: "Alex Example", user: { login: "alex", avatarUrl: "https://example.test/a.png" } },
  parents: { nodes: [{ oid: "1".repeat(40) }] },
  associatedPullRequests: { nodes: [] },
  statusCheckRollup: null,
  ...over,
});

describe("C-1: mapCommitNode builds a Commits list row", () => {
  it("maps title, message, 8-character short SHA, author and dates", () => {
    const row = mapCommitNode(node());
    expect(row.sha, "Expected the full oid as sha").toBe(OID);
    expect(row.shortSha, "Expected the first 8 characters as shortSha").toBe("01234567");
    expect(row.title, "Expected messageHeadline as the title").toBe("Add retry to the sync job");
    expect(row.message, "Expected the full message").toBe("Add retry to the sync job\n\nRetries three times with backoff.");
    expect(row.author, "Expected the author's name, login and avatar").toEqual({ name: "Alex Example", login: "alex", avatarUrl: "https://example.test/a.png" });
    expect(row.date, "Expected date to be the authoredDate as a Date").toEqual(new Date("2026-03-04T09:00:00Z"));
    expect(row.committedDate, "Expected committedDate as a Date").toEqual(new Date("2026-03-05T10:30:00Z"));
  });

  it("flattens the parents connection to an ordered array of oids", () => {
    const row = mapCommitNode(node({ parents: { nodes: [{ oid: "a".repeat(40) }, { oid: "b".repeat(40) }] } }));
    expect(row.parents, "Expected parents in order, first parent first").toEqual(["a".repeat(40), "b".repeat(40)]);
  });

  it("gives a root commit an empty parents array", () => {
    expect(mapCommitNode(node({ parents: { nodes: [] } })).parents, "Expected no parents for a root commit").toEqual([]);
  });

  it("falls back to the ghost for a commit with no author", () => {
    expect(mapCommitNode(node({ author: null })).author, "Expected the ghost author").toEqual({ name: "ghost", login: "ghost", avatarUrl: GHOST_AVATAR });
  });

  it.each(["MERGED", "OPEN"] as const)("shows the PR number when the associated PR is %s", (state) => {
    const row = mapCommitNode(node({ associatedPullRequests: { nodes: [{ number: 412, title: "Retry sync", state }] } }));
    expect(row.prNumber, `Expected PR 412 to show for a ${state} pull request`).toBe(412);
  });

  it("shows no PR number when the associated PR is CLOSED (unmerged)", () => {
    const row = mapCommitNode(node({ associatedPullRequests: { nodes: [{ number: 9, title: "Abandoned", state: "CLOSED" }] } }));
    expect(row.prNumber, "Expected a closed, unmerged PR not to be shown").toBeNull();
  });

  it("shows no PR number when there is no associated PR", () => {
    expect(mapCommitNode(node()).prNumber, "Expected null when nothing is associated").toBeNull();
  });

  it.each([
    ["SUCCESS", "succeeded"],
    ["FAILURE", "failed"],
    ["PENDING", "running"],
  ])("maps the rollup state %s to the row status %s", (state, expected) => {
    expect(mapCommitNode(node({ statusCheckRollup: { state } })).status, `Expected status ${expected}`).toBe(expected);
  });

  it("gives a null status when the commit has no checks", () => {
    expect(mapCommitNode(node({ statusCheckRollup: null })).status, "Expected null status without a rollup").toBeNull();
  });
});

describe("C-1: mapCommitsPage maps a whole response", () => {
  const body = (nodes: GqlCommitNode[], pageInfo = { hasNextPage: true, endCursor: "cur 49" }) => ({ data: { repository: { ref: { target: { history: { pageInfo, nodes } } } } } });

  it("maps every node in order and carries the paging cursor", () => {
    const page = mapCommitsPage(body([node({ oid: "a".repeat(40) }), node({ oid: "b".repeat(40) })]));
    expect(page.rows.map((r) => r.sha), "Expected the rows in response order").toEqual(["a".repeat(40), "b".repeat(40)]);
    expect(page.hasNextPage, "Expected hasNextPage from pageInfo").toBe(true);
    expect(page.endCursor, "Expected endCursor from pageInfo").toBe("cur 49");
  });

  it("reports the last page", () => {
    const page = mapCommitsPage(body([node()], { hasNextPage: false, endCursor: "end" }));
    expect(page.hasNextPage, "Expected hasNextPage false on the last page").toBe(false);
  });

  it("gives no rows when the ref does not exist", () => {
    expect(mapCommitsPage({ data: { repository: { ref: null } } }), "Expected an empty, finished page for a missing ref").toEqual({ rows: [], hasNextPage: false, endCursor: null });
  });
});

describe("C-1: mapCommitSearch maps the SHA-prefix lookup", () => {
  it("maps the matching commit to a row", () => {
    const row = mapCommitSearch({ data: { repository: { object: node() } } });
    expect(row?.sha, "Expected the matched commit's row").toBe(OID);
  });

  it("returns null when no commit matches the prefix", () => {
    expect(mapCommitSearch({ data: { repository: { object: null } } }), "Expected null for an unknown prefix").toBeNull();
  });
});

describe("commitsByPathQuery: history(path:) for the Commits path filter", () => {
  const base = { owner: "acme", name: "web", ref: "refs/heads/main" };
  it("passes the path as a variable and asks history for it, never inlining it", () => {
    const q = commitsByPathQuery({ ...base, path: "src/app.ts", after: "c1" });
    expect(q.variables, "Expected owner, name, ref, after and path variables").toEqual({ ...base, after: "c1", path: "src/app.ts" });
    expect(q.query).toMatch(/history\(first: 50, after: \$after, path: \$path\)/);
    expect(q.query).toContain("$path: String");
    expect(q.query).not.toContain("src/app.ts");
  });
  it("selects the same fields as the plain history query", () => {
    const plain = commitsQuery(base).query.replace(/history\([^)]*\)/, "");
    expect(commitsByPathQuery({ ...base, path: "a" }).query.replace(/history\([^)]*\)/, "").replace(/, \$path: String/, "")).toBe(plain);
  });
  it.each([["  /src/lib/ ", "src/lib"], ["README.md", "README.md"], ["./a/b", "a/b"]])("normalises %j to %j", (raw, want) => {
    expect(normalizeHistoryPath(raw)).toBe(want);
  });
  it.each(["", "   ", "/", "./"])("sends null for the blank path %j (GitHub rejects an empty string)", (raw) => {
    expect(commitsByPathQuery({ ...base, path: raw }).variables.path).toBeNull();
  });
});

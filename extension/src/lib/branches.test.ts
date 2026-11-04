import { describe, it, expect } from "vitest";
import {
  branchListQuery,
  mapBranchesPage,
  buildRefTree,
  filterByTab,
  branchesToCompare,
  mapCompare,
  inBatches,
  maxDivergence,
  barWidths,
  createBranchMutation,
  canDeleteBranch,
  type Branch,
  type GqlBranchNode,
  type RefNode,
} from "./branches";
import { GHOST_AVATAR } from "./commitsQuery";
import { comparePath } from "./commitDetail";

// Module under test: src/lib/branches.ts, requirements B-1 to B-5. Generic helpers (buildRefTree) are reused by tags.ts (T-1).
// Shared rule, as in feedQuery.ts / actionsQuery.ts: caller-supplied values travel in `variables`; query text is constant.
// DECISIONS (live checks against cli/cli with `gh api graphql`, 2026-11-02):
//  - RefOrderField has TAG_COMMIT_DATE and ALPHABETICAL. But on refs/heads/ TAG_COMMIT_DATE does NOT order by commit date: its result was identical to
//    ALPHABETICAL for both directions (DESC listed workflows, workflow-view, workflow-test-spike, wm-... : Z to A). For tags it does order newest first.
//    So the branch list uses ALPHABETICAL ASC, the fallback B-1 allows, and the Branches tab/tree must not assume a recency order from the server.
//  - buildRefTree: folders first (case-insensitive A-Z, ties ordinal), then refs in INPUT order (the server's order); the pinned default is a top-level leaf, first of all.
//  - a pinned ref keeps its whole name as the leaf name; refs inside folders use their last segment.
//  - deleting a branch reuses deleteRefMutation (actionsQuery.ts, already tested); only creation is new here.
// GitHub names: Repository.refs, RefOrderField, RefOrderField.ALPHABETICAL, Ref.associatedPullRequests, Ref.branchProtectionRule, Repository.defaultBranchRef, CreateRefInput.

const norm = (s: string) => s.replace(/\s+/g, " ");
const NASTY = ['we"ird', "back\\slash", "ünï cødé 日本", "sp ace #hash", "q{uery}", "$var"];
const OID = "0123456789abcdef0123456789abcdef01234567";

describe("B-1: branchListQuery lists branches with their head commit", () => {
  const req = () => branchListQuery({ owner: "acme", name: "web" });
  const q = () => norm(req().query);

  it("sends owner, name and a null cursor as variables", () => {
    expect(req().variables, "Expected { owner, name, after: null } on the first page").toEqual({ owner: "acme", name: "web", after: null });
    expect(branchListQuery({ owner: "o", name: "n", after: "MTAw" }).variables.after, "Expected the cursor in variables.after").toBe("MTAw");
  });

  it("reads refs/heads/ 100 at a time after the cursor", () => {
    expect(q(), "Expected $after: String").toMatch(/\$after:\s*String(?!!)/);
    expect(q(), 'Expected refs(refPrefix: "refs/heads/", first: 100, after: $after, ...)').toMatch(/refs\(refPrefix:\s*"refs\/heads\/",\s*first:\s*100,\s*after:\s*\$after,/);
  });

  it("orders ALPHABETICAL ASC (TAG_COMMIT_DATE does not order branches by date; see the DECISIONS above)", () => {
    expect(q(), "Expected orderBy {field: ALPHABETICAL, direction: ASC}").toMatch(/orderBy:\s*\{\s*field:\s*ALPHABETICAL,\s*direction:\s*ASC\s*\}/);
  });

  it("asks for the page info", () => {
    expect(q(), "Expected pageInfo { hasNextPage endCursor }").toMatch(/pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/);
  });

  it("selects the ref id and name, which delete and display need", () => {
    expect(q(), "Expected id and name on each ref").toMatch(/nodes\s*\{\s*id\s+name\b/);
  });

  it("selects the head commit's oid, authoredDate, author user and check state", () => {
    expect(q(), "Expected the Commit fragment fields").toMatch(/target\s*\{\s*\.\.\.\s*on Commit\s*\{[^]*\boid\b[^]*\bauthoredDate\b[^]*author\s*\{\s*name\s+email\s+user\s*\{\s*login\s+avatarUrl\s*\}\s*\}[^]*statusCheckRollup\s*\{\s*state\s*\}/);
  });

  it("selects the first OPEN pull request on the ref", () => {
    expect(q(), "Expected associatedPullRequests(states: OPEN, first: 1)").toMatch(/associatedPullRequests\(states:\s*OPEN,\s*first:\s*1\)\s*\{\s*nodes\s*\{\s*number\b/);
  });

  it("selects the branch protection rule id", () => {
    expect(q(), "Expected branchProtectionRule { id }").toMatch(/branchProtectionRule\s*\{\s*id\s*\}/);
  });

  it("selects the repository id (for createRef) and the default branch", () => {
    expect(q(), "Expected repository { id ... }").toMatch(/repository\(owner:\s*\$owner,\s*name:\s*\$name\)\s*\{\s*id\b/);
    expect(q(), "Expected defaultBranchRef { name }").toMatch(/defaultBranchRef\s*\{\s*name\s*\}/);
  });

  it.each(NASTY)("never puts caller text in the query string: %s", (nasty) => {
    const a = branchListQuery({ owner: nasty, name: nasty, after: nasty });
    expect(a.query, "Expected constant query text").toBe(req().query);
    expect(a.variables, "Expected the text in variables").toMatchObject({ owner: nasty, name: nasty, after: nasty });
  });

  it("is a single query operation", () => {
    expect(q().match(/\b(query|mutation|subscription)\b\s*[\w]*\s*\(/g), "Expected exactly one operation").toHaveLength(1);
  });
});

const gql = (name: string, over: Partial<GqlBranchNode> = {}): GqlBranchNode => ({
  id: `REF_${name}`,
  name,
  branchProtectionRule: null,
  associatedPullRequests: { nodes: [] },
  target: { oid: OID, authoredDate: "2026-10-01T08:00:00Z", author: { name: "Alex Example", user: { login: "alex", avatarUrl: "https://example.test/a.png" } }, statusCheckRollup: null },
  ...over,
});
const page = (nodes: GqlBranchNode[], defaultName: string | null = "main") => ({
  data: { repository: { id: "REPO_1", defaultBranchRef: defaultName ? { name: defaultName } : null, refs: { pageInfo: { hasNextPage: true, endCursor: "MTAw" }, nodes } } },
});

describe("B-1: mapBranchesPage builds the list rows", () => {
  it("maps id, name, sha, short SHA, author, authored date and flags", () => {
    const p = mapBranchesPage(page([gql("feature/x")]));
    expect(p.branches[0], "Expected the branch row").toEqual({
      id: "REF_feature/x",
      name: "feature/x",
      sha: OID,
      shortSha: "01234567",
      author: { name: "Alex Example", login: "alex", avatarUrl: "https://example.test/a.png" },
      authoredDate: new Date("2026-10-01T08:00:00Z"),
      status: null,
      prNumber: null,
      protected: false,
      isDefault: false,
    });
  });

  it("carries the repository id, default branch name and paging cursor", () => {
    const p = mapBranchesPage(page([gql("main")]));
    expect(p.repoId, "Expected repository.id (createRef's repositoryId)").toBe("REPO_1");
    expect(p.defaultBranch, "Expected defaultBranchRef.name").toBe("main");
    expect(p.hasNextPage, "Expected hasNextPage").toBe(true);
    expect(p.endCursor, "Expected endCursor").toBe("MTAw");
  });

  it("marks only the default branch isDefault", () => {
    const p = mapBranchesPage(page([gql("main"), gql("dev")]));
    expect(p.branches.map((b) => b.isDefault), "Expected main to be the default").toEqual([true, false]);
  });

  it("has a null default branch for an empty repository", () => {
    expect(mapBranchesPage(page([], null)).defaultBranch, "Expected null without defaultBranchRef").toBeNull();
  });

  it("marks a branch with a protection rule as protected", () => {
    const p = mapBranchesPage(page([gql("main", { branchProtectionRule: { id: "BPR_1" } }), gql("dev")]));
    expect(p.branches.map((b) => b.protected), "Expected only the ruled branch to be protected").toEqual([true, false]);
  });

  it("shows the open PR number, or null", () => {
    const p = mapBranchesPage(page([gql("a", { associatedPullRequests: { nodes: [{ number: 21, title: "T" }] } }), gql("b")]));
    expect(p.branches.map((b) => b.prNumber), "Expected PR 21 on a and null on b").toEqual([21, null]);
  });

  it.each([
    ["SUCCESS", "succeeded"],
    ["FAILURE", "failed"],
    ["PENDING", "running"],
  ])("maps check state %s to %s", (state, expected) => {
    const node = gql("a");
    node.target!.statusCheckRollup = { state };
    expect(mapBranchesPage(page([node])).branches[0].status, `Expected ${expected}`).toBe(expected);
  });

  it("uses the ghost for an author without an account, keeping the git name", () => {
    const node = gql("a");
    node.target!.author = { name: "Sam Unlinked", user: null };
    expect(mapBranchesPage(page([node])).branches[0].author, "Expected name kept, login null, ghost avatar").toEqual({ name: "Sam Unlinked", login: null, avatarUrl: GHOST_AVATAR });
  });
});

// ---- B-2 ----

type Item = { name: string };
const items = (...names: string[]): Item[] => names.map((name) => ({ name }));
/** A compact picture of the tree: folder names end in "/", refs show their leaf name. */
function shape(nodes: RefNode<Item>[]): unknown[] {
  return nodes.map((n) => (n.kind === "folder" ? { [n.name + "/"]: shape(n.children) } : n.name));
}

describe("B-2: buildRefTree groups branch names into folders by '/'", () => {
  it("nests feature/jdp/tooling under folder feature, then jdp", () => {
    const tree = buildRefTree(items("feature/jdp/tooling"));
    expect(shape(tree), "Expected feature/ > jdp/ > tooling").toEqual([{ "feature/": [{ "jdp/": ["tooling"] }] }]);
  });

  it("gives each folder its segment name and full path, and each ref its item", () => {
    const [feature] = buildRefTree(items("feature/jdp/tooling")) as any[];
    expect(feature, "Expected the outer folder").toMatchObject({ kind: "folder", name: "feature", path: "feature" });
    expect(feature.children[0], "Expected the inner folder to carry its full path").toMatchObject({ kind: "folder", name: "jdp", path: "feature/jdp" });
    expect(feature.children[0].children[0], "Expected the leaf to hold the original item").toEqual({ kind: "ref", name: "tooling", item: { name: "feature/jdp/tooling" } });
  });

  it("does not collapse a folder with a single child", () => {
    expect(shape(buildRefTree(items("a/b/c"))), "Expected a/ > b/ > c, not a/b/c").toEqual([{ "a/": [{ "b/": ["c"] }] }]);
  });

  it("shares a folder between branches with the same prefix", () => {
    expect(shape(buildRefTree(items("feature/a", "feature/b", "bugfix/c"))), "Expected one feature folder with two refs").toEqual([{ "bugfix/": ["c"] }, { "feature/": ["a", "b"] }]);
  });

  it("lists folders first, then branches, at every level", () => {
    const tree = buildRefTree(items("zeta", "feature/a", "alpha", "feature/inner/b", "feature/z"));
    expect(shape(tree), "Expected folders before refs, at the top level and inside feature/").toEqual([{ "feature/": [{ "inner/": ["b"] }, "a", "z"] }, "zeta", "alpha"]);
  });

  it("sorts folders case-insensitively A-Z", () => {
    expect(shape(buildRefTree(items("Zed/a", "alpha/a", "Beta/a"))), "Expected alpha, Beta, Zed").toEqual([{ "alpha/": ["a"] }, { "Beta/": ["a"] }, { "Zed/": ["a"] }]);
  });

  it("keeps refs in the order they were supplied", () => {
    expect(shape(buildRefTree(items("m", "c", "x", "a"))), "Expected input order, not alphabetical").toEqual(["m", "c", "x", "a"]);
  });

  it("returns an empty tree for no branches", () => {
    expect(buildRefTree(items()), "Expected an empty tree").toEqual([]);
  });
});

describe("B-2: the default branch is pinned to the top level", () => {
  it("puts the default branch first, ahead of folders and other branches", () => {
    const tree = buildRefTree(items("alpha", "feature/a", "main"), { pin: "main" });
    expect(shape(tree), "Expected main first").toEqual(["main", { "feature/": ["a"] }, "alpha"]);
  });

  it("keeps a default branch that contains '/' out of its folder, under its whole name", () => {
    const tree = buildRefTree(items("release/1.x", "release/2.0", "feature/a"), { pin: "release/1.x" });
    expect(shape(tree), "Expected release/1.x at the top, release/ holding only 2.0").toEqual(["release/1.x", { "feature/": ["a"] }, { "release/": ["2.0"] }]);
    expect((tree[0] as any).item, "Expected the pinned leaf to hold the branch item").toEqual({ name: "release/1.x" });
  });

  it("ignores a pin that is not among the branches", () => {
    expect(shape(buildRefTree(items("a", "b"), { pin: "main" })), "Expected no invented entry").toEqual(["a", "b"]);
  });
});

describe("B-2: name search keeps matching branches with their folder path", () => {
  const all = items("feature/jdp/tooling", "feature/jdp/Docs", "feature/other", "bugfix/tooling-fix", "main");

  it("matches case-insensitively as a substring of the whole name", () => {
    expect(shape(buildRefTree(all, { query: "TOOLING" })), "Expected both tooling branches under their folders").toEqual([{ "bugfix/": ["tooling-fix"] }, { "feature/": [{ "jdp/": ["tooling"] }] }]);
  });

  it("matches the folder part of a name too", () => {
    expect(shape(buildRefTree(all, { query: "jdp" })), "Expected both jdp branches").toEqual([{ "feature/": [{ "jdp/": ["tooling", "Docs"] }] }]);
  });

  it("drops folders with no matches", () => {
    const tree = buildRefTree(all, { query: "docs" });
    expect(shape(tree), "Expected only the folders on the path to the match").toEqual([{ "feature/": [{ "jdp/": ["Docs"] }] }]);
  });

  it("ignores surrounding whitespace and treats a blank query as everything", () => {
    expect(shape(buildRefTree(all, { query: "  main " })), "Expected trimmed query to match main").toEqual(["main"]);
    expect(shape(buildRefTree(all, { query: "   " })), "Expected a blank query to keep everything").toEqual(shape(buildRefTree(all)));
  });

  it("returns nothing when nothing matches", () => {
    expect(buildRefTree(all, { query: "zzz" }), "Expected an empty tree").toEqual([]);
  });

  it("still pins a matching default branch first, and drops it when it does not match", () => {
    expect(shape(buildRefTree(all, { query: "ma", pin: "main" })), "Expected main pinned").toEqual(["main"]);
    expect(shape(buildRefTree(all, { query: "tooling", pin: "main" })), "Expected the unmatched pin to be dropped").toEqual([{ "bugfix/": ["tooling-fix"] }, { "feature/": [{ "jdp/": ["tooling"] }] }]);
  });
});

// ---- B-3 ----

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-02T12:00:00Z");
const branch = (name: string, over: Partial<Branch> = {}): Branch => ({
  id: `REF_${name}`,
  name,
  sha: OID,
  shortSha: "01234567",
  author: { name: "Alex", login: "alex", avatarUrl: "https://example.test/a.png" },
  authoredDate: new Date(NOW.getTime() - DAY),
  status: null,
  prNumber: null,
  protected: false,
  isDefault: false,
  ...over,
});
const by = (login: string | null): Branch["author"] => ({ name: "N", login, avatarUrl: "u" });
const names = (bs: Branch[]) => bs.map((b) => b.name);

describe("B-3: tabs", () => {
  const ctx = (favourites: string[] = []) => ({ viewer: "alex", favourites: new Set(favourites), now: NOW });

  it("All shows every branch in the given order", () => {
    const bs = [branch("b"), branch("a")];
    expect(names(filterByTab(bs, "all", ctx())), "Expected everything, unchanged order").toEqual(["b", "a"]);
  });

  it("Mine shows branches whose head commit author is the viewer", () => {
    const bs = [branch("mine", { author: by("alex") }), branch("theirs", { author: by("sam") }), branch("unlinked", { author: by(null) })];
    expect(names(filterByTab(bs, "mine", ctx())), "Expected only the viewer's branch").toEqual(["mine"]);
  });

  it("Mine also shows favourites, whoever authored them", () => {
    const bs = [branch("mine", { author: by("alex") }), branch("starred", { author: by("sam") }), branch("other", { author: by("sam") })];
    expect(names(filterByTab(bs, "mine", ctx(["starred"]))), "Expected the viewer's branch and the favourite, in input order").toEqual(["mine", "starred"]);
  });

  it("Mine lists a branch once when it is both the viewer's and a favourite", () => {
    const bs = [branch("both", { author: by("alex") })];
    expect(names(filterByTab(bs, "mine", ctx(["both"]))), "Expected no duplicate").toEqual(["both"]);
  });

  it("Stale shows branches whose head commit is older than 90 days", () => {
    const bs = [
      branch("fresh", { authoredDate: new Date(NOW.getTime() - 10 * DAY) }),
      branch("old", { authoredDate: new Date(NOW.getTime() - 91 * DAY) }),
      branch("ancient", { authoredDate: new Date(NOW.getTime() - 400 * DAY) }),
    ];
    expect(names(filterByTab(bs, "stale", ctx())), "Expected only the old branches").toEqual(["old", "ancient"]);
  });

  it("Stale treats exactly 90 days as not yet stale and one millisecond more as stale", () => {
    const edge = branch("edge", { authoredDate: new Date(NOW.getTime() - 90 * DAY) });
    const over = branch("over", { authoredDate: new Date(NOW.getTime() - 90 * DAY - 1) });
    expect(names(filterByTab([edge, over], "stale", ctx())), "Expected only the branch older than 90 days").toEqual(["over"]);
  });

  it("measures age against the injected now, not the clock", () => {
    const b = branch("b", { authoredDate: new Date("2026-01-01T00:00:00Z") });
    expect(names(filterByTab([b], "stale", { viewer: "x", favourites: new Set(), now: new Date("2026-02-01T00:00:00Z") })), "Expected 31 days to be fresh").toEqual([]);
    expect(names(filterByTab([b], "stale", { viewer: "x", favourites: new Set(), now: new Date("2026-06-01T00:00:00Z") })), "Expected 151 days to be stale").toEqual(["b"]);
  });
});

// ---- B-4 ----

describe("B-4: behind / ahead against the default branch", () => {
  // The compare URL is comparePath(repo, defaultBranch, branch), tested in commitDetail.test.ts with slashes in branch names.
  it("compares default...branch with the branch name encoded", () => {
    expect(comparePath("acme/web", "main", "feature/jdp/tooling"), "Expected compare/main...feature%2Fjdp%2Ftooling").toBe("/repos/acme/web/compare/main...feature%2Fjdp%2Ftooling");
  });

  it("skips the default branch, which has no behind/ahead", () => {
    expect(branchesToCompare(["dev", "main", "feature/x"], "main"), "Expected every branch except the default, in order").toEqual(["dev", "feature/x"]);
  });

  it("compares nothing when the default is the only branch", () => {
    expect(branchesToCompare(["main"], "main"), "Expected an empty list").toEqual([]);
  });

  it("maps ahead_by and behind_by", () => {
    expect(mapCompare({ ahead_by: 3, behind_by: 12 }), "Expected { ahead: 3, behind: 12 }").toEqual({ ahead: 3, behind: 12 });
  });
});

describe("B-4: inBatches caps concurrency", () => {
  it("splits into consecutive batches of at most the cap, keeping order", () => {
    expect(inBatches([1, 2, 3, 4, 5, 6, 7], 3), "Expected batches of 3, 3 and 1").toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it("makes one batch when the items fit", () => {
    expect(inBatches([1, 2], 6), "Expected a single batch").toEqual([[1, 2]]);
  });

  it("makes no batches for no items", () => {
    expect(inBatches([], 4), "Expected no batches").toEqual([]);
  });

  it("makes batches of one when the cap is 1", () => {
    expect(inBatches(["a", "b"], 1), "Expected one item per batch").toEqual([["a"], ["b"]]);
  });

  it.each([0, -1])("throws a RangeError for a cap of %i", (size) => {
    expect(() => inBatches([1], size), "Expected a cap below 1 to be refused").toThrow(RangeError);
  });
});

describe("B-4: the Behind | Ahead split bar", () => {
  it("finds the largest value across visible rows", () => {
    expect(maxDivergence([{ ahead: 2, behind: 40 }, { ahead: 7, behind: 1 }, null, undefined]), "Expected 40, ignoring rows without a compare").toBe(40);
  });

  it("is 0 when there are no comparisons", () => {
    expect(maxDivergence([]), "Expected 0 for no rows").toBe(0);
    expect(maxDivergence([null, undefined]), "Expected 0 when no row has a compare").toBe(0);
  });

  it("scales each side as a fraction of the max", () => {
    expect(barWidths({ behind: 10, ahead: 5 }, 20), "Expected 0.5 behind and 0.25 ahead").toEqual({ behind: 0.5, ahead: 0.25 });
  });

  it("gives the row holding the max a full side", () => {
    expect(barWidths({ behind: 40, ahead: 0 }, 40), "Expected a full behind side and an empty ahead side").toEqual({ behind: 1, ahead: 0 });
  });

  it("gives empty sides, not NaN, when the max is 0", () => {
    expect(barWidths({ behind: 0, ahead: 0 }, 0), "Expected 0 and 0 when nothing diverges").toEqual({ behind: 0, ahead: 0 });
  });
});

// ---- B-5 ----

describe("B-5: createBranchMutation", () => {
  it("builds createRef with refs/heads/<name>, the repository id and the oid, as one $input variable", () => {
    const req = createBranchMutation("REPO_1", "feature/x", OID);
    expect(req.variables, "Expected { input: { repositoryId, name: refs/heads/feature/x, oid } }").toEqual({ input: { repositoryId: "REPO_1", name: "refs/heads/feature/x", oid: OID } });
    expect(norm(req.query), "Expected a createRef mutation typed with CreateRefInput!").toMatch(/^\s*mutation\b[^{]*\(\s*\$input:\s*CreateRefInput!\s*\)\s*\{\s*createRef\(input:\s*\$input\)/);
  });

  it.each(NASTY)("never puts caller text in the mutation string: %s", (nasty) => {
    const a = createBranchMutation(nasty, nasty, nasty);
    expect(a.query, "Expected constant mutation text").toBe(createBranchMutation("R", "n", "o").query);
    expect(a.variables, "Expected the text in variables").toEqual({ input: { repositoryId: nasty, name: `refs/heads/${nasty}`, oid: nasty } });
  });

  it("selects the new ref's id and name for the UI to reconcile from", () => {
    expect(norm(createBranchMutation("R", "n", "o").query), "Expected ref { id name }").toMatch(/ref\s*\{\s*id\s+name\s*\}/);
  });
});

describe("B-5: canDeleteBranch", () => {
  it("allows deleting an ordinary branch", () => {
    expect(canDeleteBranch({ name: "feature/x", protected: false }, "main"), "Expected an ordinary branch to be deletable").toEqual({ ok: true });
  });

  it("refuses the default branch, with a reason", () => {
    const r = canDeleteBranch({ name: "main", protected: false }, "main");
    expect(r, "Expected the default branch not to be deletable").toMatchObject({ ok: false, code: "default" });
    expect((r as any).reason, "Expected a reason sentence").toMatch(/\S/);
  });

  it("refuses a protected branch, with a reason", () => {
    const r = canDeleteBranch({ name: "release/1.0", protected: true }, "main");
    expect(r, "Expected a protected branch not to be deletable").toMatchObject({ ok: false, code: "protected" });
    expect((r as any).reason, "Expected a reason sentence").toMatch(/\S/);
  });

  it("reports 'default' when the default branch is also protected", () => {
    expect(canDeleteBranch({ name: "main", protected: true }, "main"), "Expected the default reason to win").toMatchObject({ ok: false, code: "default" });
  });

  it("allows an unprotected branch when the default branch is unknown", () => {
    expect(canDeleteBranch({ name: "x", protected: false }, null), "Expected deletable with no default known").toEqual({ ok: true });
  });
});

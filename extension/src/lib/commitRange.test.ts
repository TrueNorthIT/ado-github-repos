import { describe, it, expect } from "vitest";
import { rangeQuery, toRangeContext, lastReviewedOid, resolveRange, type RangeContext, type RangePrNode } from "./commitRange";
import { comparePath, commitFilesPath } from "./commitDetail";
import { expectPrQuery, expectNotInQuery, NASTY } from "./ciTestHelpers";
import { expectQueryOperation } from "./editTestHelpers";
import { expectNestedSelection, expectDeclares } from "./b4TestHelpers";

// Module under test: src/lib/commitRange.ts (stubs until the developer implements them). Requirement VW-6: ""Show changes from": all, or a single commit in the PR, or a range of commits. Compute the
// base and head oids for compare (the single commit's parent is the base). Also "since your last review", using the viewer's latest review `commit.oid`. Validate `PullRequestReview.commit`."
// Schema facts (including the PullRequestReview.commit validation) and decisions are in the header of src/lib/commitRange.ts. Fixtures are invented: a linear pull request of four commits on base "B0".

const REPO = "octo/demo";
const commits = [
  { oid: "c1", title: "First", parents: ["B0"] },
  { oid: "c2", title: "Second", parents: ["c1"] },
  { oid: "c3", title: "Merge main", parents: ["c2", "m9"] },
  { oid: "c4", title: "Fourth", parents: ["c3"] },
];
const ctx = (over: Partial<RangeContext> = {}): RangeContext => ({ baseOid: "B0", headOid: "c4", commits, lastReviewedOid: null, ...over });

describe("VW-6: rangeQuery reads the PR's commits with their parents and the viewer's latest review", () => {
  const req = () => rangeQuery({ owner: "octo", name: "demo", number: 7 });

  it("is a variables-only query over repository { pullRequest(number) } with an $after cursor", () => {
    expectQueryOperation(req());
    expectPrQuery(req());
    expectDeclares(req(), ["$after: String"]);
    expect(req().variables, "Expected variables { owner, name, number, after: null } on the first page").toEqual({ owner: "octo", name: "demo", number: 7, after: null });
  });

  it("asks for 100 commits after the cursor with oid, headline and the first two parents' oids", () => {
    expect(req().query.replace(/\s+/g, " "), "Expected commits(first: 100, after: $after)").toMatch(/commits\(first:\s*100,\s*after:\s*\$after\)/);
    expectNestedSelection(req(), /commits\([^)]*\)/, ["pageInfo", "hasNextPage", "endCursor", "nodes", "commit", "oid", "messageHeadline", "parents"], "the commits connection");
    expect(req().query.replace(/\s+/g, " "), "Expected parents(first: 2) (a merge commit has two)").toMatch(/parents\(first:\s*2\)/);
  });

  it("selects base and head oids and the viewer's latest review with its state, time and commit oid", () => {
    expectNestedSelection(req(), /pullRequest\(number:\s*\$number\)/, ["baseRefOid", "headRefOid", "viewerLatestReview"], "the pullRequest");
    expectNestedSelection(req(), /viewerLatestReview/, ["state", "submittedAt", "commit", "oid"], "viewerLatestReview");
  });

  it("sends the cursor in variables and keeps caller values out of the text", () => {
    expect(rangeQuery({ owner: "o", name: "n", number: 1, after: "Mw" }).variables.after, "Expected the cursor in variables").toBe("Mw");
    NASTY.forEach((v) => expectNotInQuery(rangeQuery({ owner: v, name: v, number: 1, after: v }), [v]));
  });
});

describe("VW-6: lastReviewedOid reads the commit of the viewer's latest submitted review", () => {
  it("returns the review's commit oid for a submitted review of any decision", () => {
    for (const state of ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"]) expect(lastReviewedOid({ state, commit: { oid: "c2" } }), `Expected c2 for a ${state} review`).toBe("c2");
  });

  it("returns null for no review, a PENDING review or a review without a commit", () => {
    expect(lastReviewedOid(null), "Expected null for no review").toBeNull();
    expect(lastReviewedOid(undefined), "Expected null for undefined").toBeNull();
    expect(lastReviewedOid({ state: "PENDING", commit: { oid: "c2" } }), "Expected a draft review not to count").toBeNull();
    expect(lastReviewedOid({ state: "APPROVED", commit: null }), "Expected null when the commit is gone").toBeNull();
  });
});

describe("VW-6: toRangeContext maps rangeQuery pages", () => {
  const node = (oids: string[], extra: Partial<RangePrNode> = {}): RangePrNode => ({
    baseRefOid: "B0",
    headRefOid: "c4",
    viewerLatestReview: null,
    commits: { nodes: oids.map((oid) => ({ commit: { oid, messageHeadline: `T ${oid}`, parents: { nodes: [{ oid: `p-${oid}` }] } } })) },
    ...extra,
  });

  it("maps base, head, commits (with parents in order) and the last reviewed oid", () => {
    const c = toRangeContext([node(["c1", "c2"], { viewerLatestReview: { state: "COMMENTED", submittedAt: "2026-03-02T09:00:00Z", commit: { oid: "c1" } } })]);
    expect([c.baseOid, c.headOid, c.lastReviewedOid], "Expected base, head and the review's commit").toEqual(["B0", "c4", "c1"]);
    expect(c.commits[0], "Expected the commit's oid, headline and parent oids").toEqual({ oid: "c1", title: "T c1", parents: ["p-c1"] });
  });

  it("concatenates commits from every page, in order, and skips null nodes", () => {
    const second = node(["c3", "c4"]);
    second.commits!.nodes!.unshift(null);
    expect(toRangeContext([node(["c1", "c2"]), second]).commits.map((c) => c.oid), "Expected c1..c4 across two pages").toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("gives an empty parent list for a commit with no parents data", () => {
    const n = node(["c1"]);
    n.commits!.nodes![0]!.commit.parents = null;
    expect(toRangeContext([n]).commits[0].parents, "Expected [] when parents is null").toEqual([]);
  });

  it("refuses an empty array of pages", () => {
    expect(() => toRangeContext([]), "Expected a refusal when there is no page to read").toThrow("No pages");
  });
});

describe("VW-6: resolveRange computes the base and head for compare", () => {
  it("'all' compares the PR's base with its head", () => {
    const r = resolveRange(REPO, { kind: "all" }, ctx());
    expect(r, "Expected B0...c4").toEqual({ base: "B0", head: "c4", path: comparePath(REPO, "B0", "c4") });
  });

  it("a single commit compares its first parent with the commit", () => {
    expect(resolveRange(REPO, { kind: "commit", oid: "c2" }, ctx()), "Expected c1...c2").toEqual({ base: "c1", head: "c2", path: comparePath(REPO, "c1", "c2") });
  });

  it("the first commit's parent is the PR's base", () => {
    expect(resolveRange(REPO, { kind: "commit", oid: "c1" }, ctx()), "Expected B0...c1").toMatchObject({ base: "B0", head: "c1" });
  });

  it("a merge commit is compared against its first parent", () => {
    expect(resolveRange(REPO, { kind: "commit", oid: "c3" }, ctx()), "Expected c2...c3, not m9...c3").toMatchObject({ base: "c2", head: "c3" });
  });

  it("a root commit has no base, so its files come from the commit itself", () => {
    const root = ctx({ commits: [{ oid: "r1", title: "Root", parents: [] }], headOid: "r1" });
    expect(resolveRange(REPO, { kind: "commit", oid: "r1" }, root), "Expected base null and the commit-files path").toEqual({ base: null, head: "r1", path: commitFilesPath(REPO, "r1") });
  });

  it("a range includes both ends: the base is the first parent of the older commit, the head is the newer", () => {
    expect(resolveRange(REPO, { kind: "range", from: "c2", to: "c4" }, ctx()), "Expected c1...c4 (c2 and c4 both included)").toEqual({ base: "c1", head: "c4", path: comparePath(REPO, "c1", "c4") });
  });

  it("orders the two ends by their place in the PR, whichever way round they are given", () => {
    expect(resolveRange(REPO, { kind: "range", from: "c4", to: "c2" }, ctx()), "Expected (c4, c2) to equal (c2, c4)").toEqual(resolveRange(REPO, { kind: "range", from: "c2", to: "c4" }, ctx()));
  });

  it("a range from a commit to itself is that single commit", () => {
    expect(resolveRange(REPO, { kind: "range", from: "c2", to: "c2" }, ctx()), "Expected c1...c2").toMatchObject({ base: "c1", head: "c2" });
  });

  it("'since your last review' compares the reviewed commit with the head", () => {
    expect(resolveRange(REPO, { kind: "sinceReview" }, ctx({ lastReviewedOid: "c2" })), "Expected c2...c4").toEqual({ base: "c2", head: "c4", path: comparePath(REPO, "c2", "c4") });
  });

  it("'since your last review' is null when the viewer has not reviewed", () => {
    expect(resolveRange(REPO, { kind: "sinceReview" }, ctx({ lastReviewedOid: null })), "Expected null: there is no review to compare from").toBeNull();
  });

  it("'since your last review' is an empty range when the review was on the current head", () => {
    expect(resolveRange(REPO, { kind: "sinceReview" }, ctx({ lastReviewedOid: "c4" })), "Expected base === head (no changes since)").toMatchObject({ base: "c4", head: "c4" });
  });

  it("refuses a commit that is not in the pull request, naming it", () => {
    expect(() => resolveRange(REPO, { kind: "commit", oid: "zzz" }, ctx()), "Expected an unknown single commit to be refused").toThrow("Commit zzz is not part of this pull request");
    expect(() => resolveRange(REPO, { kind: "range", from: "c1", to: "zzz" }, ctx()), "Expected an unknown range end to be refused").toThrow("Commit zzz is not part of this pull request");
  });
});

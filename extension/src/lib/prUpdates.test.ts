import { describe, it, expect } from "vitest";
import { UPDATE_PUSH_WINDOW_MS, updatesQuery, toUpdates, compareUpdates, type PrUpdate } from "./prUpdates";
import { comparePath } from "./commitDetail";
import type { TimelineNode } from "./feedModel";
import { expectPrQuery, expectNotInQuery, NASTY } from "./ciTestHelpers";
import { expectQueryOperation } from "./editTestHelpers";
import { expectNestedSelection, expectDeclares } from "./b4TestHelpers";

// Module under test: src/lib/prUpdates.ts (stubs until the developer implements them). Requirement VW-1: "Updates tab (native ADO "Updates", which lists iterations). Build PR "iterations" from
// the timeline: each push to the head is one update." Schema facts and the grouping decisions are in the header of src/lib/prUpdates.ts.
// Fixtures are invented: oids are short labels, times are minutes after 2026-03-02T09:00:00Z.

const at = (min: number) => new Date(Date.UTC(2026, 2, 2, 9, 0, 0) + min * 60_000).toISOString();
const commit = (oid: string, min: number, title = `Commit ${oid}`): TimelineNode => ({ __typename: "PullRequestCommit", id: `C_${oid}`, commit: { oid, messageHeadline: title, committedDate: at(min) } });
const force = (before: string | null, after: string | null, min: number): TimelineNode => ({
  __typename: "HeadRefForcePushedEvent",
  id: `F_${after}`,
  createdAt: at(min),
  beforeCommit: before ? { oid: before } : null,
  afterCommit: after ? { oid: after } : null,
});
const oids = (u: PrUpdate) => u.commits.map((c) => c.oid);

describe("VW-1: updatesQuery asks the timeline for commits and force pushes", () => {
  const req = () => updatesQuery({ owner: "octo", name: "demo", number: 7 });

  it("is a variables-only query over repository(owner, name) { pullRequest(number) } with a paging cursor", () => {
    expectQueryOperation(req());
    expectPrQuery(req());
    expectDeclares(req(), ["$after: String"]);
    expect(req().variables, "Expected variables { owner, name, number, after: null } on the first page").toEqual({ owner: "octo", name: "demo", number: 7, after: null });
  });

  it("passes the timeline cursor in variables", () => {
    expect(updatesQuery({ owner: "octo", name: "demo", number: 7, after: "CUR1" }).variables.after, "Expected the cursor to be sent as $after").toBe("CUR1");
  });

  it("reads 100 timeline items of exactly the two types that mark pushes, after the cursor", () => {
    const q = req().query.replace(/\s+/g, " ");
    expect(q, "Expected timelineItems(first: 100, after: $after, ...)").toMatch(/timelineItems\(first:\s*100,\s*after:\s*\$after,/);
    const types = /itemTypes:\s*\[([^\]]*)\]/.exec(q);
    expect(types, "Expected an itemTypes list").not.toBeNull();
    expect(types![1].split(/[\s,]+/).filter(Boolean).sort(), "Expected PULL_REQUEST_COMMIT and HEAD_REF_FORCE_PUSHED_EVENT").toEqual(["HEAD_REF_FORCE_PUSHED_EVENT", "PULL_REQUEST_COMMIT"]);
  });

  it("selects the commit's oid, headline and committedDate (the only per-commit time GitHub still provides)", () => {
    expectNestedSelection(req(), /on PullRequestCommit/, ["commit", "oid", "messageHeadline", "committedDate"], "PullRequestCommit.commit");
  });

  it("selects the force push's createdAt and the before and after commits' oids", () => {
    expectNestedSelection(req(), /on HeadRefForcePushedEvent/, ["createdAt", "beforeCommit", "afterCommit", "oid"], "HeadRefForcePushedEvent");
  });

  it("selects __typename, the page info and the PR's base and head oids", () => {
    expectNestedSelection(req(), /timelineItems\([^)]*\)/, ["pageInfo", "hasNextPage", "endCursor", "nodes", "__typename"], "the timelineItems connection");
    expectNestedSelection(req(), /pullRequest\(number:\s*\$number\)/, ["baseRefOid", "headRefOid"], "the pullRequest");
  });

  it("keeps caller-supplied values out of the query text", () => {
    NASTY.forEach((v) => expectNotInQuery(updatesQuery({ owner: v, name: v, number: 1, after: v }), [v]));
  });
});

describe("VW-1: toUpdates builds one update per push", () => {
  it("gives no updates for an empty timeline, nulls and unrelated items", () => {
    expect(toUpdates([], "base"), "Expected [] for an empty timeline").toEqual([]);
    expect(toUpdates([null, { __typename: "IssueComment", id: "x", createdAt: at(0) }], "base"), "Expected nulls and other item types to be ignored").toEqual([]);
  });

  it("groups commits pushed together into update 1, with 1-based index, head, before, forced and time", () => {
    const [u, ...rest] = toUpdates([commit("c1", 0), commit("c2", 2), commit("c3", 5)], "base0");
    expect(rest, "Expected a single update for commits within the push window").toHaveLength(0);
    expect(u.index, "Expected the first update to have index 1").toBe(1);
    expect(oids(u), "Expected the commits in timeline order").toEqual(["c1", "c2", "c3"]);
    expect(u.commits[0], "Expected each commit to carry its headline and committedDate").toEqual({ oid: "c1", title: "Commit c1", date: new Date(at(0)) });
    expect(u.headOid, "Expected headOid to be the last commit").toBe("c3");
    expect(u.beforeOid, "Expected beforeOid of the first update to be the PR base").toBe("base0");
    expect(u.forced, "Expected an ordinary push not to be forced").toBe(false);
    expect(u.at, "Expected `at` to be the last commit's committedDate").toEqual(new Date(at(5)));
  });

  it("leaves beforeOid null on the first update when no base is given", () => {
    expect(toUpdates([commit("c1", 0)])[0].beforeOid, "Expected null without a baseOid").toBeNull();
  });

  it("keeps commits a full push window apart in one update and splits them when the gap is one second longer", () => {
    const window = UPDATE_PUSH_WINDOW_MS / 60_000;
    expect(toUpdates([commit("c1", 0), commit("c2", window)], "b"), `Expected a gap of exactly ${window} minutes to stay one update`).toHaveLength(1);
    expect(toUpdates([commit("c1", 0), commit("c2", window + 1 / 60)], "b"), "Expected a gap of the window plus one second to start a new update").toHaveLength(2);
  });

  it("starts update 2 after a long gap, chaining beforeOid to the previous head", () => {
    const [a, b] = toUpdates([commit("c1", 0), commit("c2", 1), commit("c3", 120)], "base0");
    expect([a.index, b.index], "Expected indexes 1 and 2").toEqual([1, 2]);
    expect(oids(b), "Expected the late commit in update 2").toEqual(["c3"]);
    expect(b.beforeOid, "Expected update 2 to start from update 1's head").toBe("c2");
    expect(b.headOid, "Expected update 2's head to be c3").toBe("c3");
  });

  it("makes a force push an update of its own with the event's before, after and time", () => {
    const [a, f] = toUpdates([commit("c1", 0), force("c1", "n1", 60)], "base0");
    expect(a.forced, "Expected the earlier ordinary push not to be forced").toBe(false);
    expect(f.index, "Expected the force push to be update 2").toBe(2);
    expect(f.forced, "Expected forced: true for a HEAD_REF_FORCE_PUSHED_EVENT").toBe(true);
    expect(f.headOid, "Expected headOid to be the event's afterCommit").toBe("n1");
    expect(f.beforeOid, "Expected beforeOid to be the event's beforeCommit").toBe("c1");
    expect(f.commits, "Expected no commits when the new head is not listed in the timeline").toEqual([]);
    expect(f.at, "Expected `at` to be the event's createdAt").toEqual(new Date(at(60)));
  });

  it("attaches the commit listed just before a force push to that update when it is the event's afterCommit", () => {
    // Shape seen on a real pull request: the new head commit is dated seconds before the force push event.
    const updates = toUpdates([commit("c1", 0), commit("c2", 60), force("c1", "c2", 61)], "base0");
    expect(updates, "Expected the ordinary push of c1 and the force push of c2 as two updates").toHaveLength(2);
    expect(updates[1].forced, "Expected update 2 to be the force push").toBe(true);
    expect(oids(updates[1]), "Expected c2 to be that update's commit, not a third update").toEqual(["c2"]);
    expect(updates[1].headOid, "Expected headOid c2").toBe("c2");
    expect(updates[1].at, "Expected `at` to stay the event's createdAt").toEqual(new Date(at(61)));
  });

  it("does the same when the afterCommit is listed just after the event", () => {
    const updates = toUpdates([commit("c1", 0), force("c1", "c2", 60), commit("c2", 61)], "base0");
    expect(updates, "Expected two updates, not a third for the commit after the event").toHaveLength(2);
    expect(oids(updates[1]), "Expected c2 to belong to the force push").toEqual(["c2"]);
    expect(updates[1].forced, "Expected the update to stay forced").toBe(true);
  });

  it("makes ordinary commits that precede a force push (and are not its afterCommit) their own update", () => {
    const updates = toUpdates([commit("c1", 0), commit("c2", 1), force("c2", "n1", 30)], "base0");
    expect(updates.map((u) => [u.index, u.forced, u.headOid]), "Expected [ordinary c2, forced n1]").toEqual([[1, false, "c2"], [2, true, "n1"]]);
  });

  it("gives each of two consecutive force pushes its own update, with its own before and after", () => {
    const [, f1, f2] = toUpdates([commit("c1", 0), force("c1", "n1", 10), force("n1", "n2", 20)], "base0");
    expect([f1.beforeOid, f1.headOid, f1.index], "Expected the first force push c1 -> n1 as update 2").toEqual(["c1", "n1", 2]);
    expect([f2.beforeOid, f2.headOid, f2.index], "Expected the second force push n1 -> n2 as update 3").toEqual(["n1", "n2", 3]);
  });

  it("chains an ordinary push after a force push to the force push's head", () => {
    const updates = toUpdates([force("old", "n1", 0), commit("c9", 90)], "base0");
    expect(updates[0].beforeOid, "Expected a leading force push to start from its own beforeCommit").toBe("old");
    expect(updates[1].beforeOid, "Expected the next push to start from the forced head").toBe("n1");
  });

  it("keeps timeline order even when a later commit has an older committedDate (a rebase)", () => {
    const updates = toUpdates([commit("c1", 100), force("c1", "n1", 110), commit("c2", 20)], "base0");
    expect(updates.map((u) => u.headOid), "Expected the updates in timeline order, not date order").toEqual(["c1", "n1", "c2"]);
  });

  it("skips a force push whose afterCommit is unknown and does not use up an index", () => {
    const updates = toUpdates([commit("c1", 0), force("c1", null, 10), commit("c2", 120)], "base0");
    expect(updates.map((u) => u.index), "Expected contiguous indexes 1 and 2").toEqual([1, 2]);
    expect(updates.map((u) => u.headOid), "Expected the unknown-head event to produce no update").toEqual(["c1", "c2"]);
  });
});

describe("VW-1: compareUpdates builds 'Compare update N with M' from the updates' oids", () => {
  const updates: PrUpdate[] = [
    { index: 1, commits: [], headOid: "h1", beforeOid: "base0", forced: false, at: new Date(at(0)) },
    { index: 2, commits: [], headOid: "h2", beforeOid: "h1", forced: true, at: new Date(at(10)) },
    { index: 3, commits: [], headOid: "h3", beforeOid: "h2", forced: false, at: new Date(at(20)) },
  ];

  it("compares update 1 with update 3 as head of 1 ... head of 3, with the REST compare path", () => {
    const c = compareUpdates("octo/demo", updates, 1, 3);
    expect([c.base, c.head], "Expected base h1 and head h3").toEqual(["h1", "h3"]);
    expect(c.path, "Expected /repos/octo/demo/compare/h1...h3").toBe(comparePath("octo/demo", "h1", "h3"));
  });

  it("orders the two updates itself: the older one is the base whichever way round they are given", () => {
    expect(compareUpdates("octo/demo", updates, 3, 1), "Expected (3, 1) to equal (1, 3)").toEqual(compareUpdates("octo/demo", updates, 1, 3));
  });

  it("treats index 0 as the pull request's base, so the changes of update 2 are (1, 2) and of update 1 are (0, 1)", () => {
    expect(compareUpdates("octo/demo", updates, 0, 1), "Expected update 1's own changes to be base0...h1").toMatchObject({ base: "base0", head: "h1" });
    expect(compareUpdates("octo/demo", updates, 1, 2), "Expected update 2's own changes to be h1...h2").toMatchObject({ base: "h1", head: "h2" });
  });

  it("refuses to compare an update with itself", () => {
    expect(() => compareUpdates("octo/demo", updates, 2, 2), "Expected a refusal for identical indexes").toThrow("Choose two different updates");
  });

  it("refuses an index that is not an update", () => {
    expect(() => compareUpdates("octo/demo", updates, 1, 7), "Expected an unknown index to be refused").toThrow("Unknown update 7");
    expect(() => compareUpdates("octo/demo", updates, -1, 1), "Expected a negative index to be refused").toThrow("Unknown update -1");
  });

  it("refuses index 0 when the pull request's base is unknown", () => {
    const noBase = [{ ...updates[0], beforeOid: null }, ...updates.slice(1)];
    expect(() => compareUpdates("octo/demo", noBase, 0, 1), "Expected a refusal when update 1 has no beforeOid").toThrow("The base of the pull request is unknown");
  });
});

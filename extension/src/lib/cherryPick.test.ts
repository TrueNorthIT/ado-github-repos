import { describe, it, expect } from "vitest";
import {
  PickError, createCommitRequest, defaultTopicBranch, deleteTempRefRequest, pickErrorFor, pickMessage, pickRange, prLanding, prPickMessage, randomSuffix,
  runPick, tempBranchName, toGitCommit, type PickRun, type PickStep,
} from "./cherryPick";
import type { RestRequest } from "./restRequest";

// Module under test: src/lib/cherryPick.ts. GitHub has no cherry-pick API: a synthetic commit on a temporary branch plus POST /merges does
// the three-way merge, then the result's tree is recommitted on the target's head and a new topic branch made at it.

const C = "c".repeat(40), P = "p".repeat(40), Q = "q".repeat(40), H = "h".repeat(40);

describe("names and messages", () => {
  it("defaults the topic branch like native, numbering a taken name", () => {
    expect(defaultTopicBranch("cherryPick", "release/1.0", "1e0daa58")).toBe("release/1.0-cherry-pick-1e0daa58");
    expect(defaultTopicBranch("revert", "main", "1e0daa58", ["main-revert-1e0daa58", "main-revert-1e0daa58-2"])).toBe("main-revert-1e0daa58-3");
  });
  it("names the temporary branch under tmp/ with the short sha and a random part", () => {
    expect(tempBranchName("cherryPick", C, "abc123")).toBe(`tmp/cherry-pick-${C.slice(0, 8)}-abc123`);
    expect(tempBranchName("revert", C, "x")).toBe(`tmp/revert-${C.slice(0, 8)}-x`);
    expect(randomSuffix(() => 0.5)).toMatch(/^[0-9a-z]{6}$/);
  });
  it("words messages as git does", () => {
    expect(pickMessage("cherryPick", { sha: C, message: "Fix it\n\nBody.\n" })).toBe(`Fix it\n\nBody.\n\n(cherry picked from commit ${C})`);
    expect(pickMessage("revert", { sha: C, message: "Fix it\n\nBody." })).toBe(`Revert "Fix it"\n\nThis reverts commit ${C}.`);
    expect(prPickMessage(" Add retry ", 12, C)).toBe(`Add retry (#12)\n\n(cherry picked from commit ${C})`);
  });
});

describe("pickRange", () => {
  it("cherry-picks parent → commit and reverts commit → parent", () => {
    expect(pickRange("cherryPick", { sha: C, parents: [P] })).toEqual({ from: P, to: C });
    expect(pickRange("revert", { sha: C, parents: [P] })).toEqual({ from: C, to: P });
  });
  it("needs a mainline for a merge commit and uses the chosen parent", () => {
    expect(() => pickRange("cherryPick", { sha: C, parents: [P, Q] })).toThrow(/mainline/);
    expect(pickRange("cherryPick", { sha: C, parents: [P, Q] }, 2)).toEqual({ from: Q, to: C });
    expect(() => pickRange("revert", { sha: C, parents: [P, Q] }, 3)).toThrow(/no parent 3/);
  });
  it("refuses a root commit", () => {
    try { pickRange("revert", { sha: C, parents: [] }); expect.unreachable(); } catch (e) { expect((e as PickError).code).toBe("rootCommit"); }
  });
});

describe("prLanding", () => {
  it("tells a merge commit, a squash and a rebase apart", () => {
    expect(prLanding({ parents: [P, Q], message: "Merge pull request #3" }, 4, "x")).toEqual({ how: "merge" });
    expect(prLanding({ parents: [P], message: "Add retry (#3)" }, 4, "Last commit")).toEqual({ how: "squash" });
    expect(prLanding({ parents: [P], message: "Only" }, 1, "Only")).toEqual({ how: "squash" });
    expect(prLanding({ parents: [P], message: "Last commit\n" }, 3, "Last commit")).toEqual({ how: "rebase", count: 3 });
  });
});

describe("requests", () => {
  it("only deletes temporary branches", () => {
    expect(deleteTempRefRequest("o/r", "tmp/cherry-pick-x")).toEqual({ method: "DELETE", path: "/repos/o/r/git/refs/heads/tmp/cherry-pick-x" });
    expect(() => deleteTempRefRequest("o/r", "main")).toThrow();
  });
  it("sends the author only when given", () => {
    expect(createCommitRequest("o/r", { message: "m", tree: "t", parents: [P] }).body).toEqual({ message: "m", tree: "t", parents: [P] });
    expect(createCommitRequest("o/r", { message: "m", tree: "t", parents: [P], author: { name: "A", email: "a@x" } }).body?.author).toEqual({ name: "A", email: "a@x" });
  });
  it("reads REST's git commit", () => {
    expect(toGitCommit({ sha: C, tree: { sha: "t" }, parents: [{ sha: P }], message: "m", author: { name: "A", email: "a@x", date: "d" } })).toEqual({ sha: C, tree: "t", parents: [P], message: "m", author: { name: "A", email: "a@x", date: "d" } });
  });
});

// ---------- runPick against a scripted GitHub ----------

const err = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

function fakeGitHub(opts: { conflict?: boolean; mergedTree?: string; topicTaken?: boolean; noTarget?: boolean } = {}) {
  const log: RestRequest[] = [];
  const commits: Record<string, any> = {
    [H]: { sha: H, tree: { sha: "treeH" }, parents: [{ sha: "0".repeat(40) }], message: "head" },
    [C]: { sha: C, tree: { sha: "treeC" }, parents: [{ sha: P }], message: "pick me" },
    [P]: { sha: P, tree: { sha: "treeP" }, parents: [], message: "parent" },
  };
  let n = 0;
  const send = async (r: RestRequest): Promise<any> => {
    log.push(r);
    if (r.method === "GET" && r.path.includes("/git/ref/heads/")) { if (opts.noTarget) throw err(404); return { object: { sha: H } }; }
    const g = /\/git\/commits\/(\w+)$/.exec(r.path);
    if (r.method === "GET" && g) return commits[g[1]];
    if (r.method === "POST" && r.path.endsWith("/git/commits")) {
      const sha = `new${++n}`.padEnd(40, "0");
      return (commits[sha] = { sha, tree: { sha: r.body!.tree }, parents: (r.body!.parents as string[]).map((s) => ({ sha: s })), message: r.body!.message });
    }
    if (r.method === "POST" && r.path.endsWith("/git/refs")) {
      if (opts.topicTaken && !String(r.body!.ref).startsWith("refs/heads/tmp/")) throw err(422);
      return { ref: r.body!.ref };
    }
    if (r.method === "POST" && r.path.endsWith("/merges")) { if (opts.conflict) throw err(409); return { sha: "m".repeat(40), commit: { tree: { sha: opts.mergedTree ?? "treeMerged" } } }; }
    if (r.method === "DELETE") return undefined;
    throw new Error(`unexpected ${r.method} ${r.path}`);
  };
  return { send, log, commits };
}

const run = (over: Partial<PickRun> = {}): PickRun => ({
  repo: "o/r", kind: "cherryPick", range: { from: P, to: C }, message: "msg", target: "release", topic: "release-cherry-pick-cccccccc", temp: "tmp/cherry-pick-cccccccc-abc", ...over,
});

describe("runPick", () => {
  it("cherry-picks: merges the commit itself into a temp branch at (H's tree, parent P), recommits on H, makes the topic branch, deletes the temp", async () => {
    const gh = fakeGitHub();
    const steps: PickStep[] = [];
    const out = await runPick(gh.send, run({ author: { name: "Ann", email: "ann@x" }, onStep: (s) => steps.push(s) }));
    expect(steps).toEqual(["prepare", "apply", "commit", "branch"]);
    const writes = gh.log.filter((r) => r.method !== "GET");
    expect(writes.map((r) => `${r.method} ${r.path.replace("/repos/o/r", "")}`)).toEqual(["POST /git/commits", "POST /git/refs", "POST /merges", "POST /git/commits", "POST /git/refs", "DELETE /git/refs/heads/tmp/cherry-pick-cccccccc-abc"]);
    expect(writes[0].body).toMatchObject({ tree: "treeH", parents: [P] });
    expect(writes[1].body).toEqual({ ref: "refs/heads/tmp/cherry-pick-cccccccc-abc", sha: "new1".padEnd(40, "0") });
    expect(writes[2].body).toMatchObject({ base: "tmp/cherry-pick-cccccccc-abc", head: C });
    expect(writes[3].body).toEqual({ message: "msg", tree: "treeMerged", parents: [H], author: { name: "Ann", email: "ann@x" } });
    expect(writes[4].body).toEqual({ ref: "refs/heads/release-cherry-pick-cccccccc", sha: "new2".padEnd(40, "0") });
    expect(out).toEqual({ branch: "release-cherry-pick-cccccccc", sha: "new2".padEnd(40, "0"), base: H });
    // Nothing but the temp and the new topic branch is ever written.
    expect(gh.log.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("reverts: a synthetic commit (P's tree on top of C) is merged, so the merge base is C", async () => {
    const gh = fakeGitHub();
    await runPick(gh.send, run({ kind: "revert", range: { from: C, to: P } }));
    const writes = gh.log.filter((r) => r.method === "POST");
    expect(writes[0].body).toMatchObject({ tree: "treeP", parents: [C] });
    expect(writes[1].body).toMatchObject({ tree: "treeH", parents: [C] });
    expect(writes[3].body).toMatchObject({ head: "new1".padEnd(40, "0") });
  });

  it("maps a 409 from the merge to a conflict and still deletes the temp branch", async () => {
    const gh = fakeGitHub({ conflict: true });
    await expect(runPick(gh.send, run())).rejects.toMatchObject({ code: "conflict" });
    expect(gh.log[gh.log.length - 1]).toMatchObject({ method: "DELETE" });
    expect(gh.log.filter((r) => r.path.endsWith("/git/refs")).length).toBe(1);
  });

  it("refuses when the target already has the change", async () => {
    const gh = fakeGitHub({ mergedTree: "treeH" });
    await expect(runPick(gh.send, run())).rejects.toMatchObject({ code: "nothingToPick" });
    expect(gh.log[gh.log.length - 1]).toMatchObject({ method: "DELETE" });
  });

  it("says when the topic branch name is taken, and when the target is gone (before anything is written)", async () => {
    const taken = fakeGitHub({ topicTaken: true });
    await expect(runPick(taken.send, run())).rejects.toMatchObject({ code: "exists" });
    expect(taken.log[taken.log.length - 1]).toMatchObject({ method: "DELETE" });
    const gone = fakeGitHub({ noTarget: true });
    await expect(runPick(gone.send, run())).rejects.toMatchObject({ code: "targetMissing" });
    expect(gone.log.every((r) => r.method === "GET")).toBe(true);
  });
});

describe("pickErrorFor", () => {
  const ctx = { kind: "cherryPick" as const, target: "main", topic: "t" };
  it("words access refusals and passes other errors on", () => {
    expect((pickErrorFor(err(403), "other", ctx) as PickError).code).toBe("access");
    const e = new Error("network");
    expect(pickErrorFor(e, "other", ctx)).toBe(e);
  });
});

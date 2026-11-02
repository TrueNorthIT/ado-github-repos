import { describe, it, expect } from "vitest";
import { applyReply, applyResolve, applyComment, resolvedCounts, optimistic } from "./feedState";
import type { FeedItem, FeedComment, ThreadItem, CommentItem, EventItem } from "./feedModel";

// Module under test: src/lib/feedState.ts (applyReply, applyResolve, applyComment, resolvedCounts, optimistic).
// The apply* functions are pure: they return a new array and never mutate their input (the fixtures are deep-frozen, so a
// mutation throws). `optimistic` is the rollback pattern: set the optimistic state at once, commit, restore the previous array on failure.
// Decisions fixed by these tests, where the requirements were open:
//  - an unknown threadId leaves the feed unchanged (an equal array, no throw).
//  - a reply goes at the end of the thread's comments and moves lastActivity to the reply's date; the thread's `date` (first comment) is unchanged.
//  - applyComment puts a comment that is newer than everything first (the feed is newest first).
//  - resolvedCounts counts every thread, outdated ones included, as prModel's `resolved/total` does; comments and events are ignored.
//  - `optimistic` never rejects: it resolves { ok: true } or { ok: false, error }.

const d = (hhmm: string) => new Date(`2026-06-01T${hhmm}:00Z`);
const fc = (id: string, hhmm: string): FeedComment => ({ id, author: "bob", avatarUrl: "", html: `<p>${id}</p>`, date: d(hhmm), url: `https://example.com/${id}` });
const thread = (id: string, over: Partial<ThreadItem> = {}): ThreadItem => ({
  kind: "thread", id, status: "active", outdated: false, path: "a.ts", line: 1, startLine: null, side: "RIGHT",
  comments: [fc(`${id}-c1`, "10:00")], date: d("10:00"), lastActivity: d("10:00"), ...over,
});
const comment = (id: string, hhmm: string): CommentItem => ({ kind: "comment", ...fc(id, hhmm) });
const ev = (id: string, hhmm: string): EventItem => ({ kind: "event", id, type: "merged", actor: "ann", avatarUrl: "", date: d(hhmm) });

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o as object).forEach(deepFreeze);
  }
  return o;
}
/** Newest first, as toFeed returns it. */
const sample = (): FeedItem[] => deepFreeze([ev("e2", "12:00"), comment("c1", "11:00"), thread("T1"), thread("T2", { status: "resolved", date: d("09:30") }), ev("e1", "09:00")]);
const byId = (items: FeedItem[], id: string) => items.find((i) => i.id === id) as ThreadItem;

describe("AF-3: applyReply adds a reply to a thread", () => {
  it("appends the reply to the thread's comments and moves lastActivity", () => {
    const items = sample();
    const next = applyReply(items, "T1", fc("new", "13:00"));
    expect(byId(next, "T1").comments.map((c) => c.id), "Expected the reply after the existing comment").toEqual(["T1-c1", "new"]);
    expect(byId(next, "T1").lastActivity, "Expected lastActivity to be the reply's date").toEqual(d("13:00"));
    expect(byId(next, "T1").date, "Expected the thread's date (first comment) to stay put, so it keeps its place in the feed").toEqual(d("10:00"));
  });

  it("returns a new array and leaves the input untouched", () => {
    const items = sample();
    const next = applyReply(items, "T1", fc("new", "13:00"));
    expect(next, "Expected a new array").not.toBe(items);
    expect(byId(items, "T1").comments, "Expected the original thread to still have one comment").toHaveLength(1);
  });

  it("changes only the target thread and keeps the order", () => {
    const items = sample();
    const next = applyReply(items, "T1", fc("new", "13:00"));
    expect(next.map((i) => i.id), "Expected the same order").toEqual(items.map((i) => i.id));
    expect(byId(next, "T2"), "Expected the other thread to be equal to before").toEqual(byId(items, "T2"));
  });

  it("leaves the feed unchanged for an unknown thread id", () => {
    const items = sample();
    expect(applyReply(items, "nope", fc("new", "13:00")), "Expected an equal feed when the thread is not found").toEqual(items);
  });
});

describe("AF-3 / AF-4: applyResolve resolves and reactivates a thread", () => {
  it("resolves an active thread", () => {
    const next = applyResolve(sample(), "T1", true);
    expect(byId(next, "T1").status, "Expected T1 to be resolved").toBe("resolved");
  });

  it("reactivates a resolved thread", () => {
    const next = applyResolve(sample(), "T2", false);
    expect(byId(next, "T2").status, "Expected T2 to be active again").toBe("active");
  });

  it("returns a new array, does not mutate, and touches only the target thread", () => {
    const items = sample();
    const next = applyResolve(items, "T1", true);
    expect(next, "Expected a new array").not.toBe(items);
    expect(byId(items, "T1").status, "Expected the original T1 to remain active").toBe("active");
    expect(byId(next, "T2"), "Expected T2 to be equal to before").toEqual(byId(items, "T2"));
    expect(next.map((i) => i.id), "Expected the same order").toEqual(items.map((i) => i.id));
  });

  it("leaves the feed unchanged for an unknown thread id", () => {
    const items = sample();
    expect(applyResolve(items, "nope", true), "Expected an equal feed when the thread is not found").toEqual(items);
  });
});

describe("AF-2: applyComment adds a top-level comment", () => {
  it("puts a newer comment first as a comment item", () => {
    const items = sample();
    const next = applyComment(items, fc("mine", "14:00"));
    expect(next, "Expected one more item").toHaveLength(items.length + 1);
    expect(next[0], "Expected the new comment at the top of the newest-first feed").toMatchObject({ kind: "comment", id: "mine", author: "bob", html: "<p>mine</p>", url: "https://example.com/mine" });
    expect(next.slice(1).map((i) => i.id), "Expected the existing items after it, in order").toEqual(items.map((i) => i.id));
  });

  it("returns a new array and leaves the input untouched", () => {
    const items = sample();
    const next = applyComment(items, fc("mine", "14:00"));
    expect(next, "Expected a new array").not.toBe(items);
    expect(items, "Expected the original feed to be unchanged").toHaveLength(5);
  });

  it("adds the first comment to an empty feed", () => {
    expect(applyComment([], fc("mine", "14:00")).map((i) => i.id), "Expected a feed of just the new comment").toEqual(["mine"]);
  });
});

describe("AF-7: resolvedCounts gives resolved and total over threads", () => {
  it("counts resolved and all threads, ignoring comments and events", () => {
    expect(resolvedCounts(sample()), "Expected 1 resolved of 2 threads").toEqual({ resolved: 1, total: 2 });
  });

  it("counts outdated threads, as prModel's resolved/total does", () => {
    const items = [thread("A", { outdated: true }), thread("B", { outdated: true, status: "resolved" }), thread("C")];
    expect(resolvedCounts(items), "Expected outdated threads to count towards total and resolved").toEqual({ resolved: 1, total: 3 });
  });

  it("is 0 of 0 when there are no threads", () => {
    expect(resolvedCounts([comment("c1", "10:00"), ev("e1", "09:00")]), "Expected 0/0 for a feed without threads").toEqual({ resolved: 0, total: 0 });
    expect(resolvedCounts([]), "Expected 0/0 for an empty feed").toEqual({ resolved: 0, total: 0 });
  });

  it("changes immediately after applyResolve", () => {
    const items = sample();
    expect(resolvedCounts(applyResolve(items, "T1", true)), "Expected resolving T1 to move the count to 2/2").toEqual({ resolved: 2, total: 2 });
    expect(resolvedCounts(applyResolve(items, "T2", false)), "Expected reactivating T2 to move the count to 0/2").toEqual({ resolved: 0, total: 2 });
  });

  it("does not change when a reply is added", () => {
    const items = sample();
    expect(resolvedCounts(applyReply(items, "T1", fc("new", "13:00"))), "Expected a reply to leave the counts alone").toEqual(resolvedCounts(items));
  });
});

describe("AF-7: failures roll back", () => {
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
    return { promise, resolve, reject };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // Optimistic: the counts move before the network answers.
  it("sets the optimistic state before the commit settles", async () => {
    const items = sample();
    const d1 = deferred();
    const seen: FeedItem[][] = [];
    const pending = optimistic(items, (i) => applyResolve(i, "T1", true), () => d1.promise, (i) => seen.push(i));
    await tick();
    expect(seen, "Expected exactly one set (the optimistic state) while the commit is pending").toHaveLength(1);
    expect(resolvedCounts(seen[0]), "Expected the optimistic counts to show T1 resolved (2/2)").toEqual({ resolved: 2, total: 2 });
    d1.resolve();
    await pending;
  });

  it("keeps the optimistic state and resolves ok when the commit succeeds", async () => {
    const items = sample();
    const seen: FeedItem[][] = [];
    const result = await optimistic(items, (i) => applyResolve(i, "T1", true), () => Promise.resolve("done"), (i) => seen.push(i));
    expect(result, "Expected { ok: true }").toEqual({ ok: true });
    expect(seen, "Expected no rollback after a successful commit").toHaveLength(1);
    expect(resolvedCounts(seen[seen.length - 1]), "Expected the final counts to be the optimistic ones").toEqual({ resolved: 2, total: 2 });
  });

  // Failure: the previous array comes back, as the very same reference.
  it("restores the previous feed and reports the error when the commit fails", async () => {
    const items = sample();
    const boom = new Error("GitHub said no");
    const seen: FeedItem[][] = [];
    const result = await optimistic(items, (i) => applyResolve(i, "T1", true), () => Promise.reject(boom), (i) => seen.push(i));
    expect(result, "Expected { ok: false, error } carrying the rejection").toEqual({ ok: false, error: boom });
    expect(seen, "Expected the optimistic state then the rollback").toHaveLength(2);
    expect(seen[1], "Expected the previous feed restored, same reference").toBe(items);
    expect(resolvedCounts(seen[1]), "Expected the counts back to 1/2").toEqual({ resolved: 1, total: 2 });
  });

  it("rolls back an optimistic reply too", async () => {
    const items = sample();
    const seen: FeedItem[][] = [];
    await optimistic(items, (i) => applyReply(i, "T1", fc("new", "13:00")), () => Promise.reject(new Error("offline")), (i) => seen.push(i));
    expect(byId(seen[0], "T1").comments, "Expected the optimistic reply to show first").toHaveLength(2);
    expect(seen[seen.length - 1], "Expected the feed without the reply restored").toBe(items);
  });

  it("does not reject when the commit throws synchronously", async () => {
    const items = sample();
    const seen: FeedItem[][] = [];
    const result = await optimistic(items, (i) => applyResolve(i, "T1", true), () => { throw new Error("sync"); }, (i) => seen.push(i));
    expect(result.ok, "Expected { ok: false } rather than a rejection").toBe(false);
    expect(seen[seen.length - 1], "Expected the previous feed restored").toBe(items);
  });
});

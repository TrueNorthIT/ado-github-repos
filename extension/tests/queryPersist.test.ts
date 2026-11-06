// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { PERSIST_MAX_AGE, clearPersisted, cloneable, firstPageOnly, idbPersister, mergeClients, shouldPersist } from "../src/queryPersist";

const q = (key: unknown[], data: unknown, at = Date.now()) => ({ queryKey: key, queryHash: JSON.stringify(key), state: { data, dataUpdatedAt: at } as any });
const client = (rows: unknown, key: unknown[] = ["prs"], buster = "1.0.0"): PersistedClient => ({ timestamp: 1, buster, clientState: { mutations: [], queries: [q(key, rows)] } });
const dataOf = (c: PersistedClient | undefined) => Object.fromEntries((c?.clientState.queries ?? []).map((x) => [x.queryHash, x.state.data]));
const saved = async (id: string) => (await idbPersister(id).restoreClient()) as PersistedClient | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await clearPersisted();
});

describe("idbPersister", () => {
  it("writes a quarter of a second after the first change, with the latest state, and later changes don't put it off", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = idbPersister("org|user|hub");
    const when = new Date("2026-11-05T10:00:00Z");
    p.persistClient(client([{ n: 1 }]));
    await vi.advanceTimersByTimeAsync(200);
    p.persistClient(client([{ n: 2, at: when }]));
    await vi.advanceTimersByTimeAsync(49);
    expect(await saved("org|user|hub")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await vi.waitFor(async () => expect(await saved("org|user|hub")).toBeDefined());
    const rows = (await saved("org|user|hub"))!.clientState.queries[0].state.data as { n: number; at: Date }[];
    expect(rows).toEqual([{ n: 2, at: when }]);
    expect(rows[0].at).toBeInstanceOf(Date);
  });

  it("flush writes a pending change at once (the frame is going), and nothing when none is pending", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = idbPersister("org|user|tags");
    p.flush();
    p.persistClient(client(["tags"]));
    p.flush();
    vi.useRealTimers();
    await vi.waitFor(async () => expect((await saved("org|user|tags"))?.clientState.queries[0].state.data).toEqual(["tags"]));
  });

  it("keeps one record per id, and removeClient drops only its own", async () => {
    const a = idbPersister("org|ann|prs");
    const b = idbPersister("org|bob|prs");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    a.persistClient(client(["ann"]));
    b.persistClient(client(["bob"]));
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await vi.waitFor(async () => expect((await saved("org|bob|prs"))?.clientState.queries[0].state.data).toEqual(["bob"]));
    expect((await saved("org|ann|prs"))?.clientState.queries[0].state.data).toEqual(["ann"]);
    await a.removeClient();
    expect(await saved("org|ann|prs")).toBeUndefined();
    expect(await saved("org|bob|prs")).toBeDefined();
  });

  it("clearPersisted (Sign out) drops every hub's record", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    idbPersister("org|ann|prs").persistClient(client([1]));
    idbPersister("org|ann|commits").persistClient(client([2]));
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await vi.waitFor(async () => expect(await saved("org|ann|commits")).toBeDefined());
    await clearPersisted();
    expect(await saved("org|ann|prs")).toBeUndefined();
    expect(await saved("org|ann|commits")).toBeUndefined();
  });
});

describe("shouldPersist", () => {
  it("keeps only successful reads that opted in", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await qc.prefetchQuery({ queryKey: ["prs", "list"], queryFn: () => ["row"], meta: { persist: true } });
    await qc.prefetchQuery({ queryKey: ["browse", "raw"], queryFn: () => "file contents" });
    await qc.prefetchQuery({ queryKey: ["prs", "failed"], queryFn: () => Promise.reject(new Error("no")), meta: { persist: true } });
    expect(dehydrate(qc, { shouldDehydrateQuery: shouldPersist }).queries.map((q) => q.queryKey)).toEqual([["prs", "list"]]);
  });
});

describe("mergeClients", () => {
  const NOW = 1_800_000_000_000;
  const rec = (queries: ReturnType<typeof q>[], buster = "1.0.0"): PersistedClient => ({ timestamp: 1, buster, clientState: { mutations: [], queries } });

  it("keeps the other frames' reads and takes the newer read of a shared key", () => {
    const stored = rec([q(["refs", "branches", "a/b"], "branches", NOW - 10), q(["prs", "list"], "old prs", NOW - 10)]);
    const mine = rec([q(["prs", "list"], "new prs", NOW - 5)]);
    expect(dataOf(mergeClients(stored, mine, NOW))).toEqual({ '["refs","branches","a/b"]': "branches", '["prs","list"]': "new prs" });
  });

  it("never lets an older read of this frame replace a newer stored one", () => {
    const stored = rec([q(["prs", "list"], "newer", NOW - 1)]);
    expect(dataOf(mergeClients(stored, rec([q(["prs", "list"], "older", NOW - 100)]), NOW))).toEqual({ '["prs","list"]': "newer" });
  });

  it("drops reads older than a day, and replaces a record from another extension version", () => {
    const stored = rec([q(["refs", "tags"], "stale", NOW - PERSIST_MAX_AGE - 1), q(["refs", "x"], "fresh", NOW - 1)]);
    expect(dataOf(mergeClients(stored, rec([]), NOW))).toEqual({ '["refs","x"]': "fresh" });
    expect(dataOf(mergeClients(rec([q(["refs", "x"], "v1", NOW - 1)], "0.9.0"), rec([q(["prs"], "v2", NOW - 1)]), NOW))).toEqual({ '["prs"]': "v2" });
  });
});

describe("one record per project", () => {
  it("two frames saving at once keep both their reads", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    idbPersister("org|ann|proj").persistClient(client(["branches"], ["refs", "branches"]));
    idbPersister("org|ann|proj").persistClient(client(["prs"], ["prs", "list"]));
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await vi.waitFor(async () => expect(dataOf(await saved("org|ann|proj"))).toEqual({ '["refs","branches"]': ["branches"], '["prs","list"]': ["prs"] }));
  });

  it("forget drops the saved reads under a key prefix and nothing else", async () => {
    const p = idbPersister("org|ann|proj");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    p.persistClient({ timestamp: 1, buster: "1.0.0", clientState: { mutations: [], queries: [q(["refs", "branches", "a/b"], 1), q(["refs", "tags", "a/b"], 2), q(["prs", "list", "a/b"], 3), q(["refsx"], 4)] } });
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await vi.waitFor(async () => expect(Object.keys(dataOf(await saved("org|ann|proj")))).toHaveLength(4));
    await p.forget(["refs"]);
    expect(dataOf(await saved("org|ann|proj"))).toEqual({ '["prs","list","a/b"]': 3, '["refsx"]': 4 });
  });
});

describe("firstPageOnly", () => {
  it("saves a Load more list with its first page only, and leaves other reads alone", () => {
    const many = q(["refs", "commits"], { pages: [["a"], ["b"], ["c"]], pageParams: [undefined, 2, 3] });
    expect(firstPageOnly(many).state.data).toEqual({ pages: [["a"]], pageParams: [undefined] });
    const one = q(["refs", "commits"], { pages: [["a"]], pageParams: [undefined] });
    expect(firstPageOnly(one)).toBe(one);
    const plain = q(["prs", "list"], { rows: [1], pages: 3 });
    expect(firstPageOnly(plain)).toBe(plain);
  });

  it("is applied when a frame saves", () => {
    const now = Date.now();
    const mine: PersistedClient = { timestamp: 1, buster: "1", clientState: { mutations: [], queries: [q(["refs", "commits"], { pages: [[1], [2]], pageParams: [1, 2] }, now)] } };
    expect(mergeClients(undefined, mine, now).clientState.queries[0].state.data).toEqual({ pages: [[1]], pageParams: [1] });
  });
});

describe("cloneable", () => {
  it("drops only the reads whose value can't be stored", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ok = q(["prs", "list"], [{ at: new Date(0) }]);
    const bad = q(["refs", "x"], { run: () => 1 });
    const c: PersistedClient = { timestamp: 1, buster: "1", clientState: { mutations: [], queries: [ok, bad] } };
    expect(cloneable(c).clientState.queries).toEqual([ok]);
    const fine: PersistedClient = { timestamp: 1, buster: "1", clientState: { mutations: [], queries: [ok] } };
    expect(cloneable(fine)).toBe(fine);
  });
});

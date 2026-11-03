// Live findings (0.26.0, 0.27.1, 0.31.0): a cold load of a deep link (#repo=...&pr=234, #repo=...&path=README.md) sometimes
// opened the hub's default view. The host answered getHash() with "" for over a second and the hub's default-repo fill
// replaced the real address. go(..., "ifEmpty") now shows the default in memory only, keeps re-reading the hash, adopts the
// real one if it turns up, and writes the default only if the address is still empty at the end and nobody navigated.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const svc = {
  hashes: [] as string[],
  replaced: [] as string[],
  set: [] as string[],
  listener: null as null | ((h: string) => void),
  getHash: vi.fn(async () => svc.hashes.shift() ?? ""),
  replaceHash: vi.fn((h: string) => void svc.replaced.push(h)),
  setHash: vi.fn((h: string) => void svc.set.push(h)),
  onHashChanged: (cb: (h: string) => void) => { svc.listener = cb; },
};
vi.mock("azure-devops-extension-sdk", () => ({ getService: async () => svc }));
vi.mock("./lib/repoChannel", () => ({ onRepoMessage: () => {}, post: () => {}, sibling: () => null }));
vi.mock("./connections", () => ({ getProjectCtx: async () => ({}) }));
import { connectNav, IF_EMPTY_WAITS } from "./hostNav";

const TOTAL = IF_EMPTY_WAITS.reduce((a, b) => a + b, 0);

/** connectNav with a cold-load host: every getHash() answers "" until `hashes` is refilled. */
async function connect(seen: unknown[]) {
  svc.hashes = ["", ""];
  const p = connectNav((s) => seen.push(s));
  await vi.advanceTimersByTimeAsync(1000); // readInitialHash's own wait
  return p;
}

describe("connectNav go(…, 'ifEmpty')", () => {
  beforeEach(() => { vi.useFakeTimers(); svc.replaced = []; svc.set = []; });
  afterEach(() => vi.useRealTimers());

  it("shows the default at once, in memory only", async () => {
    const seen: unknown[] = [];
    const go = await connect(seen);
    go({ repo: "d/default", view: "prs" }, "ifEmpty");
    expect(seen[seen.length - 1]).toMatchObject({ repo: "d/default", view: "prs" });
    expect(svc.replaced).toEqual([]);
  });

  it("adopts the real hash when the host has it on a later read", async () => {
    const seen: unknown[] = [];
    const go = await connect(seen);
    svc.hashes = ["", "#repo=o%2Fr&view=prs&pr=234"];
    go({ repo: "d/default", view: "prs" }, "ifEmpty");
    await vi.advanceTimersByTimeAsync(TOTAL);
    expect(svc.replaced).toEqual([]);
    expect(seen[seen.length - 1]).toMatchObject({ repo: "o/r", pr: 234 });
  });

  it("writes the default only once the address is still empty after every re-read", async () => {
    const go = await connect([]);
    svc.hashes = [];
    go({ repo: "d/default", view: "prs" }, "ifEmpty");
    await vi.advanceTimersByTimeAsync(TOTAL - 1);
    expect(svc.replaced).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(svc.replaced).toHaveLength(1);
    expect(svc.replaced[0]).toContain("repo=d%2Fdefault");
  });

  it("never writes the default if the user navigated meanwhile", async () => {
    const go = await connect([]);
    svc.hashes = [];
    go({ repo: "d/default", view: "prs" }, "ifEmpty");
    go({ repo: "o/r", view: "prs", pr: 7 });
    await vi.advanceTimersByTimeAsync(TOTAL);
    expect(svc.replaced).toEqual([]);
    expect(svc.set).toHaveLength(1);
  });
});

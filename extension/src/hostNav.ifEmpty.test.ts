// Live finding (0.26.0, again on 0.27.1): a cold load of #repo=...&view=prs&pr=234 sometimes opened the PR list. The host
// answered getHash() before it had the hash, and the hub's default-repo fill replaced the real address. "ifEmpty" re-reads
// the hash first and only writes the default when there is still no repo.
import { describe, expect, it, vi } from "vitest";

const svc = { hashes: [] as string[], replaced: [] as string[], set: [] as string[], listener: null as null | ((h: string) => void),
  getHash: vi.fn(async () => svc.hashes.shift() ?? ""), replaceHash: vi.fn((h: string) => void svc.replaced.push(h)), setHash: vi.fn((h: string) => void svc.set.push(h)),
  onHashChanged: (cb: (h: string) => void) => { svc.listener = cb; } };
vi.mock("azure-devops-extension-sdk", () => ({ getService: async () => svc }));
vi.mock("./lib/repoChannel", () => ({ onRepoMessage: () => {}, post: () => {}, sibling: () => null }));
vi.mock("./connections", () => ({ getProjectCtx: async () => ({}) }));
import { connectNav } from "./hostNav";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("connectNav go(…, 'ifEmpty')", () => {
  it("uses the real hash when it has arrived by the time the default is filled", async () => {
    svc.hashes = ["#repo=o%2Fr&view=prs&pr=234", "#repo=o%2Fr&view=prs&pr=234"]; svc.replaced = [];
    const seen: unknown[] = [];
    const go = await connectNav((s) => seen.push(s));
    svc.hashes = ["#repo=o%2Fr&view=prs&pr=234"];
    go({ repo: "d/default", view: "prs" }, "ifEmpty");
    await tick();
    expect(svc.replaced).toEqual([]);
    expect(seen[seen.length - 1]).toMatchObject({ repo: "o/r", pr: 234 });
  });
  it("writes the default when the hash is still empty", async () => {
    svc.hashes = ["", ""]; svc.replaced = [];
    const go = await connectNav(() => {});
    svc.hashes = [""];
    go({ repo: "d/default", view: "prs" }, "ifEmpty");
    await tick();
    expect(svc.replaced).toHaveLength(1);
    expect(svc.replaced[0]).toContain("repo=d%2Fdefault");
  });
});

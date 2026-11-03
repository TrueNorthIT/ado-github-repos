// Back/forward while a file edit is unsaved can't be blocked: the old address is put back and the Discard dialog shown.
// Keep leaves the old address; Discard must move the page and the address bar on to the new one.
import { describe, expect, it, vi } from "vitest";

const svc = {
  hash: "#repo=o%2Fr&path=a.ts",
  replaced: [] as string[],
  listener: null as null | ((h: string) => void),
  getHash: vi.fn(async () => svc.hash),
  replaceHash: vi.fn((h: string) => void svc.replaced.push(h)),
  setHash: vi.fn(),
  onHashChanged: (cb: (h: string) => void) => { svc.listener = cb; },
};
vi.mock("azure-devops-extension-sdk", () => ({ getService: async () => svc }));
vi.mock("./lib/repoChannel", () => ({ onRepoMessage: () => {}, post: () => {}, sibling: () => null }));
vi.mock("./connections", () => ({ getProjectCtx: async () => ({}) }));
import { connectNav, setEditGuard } from "./hostNav";

describe("unsaved edit and an external hash change", () => {
  it("restores the old address, then Discard moves page and address on; Keep leaves both", async () => {
    const seen: { path?: string }[] = [];
    await connectNav((s) => seen.push(s as { path?: string }));
    // The real dialog answers later, after the old address has been put back; model that.
    let pending: (() => void) | null = null;
    const discard = vi.fn();
    setEditGuard({ dirty: true, path: "a.ts", discard, ask: (proceed) => { pending = proceed; } });

    svc.listener!("#repo=o%2Fr&path=b.ts"); // Keep
    expect(svc.replaced[svc.replaced.length - 1]).toBe("repo=o%2Fr&path=a.ts");
    expect(seen[seen.length - 1].path).toBe("a.ts");
    expect(discard).not.toHaveBeenCalled();

    svc.listener!("#repo=o%2Fr&path=b.ts");
    pending!(); // Discard
    expect(discard).toHaveBeenCalledTimes(1);
    expect(seen[seen.length - 1].path).toBe("b.ts");
    expect(svc.replaced).toContain("repo=o%2Fr&path=b.ts");
    setEditGuard(null);
  });
});

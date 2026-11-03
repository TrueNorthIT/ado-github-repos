import { describe, expect, it, vi } from "vitest";
vi.mock("azure-devops-extension-sdk", () => ({}));
import { readInitialHash } from "./hostNav";

describe("readInitialHash", () => {
  it("trusts a non-empty first answer without waiting", async () => {
    const get = vi.fn().mockResolvedValueOnce("#repo=o%2Fr&pr=1");
    expect(await readInitialHash(get, 0)).toBe("#repo=o%2Fr&pr=1");
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("reads again when the host first answers empty (cold load race)", async () => {
    const get = vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce("#repo=o%2Fr&view=prs&pr=234");
    expect(await readInitialHash(get, 0)).toBe("#repo=o%2Fr&view=prs&pr=234");
  });
  it("treats a bare # as empty, and accepts a genuinely empty hash on the second read", async () => {
    const get = vi.fn().mockResolvedValueOnce("#").mockResolvedValueOnce("");
    expect(await readInitialHash(get, 0)).toBe("");
    expect(get).toHaveBeenCalledTimes(2);
  });
});

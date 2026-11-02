import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for ADO's extension data service, so getTokens() runs as it does in the hub frame.
let stored: Record<string, unknown> | null = null;
const deleteDocument = vi.fn(async () => { stored = null; });
const manager = {
  getDocument: vi.fn(async () => { if (!stored) throw new Error("404"); return { ...stored }; }),
  setDocument: vi.fn(async (_c: string, doc: Record<string, unknown>) => { stored = { ...doc }; return doc; }),
  deleteDocument,
};
vi.mock("azure-devops-extension-sdk", () => ({
  getService: async () => ({ getExtensionDataManager: async () => manager }),
  getExtensionContext: () => ({ id: "test.ext" }),
  getAccessToken: async () => "ado-token",
}));
vi.mock("./config", () => ({ AUTH_BASE: "https://auth.example" }));

const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const expired = { id: "tokens", accessToken: "old-access", expiresAt: iso(-60_000), refreshToken: "old-refresh", refreshTokenExpiresAt: iso(86_400_000) };
const fresh = { accessToken: "new-access", expiresAt: iso(8 * 3_600_000), refreshToken: "new-refresh", refreshTokenExpiresAt: iso(86_400_000) };

describe("getTokens refresh (seen live in 0.20.0: concurrent refreshes signed the user out)", () => {
  beforeEach(() => {
    vi.resetModules();
    stored = { ...expired };
    deleteDocument.mockClear();
  });

  it("refreshes once for concurrent callers and keeps the user signed in", async () => {
    let calls = 0;
    // A single-use refresh token: the second call with the same token fails, as GitHub does.
    globalThis.fetch = vi.fn(async () => (++calls === 1 ? new Response(JSON.stringify(fresh), { status: 200 }) : new Response("{}", { status: 401 }))) as typeof fetch;
    const { getTokens } = await import("./auth");
    const results = await Promise.all([getTokens(), getTokens(), getTokens()]);
    expect(calls, "Expected exactly one refresh request").toBe(1);
    for (const r of results) expect(r?.accessToken).toBe("new-access");
    expect(deleteDocument, "Expected no sign-out").not.toHaveBeenCalled();
    expect(stored?.refreshToken).toBe("new-refresh");
  });

  it("does not sign out when another tab refreshed first", async () => {
    // This frame's refresh fails because another tab already used the token and saved new ones.
    globalThis.fetch = vi.fn(async () => { stored = { id: "tokens", ...fresh }; return new Response("{}", { status: 401 }); }) as typeof fetch;
    const { getTokens } = await import("./auth");
    const r = await getTokens();
    expect(r?.accessToken).toBe("new-access");
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("signs out when the refresh token itself is rejected", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 401 })) as typeof fetch;
    const { getTokens } = await import("./auth");
    expect(await getTokens()).toBeNull();
    expect(deleteDocument).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createGhProxy, proxyTarget } from "../src/dev/ghProxy";

const S = "TrueNorthIT/gh-repos-sandbox";
const TOKEN = "test-token-not-real";

describe("proxyTarget: api.github.com paths only", () => {
  const OK: [string, string][] = [
    [`/__gh/repos/${S}/pulls/3`, `https://api.github.com/repos/${S}/pulls/3`],
    ["/__gh/user", "https://api.github.com/user"],
    ["/__gh/graphql", "https://api.github.com/graphql"],
    [`/__gh/search/issues?q=repo:${S}+involves:@me`, `https://api.github.com/search/issues?q=repo:${S}+involves:@me`],
    [`/__gh/repos/${S}/contents/a%20b.md?ref=main`, `https://api.github.com/repos/${S}/contents/a%20b.md?ref=main`],
    ["/__gh/@evil.example/x", "https://api.github.com/@evil.example/x"], // a path segment, not userinfo: still api.github.com
  ];
  it.each(OK)("%s -> %s", (raw, want) => {
    const t = proxyTarget(raw);
    expect(t.ok && t.url.href).toBe(want);
  });

  const BAD: [string, string][] = [
    ["full URL in the path", "/__gh/https://evil.example/x"],
    ["full URL to GitHub in the path", "/__gh/https://api.github.com/user"],
    ["encoded full URL", "/__gh/https%3A%2F%2Fevil.example%2Fx"],
    ["protocol-relative", "/__gh//evil.example/x"],
    ["encoded protocol-relative", "/__gh/%2F%2Fevil.example/x"],
    ["backslash", "/__gh/\\evil.example/x"],
    ["encoded backslash", "/__gh/%5Cevil.example"],
    ["control character", "/__gh/user%0d%0aHost:%20evil.example"],
    ["bad percent-encoding", "/__gh/user%zz"],
    ["prefix without slash", "/__ghuser"],
    ["prefix alone", "/__gh"],
    ["not under the prefix", "/hub.html"],
  ];
  it.each(BAD)("refuses %s", (_, raw) => expect(proxyTarget(raw).ok).toBe(false));

  it("normalises dot segments before the guard sees the path", () => {
    const t = proxyTarget(`/__gh/repos/${S}/../../TrueNorthIT/TrueTunes`);
    expect(t.ok && t.url.pathname).toBe("/repos/TrueNorthIT/TrueTunes"); // which the guard then refuses (below)
  });
});

type Call = { url: string; method: string; headers: Headers; body?: unknown };
/** A fake GitHub: answers from `routes` (by full URL) and records every outbound call. */
function harness(routes: Record<string, () => Response> = {}) {
  const calls: Call[] = [];
  const log = vi.fn();
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body });
    expect(init?.redirect).toBe("manual"); // redirects are always followed by hand
    const r = routes[u];
    return r ? r() : new Response(JSON.stringify({ ok: true, node_id: "PR_kwDOAbCdEf12" }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }) as unknown as typeof fetch & { mock: unknown };
  const handle = createGhProxy({ token: TOKEN, fetch, log });
  const req = (method: string, url: string, headers: Record<string, string> = {}, body?: string) =>
    handle({ method, url, headers, body: body === undefined ? undefined : new TextEncoder().encode(body) });
  return { calls, log, req };
}

describe("ghProxy: guard, token and headers", () => {
  it("adds the token for the sandbox and forwards only safe headers", async () => {
    const h = harness();
    const r = await h.req("GET", `/__gh/repos/${S}/pulls/3`, { accept: "application/vnd.github.raw", "if-none-match": 'W/"x"', authorization: "Bearer placeholder", cookie: "a=b", "sec-fetch-site": "same-origin", origin: "http://localhost:3000" });
    expect(r.status).toBe(200);
    expect(h.calls).toHaveLength(1);
    const sent = h.calls[0].headers;
    expect(sent.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(sent.get("accept")).toBe("application/vnd.github.raw");
    expect(sent.get("if-none-match")).toBe('W/"x"');
    for (const k of ["cookie", "sec-fetch-site", "origin"]) expect(sent.has(k)).toBe(false);
  });

  const REFUSED: [string, string, string, string?][] = [
    ["another repository", "GET", "/__gh/repos/TrueNorthIT/TrueTunes/pulls/234"],
    ["dot segments into another repository", "GET", `/__gh/repos/${S}/../../TrueNorthIT/TrueTunes`],
    ["a write outside the sandbox", "PATCH", "/__gh/user", "{}"],
    ["an unlisted path", "GET", "/__gh/orgs/TrueNorthIT/repos"],
    ["a search without repo:", "GET", "/__gh/search/issues?q=is:open"],
    ["graphql on another repository", "POST", "/__gh/graphql", JSON.stringify({ query: 'query { repository(owner: "TrueNorthIT", name: "TrueTunes") { id } }' })],
    ["graphql on an unseen node id", "POST", "/__gh/graphql", JSON.stringify({ query: "query($id: ID!) { node(id: $id) { id } }", variables: { id: "PR_kwDOZZZZZZ99" } })],
  ];
  it.each(REFUSED)("refuses %s with 403, logs, and sends nothing", async (_, method, url, body) => {
    const h = harness();
    const r = await h.req(method, url, {}, body);
    expect(r.status).toBe(403);
    expect(h.calls).toHaveLength(0);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining("[live guard] refused"));
    expect(await r.text()).not.toContain(TOKEN);
  });

  it("refuses a URL in the path with 400 and sends nothing", async () => {
    const h = harness();
    const r = await h.req("GET", "/__gh/https://evil.example/steal");
    expect(r.status).toBe(400);
    expect(h.calls).toHaveLength(0);
    expect(h.log).toHaveBeenCalled();
  });

  it("allows graphql on node ids that came back from the sandbox", async () => {
    const h = harness();
    await h.req("GET", `/__gh/repos/${S}/pulls/3`); // response carries PR_kwDOAbCdEf12
    const r = await h.req("POST", "/__gh/graphql", {}, JSON.stringify({ query: "query($id: ID!) { node(id: $id) { id } }", variables: { id: "PR_kwDOAbCdEf12" } }));
    expect(r.status).toBe(200);
  });

  it("resolves the sandbox id before allowing /repositories/{id}", async () => {
    const h = harness({ [`https://api.github.com/repos/${S}`]: () => new Response(JSON.stringify({ id: 42 }), { headers: { "Content-Type": "application/json" } }) });
    expect((await h.req("GET", "/__gh/repositories/42/pulls")).status).toBe(200);
    expect((await h.req("GET", "/__gh/repositories/43/pulls")).status).toBe(403);
  });
});

describe("ghProxy: redirects", () => {
  const LOGS = `https://api.github.com/repos/${S}/actions/jobs/7/logs`;
  const BLOB = "https://productionresultssa1.blob.core.windows.net/actions-results/x/logs.txt?sig=abc";
  const redirect = (to: string, status = 302) => () => new Response(null, { status, headers: { Location: to } });

  it("follows a log redirect to the blob host without the token or the page's headers", async () => {
    const h = harness({ [LOGS]: redirect(BLOB), [BLOB]: () => new Response("line 1\nline 2", { headers: { "Content-Type": "text/plain" } }) });
    const r = await h.req("GET", `/__gh/repos/${S}/actions/jobs/7/logs`, { accept: "application/vnd.github+json", "if-none-match": "x" });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("line 1\nline 2");
    expect(h.calls.map((c) => c.url)).toEqual([LOGS, BLOB]);
    expect(h.calls[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    const blob = h.calls[1].headers;
    expect(blob.has("authorization")).toBe(false);
    expect(blob.has("accept")).toBe(false);
    expect(blob.has("if-none-match")).toBe(false);
  });

  it("guards a redirect back onto api.github.com", async () => {
    const h = harness({ [`https://api.github.com/repos/${S}/pulls/3`]: redirect("https://api.github.com/repos/TrueNorthIT/TrueTunes/pulls/3", 301) });
    const r = await h.req("GET", `/__gh/repos/${S}/pulls/3`);
    expect(r.status).toBe(403);
    expect(h.calls).toHaveLength(1);
  });

  it("does not follow a redirect to plain http", async () => {
    const h = harness({ [LOGS]: redirect("http://evil.example/x") });
    expect((await h.req("GET", `/__gh/repos/${S}/actions/jobs/7/logs`)).status).toBe(502);
    expect(h.calls).toHaveLength(1);
  });

  it("stops after five redirects", async () => {
    const hop = (n: number) => `https://blob.example/${n}`;
    const routes: Record<string, () => Response> = { [LOGS]: redirect(hop(1)) };
    for (let n = 1; n < 10; n++) routes[hop(n)] = redirect(hop(n + 1));
    const h = harness(routes);
    expect((await h.req("GET", `/__gh/repos/${S}/actions/jobs/7/logs`)).status).toBe(508);
    expect(h.calls).toHaveLength(6);
  });
});

describe("ghProxy: egress proxy hints", () => {
  const egress403 = (message: string) => () => new Response(JSON.stringify({ message }), { status: 403, headers: { "Content-Type": "application/json" } });

  it("explains a cloud session's GraphQL refusal once, and passes the 403 through", async () => {
    const h = harness({ "https://api.github.com/graphql": egress403("GitHub GraphQL is not available from Claude Code sessions; use the REST API") });
    const body = JSON.stringify({ query: `query { repository(owner: "TrueNorthIT", name: "gh-repos-sandbox") { id } }` });
    expect((await h.req("POST", "/__gh/graphql", {}, body)).status).toBe(403);
    await h.req("POST", "/__gh/graphql", {}, body);
    expect(h.log.mock.calls.filter(([m]) => /\[gh proxy\].*GraphQL/.test(m))).toHaveLength(1);
  });

  it("says to attach the sandbox when the session's proxy refuses it", async () => {
    const h = harness({ [`https://api.github.com/repos/${S}`]: egress403("GitHub access to this repository is not enabled for this session. Use add_repo to request access.") });
    await h.req("GET", `/__gh/repos/${S}`);
    expect(h.log).toHaveBeenCalledWith(expect.stringMatching(/\[gh proxy\].*attach it to the session/));
  });

  it("stays quiet for GitHub's own 403s", async () => {
    const h = harness({ [`https://api.github.com/repos/${S}/pulls`]: egress403("Resource not accessible by integration") });
    await h.req("GET", `/__gh/repos/${S}/pulls`);
    expect(h.log).not.toHaveBeenCalled();
  });
});

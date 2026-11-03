// __TN_LIVE__ Live mode's same-origin GitHub proxy, run by the dev server (build.mjs --dev with LIVE=1), never by the page.
// The page sends api.github.com requests to /__gh/…; this adds the sandbox token (held only by the Node process), runs the same
// repo guard as the page (liveGuard.ts), and follows GitHub's redirects for job logs and artifact zips itself, without sending the
// token to the blob host. It proxies api.github.com only: anything that tries to name another host is refused.
import { decide, learnIds, SANDBOX, type GuardCtx } from "./liveGuard";

export const GH_PREFIX = "/__gh";
const API = "https://api.github.com";
const MAX_REDIRECTS = 5;

export type Target = { ok: true; url: URL } | { ok: false; reason: string };

/** The api.github.com URL a raw request path (`/__gh/repos/o/r?x=1`) stands for, or why it is refused. */
export function proxyTarget(raw: string): Target {
  if (!raw.startsWith(GH_PREFIX + "/")) return { ok: false, reason: `not under ${GH_PREFIX}/` };
  const rest = raw.slice(GH_PREFIX.length); // starts with "/", so API + rest can't turn into userinfo or another host
  const path = rest.split(/[?#]/, 1)[0];
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return { ok: false, reason: "malformed percent-encoding" }; }
  // No full or protocol-relative URL, backslash or control character in the path, raw or decoded.
  for (const s of [path, decoded]) {
    if (/^\/[/\\]|:\/\/|\\|[\0-\x1f\x7f]/.test(s)) return { ok: false, reason: "the path must be an api.github.com path, not a URL" };
  }
  let url: URL;
  try { url = new URL(API + rest); } catch { return { ok: false, reason: "unparseable path" }; }
  if (url.origin !== API) return { ok: false, reason: `resolves to ${url.origin}` };
  return { ok: true, url };
}

/** Request headers worth passing on to GitHub. Everything else (cookies, Sec-Fetch-*, Origin, the page's Authorization) is dropped. */
const FORWARD = new Set(["accept", "content-type", "if-none-match", "if-modified-since", "range", "x-github-api-version", "graphql-features"]);
/** Response headers not passed back: hop-by-hop, and encoding/length (fetch has already decoded the body). */
const DROP_BACK = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "set-cookie", "strict-transport-security"]);

export interface ProxyRequest { method: string; url: string; headers: Record<string, string | string[] | undefined>; body?: Uint8Array<ArrayBuffer> }
export interface ProxyDeps { token: string; fetch: typeof fetch; log: (msg: string) => void }

/** Refusals from a Claude Code cloud session's egress proxy (not from GitHub), each with what to do about it. */
export const EGRESS_HINTS: [RegExp, string][] = [
  [/not enabled for this session/i, `this cloud session's egress proxy refuses ${SANDBOX}: attach it to the session (start the session with both repos, or add_repo).`],
  [/GraphQL is not available from Claude Code sessions/i, "this cloud session's egress proxy refuses GitHub GraphQL, so pages built on it (PR overview, releases) show an access error here; check those locally."],
];

export function createGhProxy({ token, fetch: fetchImpl, log }: ProxyDeps) {
  const ctx: GuardCtx = { seenIds: new Set() };
  const hinted = new Set<string>();
  const hint = (status: number, text: string) => {
    if (status !== 403) return;
    for (const [re, msg] of EGRESS_HINTS) if (re.test(text) && !hinted.has(msg)) { hinted.add(msg); log(`[gh proxy] ${msg}`); }
  };
  const refuse = (status: number, reason: string) => {
    log(`[live guard] refused (dev server): ${reason}`);
    return new Response(JSON.stringify({ message: `Live mode refused this request: ${reason}. Only ${SANDBOX} may be touched.` }), { status, headers: { "Content-Type": "application/json" } });
  };
  const authed = (h: Headers) => { h.set("Authorization", `Bearer ${token}`); h.set("User-Agent", "gh-repos-dev-harness"); return h; };

  return async function handle(req: ProxyRequest): Promise<Response> {
    const t = proxyTarget(req.url);
    if (!t.ok) return refuse(400, t.reason);
    let method = req.method.toUpperCase();
    let body: Uint8Array<ArrayBuffer> | undefined = method === "GET" || method === "HEAD" ? undefined : req.body;
    const bodyText = body ? new TextDecoder().decode(body) : undefined;

    if (ctx.sandboxId === undefined && t.url.pathname.startsWith("/repositories/")) { // the guard needs the sandbox's numeric id
      const r = await fetchImpl(`${API}/repos/${SANDBOX}`, { headers: authed(new Headers({ Accept: "application/vnd.github+json" })), redirect: "manual" });
      if (r.ok) ctx.sandboxId = (await r.json()).id;
    }

    const fwd = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && FORWARD.has(k.toLowerCase())) fwd.set(k, Array.isArray(v) ? v.join(", ") : v);

    let url = t.url;
    for (let hop = 0; ; hop++) {
      const toApi = url.origin === API;
      if (toApi) { // every api.github.com hop, including a redirect GitHub sends us to, passes the guard
        const d = decide({ method, url, body: bodyText }, ctx);
        if (!d.ok) return refuse(403, d.reason);
      }
      // The token goes to api.github.com only. Redirects are followed by hand, so a blob host never sees Authorization or the page's headers.
      const headers = toApi ? authed(new Headers(fwd)) : new Headers({ "User-Agent": "gh-repos-dev-harness" });
      const res = await fetchImpl(url.href, { method, headers, body, redirect: "manual" });
      const loc = res.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
        if (hop >= MAX_REDIRECTS) return refuse(508, "too many redirects");
        let next: URL;
        try { next = new URL(loc, url); } catch { return refuse(502, "unreadable redirect"); }
        if (next.protocol !== "https:") return refuse(502, `redirect to ${next.protocol} is not followed`);
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) { method = "GET"; body = undefined; }
        url = next;
        continue;
      }
      const out = new Headers();
      res.headers.forEach((v, k) => { if (!DROP_BACK.has(k)) out.set(k, v); });
      if (/json/.test(res.headers.get("content-type") ?? "")) {
        const text = await res.text();
        if (toApi) { learnIds(text, ctx); hint(res.status, text); }
        return new Response(res.status === 304 ? null : text, { status: res.status, statusText: res.statusText, headers: out });
      }
      return new Response(res.status === 304 || method === "HEAD" ? null : res.body, { status: res.status, statusText: res.statusText, headers: out });
    }
  };
}

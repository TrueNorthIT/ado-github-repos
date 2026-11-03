// __TN_LIVE__ Live mode (LIVE=1 GH_SANDBOX_TOKEN=… npm run dev): api.github.com goes to the real network, guarded to the sandbox repo.
import { SANDBOX, decide, learnIds, type GuardCtx } from "./liveGuard";

declare const __LIVE_TOKEN__: string; // build.mjs defines it in the dev bundle only ("" unless live)
export const LIVE_TOKEN = __LIVE_TOKEN__;
export const LIVE = LIVE_TOKEN !== "";
export { SANDBOX };

const ctx: GuardCtx = { seenIds: new Set() };
const refuse = (reason: string) => {
  console.error(`[live guard] refused: ${reason}`);
  return new Response(JSON.stringify({ message: `Live mode refused this request: ${reason}. Only ${SANDBOX} may be touched.` }), { status: 403, headers: { "Content-Type": "application/json" } });
};

/** Sends a guarded request to the real GitHub with the injected token; the caller has checked the host. */
export async function liveFetch(real: typeof fetch, u: URL, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const body = typeof init?.body === "string" ? init.body : undefined;
  if (ctx.sandboxId === undefined && u.pathname.startsWith("/repositories/")) { // resolved once, through a request the guard itself accepts
    const r = await real(`https://api.github.com/repos/${SANDBOX}`, { headers: { Authorization: `Bearer ${LIVE_TOKEN}` } });
    if (r.ok) ctx.sandboxId = (await r.json()).id;
  }
  const d = decide({ method, url: u, body }, ctx);
  if (!d.ok) return refuse(d.reason);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("Authorization", `Bearer ${LIVE_TOKEN}`);
  const res = await real(u.href, { ...init, method, headers });
  if (/json/.test(res.headers.get("Content-Type") ?? "")) learnIds(await res.clone().text(), ctx);
  return res;
}

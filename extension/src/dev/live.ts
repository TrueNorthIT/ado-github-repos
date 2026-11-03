// __TN_LIVE__ Live mode (LIVE=1 GH_SANDBOX_TOKEN=… npm run dev): api.github.com requests go to the dev server's same-origin proxy
// (/__gh/…, src/dev/ghProxy.ts), which adds the sandbox token in Node and guards again. The page never holds the token.
import { SANDBOX, decide, learnIds, type GuardCtx } from "./liveGuard";

declare const __LIVE__: boolean; // build.mjs defines it in the dev bundle only
export const LIVE = __LIVE__;
export { SANDBOX };

const ctx: GuardCtx = { seenIds: new Set() };
const refuse = (reason: string) => {
  console.error(`[live guard] refused: ${reason}`);
  return new Response(JSON.stringify({ message: `Live mode refused this request: ${reason}. Only ${SANDBOX} may be touched.` }), { status: 403, headers: { "Content-Type": "application/json" } });
};
const viaDevServer = (u: URL) => `/__gh${u.pathname}${u.search}`;

/** Sends a guarded api.github.com request through the dev server's proxy; the caller has checked the host. */
export async function liveFetch(real: typeof fetch, u: URL, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const body = typeof init?.body === "string" ? init.body : undefined;
  if (ctx.sandboxId === undefined && u.pathname.startsWith("/repositories/")) { // resolved once, through a request the guard itself accepts
    const r = await real(viaDevServer(new URL(`https://api.github.com/repos/${SANDBOX}`)));
    if (r.ok) ctx.sandboxId = (await r.json()).id;
  }
  const d = decide({ method, url: u, body }, ctx);
  if (!d.ok) return refuse(d.reason);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.delete("Authorization"); // the app's placeholder; the dev server sets the real one
  const res = await real(viaDevServer(u), { ...init, method, headers });
  if (/json/.test(res.headers.get("Content-Type") ?? "")) learnIds(await res.clone().text(), ctx);
  return res;
}

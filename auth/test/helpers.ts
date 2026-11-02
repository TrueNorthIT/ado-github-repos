// Shared test helpers. Nothing here asserts requirements; it only builds inputs and reads outputs.
import vm from "node:vm";
import { vi } from "vitest";
import type { HttpResponseInit } from "@azure/functions";
import type { AuthConfig, FetchFn } from "../src/handlers";
import { start } from "../src/handlers";

export const ORIGIN_A = "https://truenorthit.gallerycdn.vsassets.io";
export const ORIGIN_B = "https://dev.azure.com";
export const CLIENT_SECRET = "s3cr3t-client-secret-value-9f8e7d";
export const STATE_COOKIE_NAME = "tn_gh_state";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const NOW = new Date("2026-01-01T00:00:00.000Z");

export const config: AuthConfig = {
  clientId: "Iv1.testclientid",
  clientSecret: CLIENT_SECRET,
  allowedOrigins: [ORIGIN_A, ORIGIN_B],
  stateSecret: "state-signing-secret-for-tests",
  baseUrl: "https://auth.example.test",
};

/** Freeze Date only, so promises and the stubbed fetch still run normally. */
export function freezeClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
}
export function advanceClock(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}
export function restoreClock() {
  vi.useRealTimers();
}

export function startRequest(origin?: string) {
  const qs = origin === undefined ? "" : `?origin=${encodeURIComponent(origin)}`;
  return new Request(`${config.baseUrl}/api/auth/start${qs}`, { method: "GET" });
}

export function callbackRequest(opts: { state?: string; code?: string; cookie?: string; error?: string }) {
  const u = new URL(`${config.baseUrl}/api/auth/callback`);
  if (opts.code !== undefined) u.searchParams.set("code", opts.code);
  if (opts.error !== undefined) u.searchParams.set("error", opts.error);
  if (opts.state !== undefined) u.searchParams.set("state", opts.state);
  const headers: Record<string, string> = {};
  if (opts.cookie !== undefined) headers.cookie = opts.cookie;
  return new Request(u.toString(), { method: "GET", headers });
}

export function refreshRequest(opts: { body?: string; origin?: string; method?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.origin !== undefined) headers.origin = opts.origin;
  const method = opts.method ?? "POST";
  return new Request(`${config.baseUrl}/api/auth/refresh`, {
    method,
    headers,
    ...(method === "POST" && opts.body !== undefined ? { body: opts.body } : {}),
  });
}

/** Run start() for an allowed origin and return what the browser would carry into the callback. */
export async function beginFlow(origin: string = ORIGIN_A, cfg: AuthConfig = config) {
  const res = await start(startRequest(origin), cfg);
  const location = headerOf(res, "location") ?? "";
  const state = location ? new URL(location).searchParams.get("state") ?? "" : "";
  const cookie = res.cookies?.find((c) => c.name === STATE_COOKIE_NAME);
  return { res, state, cookieValue: cookie?.value ?? "" };
}

export function cookieHeader(value: string, extra = "") {
  return `${extra}${STATE_COOKIE_NAME}=${value}`;
}

export function headerOf(res: HttpResponseInit, name: string): string | null {
  return new Headers(res.headers as HeadersInit | undefined).get(name);
}

export function bodyText(res: HttpResponseInit): string {
  return typeof res.body === "string" ? res.body : "";
}

/** JSON body, whether the handler used jsonBody (preferred) or a JSON string body. */
export function jsonOf(res: HttpResponseInit): unknown {
  if (res.jsonBody !== undefined) return res.jsonBody;
  return JSON.parse(bodyText(res));
}

export function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

export function githubTokens(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "ghu_access123",
    expires_in: 28800,
    refresh_token: "ghr_refresh456",
    refresh_token_expires_in: 15811200,
    token_type: "bearer",
    scope: "",
    ...overrides,
  };
}

/** The GitHubTokenSet expected for githubTokens() at NOW. */
export const expectedTokenSet = {
  accessToken: "ghu_access123",
  expiresAt: new Date(NOW.getTime() + 28800 * 1000).toISOString(),
  refreshToken: "ghr_refresh456",
  refreshTokenExpiresAt: new Date(NOW.getTime() + 15811200 * 1000).toISOString(),
};

export function stubFetch(responder: Response | (() => Response | Promise<Response>)) {
  return vi.fn<FetchFn>(async () => (typeof responder === "function" ? responder() : responder.clone()));
}

/** What the handler sent to GitHub on call n: url, method, normalised headers and form/JSON params. */
export function sentToGitHub(fetchFn: ReturnType<typeof stubFetch>, n = 0) {
  const [url, init] = fetchFn.mock.calls[n];
  const raw = init?.body;
  const text = raw instanceof URLSearchParams ? raw.toString() : String(raw ?? "");
  const params = text.trim().startsWith("{")
    ? (JSON.parse(text) as Record<string, string>)
    : Object.fromEntries(new URLSearchParams(text));
  return { url: String(url), method: init?.method, headers: new Headers(init?.headers), params };
}

/**
 * Executes every inline <script> in the popup HTML in a sandbox that offers only window.opener.postMessage
 * and window.close, recording what is posted. This proves what a browser would do, including that
 * embedded values cannot break out of the script.
 */
export function runPopup(html: string) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)];
  const calls: { message: any; targetOrigin: unknown }[] = [];
  let closed = 0;
  const win = {
    opener: {
      postMessage: (message: unknown, targetOrigin: unknown) =>
        calls.push({ message: JSON.parse(JSON.stringify(message)), targetOrigin }),
    },
    close: () => {
      closed++;
    },
  };
  const el: any = new Proxy(function () {}, { get: () => el, set: () => true, apply: () => el });
  const sandbox = {
    window: win,
    document: { getElementById: () => el, querySelector: () => el, body: el, write() {} },
    setTimeout: (fn: () => void) => fn(),
  };
  const ctx = vm.createContext(sandbox);
  for (const s of scripts) vm.runInContext(s[1], ctx);
  return { scriptCount: scripts.length, calls, closed };
}

/** Capture every console channel so tests can assert nothing sensitive was logged. */
export function captureConsole() {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
  return { text: () => JSON.stringify(spies.flatMap((s) => s.mock.calls.map((c) => c.map(String)))) };
}

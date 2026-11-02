// GitHub App user-to-server token exchange. See shared/contract.ts for the flow.
// Never log or echo request errors: a failed fetch can carry the client secret in its message.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Cookie, HttpResponseInit } from "@azure/functions";
import { AUTH_MESSAGE_TYPE, type AuthMessage, type GitHubTokenSet } from "../../shared/contract";

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  /** Exact origins, e.g. "https://x.gallerycdn.vsassets.io" (no trailing slash). */
  allowedOrigins: string[];
  /** Key for signing and verifying the state value. */
  stateSecret: string;
  /** Public base URL of this function app, no trailing slash, e.g. "https://auth.example.com". */
  baseUrl: string;
}

/** Structurally satisfied by both the Functions HttpRequest and the web-standard Request. */
export interface HandlerRequest {
  url: string;
  method: string;
  headers: Headers;
  json(): Promise<unknown>;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const STATE_COOKIE = "tn_gh_state";
const COOKIE_PATH = "/api/auth/callback";
const STATE_TTL_MS = 10 * 60 * 1000;

/** Parses ALLOWED_ORIGINS. Null if any entry is not exactly an https origin (rejects *, null, paths, trailing slashes, http:). */
export function parseAllowedOrigins(value: string): string[] | null {
  const origins = value.split(",").map((o) => o.trim()).filter(Boolean);
  return origins.every((o) => URL.canParse(o) && new URL(o).protocol === "https:" && new URL(o).origin === o) ? origins : null;
}

// ---- state: base64url(JSON {o: origin, n: nonce, e: expiry ms}) + "." + base64url(HMAC-SHA256) ----

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function issueState(origin: string, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ o: origin, n: randomBytes(16).toString("base64url"), e: Date.now() + STATE_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the origin carried in a valid, unexpired state, or null. */
function verifyState(state: string, secret: string): string | null {
  const [payload, sig, ...rest] = state.split(".");
  if (!payload || !sig || rest.length || !safeEqual(sig, sign(payload, secret))) return null;
  try {
    const { o, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof o === "string" && typeof e === "number" && Date.now() < e ? o : null;
  } catch {
    return null;
  }
}

function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

const stateCookie = (value: string, maxAge: number): Cookie => ({
  name: STATE_COOKIE,
  value,
  path: COOKIE_PATH,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  maxAge,
});

// ---- GitHub token endpoint ----

async function exchange(params: Record<string, string>, config: AuthConfig, fetchFn: FetchFn): Promise<GitHubTokenSet | null> {
  try {
    const res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: config.clientId, client_secret: config.clientSecret }),
    });
    if (!res.ok) return null;
    const t = (await res.json()) as Record<string, unknown>;
    if (
      typeof t.access_token !== "string" || !t.access_token ||
      typeof t.refresh_token !== "string" || !t.refresh_token ||
      typeof t.expires_in !== "number" || typeof t.refresh_token_expires_in !== "number"
    ) return null; // includes GitHub's 200 { error } responses, and apps with token expiry turned off
    const now = Date.now();
    return {
      accessToken: t.access_token,
      expiresAt: new Date(now + t.expires_in * 1000).toISOString(),
      refreshToken: t.refresh_token,
      refreshTokenExpiresAt: new Date(now + t.refresh_token_expires_in * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

// ---- handlers ----

const text = (status: number, body: string, headers: Record<string, string> = {}): HttpResponseInit => ({
  status,
  body,
  headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers },
});

export async function start(request: HandlerRequest, config: AuthConfig): Promise<HttpResponseInit> {
  const origin = new URL(request.url).searchParams.get("origin");
  if (!origin || !config.allowedOrigins.includes(origin)) return text(400, "Origin not allowed.");

  const state = issueState(origin, config.stateSecret);
  const location = new URL(AUTHORIZE_URL);
  location.searchParams.set("client_id", config.clientId);
  location.searchParams.set("redirect_uri", `${config.baseUrl}/api/auth/callback`);
  location.searchParams.set("state", state);
  return {
    status: 302,
    headers: { location: location.toString(), "cache-control": "no-store" },
    cookies: [stateCookie(state, STATE_TTL_MS / 1000)],
  };
}

/** Embeds a value in an inline script as data: JSON, with "<" escaped so nothing can close the script. */
const js = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

function popup(message: AuthMessage, targetOrigin: string): HttpResponseInit {
  const script = `if(window.opener)window.opener.postMessage(${js(message)},${js(targetOrigin)});window.close();`;
  const hash = createHash("sha256").update(script).digest("base64");
  return {
    status: 200,
    body: `<!doctype html><meta charset="utf-8"><title>GitHub sign-in</title><p>You can close this window.</p><script>${script}</script>`,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; script-src 'sha256-${hash}'`,
    },
    cookies: [stateCookie("", 0)], // state is spent once verified
  };
}

export async function callback(request: HandlerRequest, config: AuthConfig, fetchFn: FetchFn): Promise<HttpResponseInit> {
  const query = new URL(request.url).searchParams;
  const state = query.get("state") ?? "";
  const code = query.get("code");
  const cookie = readCookie(request.headers.get("cookie"), STATE_COOKIE);
  const error = query.get("error"); // GitHub sends ?error=access_denied when the user cancels
  const origin = verifyState(state, config.stateSecret);
  if (!origin || !config.allowedOrigins.includes(origin) || !cookie || !safeEqual(cookie, state) || (!code && !error)) {
    return text(400, "Invalid or expired sign-in request.");
  }
  if (!code) return popup({ type: AUTH_MESSAGE_TYPE, ok: false, error: "GitHub sign-in was cancelled." }, origin);

  const tokens = await exchange({ code }, config, fetchFn);
  return popup(
    tokens
      ? { type: AUTH_MESSAGE_TYPE, ok: true, tokens }
      : { type: AUTH_MESSAGE_TYPE, ok: false, error: "GitHub sign-in failed." },
    origin,
  );
}

export async function refresh(request: HandlerRequest, config: AuthConfig, fetchFn: FetchFn): Promise<HttpResponseInit> {
  const origin = request.headers.get("origin");
  const allowed = !!origin && config.allowedOrigins.includes(origin);
  const headers: Record<string, string> = { vary: "Origin", "cache-control": "no-store" };
  if (allowed) headers["access-control-allow-origin"] = origin;

  if (request.method.toUpperCase() === "OPTIONS") {
    if (allowed) {
      headers["access-control-allow-methods"] = "POST";
      headers["access-control-allow-headers"] = "Content-Type";
      headers["access-control-max-age"] = "600";
    }
    return { status: 204, headers };
  }

  const unauthorised: HttpResponseInit = { status: 401, jsonBody: { error: "Refresh failed." }, headers };
  let refreshToken: unknown;
  try {
    refreshToken = ((await request.json()) as { refreshToken?: unknown } | null)?.refreshToken;
  } catch {
    return unauthorised;
  }
  if (typeof refreshToken !== "string" || !refreshToken) return unauthorised;

  const tokens = await exchange({ grant_type: "refresh_token", refresh_token: refreshToken }, config, fetchFn);
  return tokens ? { status: 200, jsonBody: tokens, headers } : unauthorised;
}

// Contract step 1: GET /api/auth/start?origin=... (production code: start() in auth/src/handlers.ts)
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { start } from "../src/handlers";
import {
  ORIGIN_A, ORIGIN_B, STATE_COOKIE_NAME, beginFlow, config, freezeClock, headerOf, restoreClock, startRequest,
} from "./helpers";

beforeEach(freezeClock);
afterEach(restoreClock);

describe("REQ start: origin in ALLOWED_ORIGINS redirects to GitHub authorize", () => {
  // Given an allow-listed origin, start() returns 302 to the GitHub authorize URL carrying
  // client_id, redirect_uri ({baseUrl}/api/auth/callback) and a non-empty state.
  it.each([ORIGIN_A, ORIGIN_B])("responds 302 to github.com/login/oauth/authorize for allowed origin %s", async (origin) => {
    const res = await start(startRequest(origin), config);
    expect(res.status, "Expected 302 redirect for an allow-listed origin").toBe(302);
    const location = headerOf(res, "location");
    expect(location, "Expected a Location header pointing at GitHub").toBeTruthy();
    const url = new URL(location!);
    expect(`${url.origin}${url.pathname}`, "Expected redirect to the GitHub authorize endpoint").toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(url.searchParams.get("client_id"), "Expected configured client_id in the authorize URL").toBe(config.clientId);
    expect(url.searchParams.get("redirect_uri"), "Expected redirect_uri to be {baseUrl}/api/auth/callback").toBe(
      `${config.baseUrl}/api/auth/callback`,
    );
    expect(url.searchParams.get("state"), "Expected a non-empty state value").toBeTruthy();
  });

  // The state is bound to the browser by a cookie named tn_gh_state whose value is the state itself.
  it("sets an HttpOnly, Secure, SameSite=Lax state cookie", async () => {
    const res = await start(startRequest(ORIGIN_A), config);
    const cookie = res.cookies?.find((c) => c.name === STATE_COOKIE_NAME);
    expect(cookie, `Expected a cookie named ${STATE_COOKIE_NAME} in res.cookies`).toBeDefined();
    expect(cookie!.httpOnly, "Expected HttpOnly on the state cookie").toBe(true);
    expect(cookie!.secure, "Expected Secure on the state cookie").toBe(true);
    expect(cookie!.sameSite, "Expected SameSite=Lax on the state cookie").toBe("Lax");
  });

  it("sets a state cookie whose value equals the state in the authorize URL", async () => {
    const { state, cookieValue } = await beginFlow(ORIGIN_A);
    expect(state, "Expected a state in the authorize URL").not.toBe("");
    expect(cookieValue, "Expected the cookie value to equal the state so the callback can bind them").toBe(state);
  });

  // The cookie must be sent back to /api/auth/callback, so its path (if set) must cover it.
  it("scopes the state cookie so the browser sends it to /api/auth/callback", async () => {
    const res = await start(startRequest(ORIGIN_A), config);
    const cookie = res.cookies?.find((c) => c.name === STATE_COOKIE_NAME);
    expect(cookie, `Expected a cookie named ${STATE_COOKIE_NAME}`).toBeDefined();
    expect(
      cookie!.path === undefined || "/api/auth/callback".startsWith(cookie!.path),
      `Expected cookie path to be unset or a prefix of /api/auth/callback, got ${cookie!.path}`,
    ).toBe(true);
  });

  it("issues a different state on each call so a state cannot be replayed across flows", async () => {
    const first = await beginFlow(ORIGIN_A);
    const second = await beginFlow(ORIGIN_A);
    expect(first.state, "Expected a state").not.toBe("");
    expect(second.state, "Expected two start calls to produce different state values").not.toBe(first.state);
  });
});

describe("REQ start: origin must be in ALLOWED_ORIGINS, else 400 with no redirect", () => {
  // Each case: start() returns 400, no Location header, no cookie.
  const rejected: [string, string | undefined][] = [
    ["missing origin", undefined],
    ["empty origin", ""],
    ["origin not on the list", "https://attacker.example"],
    ["subdomain suffix near-miss", `${ORIGIN_A}.attacker.com`],
    ["allowed origin with a trailing slash", `${ORIGIN_A}/`],
    ["allowed origin over http instead of https", ORIGIN_A.replace("https://", "http://")],
    ["allowed origin with a path", `${ORIGIN_A}/path`],
  ];
  it.each(rejected)("rejects %s with 400, no redirect and no cookie", async (_name, origin) => {
    const res = await start(startRequest(origin), config);
    expect(res.status, "Expected 400 for a disallowed origin").toBe(400);
    expect(headerOf(res, "location"), "Expected no redirect for a disallowed origin").toBeNull();
    expect(res.cookies ?? [], "Expected no cookie for a disallowed origin").toHaveLength(0);
    expect(headerOf(res, "set-cookie"), "Expected no Set-Cookie header for a disallowed origin").toBeNull();
  });
});

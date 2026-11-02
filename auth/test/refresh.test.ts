// Contract step 3: POST /api/auth/refresh (production code: refresh() in auth/src/handlers.ts)
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refresh } from "../src/handlers";
import {
  GITHUB_TOKEN_URL, ORIGIN_A, config, expectedTokenSet, freezeClock, githubTokens, headerOf, jsonOf, jsonResponse,
  refreshRequest, restoreClock, sentToGitHub, stubFetch,
} from "./helpers";

beforeEach(freezeClock);
afterEach(restoreClock);

const body = (refreshToken: unknown) => JSON.stringify({ refreshToken });

describe("REQ refresh: a valid refreshToken is exchanged at GitHub", () => {
  // Given { refreshToken }, refresh() POSTs grant_type=refresh_token with the client credentials to GitHub.
  it("calls GitHub with grant_type=refresh_token, the client credentials and the token", async () => {
    const fetchFn = stubFetch(jsonResponse(githubTokens()));
    await refresh(refreshRequest({ body: body("ghr_old"), origin: ORIGIN_A }), config, fetchFn);
    expect(fetchFn, "Expected exactly one call to GitHub").toHaveBeenCalledTimes(1);
    const sent = sentToGitHub(fetchFn);
    expect(sent.url, "Expected the GitHub access_token endpoint").toBe(GITHUB_TOKEN_URL);
    expect(sent.method, "Expected a POST to GitHub").toBe("POST");
    expect(sent.headers.get("accept"), "Expected Accept: application/json").toBe("application/json");
    expect(sent.params.grant_type, "Expected grant_type=refresh_token").toBe("refresh_token");
    expect(sent.params.refresh_token, "Expected the supplied refresh token").toBe("ghr_old");
    expect(sent.params.client_id, "Expected configured client_id").toBe(config.clientId);
    expect(sent.params.client_secret, "Expected configured client_secret").toBe(config.clientSecret);
  });

  it("returns 200 with a GitHubTokenSet mapped from GitHub's response", async () => {
    const res = await refresh(
      refreshRequest({ body: body("ghr_old"), origin: ORIGIN_A }),
      config,
      stubFetch(jsonResponse(githubTokens())),
    );
    expect(res.status, "Expected 200 for a successful refresh").toBe(200);
    expect(jsonOf(res), "Expected a GitHubTokenSet with seconds converted to ISO timestamps").toEqual(expectedTokenSet);
  });
});

describe("REQ refresh: a missing or invalid refreshToken, or a GitHub error, gives 401 with an AuthError", () => {
  async function expectUnauthorised(res: Awaited<ReturnType<typeof refresh>>, why: string) {
    expect(res.status, `Expected 401 for ${why}`).toBe(401);
    const json = jsonOf(res) as { error?: unknown };
    expect(typeof json.error, `Expected an AuthError { error: string } for ${why}`).toBe("string");
    expect(json.error, `Expected a non-empty AuthError.error for ${why}`).not.toBe("");
    expect(json, `Expected no tokens in the response for ${why}`).not.toHaveProperty("accessToken");
  }

  // Input problems: 401 and GitHub is never called.
  const bad: [string, string | undefined][] = [
    ["a missing body", undefined],
    ["an empty body", ""],
    ["an empty object", "{}"],
    ["an empty refreshToken", body("")],
    ["a non-string refreshToken", body(12345)],
    ["malformed JSON", "{not json"],
  ];
  it.each(bad)("rejects %s with 401 and does not call GitHub", async (_name, raw) => {
    const fetchFn = stubFetch(jsonResponse(githubTokens()));
    const res = await refresh(refreshRequest({ body: raw, origin: ORIGIN_A }), config, fetchFn);
    await expectUnauthorised(res, "an unusable refresh request");
    expect(fetchFn, "Expected GitHub not to be called without a usable refreshToken").not.toHaveBeenCalled();
  });

  it("returns 401 when GitHub answers { error: 'bad_refresh_token' }", async () => {
    const res = await refresh(
      refreshRequest({ body: body("ghr_old"), origin: ORIGIN_A }),
      config,
      stubFetch(jsonResponse({ error: "bad_refresh_token" })),
    );
    await expectUnauthorised(res, "a GitHub error body");
  });

  it("returns 401 when GitHub returns a non-2xx status", async () => {
    const res = await refresh(
      refreshRequest({ body: body("ghr_old"), origin: ORIGIN_A }),
      config,
      stubFetch(new Response("nope", { status: 500 })),
    );
    await expectUnauthorised(res, "a GitHub non-2xx");
  });

  it("returns 401 when the request to GitHub fails outright", async () => {
    const res = await refresh(
      refreshRequest({ body: body("ghr_old"), origin: ORIGIN_A }),
      config,
      stubFetch(() => {
        throw new TypeError("fetch failed");
      }),
    );
    await expectUnauthorised(res, "a network failure");
  });
});

describe("REQ refresh: CORS headers are present only for allowed origins", () => {
  const ok = () => stubFetch(jsonResponse(githubTokens()));

  it("allows an allow-listed origin on a successful refresh", async () => {
    const res = await refresh(refreshRequest({ body: body("t"), origin: ORIGIN_A }), config, ok());
    expect(headerOf(res, "access-control-allow-origin"), "Expected ACAO to echo the allowed origin exactly").toBe(ORIGIN_A);
  });

  it("allows an allow-listed origin on a failed refresh too, so the extension can read the 401", async () => {
    const res = await refresh(refreshRequest({ body: "", origin: ORIGIN_A }), config, ok());
    expect(res.status, "Test setup: expected 401").toBe(401);
    expect(headerOf(res, "access-control-allow-origin"), "Expected ACAO on the 401 for an allowed origin").toBe(ORIGIN_A);
  });

  it.each([
    ["an origin not on the list", "https://attacker.example"],
    ["a near-miss origin", `${ORIGIN_A}.attacker.com`],
    ["an allowed origin with a trailing slash", `${ORIGIN_A}/`],
    ["no Origin header", undefined],
  ])("sends no Access-Control-Allow-Origin for %s", async (_name, origin) => {
    const res = await refresh(refreshRequest({ body: body("t"), origin }), config, ok());
    expect(headerOf(res, "access-control-allow-origin"), "Expected no ACAO header, and never '*'").toBeNull();
  });

  // The JSON content type forces a browser preflight, so refresh() answers OPTIONS for allowed origins.
  it("answers a preflight from an allowed origin with 204 and the allowed method and headers", async () => {
    const fetchFn = ok();
    const res = await refresh(refreshRequest({ method: "OPTIONS", origin: ORIGIN_A }), config, fetchFn);
    expect(res.status, "Expected 204 for an allowed preflight").toBe(204);
    expect(headerOf(res, "access-control-allow-origin"), "Expected ACAO to echo the allowed origin").toBe(ORIGIN_A);
    expect(headerOf(res, "access-control-allow-methods") ?? "", "Expected POST to be allowed").toMatch(/POST/i);
    expect(headerOf(res, "access-control-allow-headers") ?? "", "Expected Content-Type to be allowed").toMatch(/content-type/i);
    expect(fetchFn, "Expected a preflight not to call GitHub").not.toHaveBeenCalled();
  });

  it("answers a preflight from a disallowed origin without CORS headers", async () => {
    const res = await refresh(refreshRequest({ method: "OPTIONS", origin: "https://attacker.example" }), config, ok());
    expect(headerOf(res, "access-control-allow-origin"), "Expected no ACAO for a disallowed preflight").toBeNull();
    expect(headerOf(res, "access-control-allow-methods"), "Expected no allow-methods for a disallowed preflight").toBeNull();
  });
});

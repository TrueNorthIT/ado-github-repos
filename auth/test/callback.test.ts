// Contract step 2: GET /api/auth/callback?code&state (production code: callback() in auth/src/handlers.ts)
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callback } from "../src/handlers";
import {
  GITHUB_TOKEN_URL, ORIGIN_A, ORIGIN_B, advanceClock, beginFlow, bodyText, callbackRequest, config, cookieHeader,
  expectedTokenSet, freezeClock, githubTokens, headerOf, jsonResponse, restoreClock, runPopup, sentToGitHub, stubFetch,
} from "./helpers";

beforeEach(freezeClock);
afterEach(restoreClock);

/** A fresh, valid flow: start() for `origin`, then the callback request the browser would make. */
async function validCallback(origin: string = ORIGIN_A, code = "the-code") {
  const { state, cookieValue } = await beginFlow(origin);
  return { state, request: callbackRequest({ state, code, cookie: cookieHeader(cookieValue) }) };
}

describe("REQ callback: valid state and matching cookie exchanges the code at GitHub", () => {
  // Given a valid state and cookie, callback() POSTs client_id, client_secret and code to
  // https://github.com/login/oauth/access_token with Accept: application/json.
  it("sends client_id, client_secret and code to the GitHub access_token endpoint", async () => {
    const fetchFn = stubFetch(jsonResponse(githubTokens()));
    const { request } = await validCallback(ORIGIN_A, "code-from-github");
    await callback(request, config, fetchFn);
    expect(fetchFn, "Expected exactly one call to GitHub").toHaveBeenCalledTimes(1);
    const sent = sentToGitHub(fetchFn);
    expect(sent.url, "Expected the GitHub access_token endpoint").toBe(GITHUB_TOKEN_URL);
    expect(sent.method, "Expected a POST to GitHub").toBe("POST");
    expect(sent.headers.get("accept"), "Expected Accept: application/json so GitHub replies in JSON").toBe("application/json");
    expect(sent.params.client_id, "Expected configured client_id").toBe(config.clientId);
    expect(sent.params.client_secret, "Expected configured client_secret").toBe(config.clientSecret);
    expect(sent.params.code, "Expected the code from the callback query").toBe("code-from-github");
  });

  it("returns 200 HTML", async () => {
    const { request } = await validCallback();
    const res = await callback(request, config, stubFetch(jsonResponse(githubTokens())));
    expect(res.status, "Expected 200 after a successful exchange").toBe(200);
    expect(headerOf(res, "content-type") ?? "", "Expected an HTML page for the popup").toMatch(/text\/html/i);
  });

  // GitHub returns expires_in and refresh_token_expires_in in seconds; AuthMessage needs ISO 8601 timestamps.
  it("posts an ok:true AuthMessage with GitHub's tokens mapped to a GitHubTokenSet", async () => {
    const { request } = await validCallback();
    const res = await callback(request, config, stubFetch(jsonResponse(githubTokens())));
    const popup = runPopup(bodyText(res));
    expect(popup.calls, "Expected exactly one postMessage to the opener").toHaveLength(1);
    expect(popup.calls[0].message, "Expected AuthMessage { type, ok: true, tokens } with seconds converted to ISO timestamps").toEqual({
      type: "tn-gh-auth",
      ok: true,
      tokens: expectedTokenSet,
    });
  });

  it("closes the popup after posting the message", async () => {
    const { request } = await validCallback();
    const res = await callback(request, config, stubFetch(jsonResponse(githubTokens())));
    expect(runPopup(bodyText(res)).closed, "Expected window.close() to be called").toBeGreaterThan(0);
  });

  // The target origin is the one carried in the signed state, never "*" and never another allowed origin.
  it.each([ORIGIN_A, ORIGIN_B])("posts to exactly the origin carried in the state (%s)", async (origin) => {
    const { request } = await validCallback(origin);
    const res = await callback(request, config, stubFetch(jsonResponse(githubTokens())));
    const popup = runPopup(bodyText(res));
    expect(popup.calls, "Expected one postMessage").toHaveLength(1);
    expect(popup.calls[0].targetOrigin, `Expected targetOrigin to be exactly ${origin}, never "*"`).toBe(origin);
  });

  it("accepts the state cookie when the browser sends other cookies alongside it", async () => {
    const { state, cookieValue } = await beginFlow(ORIGIN_A);
    const cookie = `${cookieHeader(cookieValue, "a=1; ")}; z=9`;
    const res = await callback(callbackRequest({ state, code: "c", cookie }), config, stubFetch(jsonResponse(githubTokens())));
    expect(res.status, "Expected the state cookie to be found among other cookies").toBe(200);
    expect(runPopup(bodyText(res)).calls[0]?.message.ok, "Expected ok:true").toBe(true);
  });

  it("accepts a state shortly after it was issued", async () => {
    const { request } = await validCallback();
    advanceClock(60 * 1000);
    const res = await callback(request, config, stubFetch(jsonResponse(githubTokens())));
    expect(res.status, "Expected a one-minute-old state to still be valid").toBe(200);
  });
});

describe("REQ callback: missing, invalid or expired state gives 400 and posts nothing", () => {
  // Each case: 400, no postMessage in the body, GitHub never called.
  async function expectRejected(request: Request, why: string, cfg = config) {
    const fetchFn = stubFetch(jsonResponse(githubTokens()));
    const res = await callback(request, cfg, fetchFn);
    expect(res.status, `Expected 400 for ${why}`).toBe(400);
    expect(bodyText(res), `Expected nothing posted to the opener for ${why}`).not.toMatch(/postMessage/);
    expect(fetchFn, `Expected GitHub not to be called for ${why}`).not.toHaveBeenCalled();
  }

  it("rejects a missing state", async () => {
    const { cookieValue } = await beginFlow();
    await expectRejected(callbackRequest({ code: "c", cookie: cookieHeader(cookieValue) }), "a missing state");
  });

  it("rejects a callback with no state cookie", async () => {
    const { state } = await beginFlow();
    await expectRejected(callbackRequest({ state, code: "c" }), "a missing state cookie");
  });

  // Tampering: the cookie is set to the tampered value too, so only signature verification can reject it.
  const tamper: [string, (s: string) => string][] = [
    ["first character changed", (s) => (s[0] === "A" ? "B" : "A") + s.slice(1)],
    ["extra characters appended", (s) => `${s}AAAA`],
    ["tail removed", (s) => s.slice(0, -6)],
  ];
  it.each(tamper)("rejects a tampered state (%s)", async (_name, mutate) => {
    const { state } = await beginFlow();
    const bad = mutate(state);
    expect(bad, "Test setup: tampered state must differ").not.toBe(state);
    await expectRejected(callbackRequest({ state: bad, code: "c", cookie: cookieHeader(bad) }), "a tampered state");
  });

  it("rejects a state signed with a different STATE_SECRET", async () => {
    const { state, cookieValue } = await beginFlow(ORIGIN_A, { ...config, stateSecret: "some-other-signing-secret" });
    await expectRejected(
      callbackRequest({ state, code: "c", cookie: cookieHeader(cookieValue) }),
      "a state signed with another secret",
    );
  });

  // The state's lifetime is at most 10 minutes (decision recorded in the handover; contract says only "expired").
  it("rejects an expired state", async () => {
    const { request } = await validCallback();
    advanceClock(11 * 60 * 1000);
    await expectRejected(request, "a state older than 10 minutes");
  });

  // Login-CSRF defence: a genuine state from another browser session must not match this browser's cookie.
  it("rejects a valid state that does not match the cookie", async () => {
    const mine = await beginFlow(ORIGIN_A);
    const theirs = await beginFlow(ORIGIN_A);
    expect(theirs.state, "Test setup: the two states must differ").not.toBe(mine.state);
    await expectRejected(
      callbackRequest({ state: theirs.state, code: "c", cookie: cookieHeader(mine.cookieValue) }),
      "a state that does not match the cookie",
    );
  });

  it("rejects a missing code", async () => {
    const { state, cookieValue } = await beginFlow();
    await expectRejected(callbackRequest({ state, cookie: cookieHeader(cookieValue) }), "a missing code");
  });

  // The allow-list may shrink between start and callback: a validly signed state for a removed origin is rejected.
  it("rejects a valid state whose origin is no longer in ALLOWED_ORIGINS", async () => {
    const { request } = await validCallback(ORIGIN_A);
    await expectRejected(request, "an origin removed from the allow-list", { ...config, allowedOrigins: [ORIGIN_B] });
  });

  it("rejects a removed origin even when GitHub reports an error", async () => {
    const { state, cookieValue } = await beginFlow(ORIGIN_A);
    await expectRejected(
      callbackRequest({ state, error: "access_denied", cookie: cookieHeader(cookieValue) }),
      "an error callback for an origin removed from the allow-list",
      { ...config, allowedOrigins: [ORIGIN_B] },
    );
  });

  // An ?error from GitHub never bypasses state and cookie checks.
  it("rejects an error callback with a tampered state", async () => {
    const { state } = await beginFlow();
    const bad = `${state}AAAA`;
    await expectRejected(callbackRequest({ state: bad, error: "access_denied", cookie: cookieHeader(bad) }), "a tampered state with ?error");
  });

  it("rejects an error callback with no state cookie", async () => {
    const { state } = await beginFlow();
    await expectRejected(callbackRequest({ state, error: "access_denied" }), "?error with no state cookie");
  });

  it("rejects an error callback with an expired state", async () => {
    const { state, cookieValue } = await beginFlow();
    advanceClock(11 * 60 * 1000);
    await expectRejected(callbackRequest({ state, error: "access_denied", cookie: cookieHeader(cookieValue) }), "?error with an expired state");
  });
});

describe("REQ callback: cancelling at GitHub posts { ok: false } to the state origin", () => {
  it.each([ORIGIN_A, ORIGIN_B])("posts the cancel message to %s, expires the cookie and does not call GitHub", async (origin) => {
    const { state, cookieValue } = await beginFlow(origin);
    const fetchFn = stubFetch(jsonResponse(githubTokens()));
    const res = await callback(callbackRequest({ state, error: "access_denied", cookie: cookieHeader(cookieValue) }), config, fetchFn);
    expect(res.status, "Expected 200 popup HTML for a cancelled sign-in").toBe(200);
    expect(headerOf(res, "content-type") ?? "", "Expected an HTML page").toMatch(/text\/html/i);
    const popup = runPopup(bodyText(res));
    expect(popup.calls, "Expected exactly one postMessage").toHaveLength(1);
    expect(popup.calls[0].targetOrigin, "Expected the state origin").toBe(origin);
    expect(popup.calls[0].message, "Expected the cancel AuthMessage").toEqual({
      type: "tn-gh-auth",
      ok: false,
      error: "GitHub sign-in was cancelled.",
    });
    expect(popup.closed, "Expected the popup to close").toBeGreaterThan(0);
    expect(res.cookies?.find((c) => c.name === "tn_gh_state")?.maxAge, "Expected the state cookie to be expired").toBe(0);
    expect(fetchFn, "Expected GitHub not to be called").not.toHaveBeenCalled();
  });
});

describe("REQ callback: a failed exchange posts { ok: false } to the state origin rather than hanging", () => {
  async function failedExchange(fetchFn: ReturnType<typeof stubFetch>, origin: string = ORIGIN_A) {
    const { request } = await validCallback(origin);
    const res = await callback(request, config, fetchFn);
    return { res, popup: runPopup(bodyText(res)) };
  }

  function expectOkFalse(popup: ReturnType<typeof runPopup>, origin: string = ORIGIN_A) {
    expect(popup.calls, "Expected exactly one postMessage so the popup does not hang").toHaveLength(1);
    expect(popup.calls[0].targetOrigin, "Expected the failure to be posted to the state origin only").toBe(origin);
    expect(popup.calls[0].message.type, "Expected AuthMessage type tn-gh-auth").toBe("tn-gh-auth");
    expect(popup.calls[0].message.ok, "Expected ok:false").toBe(false);
    expect(typeof popup.calls[0].message.error, "Expected a string error").toBe("string");
    expect(popup.calls[0].message.error, "Expected a non-empty error").not.toBe("");
    expect(popup.calls[0].message.tokens, "Expected no tokens on a failure").toBeUndefined();
    expect(popup.closed, "Expected the popup to close").toBeGreaterThan(0);
  }

  it("posts ok:false when GitHub returns { error: 'bad_verification_code' }", async () => {
    const { res, popup } = await failedExchange(stubFetch(jsonResponse({ error: "bad_verification_code" })));
    expect(headerOf(res, "content-type") ?? "", "Expected an HTML page").toMatch(/text\/html/i);
    expectOkFalse(popup);
  });

  it("posts ok:false when GitHub returns a non-2xx status", async () => {
    const { popup } = await failedExchange(stubFetch(new Response("upstream exploded", { status: 502 })));
    expectOkFalse(popup);
  });

  it("posts ok:false when GitHub returns 2xx without an access_token", async () => {
    const { popup } = await failedExchange(stubFetch(jsonResponse({ token_type: "bearer" })));
    expectOkFalse(popup);
  });

  it("posts ok:false when the request to GitHub fails outright", async () => {
    const { popup } = await failedExchange(
      stubFetch(() => {
        throw new TypeError("fetch failed");
      }),
    );
    expectOkFalse(popup);
  });

  it("posts the failure to the state origin of the second allowed origin too", async () => {
    const { popup } = await failedExchange(stubFetch(jsonResponse({ error: "bad_verification_code" })), ORIGIN_B);
    expectOkFalse(popup, ORIGIN_B);
  });
});

describe("REQ callback: values embedded in the HTML cannot break out of the script", () => {
  const hostile = `https://x.example"</script><script>window.pwned=1</script></SCRIPT><!--'\\`;

  // Origin containing </script> and quotes (placed on the allow-list so it reaches the state):
  // the executed script must still post exactly once, to exactly that string.
  it("embeds an origin containing </script> and quotes as data, not markup", async () => {
    const cfg = { ...config, allowedOrigins: [hostile] };
    const { state, cookieValue } = await beginFlow(hostile, cfg);
    expect(state, "Test setup: start() must accept an allow-listed origin even if unusual").not.toBe("");
    const res = await callback(
      callbackRequest({ state, code: "c", cookie: cookieHeader(cookieValue) }),
      cfg,
      stubFetch(jsonResponse(githubTokens())),
    );
    const html = bodyText(res);
    const popup = runPopup(html);
    expect(popup.scriptCount, "Expected a single script block; the origin broke out of it").toBe(1);
    expect(html, "Expected the injected script not to appear as markup").not.toContain("window.pwned=1</script>");
    expect(popup.calls, "Expected exactly one postMessage").toHaveLength(1);
    expect(popup.calls[0].targetOrigin, "Expected targetOrigin to be the hostile origin string verbatim").toBe(hostile);
  });

  it("embeds a GitHub error string containing </script> and quotes as data, not markup", async () => {
    const evil = `</script><script>window.pwned=1</script></SCRIPT>"'<!--`;
    const { request } = await validCallback();
    const res = await callback(
      request,
      config,
      stubFetch(jsonResponse({ error: evil, error_description: evil })),
    );
    const html = bodyText(res);
    const popup = runPopup(html);
    expect(popup.scriptCount, "Expected a single script block; the error text broke out of it").toBe(1);
    expect(html, "Expected the injected script not to appear as markup").not.toContain("window.pwned=1</script>");
    expect(popup.calls, "Expected exactly one postMessage").toHaveLength(1);
    expect(popup.calls[0].message.ok, "Expected ok:false").toBe(false);
    expect(popup.calls[0].targetOrigin, "Expected the legitimate origin").toBe(ORIGIN_A);
  });

  it("embeds token values containing </script> as data, not markup", async () => {
    const { request } = await validCallback();
    const evil = `tok</script><script>window.pwned=1</script>"'`;
    const res = await callback(request, config, stubFetch(jsonResponse(githubTokens({ access_token: evil }))));
    const popup = runPopup(bodyText(res));
    expect(popup.scriptCount, "Expected a single script block; the token broke out of it").toBe(1);
    expect(popup.calls[0]?.message.tokens.accessToken, "Expected the token to arrive verbatim").toBe(evil);
  });
});

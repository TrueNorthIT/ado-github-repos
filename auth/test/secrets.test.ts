// Cross-cutting requirement: "No response or log message ever contains the client secret."
// Production code: start(), callback(), refresh() in auth/src/handlers.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callback, refresh, start } from "../src/handlers";
import {
  CLIENT_SECRET, ORIGIN_A, beginFlow, callbackRequest, captureConsole, config, cookieHeader, freezeClock, githubTokens,
  jsonResponse, refreshRequest, restoreClock, startRequest, stubFetch,
} from "./helpers";

beforeEach(freezeClock);
afterEach(restoreClock);

// A network error whose message echoes the request (some HTTP clients do this): the secret is in the
// error object, so handlers must not copy error messages into responses or logs.
const leakyFailure = () =>
  stubFetch(() => {
    throw new Error(`request failed: client_secret=${CLIENT_SECRET}`);
  });

const everything = (res: unknown, logs: { text(): string }) => JSON.stringify(res) + logs.text();

describe("REQ no response or log message ever contains the client secret", () => {
  it("start: a successful redirect does not expose the client secret", async () => {
    const logs = captureConsole();
    const res = await start(startRequest(ORIGIN_A), config);
    expect(everything(res, logs), "Expected the client secret to be absent from the start response and logs").not.toContain(CLIENT_SECRET);
  });

  it("start: a rejected origin does not expose the client secret", async () => {
    const logs = captureConsole();
    const res = await start(startRequest("https://attacker.example"), config);
    expect(everything(res, logs), "Expected the client secret to be absent from the 400 response and logs").not.toContain(CLIENT_SECRET);
  });

  it("callback: a successful exchange does not expose the client secret", async () => {
    const logs = captureConsole();
    const { state, cookieValue } = await beginFlow();
    const res = await callback(
      callbackRequest({ state, code: "c", cookie: cookieHeader(cookieValue) }),
      config,
      stubFetch(jsonResponse(githubTokens())),
    );
    expect(everything(res, logs), "Expected the client secret to be absent from the callback response and logs").not.toContain(CLIENT_SECRET);
  });

  it("callback: a rejected state does not expose the client secret", async () => {
    const logs = captureConsole();
    const res = await callback(callbackRequest({ state: "bogus", code: "c", cookie: cookieHeader("bogus") }), config, leakyFailure());
    expect(everything(res, logs), "Expected the client secret to be absent from the 400 response and logs").not.toContain(CLIENT_SECRET);
  });

  it("callback: a failed request to GitHub does not leak the secret from the error message", async () => {
    const logs = captureConsole();
    const { state, cookieValue } = await beginFlow();
    const res = await callback(callbackRequest({ state, code: "c", cookie: cookieHeader(cookieValue) }), config, leakyFailure());
    expect(everything(res, logs), "Expected the client secret to be absent from the failure page and logs").not.toContain(CLIENT_SECRET);
  });

  it("refresh: a successful refresh does not expose the client secret", async () => {
    const logs = captureConsole();
    const res = await refresh(
      refreshRequest({ body: JSON.stringify({ refreshToken: "t" }), origin: ORIGIN_A }),
      config,
      stubFetch(jsonResponse(githubTokens())),
    );
    expect(everything(res, logs), "Expected the client secret to be absent from the refresh response and logs").not.toContain(CLIENT_SECRET);
  });

  it("refresh: a failed request to GitHub does not leak the secret from the error message", async () => {
    const logs = captureConsole();
    const res = await refresh(
      refreshRequest({ body: JSON.stringify({ refreshToken: "t" }), origin: ORIGIN_A }),
      config,
      leakyFailure(),
    );
    expect(everything(res, logs), "Expected the client secret to be absent from the 401 response and logs").not.toContain(CLIENT_SECRET);
  });
});

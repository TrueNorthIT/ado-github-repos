// Live finding (0.32.0): GitHub refresh tokens are single use, so a page reloaded mid-refresh lost the rotated set and
// the next page, refreshing with the spent token, was signed out. refresh() now hands back the same set for a repeat of
// the same refresh token for REPLAY_TTL_MS, held in memory, encrypted with a key derived from that token.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPLAY_TTL_MS, clearReplays, refresh } from "../src/handlers";
import { ORIGIN_A, advanceClock, config, expectedTokenSet, freezeClock, githubTokens, jsonOf, jsonResponse, refreshRequest, restoreClock, stubFetch } from "./helpers";

beforeEach(() => { freezeClock(); clearReplays(); });
afterEach(restoreClock);

const ask = (token: string, fetchFn: ReturnType<typeof stubFetch>) =>
  refresh(refreshRequest({ body: JSON.stringify({ refreshToken: token }), origin: ORIGIN_A }), config, fetchFn);

describe("refresh replay", () => {
  it("answers a repeat of the same refresh token with the same tokens, without asking GitHub again", async () => {
    const fetchFn = stubFetch(jsonResponse(githubTokens()));
    const first = await ask("ghr_old", fetchFn);
    const second = await ask("ghr_old", fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(200);
    expect(jsonOf(second)).toEqual(jsonOf(first));
    expect(jsonOf(second)).toEqual(expectedTokenSet);
  });

  it("forgets the result after REPLAY_TTL_MS", async () => {
    const fetchFn = stubFetch(jsonResponse(githubTokens()));
    await ask("ghr_old", fetchFn);
    advanceClock(REPLAY_TTL_MS);
    await ask("ghr_old", fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("never replays for a different refresh token", async () => {
    const fetchFn = stubFetch(jsonResponse(githubTokens()));
    await ask("ghr_old", fetchFn);
    await ask("ghr_other", fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not remember failures", async () => {
    const fetchFn = stubFetch(() => jsonResponse({ error: "bad_refresh_token" }));
    expect((await ask("ghr_old", fetchFn)).status).toBe(401);
    expect((await ask("ghr_old", fetchFn)).status).toBe(401);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

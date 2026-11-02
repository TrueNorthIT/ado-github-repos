import { describe, it, expect } from "vitest";
import { nextPollDelay } from "./pollPlan";

const d = (elapsedMs: number, over: Partial<{ state: string; mergeStateStatus: string }> = {}) => nextPollDelay({ state: "OPEN", mergeStateStatus: "UNKNOWN", elapsedMs, ...over });

describe("nextPollDelay", () => {
  it("polls every 3 s at first", () => expect([d(0), d(3000), d(29_999)]).toEqual([3000, 3000, 3000]));
  it("backs off to 10 s after 30 s", () => expect([d(30_000), d(60_000), d(119_999)]).toEqual([10_000, 10_000, 10_000]));
  it("gives up after 2 minutes", () => expect(d(120_000)).toBeNull());
  it.each(["CLEAN", "DIRTY", "BLOCKED", "BEHIND", "UNSTABLE", "HAS_HOOKS"])("stops once the status is known (%s)", (s) => expect(d(0, { mergeStateStatus: s })).toBeNull());
  it.each(["CLOSED", "MERGED"])("does not poll a %s pull request", (state) => expect(d(0, { state })).toBeNull());
});

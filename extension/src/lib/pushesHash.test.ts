import { describe, expect, it } from "vitest";
import { applyPushFilters, noPushesText, parsePushFilters, PUSH_PERIODS } from "./pushesHash";
import { pushesPath } from "./pushes";

describe("push filters in the hash", () => {
  it("round-trips pushedBy and pushPeriod, keeping other segments in order", () => {
    const h = applyPushFilters("#repo=acme/web&ref=dev", { actor: "dependabot[bot]", period: "week" });
    expect(h).toBe("#repo=acme/web&ref=dev&pushedBy=dependabot%5Bbot%5D&pushPeriod=week");
    expect(parsePushFilters(h)).toEqual({ actor: "dependabot[bot]", period: "week" });
  });
  it("drops blank values and replaces old ones", () => {
    expect(applyPushFilters("#repo=a/b&pushedBy=x&pushPeriod=day", {})).toBe("#repo=a/b");
  });
  it("ignores an unknown period and an implausible login", () => {
    expect(parsePushFilters("#repo=a/b&pushPeriod=decade&pushedBy=a%20b")).toEqual({});
  });
  it("lists Any time first, then the five time_period values", () => {
    expect(PUSH_PERIODS.map((p) => p.id)).toEqual(["any", "day", "week", "month", "quarter", "year"]);
  });
  it("says what was filtered when nothing matches", () => {
    expect(noPushesText("main", "ann", "week")).toBe("GitHub has no recorded pushes to main by ann in the past week.");
    expect(noPushesText("main")).toBe("GitHub has no recorded pushes to main.");
  });
});

describe("pushesPath time_period", () => {
  it("adds time_period for a known period only", () => {
    expect(pushesPath("acme/web", "main", 30, { period: "quarter" })).toBe("/repos/acme/web/activity?ref=refs%2Fheads%2Fmain&per_page=30&time_period=quarter");
    expect(pushesPath("acme/web", "main", 30, { period: "any" })).toBe(pushesPath("acme/web", "main"));
  });
});

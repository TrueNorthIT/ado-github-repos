import { describe, expect, it } from "vitest";
import { nextCronRuns, nextScheduledRuns, parseCron, timeUntil } from "./cron";

const iso = (ds: Date[]) => ds.map((d) => d.toISOString().replace(":00.000Z", "Z"));
const at = (s: string) => new Date(s);

describe("parseCron", () => {
  it("reads every field of a plain expression", () => {
    const s = parseCron("5 4 * * *");
    expect(s.minutes).toEqual([5]);
    expect(s.hours).toEqual([4]);
    expect(s.days).toHaveLength(31);
    expect(s.months).toHaveLength(12);
    expect(s.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(s.anyDay).toBe(true);
    expect(s.anyWeekday).toBe(true);
  });

  it("expands lists, ranges and steps", () => {
    expect(parseCron("0,15,30,45 * * * *").minutes).toEqual([0, 15, 30, 45]);
    expect(parseCron("*/20 * * * *").minutes).toEqual([0, 20, 40]);
    expect(parseCron("10-20/5 * * * *").minutes).toEqual([10, 15, 20]);
    expect(parseCron("50/4 * * * *").minutes).toEqual([50, 54, 58]);
    expect(parseCron("0 9-17 * * *").hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(parseCron("0 0 1,15-17 * *").days).toEqual([1, 15, 16, 17]);
    expect(parseCron("0 0 * * 1-5,0").weekdays).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("de-duplicates and sorts overlapping items", () => {
    expect(parseCron("30,0,*/30 * * * *").minutes).toEqual([0, 30]);
  });

  it("accepts month and day names in any case, alone and in ranges", () => {
    expect(parseCron("0 0 * JAN,mar *").months).toEqual([1, 3]);
    expect(parseCron("0 0 * jun-AUG *").months).toEqual([6, 7, 8]);
    expect(parseCron("0 0 * * MON-FRI").weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(parseCron("0 0 * * sat,Sun").weekdays).toEqual([0, 6]);
  });

  it("treats 7 as Sunday", () => {
    expect(parseCron("0 0 * * 7").weekdays).toEqual([0]);
    expect(parseCron("0 0 * * 5-7").weekdays).toEqual([0, 5, 6]);
  });

  it("marks a stepped star as restricted, but */1 as any", () => {
    expect(parseCron("0 0 */2 * *").anyDay).toBe(false);
    expect(parseCron("0 0 */1 * *").anyDay).toBe(true);
    expect(parseCron("0 0 * * */2").weekdays).toEqual([0, 2, 4, 6]);
  });

  it("tolerates extra whitespace", () => {
    expect(parseCron("  15   3 * *   1 ").minutes).toEqual([15]);
  });

  it.each([
    ["", /5 fields/],
    ["* * * *", /5 fields, this has 4/],
    ["* * * * * *", /this has 6/],
    ["60 * * * *", /minute 60 is out of range/],
    ["* 24 * * *", /hour 24/],
    ["* * 0 * *", /day of month 0/],
    ["* * 32 * *", /day of month 32/],
    ["* * * 13 *", /month 13/],
    ["* * * * 8", /day of week 8/],
    ["*/0 * * * *", /Invalid step/],
    ["*/x * * * *", /Invalid step/],
    ["1-2-3 * * * *", /Invalid range/],
    ["5-1 * * * *", /backwards/],
    ["1,,2 * * * *", /Empty item/],
    ["a * * * *", /Invalid minute/],
    ["@daily", /5 fields/],
    ["0 0 * FOO *", /Invalid month/],
    ["1/2/3 * * * *", /Invalid minute/],
  ])("rejects %j", (expr, msg) => {
    expect(() => parseCron(expr)).toThrow(msg);
  });
});

describe("nextCronRuns", () => {
  it("lists the next runs strictly after the start", () => {
    expect(iso(nextCronRuns("0 * * * *", at("2026-11-03T10:00:00Z"), 3))).toEqual(["2026-11-03T11:00Z", "2026-11-03T12:00Z", "2026-11-03T13:00Z"]);
    expect(iso(nextCronRuns("0 * * * *", at("2026-11-03T10:00:30Z"), 1))).toEqual(["2026-11-03T11:00Z"]);
    expect(iso(nextCronRuns("30 10 * * *", at("2026-11-03T10:29:59Z"), 1))).toEqual(["2026-11-03T10:30Z"]);
  });

  it("defaults to ten runs", () => {
    expect(nextCronRuns("*/5 * * * *", at("2026-11-03T00:00:00Z"))).toHaveLength(10);
  });

  it("crosses midnight, month ends and year ends", () => {
    expect(iso(nextCronRuns("15 23,0 * * *", at("2026-12-31T22:00:00Z"), 3))).toEqual(["2026-12-31T23:15Z", "2027-01-01T00:15Z", "2027-01-01T23:15Z"]);
    expect(iso(nextCronRuns("0 0 1 * *", at("2026-11-15T00:00:00Z"), 3))).toEqual(["2026-12-01T00:00Z", "2027-01-01T00:00Z", "2027-02-01T00:00Z"]);
  });

  it("works in UTC whatever the local zone", () => {
    expect(iso(nextCronRuns("0 3 * * *", at("2026-03-29T00:00:00Z"), 2))).toEqual(["2026-03-29T03:00Z", "2026-03-30T03:00Z"]);
  });

  it("runs on weekdays only", () => {
    // 2026-11-06 is a Friday.
    expect(iso(nextCronRuns("0 9 * * MON-FRI", at("2026-11-06T10:00:00Z"), 2))).toEqual(["2026-11-09T09:00Z", "2026-11-10T09:00Z"]);
  });

  it("matches either day field when both are restricted", () => {
    // The 13th, or any Friday: 2026-11-06 (Fri), 2026-11-13 (Fri and the 13th, once), 2026-11-20 (Fri).
    expect(iso(nextCronRuns("0 0 13 * 5", at("2026-11-01T00:00:00Z"), 3))).toEqual(["2026-11-06T00:00Z", "2026-11-13T00:00Z", "2026-11-20T00:00Z"]);
  });

  it("uses only the day of week when the day of month is *", () => {
    expect(iso(nextCronRuns("0 0 * * 0", at("2026-11-03T00:00:00Z"), 1))).toEqual(["2026-11-08T00:00Z"]);
  });

  it("finds 29 February years ahead", () => {
    expect(iso(nextCronRuns("0 12 29 2 *", at("2026-11-03T00:00:00Z"), 2))).toEqual(["2028-02-29T12:00Z", "2032-02-29T12:00Z"]);
  });

  it("gives nothing for a day that never comes", () => {
    expect(nextCronRuns("0 0 31 2 *", at("2026-11-03T00:00:00Z"), 3)).toEqual([]);
    expect(nextCronRuns("0 0 30 FEB *", at("2026-11-03T00:00:00Z"), 3)).toEqual([]);
  });

  it("skips months without the day", () => {
    expect(iso(nextCronRuns("0 0 31 * *", at("2026-11-03T00:00:00Z"), 3))).toEqual(["2026-12-31T00:00Z", "2027-01-31T00:00Z", "2027-03-31T00:00Z"]);
  });

  it("orders minutes within an hour and hours within a day", () => {
    expect(iso(nextCronRuns("45,15 8,6 * * *", at("2026-11-03T00:00:00Z"), 4))).toEqual(["2026-11-03T06:15Z", "2026-11-03T06:45Z", "2026-11-03T08:15Z", "2026-11-03T08:45Z"]);
  });

  it("throws for an invalid expression", () => {
    expect(() => nextCronRuns("bad", new Date())).toThrow();
  });
});

describe("nextScheduledRuns", () => {
  it("merges schedules in time order and keeps the first ten", () => {
    const { runs, errors } = nextScheduledRuns(["0 12 * * *", "0 6 * * *"], at("2026-11-03T00:00:00Z"));
    expect(errors).toEqual([]);
    expect(runs).toHaveLength(10);
    expect(runs.slice(0, 3).map((r) => [r.at.toISOString(), r.cron])).toEqual([
      ["2026-11-03T06:00:00.000Z", "0 6 * * *"],
      ["2026-11-03T12:00:00.000Z", "0 12 * * *"],
      ["2026-11-04T06:00:00.000Z", "0 6 * * *"],
    ]);
  });

  it("keeps both runs when two schedules fire at the same minute, in file order", () => {
    const { runs } = nextScheduledRuns(["0 0 * * *", "0 0 * * 3"], at("2026-11-03T12:00:00Z"), 2);
    expect(runs.map((r) => r.cron)).toEqual(["0 0 * * *", "0 0 * * 3"]);
  });

  it("reports invalid schedules and still lists the valid ones", () => {
    const { runs, errors } = nextScheduledRuns(["nope", "0 0 * * *"], at("2026-11-03T12:00:00Z"), 1);
    expect(runs.map((r) => r.at.toISOString())).toEqual(["2026-11-04T00:00:00.000Z"]);
    expect(errors).toEqual([{ cron: "nope", message: expect.stringMatching(/5 fields/) }]);
  });

  it("is empty with no schedules", () => {
    expect(nextScheduledRuns([], new Date())).toEqual({ runs: [], errors: [] });
  });
});

describe("timeUntil", () => {
  const now = at("2026-11-03T10:00:00Z");
  const plus = (ms: number) => new Date(now.getTime() + ms);
  it.each([
    [-5000, "in under a minute"],
    [59_000, "in under a minute"],
    [60_000, "in 1m"],
    [45 * 60e3 + 30e3, "in 45m"],
    [3600e3, "in 1h"],
    [3 * 3600e3 + 20 * 60e3, "in 3h 20m"],
    [24 * 3600e3, "in 1d"],
    [52 * 3600e3 + 59 * 60e3, "in 2d 4h"],
  ])("%d ms -> %s", (ms, want) => {
    expect(timeUntil(plus(ms), now)).toBe(want);
  });
});

import { describe, it, expect } from "vitest";
import { RELATIVE_DAYS, relativeOrShortDate, fullDateTime } from "./dateFormat";

// Module under test: src/lib/dateFormat.ts (stubs until the developer implements them). Requirement VW-10: "Dates. One consistent policy: relative for less than 7 days ("3h ago", "Yesterday"),
// otherwise a short date ("21 Aug", plus the year if not the current year). The full date and time goes in a tooltip in UK format (en-GB). Check dateText.ts and reuse or extend it in a new module.
// Use a fixed clock in tests." The policy is written out in the header of src/lib/dateFormat.ts. All times are local, as in dateText.ts, so the tests build local dates.

const now = new Date(2026, 10, 3, 15, 0, 0); // 3 Nov 2026, 15:00 local
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const HOUR = 3_600_000;

describe("VW-10: relativeOrShortDate, under a day", () => {
  it("is 'just now' under a minute", () => {
    expect(relativeOrShortDate(ago(30_000), now), "Expected 30 seconds to be 'just now'").toBe("just now");
    expect(relativeOrShortDate(ago(0), now), "Expected now to be 'just now'").toBe("just now");
  });

  it("is 'just now' for a time in the future (clock skew)", () => {
    expect(relativeOrShortDate(new Date(now.getTime() + 5 * MIN), now), "Expected a future time not to read as negative").toBe("just now");
  });

  it("counts whole minutes, rounding down", () => {
    expect(relativeOrShortDate(ago(MIN), now), "Expected 1m ago").toBe("1m ago");
    expect(relativeOrShortDate(ago(5 * MIN + 59_000), now), "Expected 5m ago").toBe("5m ago");
    expect(relativeOrShortDate(ago(59 * MIN + 59_000), now), "Expected 59m ago").toBe("59m ago");
  });

  it("counts whole hours, rounding down, up to 23h", () => {
    expect(relativeOrShortDate(ago(HOUR), now), "Expected 1h ago").toBe("1h ago");
    expect(relativeOrShortDate(ago(3 * HOUR + 30 * MIN), now), "Expected 3h ago").toBe("3h ago");
    expect(relativeOrShortDate(ago(23 * HOUR + 59 * MIN), now), "Expected 23h ago").toBe("23h ago");
  });

  it("stays relative across midnight when under 24 hours have passed", () => {
    expect(relativeOrShortDate(new Date(2026, 10, 2, 23, 0), new Date(2026, 10, 3, 0, 30)), "Expected 1h ago, not Yesterday").toBe("1h ago");
  });
});

describe("VW-10: relativeOrShortDate, one to six days", () => {
  it("says 'Yesterday' for the previous calendar day once 24 hours have passed", () => {
    expect(relativeOrShortDate(new Date(2026, 10, 2, 9, 5), now), "Expected Yesterday").toBe("Yesterday");
    expect(relativeOrShortDate(new Date(2026, 10, 2, 0, 0), now), "Expected Yesterday for the start of yesterday").toBe("Yesterday");
  });

  it("counts calendar days from 2 to 6", () => {
    expect(relativeOrShortDate(new Date(2026, 10, 1, 20, 0), now), "Expected 2d ago").toBe("2d ago");
    expect(relativeOrShortDate(new Date(2026, 9, 28, 15, 0), now), "Expected 6d ago").toBe("6d ago");
  });
});

describe("VW-10: relativeOrShortDate, a week or more", () => {
  it("pins the cut-off at 7 calendar days", () => {
    expect(RELATIVE_DAYS, "Expected the cut-off from the requirement").toBe(7);
    expect(relativeOrShortDate(new Date(2026, 9, 27, 15, 0), now), "Expected 7 days to be a short date").toBe("27 Oct");
  });

  it("is a short date without the year in the current year", () => {
    expect(relativeOrShortDate(new Date(2026, 7, 21, 10, 39), now), "Expected 21 Aug").toBe("21 Aug");
  });

  it("adds the year when it is not the current year", () => {
    expect(relativeOrShortDate(new Date(2025, 10, 6, 13, 43), now), "Expected 6 Nov 2025").toBe("6 Nov 2025");
  });

  it("adds the year across the new year even a few weeks back", () => {
    expect(relativeOrShortDate(new Date(2026, 0, 2, 12, 0), new Date(2027, 0, 20, 12, 0)), "Expected 2 Jan 2026 when now is in 2027").toBe("2 Jan 2026");
  });
});

describe("VW-10: relativeOrShortDate input", () => {
  it("accepts an ISO string as well as a Date", () => {
    expect(relativeOrShortDate(ago(3 * HOUR).toISOString(), now), "Expected an ISO string to read the same as the Date").toBe("3h ago");
  });

  it("gives '' for an invalid date", () => {
    expect(relativeOrShortDate("not a date", now), "Expected an empty string").toBe("");
    expect(relativeOrShortDate(new Date(NaN), now), "Expected an empty string for an invalid Date").toBe("");
  });
});

describe("VW-10: fullDateTime is the tooltip, in UK format", () => {
  it("is day, short month, year, then 24-hour time", () => {
    expect(fullDateTime(new Date(2026, 7, 21, 14, 18)), "Expected 21 Aug 2026, 14:18").toBe("21 Aug 2026, 14:18");
  });

  it("pads the time but not the day", () => {
    expect(fullDateTime(new Date(2026, 10, 3, 9, 5)), "Expected 3 Nov 2026, 09:05").toBe("3 Nov 2026, 09:05");
  });

  it("writes September as 'Sep', not CLDR's 'Sept'", () => {
    expect(fullDateTime(new Date(2026, 8, 3, 9, 5)), "Expected 3 Sep 2026, 09:05").toBe("3 Sep 2026, 09:05");
  });

  it("uses midnight as 00:00 and always includes the year", () => {
    expect(fullDateTime(new Date(2026, 10, 3, 0, 0)), "Expected 3 Nov 2026, 00:00").toBe("3 Nov 2026, 00:00");
  });

  it("accepts an ISO string", () => {
    const d = new Date(2026, 7, 21, 14, 18);
    expect(fullDateTime(d.toISOString()), "Expected the ISO string to read as the same local time").toBe("21 Aug 2026, 14:18");
  });

  it("gives '' for an invalid date", () => {
    expect(fullDateTime("nope"), "Expected an empty string").toBe("");
  });
});

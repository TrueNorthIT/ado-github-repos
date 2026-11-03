import { describe, it, expect } from "vitest";
import { commitDateText, shortDate } from "./dateText";

const now = new Date(2026, 10, 2, 15, 0); // 2 Nov 2026, local

describe("commitDateText", () => {
  it("says Today and Yesterday", () => {
    expect(commitDateText(new Date(2026, 10, 2, 14, 18), now)).toBe("Today at 14:18");
    expect(commitDateText(new Date(2026, 10, 1, 9, 5), now)).toBe("Yesterday at 09:05");
  });
  it("leaves the year out for this year and puts it in for another", () => {
    expect(commitDateText(new Date(2026, 7, 21, 10, 39), now)).toBe("21 Aug at 10:39");
    expect(commitDateText(new Date(2025, 10, 6, 13, 43), now)).toBe("6 Nov 2025 at 13:43");
  });
  it("is empty for an invalid date", () => {
    expect(commitDateText(new Date(NaN), now)).toBe("");
  });
  it("shortDate has no time", () => {
    expect(shortDate(new Date(2025, 10, 6), now)).toBe("6 Nov 2025");
  });
});

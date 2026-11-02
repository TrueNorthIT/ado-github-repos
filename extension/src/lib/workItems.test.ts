import { describe, it, expect } from "vitest";
import { findWorkItemIds, MAX_WORK_ITEMS } from "./workItems";

// Module under test: src/lib/workItems.ts (findWorkItemIds).
// PR-7: "AB#123 mentions in the PR title, body and commit messages become linked Azure DevOps work items."
// Decisions fixed by these tests:
//  - Inside inline code spans and fenced code blocks nothing is a mention (GitHub does not autolink there either).
//  - In a markdown link, the link TEXT counts ("[AB#7](https://x)") but the destination URL does not.
//  - 0 is not a work item id; leading zeros are ignored ("AB#007" is 7).

describe("PR-7: matching AB#<number>", () => {
  it("finds a mention in plain text", () => {
    expect(findWorkItemIds("Fixes AB#123"), "Expected AB#123 to give [123]").toEqual([123]);
  });

  it("is case-insensitive", () => {
    expect(findWorkItemIds("see ab#5 and Ab#6 and aB#7"), "Expected ab#5, Ab#6 and aB#7 all to match").toEqual([5, 6, 7]);
  });

  it.each([
    ["(AB#12)", 12], ["AB#12.", 12], ["AB#12, then", 12], ["[AB#12]", 12], ["-AB#12", 12], ["AB#12\nnext", 12], ["AB#12:", 12],
  ])("matches at a word boundary in %j", (text, id) => {
    expect(findWorkItemIds(text), `Expected ${JSON.stringify(text)} to give [${id}]`).toEqual([id]);
  });

  it.each(["xAB#1", "1AB#1", "_AB#1", "AB#", "AB# 12", "AB#12a", "AB#12_", "#123", "AB-123", "AB 123"])("does not match %j", (text) => {
    expect(findWorkItemIds(text), `Expected no work item in ${JSON.stringify(text)}`).toEqual([]);
  });

  it("ignores 0 and strips leading zeros", () => {
    expect(findWorkItemIds("AB#0 AB#007"), "Expected AB#0 skipped and AB#007 read as 7").toEqual([7]);
  });

  it("returns an empty list for no text, empty text and null or undefined", () => {
    expect(findWorkItemIds(), "Expected [] with no arguments").toEqual([]);
    expect(findWorkItemIds("", null, undefined), "Expected [] for empty, null and undefined texts").toEqual([]);
  });
});

describe("PR-7: combining title, body and commit messages", () => {
  it("de-duplicates and keeps first-seen order across texts", () => {
    expect(
      findWorkItemIds("AB#3 and AB#1", "AB#2 then AB#3 again", null, "AB#1 AB#4"),
      "Expected [3,1,2,4]: first-seen order, no repeats",
    ).toEqual([3, 1, 2, 4]);
  });

  it("de-duplicates ids written in different cases", () => {
    expect(findWorkItemIds("AB#9 ab#9 Ab#9"), "Expected a single 9").toEqual([9]);
  });

  it("caps the result at 200 ids, keeping the first 200 seen", () => {
    const text = Array.from({ length: 250 }, (_, i) => `AB#${i + 1}`).join(" ");
    const ids = findWorkItemIds(text);
    expect(MAX_WORK_ITEMS, "Expected the documented cap to be 200").toBe(200);
    expect(ids, "Expected 200 ids").toHaveLength(200);
    expect(ids[0], "Expected the first id first").toBe(1);
    expect(ids[199], "Expected the 200th seen id last").toBe(200);
  });

  it("counts the cap after de-duplication", () => {
    const text = Array.from({ length: 600 }, (_, i) => `AB#${(i % 150) + 1}`).join(" ");
    expect(findWorkItemIds(text), "Expected 150 unique ids (below the cap)").toHaveLength(150);
  });
});

describe("PR-7: markdown links and code", () => {
  it("counts a mention in link text but not in the link destination", () => {
    expect(findWorkItemIds("[AB#7](https://example.com/AB#9)"), "Expected [7] only").toEqual([7]);
  });

  it("ignores a mention inside an inline code span", () => {
    expect(findWorkItemIds("use `AB#5` as the format, but AB#6 is real"), "Expected AB#5 in backticks skipped").toEqual([6]);
  });

  it("ignores a mention inside a fenced code block", () => {
    const text = "intro AB#1\n```\nAB#2\n```\noutro AB#3";
    expect(findWorkItemIds(text), "Expected the AB#2 inside the fence skipped").toEqual([1, 3]);
  });

  it("ignores a mention inside a tilde-fenced code block with a language tag", () => {
    const text = "~~~ts\nconst x = 'AB#2';\n~~~\nAB#3";
    expect(findWorkItemIds(text), "Expected the tilde-fenced AB#2 skipped").toEqual([3]);
  });
});

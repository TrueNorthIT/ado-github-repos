import { describe, expect, it } from "vitest";
import { commitWorkItemIds, splitWorkItemMentions } from "./commitWorkItems";

describe("splitWorkItemMentions", () => {
  it("splits plain text and AB# mentions, and joins back to the original", () => {
    const text = "Fix login AB#12\n\nRelated: ab#7, AB#12.";
    const parts = splitWorkItemMentions(text);
    expect(parts).toEqual(["Fix login ", { id: 12, text: "AB#12" }, "\n\nRelated: ", { id: 7, text: "ab#7" }, ", ", { id: 12, text: "AB#12" }, "."]);
    expect(parts.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe(text);
  });
  it("leaves mentions in code and inside words alone", () => {
    expect(splitWorkItemMentions("see `AB#1` and XAB#2 and AB#3x")).toEqual(["see `AB#1` and XAB#2 and AB#3x"]);
  });
  it("gives one plain part for text with no mentions", () => {
    expect(splitWorkItemMentions("Update dependencies")).toEqual(["Update dependencies"]);
  });
});

describe("commitWorkItemIds", () => {
  it("lists ids per commit and across them, unique and in order", () => {
    const r = commitWorkItemIds([
      { sha: "a", message: "One AB#5\n\nAB#6" },
      { sha: "b", message: "Two" },
      { sha: "c", message: "Three AB#6, AB#7" },
    ]);
    expect(r.bySha).toEqual({ a: [5, 6], c: [6, 7] });
    expect(r.all).toEqual([5, 6, 7]);
  });
});

import { describe, it, expect } from "vitest";
import { hunkContext, type HunkRow } from "./hunkContext";

const nums = (rows: HunkRow[]) => rows.map((r) => [r.kind[0], r.oldLine, r.newLine]);
const texts = (rows: HunkRow[]) => rows.map((r) => r.text);

// The real diff_hunk of TrueNorthIT/tn-local-agents pull comment 4465221234 (a new file), shortened lines.
const NEW_FILE = ["@@ -0,0 +1,4 @@", "+#!/bin/bash", "+# qwen3.8-27b", "+# recommended settings.", "+exec /opt/homebrew/bin/llama-server"].join("\n");

const MIXED = [
  "@@ -10,7 +10,8 @@ export function greet(name: string) {",
  " const a = 1;",
  " const b = 2;",
  "-const c = 3;",
  "+const c = 30;",
  "+const d = 4;",
  " const e = 5;",
  " const f = 6;",
].join("\n");

describe("hunkContext", () => {
  it("shows the last four lines of a new file up to the commented line", () => {
    const rows = hunkContext(NEW_FILE, { line: 4, side: "RIGHT" });
    expect(nums(rows)).toEqual([["a", null, 1], ["a", null, 2], ["a", null, 3], ["a", null, 4]]);
    expect(rows[3].text).toBe("exec /opt/homebrew/bin/llama-server");
  });

  it("numbers both sides through context, deleted and added lines", () => {
    const rows = hunkContext(MIXED, { line: 13, side: "RIGHT" });
    expect(nums(rows)).toEqual([["c", 11, 11], ["d", 12, null], ["a", null, 12], ["a", null, 13]]);
    expect(texts(rows)).toEqual(["const b = 2;", "const c = 3;", "const c = 30;", "const d = 4;"]);
  });

  it("ends at the commented line even when the hunk carries on past it", () => {
    expect(nums(hunkContext(MIXED, { line: 11, side: "RIGHT" }))).toEqual([["c", 10, 10], ["c", 11, 11]]);
  });

  it("finds a LEFT-side comment on a deleted line by its old number", () => {
    const rows = hunkContext(MIXED, { line: 12, side: "LEFT" });
    expect(rows[rows.length - 1]).toEqual({ kind: "del", oldLine: 12, newLine: null, text: "const c = 3;" });
    expect(rows).toHaveLength(3);
  });

  it("finds a LEFT-side comment on a context line by its old number, not its new one", () => {
    const hunk = ["@@ -20,3 +18,3 @@", " x", " y", " z"].join("\n");
    expect(nums(hunkContext(hunk, { line: 21, side: "LEFT" }))).toEqual([["c", 20, 18], ["c", 21, 19]]);
  });

  it("shows exactly start..line for a range comment, however long", () => {
    const hunk = ["@@ -1,0 +1,7 @@", ...[1, 2, 3, 4, 5, 6, 7].map((n) => `+line ${n}`)].join("\n");
    expect(texts(hunkContext(hunk, { line: 7, side: "RIGHT", startLine: 2 }))).toEqual(["line 2", "line 3", "line 4", "line 5", "line 6", "line 7"]);
    expect(texts(hunkContext(hunk, { line: 3, side: "RIGHT", startLine: 3 }))).toEqual(["line 1", "line 2", "line 3"]);
  });

  it("starts a range on the other side when startSide says so", () => {
    const rows = hunkContext(MIXED, { line: 13, side: "RIGHT", startLine: 12, startSide: "LEFT" });
    expect(nums(rows)).toEqual([["d", 12, null], ["a", null, 12], ["a", null, 13]]);
  });

  it("falls back to the usual context when the start line is not in the hunk", () => {
    expect(hunkContext(MIXED, { line: 13, side: "RIGHT", startLine: 2 })).toHaveLength(4);
  });

  it("restarts numbering at a second @@ header and never crosses it", () => {
    const hunk = ["@@ -1,3 +1,3 @@", " a", " b", " c", "@@ -40,3 +40,4 @@ function later()", " p", "+q", " r"].join("\n");
    const rows = hunkContext(hunk, { line: 41, side: "RIGHT" });
    expect(nums(rows)).toEqual([["c", 40, 40], ["a", null, 41]]);
    // a range whose start is only in the first segment stays in the second
    expect(nums(hunkContext(hunk, { line: 42, side: "RIGHT", startLine: 1 }))).toEqual([["c", 40, 40], ["a", null, 41], ["c", 41, 42]]);
    // a line in the first segment is still found there
    expect(nums(hunkContext(hunk, { line: 2, side: "RIGHT" }))).toEqual([["c", 1, 1], ["c", 2, 2]]);
  });

  it("reads headers without counts and with trailing function context", () => {
    expect(nums(hunkContext("@@ -5 +5 @@\n-old\n+new", { line: 5, side: "RIGHT" }))).toEqual([["d", 5, null], ["a", null, 5]]);
  });

  it("uses an outdated thread's original line, and the hunk's last row when the line is not in it", () => {
    expect(nums(hunkContext(MIXED, { line: 11, side: "RIGHT" }))).toEqual([["c", 10, 10], ["c", 11, 11]]);
    expect(hunkContext(MIXED, { line: 999, side: "RIGHT" }).map((r) => r.text)).toEqual(["const c = 30;", "const d = 4;", "const e = 5;", "const f = 6;"]);
    expect(hunkContext(MIXED, { line: null, side: "RIGHT" })).toHaveLength(4);
  });

  it("skips 'no newline at end of file' markers and a final newline", () => {
    const hunk = "@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n";
    expect(nums(hunkContext(hunk, { line: 1, side: "RIGHT" }))).toEqual([["d", 1, null], ["a", null, 1]]);
  });

  it("keeps blank context lines and CRLF hunks", () => {
    const rows = hunkContext("@@ -1,3 +1,3 @@\r\n a\r\n \r\n b", { line: 3, side: "RIGHT" });
    expect(texts(rows)).toEqual(["a", "", "b"]);
  });

  it("is empty for no hunk, an empty one or a header alone", () => {
    expect(hunkContext(undefined, { line: 1, side: "RIGHT" })).toEqual([]);
    expect(hunkContext("", { line: 1, side: "RIGHT" })).toEqual([]);
    expect(hunkContext("@@ -0,0 +1,0 @@", { line: 1, side: "RIGHT" })).toEqual([]);
  });

  it("honours a smaller context", () => {
    expect(hunkContext(MIXED, { line: 13, side: "RIGHT" }, 1)).toHaveLength(1);
  });
});

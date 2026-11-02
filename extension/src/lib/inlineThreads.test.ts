import { describe, it, expect } from "vitest";
import { threadsByFile, InlineThread } from "./inlineThreads";

// Module under test: src/lib/inlineThreads.ts (threadsByFile). Input: thread items from feedModel.toFeed (ThreadItem fields id, path,
// line, startLine, side, outdated). Output: Map<path, { line, side, threadIds }[]> used to draw comment markers in the Files diff.
// Decisions fixed by these tests, where the requirements were open:
//  - one anchor per (line, side): threads sharing a line and side share an anchor, their ids in input order.
//  - anchors for a file are ascending by line; on the same line LEFT comes before RIGHT.
//  - resolved threads are still placed (the UI may collapse them); only outdated and line-less threads are left out.
//  - a file whose threads are all left out has no entry in the map.

const th = (id: string, over: Partial<InlineThread> = {}): InlineThread => ({ id, path: "src/app.ts", line: 10, startLine: null, side: "RIGHT", outdated: false, ...over });

describe("AF-6: each current review thread maps to a file, a line and a side", () => {
  // Given a thread on src/app.ts line 10 of the head side, threadsByFile has one anchor for that file.
  it("anchors a thread at its path, line and side", () => {
    const map = threadsByFile([th("T1", { path: "src/app.ts", line: 10, side: "RIGHT" })]);
    expect(map.get("src/app.ts"), "Expected one anchor for src/app.ts at line 10 on the RIGHT (head) side").toEqual([{ line: 10, side: "RIGHT", threadIds: ["T1"] }]);
  });

  it("keeps LEFT (base) and RIGHT (head) on the same line as separate anchors, LEFT first", () => {
    const map = threadsByFile([th("R", { line: 7, side: "RIGHT" }), th("L", { line: 7, side: "LEFT" })]);
    expect(map.get("src/app.ts"), "Expected a LEFT anchor and a RIGHT anchor at line 7, LEFT first").toEqual([
      { line: 7, side: "LEFT", threadIds: ["L"] },
      { line: 7, side: "RIGHT", threadIds: ["R"] },
    ]);
  });

  it("groups files separately", () => {
    const map = threadsByFile([th("A", { path: "a.ts" }), th("B", { path: "b.ts", line: 3 })]);
    expect([...map.keys()].sort(), "Expected one entry per file").toEqual(["a.ts", "b.ts"]);
    expect(map.get("b.ts"), "Expected b.ts to hold only its own thread").toEqual([{ line: 3, side: "RIGHT", threadIds: ["B"] }]);
  });

  it("places a resolved thread too", () => {
    // ThreadItem.status is not part of InlineThread: resolution never removes a thread from the diff.
    const map = threadsByFile([{ ...th("T1"), status: "resolved" } as InlineThread]);
    expect(map.get("src/app.ts"), "Expected a resolved thread to keep its inline anchor").toEqual([{ line: 10, side: "RIGHT", threadIds: ["T1"] }]);
  });
});

describe("AF-6: outdated threads are not placed inline", () => {
  it("leaves out a thread flagged outdated", () => {
    const map = threadsByFile([th("T1", { outdated: true }), th("T2", { line: 20 })]);
    expect(map.get("src/app.ts"), "Expected only the current thread T2 to be anchored").toEqual([{ line: 20, side: "RIGHT", threadIds: ["T2"] }]);
  });

  it("leaves out a thread whose line is null", () => {
    const map = threadsByFile([th("T1", { line: null }), th("T2", { line: 20 })]);
    expect(map.get("src/app.ts"), "Expected the line-less thread T1 to be left out").toEqual([{ line: 20, side: "RIGHT", threadIds: ["T2"] }]);
  });

  it("has no entry for a file whose only threads are outdated", () => {
    const map = threadsByFile([th("T1", { path: "gone.ts", outdated: true }), th("T2", { path: "kept.ts" })]);
    expect(map.has("gone.ts"), "Expected a file with no placeable thread to be absent from the map").toBe(false);
    expect(map.has("kept.ts"), "Expected the other file to be present").toBe(true);
  });

  it("returns an empty map for no threads", () => {
    expect(threadsByFile([]).size, "Expected an empty map").toBe(0);
  });
});

describe("AF-6: multi-line threads anchor at the end line", () => {
  // GitHub's `line` is the last line of a multi-line comment, startLine the first; the marker belongs at `line`.
  it("anchors a thread covering lines 10 to 14 at line 14", () => {
    const map = threadsByFile([th("T1", { startLine: 10, line: 14 })]);
    expect(map.get("src/app.ts"), "Expected the anchor at the end line (14), not the start line (10)").toEqual([{ line: 14, side: "RIGHT", threadIds: ["T1"] }]);
  });
});

describe("AF-6: stable order", () => {
  it("orders a file's anchors by ascending line whatever the input order", () => {
    const map = threadsByFile([th("C", { line: 30 }), th("A", { line: 5 }), th("B", { line: 12 })]);
    expect(map.get("src/app.ts")!.map((a) => a.line), "Expected ascending lines").toEqual([5, 12, 30]);
  });

  it("shares one anchor between threads on the same line and side, ids in input order", () => {
    const map = threadsByFile([th("second", { line: 8 }), th("first", { line: 8 }), th("other", { line: 9 })]);
    expect(map.get("src/app.ts"), "Expected line 8 to hold both threads in input order, then line 9").toEqual([
      { line: 8, side: "RIGHT", threadIds: ["second", "first"] },
      { line: 9, side: "RIGHT", threadIds: ["other"] },
    ]);
  });

  it("gives the same result when called twice with the same input", () => {
    const input = [th("A", { line: 3 }), th("B", { line: 3, side: "LEFT" }), th("C", { line: 1 })];
    expect(threadsByFile(input), "Expected a deterministic result").toEqual(threadsByFile(input));
  });
});

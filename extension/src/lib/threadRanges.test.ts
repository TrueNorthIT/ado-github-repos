import { describe, it, expect } from "vitest";
import { linesLabel, threadRanges, threadsByFile, type InlineThread } from "./inlineThreads";

const th = (id: string, over: Partial<InlineThread> = {}): InlineThread => ({ id, path: "src/app.ts", line: 18, startLine: 12, side: "RIGHT", outdated: false, ...over });

describe("CM-6: multi-line threads in the diff", () => {
  it("anchors a range thread at its last line", () => {
    expect(threadsByFile([th("a")]).get("src/app.ts")).toEqual([{ line: 18, side: "RIGHT", threadIds: ["a"] }]);
  });

  it("marks the lines a range thread covers, per file and side", () => {
    const m = threadRanges([th("a"), th("b", { side: "LEFT", startLine: 3, line: 5 }), th("c", { path: "b.ts", startLine: 1, line: 2 })]);
    expect(m.get("src/app.ts")).toEqual([{ side: "RIGHT", startLine: 12, endLine: 18 }, { side: "LEFT", startLine: 3, endLine: 5 }]);
    expect(m.get("b.ts")).toEqual([{ side: "RIGHT", startLine: 1, endLine: 2 }]);
  });

  it("leaves out single-line, outdated and line-less threads, and merges duplicates", () => {
    const m = threadRanges([th("a", { startLine: null }), th("b", { startLine: 18 }), th("c", { outdated: true }), th("d", { line: null }), th("e"), th("f")]);
    expect(m.get("src/app.ts")).toEqual([{ side: "RIGHT", startLine: 12, endLine: 18 }]);
    expect(threadRanges([th("a", { startLine: null })]).size).toBe(0);
  });

  it("labels a thread's lines like native ADO", () => {
    expect(linesLabel({ line: 12, startLine: null })).toBe("line 12");
    expect(linesLabel({ line: 12 })).toBe("line 12");
    expect(linesLabel({ line: 12, startLine: 12 })).toBe("line 12");
    expect(linesLabel({ line: 18, startLine: 12 })).toBe("lines 12–18");
    expect(linesLabel({ line: 18, startLine: 12 }, true)).toBe("Lines 12–18");
    expect(linesLabel({ line: null, startLine: null })).toBe("");
  });
});

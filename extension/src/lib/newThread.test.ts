import { describe, it, expect } from "vitest";
import {
  parsePatch,
  toThreadTarget,
  fileTarget,
  isCommentable,
  addThreadMutation,
  applyNewThread,
  type DiffSelection,
  type LineTarget,
} from "./newThread";
import type { FeedItem, ThreadItem } from "./feedModel";
import { expectMutation, expectNotInQuery, norm, NASTY } from "./ciTestHelpers";
import { expectSelection } from "./editTestHelpers";

// Module under test: src/lib/newThread.ts (stubs until the developer implements them). Requirement CM-1: "New line and file comments".
// Schema facts are in the header of src/lib/newThread.ts. Decisions fixed by these tests:
//  - original editor line -> side LEFT, modified editor line -> side RIGHT; inline and side-by-side layouts report the same (editor, line), so there is no layout argument.
//  - a single line sends line + side only; a range sends the END as line/side and the start as startLine/startSide (both always).
//  - a range is commentable only when it lies inside one hunk; a missing patch (binary / very large) is never line-commentable.
//  - a thread added to a pending review sends pullRequestReviewId and not pullRequestId.

const o = (line: number) => ({ line, editor: "original" as const });
const m = (line: number) => ({ line, editor: "modified" as const });
const sel = (start: DiffSelection["start"], end: DiffSelection["end"] = start): DiffSelection => ({ start, end });

// Old file lines 1-4 and 20-22, new file lines 1-5 and 21-23; old line 2 is deleted, new lines 2 and 3 are added.
const PATCH = ["@@ -1,4 +1,5 @@", " line1", "-old2", "+new2", "+new2b", " line3", " line4", "@@ -20,3 +21,3 @@ function heading()", " ctx20", "-old21", "+new22", " ctx22"].join("\n");
const line = (n: number, side: "LEFT" | "RIGHT"): LineTarget => ({ subjectType: "LINE", path: "src/a.ts", line: n, side });
const range = (startLine: number, startSide: "LEFT" | "RIGHT", n: number, side: "LEFT" | "RIGHT"): LineTarget => ({ ...line(n, side), startLine, startSide });

describe("CM-1: parsePatch reads the hunk headers of a REST patch", () => {
  // Given a unified diff without a file header, parsePatch returns one entry per `@@ -a,b +c,d @@` line.
  it("returns old and new start and count for each hunk, in order", () => {
    expect(parsePatch(PATCH), "Expected two hunks with the numbers from their headers").toEqual([
      { oldStart: 1, oldCount: 4, newStart: 1, newCount: 5 },
      { oldStart: 20, oldCount: 3, newStart: 21, newCount: 3 },
    ]);
  });

  it("treats an omitted count as 1", () => {
    expect(parsePatch("@@ -3 +3 @@\n-a\n+b"), "Expected the header '-3 +3' to mean one line each side").toEqual([{ oldStart: 3, oldCount: 1, newStart: 3, newCount: 1 }]);
  });

  it("reads a new file (-0,0) and a deleted file (+0,0)", () => {
    expect(parsePatch("@@ -0,0 +1,2 @@\n+a\n+b"), "Expected an added file to have oldCount 0").toEqual([{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 }]);
    expect(parsePatch("@@ -1,2 +0,0 @@\n-a\n-b"), "Expected a deleted file to have newCount 0").toEqual([{ oldStart: 1, oldCount: 2, newStart: 0, newCount: 0 }]);
  });

  it("returns no hunks for an empty patch", () => {
    expect(parsePatch(""), "Expected no hunks for an empty patch").toEqual([]);
  });
});

describe("CM-1: toThreadTarget maps a Monaco selection to GitHub's line, side and startLine", () => {
  // Given a selection on one line of the modified editor, the target is { line, side: RIGHT } with no start fields.
  it("maps a single modified-side line to RIGHT without startLine", () => {
    expect(toThreadTarget("src/a.ts", sel(m(7))), "Expected a single RIGHT line comment").toEqual({ subjectType: "LINE", path: "src/a.ts", line: 7, side: "RIGHT" });
  });

  it("maps a single original-side line to LEFT without startLine", () => {
    expect(toThreadTarget("src/a.ts", sel(o(2))), "Expected a single LEFT line comment").toEqual({ subjectType: "LINE", path: "src/a.ts", line: 2, side: "LEFT" });
  });

  it("maps a multi-line range on the modified side: end is line/side, start is startLine/startSide", () => {
    expect(toThreadTarget("src/a.ts", sel(m(2), m(5))), "Expected line 5 as the end and 2 as the start, both RIGHT").toEqual({
      subjectType: "LINE", path: "src/a.ts", line: 5, side: "RIGHT", startLine: 2, startSide: "RIGHT",
    });
  });

  it("maps a multi-line range on the original side to LEFT for both ends", () => {
    expect(toThreadTarget("src/a.ts", sel(o(3), o(4))), "Expected a LEFT range 3 to 4").toEqual({
      subjectType: "LINE", path: "src/a.ts", line: 4, side: "LEFT", startLine: 3, startSide: "LEFT",
    });
  });

  it("swaps a range dragged upwards so startLine is not after line", () => {
    const t = toThreadTarget("src/a.ts", sel(m(9), m(4)));
    expect({ line: t.line, startLine: t.startLine }, "Expected a selection dragged from line 9 up to 4 to start at 4 and end at 9").toEqual({ line: 9, startLine: 4 });
  });

  it("starts a range that crosses sides on the original (LEFT) point", () => {
    // A unified diff view can select from a deleted line down into an added line.
    const t = toThreadTarget("src/a.ts", sel(m(3), o(2)));
    expect(t, "Expected start on LEFT line 2 and end on RIGHT line 3, whichever way it was dragged").toEqual({
      subjectType: "LINE", path: "src/a.ts", line: 3, side: "RIGHT", startLine: 2, startSide: "LEFT",
    });
  });

  it("rejects a line below 1", () => {
    expect(() => toThreadTarget("src/a.ts", sel(m(0))), "Expected line 0 to be rejected").toThrow(/line must be a positive integer/);
  });

  it("rejects a fractional line", () => {
    expect(() => toThreadTarget("src/a.ts", sel(m(2.5))), "Expected line 2.5 to be rejected").toThrow(/line must be a positive integer/);
  });

  it("rejects a blank path", () => {
    expect(() => toThreadTarget("  ", sel(m(1))), "Expected a blank path to be rejected").toThrow(/path is required/);
  });
});

describe("CM-1: fileTarget describes a whole-file thread", () => {
  it("returns subjectType FILE with the path and no line or side", () => {
    expect(fileTarget("docs/readme.md"), "Expected a FILE target carrying only the path").toEqual({ subjectType: "FILE", path: "docs/readme.md" });
  });

  it("rejects a blank path", () => {
    expect(() => fileTarget(""), "Expected a blank path to be rejected").toThrow(/path is required/);
  });
});

describe("CM-1: isCommentable says whether the diff hunks allow a line comment", () => {
  // Given the REST patch of a file, a RIGHT comment is allowed on added and context lines, a LEFT comment on deleted and context lines.
  it("allows RIGHT on added and context lines inside a hunk", () => {
    for (const n of [1, 2, 3, 4, 5, 21, 22, 23]) expect(isCommentable(PATCH, line(n, "RIGHT")), `Expected RIGHT line ${n} (inside a hunk) to be commentable`).toBe(true);
  });

  it("refuses RIGHT lines outside every hunk", () => {
    for (const n of [6, 10, 20, 24]) expect(isCommentable(PATCH, line(n, "RIGHT")), `Expected RIGHT line ${n} (outside every hunk) not to be commentable`).toBe(false);
  });

  it("allows LEFT on deleted and context lines inside a hunk", () => {
    for (const n of [1, 2, 4, 20, 21, 22]) expect(isCommentable(PATCH, line(n, "LEFT")), `Expected LEFT line ${n} (inside a hunk) to be commentable`).toBe(true);
  });

  it("refuses LEFT lines outside every hunk", () => {
    for (const n of [5, 19, 23]) expect(isCommentable(PATCH, line(n, "LEFT")), `Expected LEFT line ${n} (outside every hunk) not to be commentable`).toBe(false);
  });

  it("allows a range that lies inside one hunk", () => {
    expect(isCommentable(PATCH, range(2, "RIGHT", 4, "RIGHT")), "Expected RIGHT 2-4 inside the first hunk to be commentable").toBe(true);
  });

  it("allows a range from a deleted line to an added line of the same hunk", () => {
    expect(isCommentable(PATCH, range(2, "LEFT", 3, "RIGHT")), "Expected LEFT 2 to RIGHT 3 inside the first hunk to be commentable").toBe(true);
  });

  it("refuses a range that spans two hunks", () => {
    expect(isCommentable(PATCH, range(5, "RIGHT", 21, "RIGHT")), "Expected RIGHT 5-21, which crosses the gap between hunks, not to be commentable").toBe(false);
  });

  it("refuses a range whose start is outside the diff even though its end is inside", () => {
    expect(isCommentable(PATCH, range(10, "RIGHT", 22, "RIGHT")), "Expected a range starting in the gap not to be commentable").toBe(false);
  });

  it("refuses every line when the patch is missing (binary or very large file)", () => {
    expect(isCommentable(undefined, line(1, "RIGHT")), "Expected no line comments without a patch (undefined)").toBe(false);
    expect(isCommentable(null, line(1, "RIGHT")), "Expected no line comments without a patch (null)").toBe(false);
    expect(isCommentable("", line(1, "RIGHT")), "Expected no line comments on an empty patch").toBe(false);
  });

  it("allows any line of a new file on the RIGHT but none on the LEFT", () => {
    const added = "@@ -0,0 +1,3 @@\n+a\n+b\n+c";
    expect(isCommentable(added, line(3, "RIGHT")), "Expected RIGHT 3 of a 3-line new file to be commentable").toBe(true);
    expect(isCommentable(added, line(1, "LEFT")), "Expected no LEFT comment on a new file (it has no old lines)").toBe(false);
  });
});

describe("CM-1: addThreadMutation builds addPullRequestReviewThread", () => {
  const body = "Why not a Map?\n\n```ts\nconst x = 1;\n```\n";

  // Given a pull request id, a body and a single RIGHT line, the input carries them with subjectType LINE.
  it("is a variables-only mutation taking $input: AddPullRequestReviewThreadInput!", () => {
    const req = addThreadMutation({ pullRequestId: "PR_1", body, target: line(7, "RIGHT") });
    expectMutation(req, "AddPullRequestReviewThreadInput", "addPullRequestReviewThread");
    expect(Object.keys(req.variables), "Expected the only variable to be input").toEqual(["input"]);
  });

  it("sends a single line as pullRequestId, path, body, subjectType LINE, line and side", () => {
    const req = addThreadMutation({ pullRequestId: "PR_1", body, target: line(7, "RIGHT") });
    expect(req.variables.input, "Expected the single-line input without startLine or startSide").toEqual({
      pullRequestId: "PR_1", path: "src/a.ts", body, subjectType: "LINE", line: 7, side: "RIGHT",
    });
  });

  it("sends a range with startLine and startSide as well", () => {
    const req = addThreadMutation({ pullRequestId: "PR_1", body, target: range(2, "LEFT", 5, "RIGHT") });
    expect(req.variables.input, "Expected line/side as the end and startLine/startSide as the start").toEqual({
      pullRequestId: "PR_1", path: "src/a.ts", body, subjectType: "LINE", line: 5, side: "RIGHT", startLine: 2, startSide: "LEFT",
    });
  });

  it("sends a file thread with subjectType FILE and no line or side", () => {
    const req = addThreadMutation({ pullRequestId: "PR_1", body: "Rename this file", target: fileTarget("src/a.ts") });
    expect(req.variables.input, "Expected a FILE input with no line, side, startLine or startSide").toEqual({
      pullRequestId: "PR_1", path: "src/a.ts", body: "Rename this file", subjectType: "FILE",
    });
  });

  it("attaches to a pending review by sending pullRequestReviewId instead of pullRequestId", () => {
    const req = addThreadMutation({ pullRequestId: "PR_1", reviewId: "PRR_9", body, target: line(7, "RIGHT") });
    const input = req.variables.input as Record<string, unknown>;
    expect(input.pullRequestReviewId, "Expected the pending review id to be sent as pullRequestReviewId").toBe("PRR_9");
    expect(input, "Expected pullRequestId to be left out when a review id is given (GitHub documents them as alternatives)").not.toHaveProperty("pullRequestId");
  });

  it("selects the thread with the fields the feed model reads", () => {
    const req = addThreadMutation({ pullRequestId: "PR_1", body, target: line(7, "RIGHT") });
    expectSelection(req, /addPullRequestReviewThread\(input:\s*\$input\)/, ["thread"], "the thread payload");
    expectSelection(req, /thread/, ["id", "isResolved", "isOutdated", "path", "line", "originalLine", "startLine", "diffSide"], "the thread fields feedQuery reads");
    expect(norm(req.query), "Expected the thread's comments to be selected").toMatch(/comments\(first:\s*\d+\)\s*\{\s*nodes/);
    const words = norm(req.query).split(/[^A-Za-z0-9_]+/);
    for (const f of ["bodyHTML", "body", "createdAt", "url", "author", "replyTo"]) expect(words, `Expected the comment fields to include ${f}`).toContain(f);
  });

  it("never puts the body, path or ids in the query text", () => {
    NASTY.forEach((v, i) => {
      const req = addThreadMutation({ pullRequestId: v, body: v, target: { ...line(1, "RIGHT"), path: `${v}/${i}.ts` } });
      expectNotInQuery(req, [v, `${v}/${i}.ts`]);
    });
  });

  it("sends the body exactly as written, without trimming", () => {
    const req = addThreadMutation({ pullRequestId: "PR_1", body: "  keep\n", target: line(1, "RIGHT") });
    expect((req.variables.input as { body: string }).body, "Expected markdown whitespace to survive").toBe("  keep\n");
  });

  it("rejects an empty or whitespace-only body", () => {
    expect(() => addThreadMutation({ pullRequestId: "PR_1", body: " \n ", target: line(1, "RIGHT") }), "Expected a blank body to be rejected").toThrow(/body is required/);
  });

  it("rejects a blank pull request id when there is no review id", () => {
    expect(() => addThreadMutation({ pullRequestId: " ", body: "x", target: line(1, "RIGHT") }), "Expected a blank pullRequestId to be rejected").toThrow(/pullRequestId is required/);
  });
});

describe("CM-1: applyNewThread puts a freshly created thread in the feed", () => {
  const thread = (id: string, iso: string): ThreadItem => ({
    kind: "thread", id, status: "active", outdated: false, path: "a.ts", line: 1, startLine: null, side: "RIGHT",
    comments: [{ id: `${id}-c`, author: "ada", avatarUrl: "", html: "<p>x</p>", date: new Date(iso), url: "" }], date: new Date(iso), lastActivity: new Date(iso),
  });
  const event = (id: string, iso: string): FeedItem => ({ kind: "event", id, type: "created", actor: "ada", avatarUrl: "", date: new Date(iso) });

  it("inserts the thread newest-first among older items", () => {
    const items: FeedItem[] = [thread("t2", "2026-01-03T00:00:00Z"), thread("t1", "2026-01-01T00:00:00Z"), event("created", "2025-12-31T00:00:00Z")];
    const next = applyNewThread(items, thread("new", "2026-01-02T00:00:00Z"));
    expect(next.map((i) => i.id), "Expected the new thread between t2 (newer) and t1 (older)").toEqual(["t2", "new", "t1", "created"]);
  });

  it("puts a thread newer than everything at the top", () => {
    const items: FeedItem[] = [thread("t1", "2026-01-01T00:00:00Z")];
    expect(applyNewThread(items, thread("new", "2026-02-01T00:00:00Z")).map((i) => i.id), "Expected the newest thread first").toEqual(["new", "t1"]);
  });

  it("does not change the array it was given", () => {
    const items: FeedItem[] = [thread("t1", "2026-01-01T00:00:00Z")];
    applyNewThread(items, thread("new", "2026-02-01T00:00:00Z"));
    expect(items.map((i) => i.id), "Expected the input array to be left alone (pure)").toEqual(["t1"]);
  });
});

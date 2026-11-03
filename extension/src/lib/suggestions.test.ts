import { describe, it, expect } from "vitest";
import {
  buildSuggestionBody,
  parseSuggestions,
  canSuggest,
  targetLinesFromDiffHunk,
  applySuggestion,
  applySuggestions,
  suggestionCommitMessage,
  commitSuggestionsMutation,
  suggestionContextQuery,
  toApplyContext,
  headFileQuery,
  toFileText,
  type FileSuggestion,
  type SuggestionContextNode,
} from "./suggestions";
import { expectMutation, expectNotInQuery, expectPrQuery, norm, NASTY } from "./ciTestHelpers";
import { expectQueryOperation, expectSelection } from "./editTestHelpers";

// Module under test: src/lib/suggestions.ts (stubs until the developer implements them). Requirement CM-2: "Suggestions".
// Schema facts (no apply-suggestion mutation exists; createCommitOnBranch is the route) are in the header of src/lib/suggestions.ts. Decisions fixed by these tests:
//  - replacement is a string[] of lines: [] deletes the lines, [""] is one blank line.
//  - a suggestion block is a fence whose info string is exactly `suggestion`; the fence is lengthened past any backtick run that starts a replacement line.
//  - applying refuses, in order, an outdated thread, a range outside the file, and original lines that no longer match the file; "Apply all" refuses overlap and is all-or-nothing.
//  - the file's own line ending (LF or CRLF) and final newline are kept.

const F = "```";
const lines = (...l: string[]) => l.join("\n");
const req = (startLine: number, endLine: number, replacement: string[], originalLines: string[], extra: { outdated?: boolean } = {}) => ({
  suggestion: { startLine, endLine, replacement },
  originalLines,
  outdated: extra.outdated ?? false,
});
const fileReq = (path: string, startLine: number, endLine: number, replacement: string[], originalLines: string[]): FileSuggestion => ({ path, ...req(startLine, endLine, replacement, originalLines) });

describe("CM-2: buildSuggestionBody writes a suggestion block", () => {
  // Given replacement lines, the body is a suggestion fence containing them.
  it("wraps the replacement lines in a suggestion fence with no trailing newline", () => {
    expect(buildSuggestionBody(["const a = 1;", "const b = 2;"]), "Expected a suggestion fence holding both lines").toBe(lines(F + "suggestion", "const a = 1;", "const b = 2;", F));
  });

  it("writes an empty block to delete the lines", () => {
    expect(buildSuggestionBody([]), "Expected an empty suggestion block for a deletion").toBe(lines(F + "suggestion", F));
  });

  it("keeps a single blank replacement line distinct from a deletion", () => {
    expect(buildSuggestionBody([""]), "Expected one empty line between the fences").toBe(lines(F + "suggestion", "", F));
  });

  it("puts a comment above the block, separated by one blank line", () => {
    expect(buildSuggestionBody(["x"], "Prefer a constant\n"), "Expected the comment, a blank line, then the block").toBe(lines("Prefer a constant", "", F + "suggestion", "x", F));
  });

  it("leaves out the comment when it is blank", () => {
    expect(buildSuggestionBody(["x"], "  \n"), "Expected only the block for a blank comment").toBe(lines(F + "suggestion", "x", F));
  });

  it("uses a four-backtick fence when a replacement line starts a three-backtick fence", () => {
    expect(buildSuggestionBody([F + "js", "x", F]), "Expected a longer outer fence so the inner fence stays text").toBe(lines("````suggestion", F + "js", "x", F, "````"));
  });

  it("uses a fence one longer than the longest backtick run that starts a replacement line", () => {
    expect(buildSuggestionBody(["`````", "y"]), "Expected six backticks around a five-backtick line").toBe(lines("``````suggestion", "`````", "y", "``````"));
  });

  it("does not lengthen the fence for inline backticks in the middle of a line", () => {
    expect(buildSuggestionBody(["call `f()` here"]), "Expected the normal three-backtick fence").toBe(lines(F + "suggestion", "call `f()` here", F));
  });

  it("round-trips through parseSuggestions", () => {
    const replacement = [F + "ts", "let q = 1;", F, ""];
    const parsed = parseSuggestions(buildSuggestionBody(replacement, "Note"), { line: 8, startLine: 6 });
    expect(parsed, "Expected the built block to parse back to the same replacement lines and the thread range").toEqual([{ startLine: 6, endLine: 8, replacement }]);
  });
});

describe("CM-2: parseSuggestions reads suggestion blocks out of a comment body", () => {
  // Given a body and the thread's range, each block becomes { startLine, endLine, replacement } with the thread's range.
  it("returns one suggestion with the thread's single line as start and end", () => {
    const body = lines("Use const", "", F + "suggestion", "const a = 1;", F);
    expect(parseSuggestions(body, { line: 12, startLine: null }), "Expected startLine to default to line for a single-line thread").toEqual([{ startLine: 12, endLine: 12, replacement: ["const a = 1;"] }]);
  });

  it("uses the thread's startLine and line for a multi-line thread", () => {
    const body = lines(F + "suggestion", "a", "b", F);
    expect(parseSuggestions(body, { line: 14, startLine: 12 }), "Expected the range 12 to 14").toEqual([{ startLine: 12, endLine: 14, replacement: ["a", "b"] }]);
  });

  it("returns every block of a comment in order", () => {
    const body = lines(F + "suggestion", "one", F, "or", F + "suggestion", "two", F);
    expect(parseSuggestions(body, { line: 3 }).map((s) => s.replacement), "Expected both blocks, in order").toEqual([["one"], ["two"]]);
  });

  it("reads an empty block as a deletion", () => {
    expect(parseSuggestions(lines(F + "suggestion", F), { line: 3 })[0]?.replacement, "Expected an empty replacement for an empty block").toEqual([]);
  });

  it("reads a block holding one empty line as a blank-line replacement", () => {
    expect(parseSuggestions(lines(F + "suggestion", "", F), { line: 3 })[0]?.replacement, "Expected [''] for a block with one empty line").toEqual([""]);
  });

  it("handles CRLF line endings without leaving a carriage return on any line", () => {
    const body = ["Fix", "", F + "suggestion", "a", "b", F].join("\r\n");
    expect(parseSuggestions(body, { line: 5 })[0]?.replacement, "Expected lines without '\\r'").toEqual(["a", "b"]);
  });

  it("keeps an inner three-backtick fence when the block uses a longer fence", () => {
    const body = lines("````suggestion", F + "js", "x", F, "````");
    expect(parseSuggestions(body, { line: 2 })[0]?.replacement, "Expected the inner fence lines to be part of the replacement").toEqual([F + "js", "x", F]);
  });

  it("ignores fences with another info string", () => {
    expect(parseSuggestions(lines(F + "js", "x", F), { line: 2 }), "Expected a js fence not to be a suggestion").toEqual([]);
  });

  it("ignores a suggestion block that sits inside a longer code fence", () => {
    const body = lines("````md", F + "suggestion", "x", F, "````");
    expect(parseSuggestions(body, { line: 2 }), "Expected an example suggestion inside a quoted fence not to count").toEqual([]);
  });

  it("returns nothing for a body without a block", () => {
    expect(parseSuggestions("Looks good to me", { line: 2 }), "Expected no suggestions in plain text").toEqual([]);
  });

  it("returns nothing when the thread has no current line (outdated)", () => {
    expect(parseSuggestions(lines(F + "suggestion", "x", F), { line: null, startLine: null }), "Expected no suggestion without a current line").toEqual([]);
  });
});

describe("CM-2: canSuggest says when a thread can carry a suggestion", () => {
  const base = { side: "RIGHT" as const, line: 4, outdated: false };
  it("allows a current RIGHT line thread", () => {
    expect(canSuggest(base), "Expected a current RIGHT thread to accept suggestions").toBe(true);
    expect(canSuggest({ ...base, subjectType: "LINE" }), "Expected an explicit LINE thread to accept suggestions").toBe(true);
  });
  it("refuses LEFT threads (the deleted side has nothing to replace)", () => {
    expect(canSuggest({ ...base, side: "LEFT" }), "Expected no suggestions on the LEFT side").toBe(false);
  });
  it("refuses outdated threads and threads without a line", () => {
    expect(canSuggest({ ...base, outdated: true }), "Expected no suggestions on an outdated thread").toBe(false);
    expect(canSuggest({ ...base, line: null }), "Expected no suggestions without a current line").toBe(false);
  });
  it("refuses whole-file threads", () => {
    expect(canSuggest({ ...base, subjectType: "FILE" }), "Expected no suggestions on a FILE thread").toBe(false);
  });
});

describe("CM-2: targetLinesFromDiffHunk recovers the lines a thread was placed on", () => {
  const hunk = lines("@@ -1,4 +1,4 @@", " keep1", "-gone", "+added", " keep2", "+last");
  it("returns the last line without its marker for a single-line thread", () => {
    expect(targetLinesFromDiffHunk(hunk, 1), "Expected the final added line").toEqual(["last"]);
  });
  it("returns the last N lines for a multi-line thread, mixing context and added lines", () => {
    expect(targetLinesFromDiffHunk(hunk, 3), "Expected added, keep2 and last in order").toEqual(["added", "keep2", "last"]);
  });
  it("returns null when the range would include a deleted line", () => {
    expect(targetLinesFromDiffHunk(hunk, 4), "Expected null because '-gone' is inside the last 4 lines").toBeNull();
  });
  it("returns null when the hunk has fewer body lines than asked for", () => {
    expect(targetLinesFromDiffHunk(hunk, 9), "Expected null for a count above the body length").toBeNull();
  });
  it("returns null for a count below 1", () => {
    expect(targetLinesFromDiffHunk(hunk, 0), "Expected null for a count of 0").toBeNull();
  });
  it("does not count a no-newline marker as a line", () => {
    const h = lines("@@ -1 +1 @@", "-a", "+b", "\\ No newline at end of file");
    expect(targetLinesFromDiffHunk(h, 1), "Expected 'b', ignoring the marker line").toEqual(["b"]);
  });
});

describe("CM-2: applySuggestion turns the file at the head plus a suggestion into new contents", () => {
  const file = lines("l1", "l2", "l3", "l4", "");

  // Given a file and a suggestion whose original lines still match, the lines are replaced.
  it("replaces a single line", () => {
    expect(applySuggestion(file, req(2, 2, ["X"], ["l2"])), "Expected l2 to become X").toEqual({ ok: true, contents: lines("l1", "X", "l3", "l4", "") });
  });

  it("replaces a range with fewer lines", () => {
    expect(applySuggestion(file, req(2, 3, ["X"], ["l2", "l3"])), "Expected l2 and l3 to be replaced by one line").toEqual({ ok: true, contents: lines("l1", "X", "l4", "") });
  });

  it("replaces a line with more lines", () => {
    expect(applySuggestion(file, req(1, 1, ["a", "b", "c"], ["l1"])), "Expected l1 to become three lines").toEqual({ ok: true, contents: lines("a", "b", "c", "l2", "l3", "l4", "") });
  });

  it("deletes the lines when the replacement is empty", () => {
    expect(applySuggestion(file, req(2, 3, [], ["l2", "l3"])), "Expected l2 and l3 to be removed").toEqual({ ok: true, contents: lines("l1", "l4", "") });
  });

  it("keeps a missing final newline missing", () => {
    expect(applySuggestion("a\nb", req(2, 2, ["B"], ["b"])), "Expected no newline to be added at the end").toEqual({ ok: true, contents: "a\nB" });
  });

  it("keeps CRLF line endings, including in the replacement", () => {
    const crlf = "l1\r\nl2\r\nl3\r\n";
    expect(applySuggestion(crlf, req(2, 2, ["X", "Y"], ["l2"])), "Expected the new lines to be joined with CRLF").toEqual({ ok: true, contents: "l1\r\nX\r\nY\r\nl3\r\n" });
  });

  it("refuses an outdated thread without looking at the file", () => {
    expect(applySuggestion(file, req(2, 2, ["X"], ["l2"], { outdated: true })), "Expected reason outdated").toEqual({ ok: false, reason: "outdated" });
  });

  it("refuses when the original lines no longer match the file", () => {
    expect(applySuggestion(lines("l1", "CHANGED", "l3", ""), req(2, 2, ["X"], ["l2"])), "Expected reason mismatch when line 2 was edited after the comment").toEqual({ ok: false, reason: "mismatch" });
  });

  it("refuses when only trailing whitespace differs", () => {
    expect(applySuggestion("a \nb\n", req(1, 1, ["X"], ["a"])), "Expected a trailing-space difference to count as a mismatch").toEqual({ ok: false, reason: "mismatch" });
  });

  it("refuses when the original lines have a different count from the range", () => {
    expect(applySuggestion(file, req(2, 3, ["X"], ["l2"])), "Expected reason mismatch when one original line is given for two target lines").toEqual({ ok: false, reason: "mismatch" });
  });

  it("refuses a range that runs past the end of the file", () => {
    expect(applySuggestion(file, req(4, 6, ["X"], ["l4", "", ""])), "Expected reason out-of-range for lines beyond the file").toEqual({ ok: false, reason: "out-of-range" });
  });

  it("refuses a start line below 1 or after the end line", () => {
    expect(applySuggestion(file, req(0, 1, ["X"], ["l1"])), "Expected out-of-range for startLine 0").toEqual({ ok: false, reason: "out-of-range" });
    expect(applySuggestion(file, req(3, 2, ["X"], ["l3"])), "Expected out-of-range for startLine after endLine").toEqual({ ok: false, reason: "out-of-range" });
  });

  it("reports outdated before out-of-range or mismatch", () => {
    expect(applySuggestion(file, req(9, 9, ["X"], ["nope"], { outdated: true })), "Expected outdated to win when several checks would fail").toEqual({ ok: false, reason: "outdated" });
  });
});

describe("CM-2: applySuggestions batches several suggestions into one result (Apply all)", () => {
  const six = lines("l1", "l2", "l3", "l4", "l5", "l6", "");

  it("applies two suggestions in one file against the original line numbers, whatever the request order", () => {
    // l2 -> three lines changes every later line number; l5 is deleted. Both are located by their ORIGINAL numbers.
    const a = fileReq("a.ts", 2, 2, ["a", "b", "c"], ["l2"]);
    const b = fileReq("a.ts", 5, 5, [], ["l5"]);
    const expected = { ok: true, files: [{ path: "a.ts", contents: lines("l1", "a", "b", "c", "l3", "l4", "l6", "") }] };
    expect(applySuggestions({ "a.ts": six }, [a, b]), "Expected both edits applied (a then b)").toEqual(expected);
    expect(applySuggestions({ "a.ts": six }, [b, a]), "Expected the same result when the requests arrive in the other order").toEqual(expected);
  });

  it("applies suggestions across files and returns only the changed files in first-appearance order", () => {
    const res = applySuggestions({ "b.ts": "x\ny\n", "a.ts": "p\nq\n", "untouched.ts": "z\n" }, [fileReq("b.ts", 1, 1, ["X"], ["x"]), fileReq("a.ts", 2, 2, ["Q"], ["q"])]);
    expect(res, "Expected b.ts then a.ts, and untouched.ts left out").toEqual({ ok: true, files: [{ path: "b.ts", contents: "X\ny\n" }, { path: "a.ts", contents: "p\nQ\n" }] });
  });

  it("allows suggestions whose ranges touch but do not overlap", () => {
    const res = applySuggestions({ "a.ts": six }, [fileReq("a.ts", 2, 3, ["A"], ["l2", "l3"]), fileReq("a.ts", 4, 4, ["B"], ["l4"])]);
    expect(res, "Expected lines 2-3 and 4 to apply together").toEqual({ ok: true, files: [{ path: "a.ts", contents: lines("l1", "A", "B", "l5", "l6", "") }] });
  });

  it("refuses overlapping ranges in one file and names the later request", () => {
    const res = applySuggestions({ "a.ts": six }, [fileReq("a.ts", 2, 4, ["A"], ["l2", "l3", "l4"]), fileReq("a.ts", 4, 5, ["B"], ["l4", "l5"])]);
    expect(res, "Expected overlap on line 4 to refuse the whole batch").toEqual({ ok: false, reason: "overlap", index: 1, path: "a.ts" });
  });

  it("refuses two suggestions for exactly the same lines", () => {
    const res = applySuggestions({ "a.ts": six }, [fileReq("a.ts", 2, 2, ["A"], ["l2"]), fileReq("a.ts", 2, 2, ["B"], ["l2"])]);
    expect(res, "Expected identical ranges to count as overlap").toMatchObject({ ok: false, reason: "overlap", path: "a.ts" });
  });

  it("allows the same line numbers in different files", () => {
    const res = applySuggestions({ "a.ts": "x\n", "b.ts": "y\n" }, [fileReq("a.ts", 1, 1, ["X"], ["x"]), fileReq("b.ts", 1, 1, ["Y"], ["y"])]);
    expect(res.ok, "Expected no overlap between different files").toBe(true);
  });

  it("refuses the whole batch when one suggestion no longer matches, applying nothing", () => {
    const res = applySuggestions({ "a.ts": "x\n", "b.ts": "changed\n" }, [fileReq("a.ts", 1, 1, ["X"], ["x"]), fileReq("b.ts", 1, 1, ["Y"], ["y"])]);
    expect(res, "Expected a mismatch in b.ts (index 1) to refuse everything").toEqual({ ok: false, reason: "mismatch", index: 1, path: "b.ts" });
  });

  it("refuses an outdated suggestion in the batch", () => {
    const outdated = { ...fileReq("a.ts", 1, 1, ["X"], ["x"]), outdated: true };
    expect(applySuggestions({ "a.ts": "x\n" }, [outdated]), "Expected reason outdated for index 0").toEqual({ ok: false, reason: "outdated", index: 0, path: "a.ts" });
  });

  it("refuses a request for a file that was not supplied", () => {
    expect(applySuggestions({}, [fileReq("gone.ts", 1, 1, ["X"], ["x"])]), "Expected missing-file").toEqual({ ok: false, reason: "missing-file", index: 0, path: "gone.ts" });
  });

  it("refuses an empty batch", () => {
    expect(applySuggestions({ "a.ts": "x\n" }, []), "Expected reason empty when nothing was selected").toEqual({ ok: false, reason: "empty" });
  });
});

describe("CM-2: suggestionCommitMessage names the commit", () => {
  it("describes one suggestion", () => {
    expect(suggestionCommitMessage(1), "Expected the singular headline").toEqual({ headline: "Apply suggestion from code review" });
  });
  it("counts several suggestions", () => {
    expect(suggestionCommitMessage(3), "Expected the plural headline with the count").toEqual({ headline: "Apply 3 suggestions from code review" });
  });
  it("rejects a count below 1", () => {
    expect(() => suggestionCommitMessage(0), "Expected a count of 0 to be rejected").toThrow(/count must be at least 1/);
  });
});

describe("CM-2: commitSuggestionsMutation builds createCommitOnBranch", () => {
  const params = {
    repo: "octo/widgets",
    branch: "feature/x",
    expectedHeadOid: "0123456789abcdef0123456789abcdef01234567",
    message: { headline: "Apply suggestion from code review" },
    files: [{ path: "src/a.ts", contents: "const a = 1;\n" }],
  };
  const b64 = (s: string) => {
    let bin = "";
    for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
    return btoa(bin);
  };

  it("is a variables-only mutation taking $input: CreateCommitOnBranchInput!", () => {
    const req = commitSuggestionsMutation(params);
    expectMutation(req, "CreateCommitOnBranchInput", "createCommitOnBranch");
    expect(Object.keys(req.variables), "Expected the only variable to be input").toEqual(["input"]);
  });

  it("sends the branch, expected head, message and base64 file additions", () => {
    expect(commitSuggestionsMutation(params).variables.input, "Expected the createCommitOnBranch input shape").toEqual({
      branch: { repositoryNameWithOwner: "octo/widgets", branchName: "feature/x" },
      expectedHeadOid: "0123456789abcdef0123456789abcdef01234567",
      message: { headline: "Apply suggestion from code review" },
      fileChanges: { additions: [{ path: "src/a.ts", contents: b64("const a = 1;\n") }] },
    });
  });

  it("encodes non-ASCII text as base64 of its UTF-8 bytes", () => {
    const text = "café 日本 🚀\n";
    const input = commitSuggestionsMutation({ ...params, files: [{ path: "u.txt", contents: text }] }).variables.input as { fileChanges: { additions: { contents: string }[] } };
    expect(input.fileChanges.additions[0].contents, "Expected UTF-8 base64, not Latin-1").toBe(b64(text));
  });

  it("keeps several files in the order given", () => {
    const input = commitSuggestionsMutation({ ...params, files: [{ path: "b.ts", contents: "b" }, { path: "a.ts", contents: "a" }] }).variables.input as { fileChanges: { additions: { path: string }[] } };
    expect(input.fileChanges.additions.map((x) => x.path), "Expected b.ts then a.ts").toEqual(["b.ts", "a.ts"]);
  });

  it("includes the message body only when there is one", () => {
    const withBody = commitSuggestionsMutation({ ...params, message: { headline: "H", body: "Why" } }).variables.input as { message: unknown };
    expect(withBody.message, "Expected the body to be sent when given").toEqual({ headline: "H", body: "Why" });
  });

  it("selects the new commit and branch tip", () => {
    const req = commitSuggestionsMutation(params);
    expectSelection(req, /createCommitOnBranch\(input:\s*\$input\)/, ["commit", "ref"], "the createCommitOnBranch payload");
    expect(norm(req.query), "Expected commit { oid ... }").toMatch(/commit\s*\{[^}]*\boid\b/);
  });

  it("never puts the repository, branch, path or contents in the query text", () => {
    NASTY.forEach((v, i) => {
      const req = commitSuggestionsMutation({ ...params, repo: `${v}/r${i}`, branch: v, files: [{ path: `${v}.ts`, contents: v }] });
      expectNotInQuery(req, [`${v}/r${i}`, v, `${v}.ts`]);
    });
  });

  it("rejects a repository that is not owner/name", () => {
    expect(() => commitSuggestionsMutation({ ...params, repo: "widgets" }), "Expected a repo without a slash to be rejected").toThrow(/repo must be owner\/name/);
  });

  it("rejects a blank branch, a blank expected head and an empty file list", () => {
    expect(() => commitSuggestionsMutation({ ...params, branch: " " }), "Expected a blank branch to be rejected").toThrow(/branchName is required/);
    expect(() => commitSuggestionsMutation({ ...params, expectedHeadOid: "" }), "Expected a blank expectedHeadOid to be rejected").toThrow(/expectedHeadOid is required/);
    expect(() => commitSuggestionsMutation({ ...params, files: [] }), "Expected no files to be rejected").toThrow(/at least one file is required/);
  });
});

describe("CM-2: suggestionContextQuery and toApplyContext say where and whether a commit can go", () => {
  it("is a variables-only pull request query", () => {
    const req = suggestionContextQuery({ owner: "octo", name: "widgets", number: 7 });
    expectQueryOperation(req);
    expectPrQuery(req);
    expect(req.variables, "Expected variables { owner, name, number }").toEqual({ owner: "octo", name: "widgets", number: 7 });
  });

  it("selects the head and permission fields", () => {
    const words = norm(suggestionContextQuery({ owner: "o", name: "n", number: 1 }).query).split(/[^A-Za-z0-9_]+/);
    for (const f of ["id", "state", "headRefName", "headRefOid", "isCrossRepository", "maintainerCanModify", "viewerCanApplySuggestion", "headRepository", "nameWithOwner"])
      expect(words, `Expected the query to select ${f}`).toContain(f);
  });

  const pr: SuggestionContextNode = { id: "PR_1", state: "OPEN", headRefName: "feature/x", headRefOid: "abc123", viewerCanApplySuggestion: true, headRepository: { nameWithOwner: "fork/widgets" } };

  it("returns the head repository, branch and oid for an open pull request the viewer can commit to", () => {
    expect(toApplyContext(pr), "Expected the HEAD repository (the fork), not the base").toEqual({ ok: true, pullRequestId: "PR_1", repo: "fork/widgets", branch: "feature/x", headOid: "abc123" });
  });

  it("refuses a closed or merged pull request", () => {
    expect(toApplyContext({ ...pr, state: "MERGED" }), "Expected closed for a merged PR").toEqual({ ok: false, reason: "closed" });
    expect(toApplyContext({ ...pr, state: "CLOSED" }), "Expected closed for a closed PR").toEqual({ ok: false, reason: "closed" });
  });

  it("refuses when the head repository was deleted", () => {
    expect(toApplyContext({ ...pr, headRepository: null }), "Expected head-deleted").toEqual({ ok: false, reason: "head-deleted" });
  });

  it("refuses when the viewer cannot apply suggestions", () => {
    expect(toApplyContext({ ...pr, viewerCanApplySuggestion: false }), "Expected no-permission").toEqual({ ok: false, reason: "no-permission" });
  });

  it("reports closed before head-deleted before no-permission", () => {
    expect(toApplyContext({ ...pr, state: "CLOSED", headRepository: null, viewerCanApplySuggestion: false }), "Expected closed first").toEqual({ ok: false, reason: "closed" });
    expect(toApplyContext({ ...pr, headRepository: null, viewerCanApplySuggestion: false }), "Expected head-deleted before no-permission").toEqual({ ok: false, reason: "head-deleted" });
  });
});

describe("CM-2: headFileQuery and toFileText read the file at the head commit", () => {
  it("sends owner, name and an oid:path expression as variables", () => {
    const req = headFileQuery({ owner: "fork", name: "widgets", oid: "abc123", path: "src/a b/c.ts" });
    expectQueryOperation(req);
    expect(req.variables, "Expected the expression to be <oid>:<path> in a variable").toEqual({ owner: "fork", name: "widgets", expression: "abc123:src/a b/c.ts" });
    expect(norm(req.query), "Expected object(expression: $expression) ... on Blob { text }").toMatch(/object\(expression:\s*\$expression\)[^]*\.\.\.\s*on Blob[^]*\btext\b/);
  });

  it("never puts the path in the query text", () => {
    NASTY.forEach((v) => expectNotInQuery(headFileQuery({ owner: v, name: v, oid: "abc", path: v }), [v]));
  });

  it("returns the text of a text blob", () => {
    expect(toFileText({ repository: { object: { text: "a\nb\n", isBinary: false } } }), "Expected the blob text").toBe("a\nb\n");
  });

  it("keeps an empty file as an empty string", () => {
    expect(toFileText({ repository: { object: { text: "", isBinary: false } } }), "Expected '' for an empty file, not null").toBe("");
  });

  it("returns null for a binary blob, a missing object and missing data", () => {
    expect(toFileText({ repository: { object: { text: null, isBinary: true } } }), "Expected null for a binary blob").toBeNull();
    expect(toFileText({ repository: { object: null } }), "Expected null when the path does not exist at that commit").toBeNull();
    expect(toFileText(null), "Expected null for missing data").toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { codeSnippet, type SnippetLine } from "./codeSnippet";

// Module under test: src/lib/codeSnippet.ts (stub until the developer implements it). Requirement AS-6: "Code snippet for a code-scanning location: given file text and a line range, return the lines with 3 lines of context and
// marked target lines. Handle out-of-range lines and CRLF." Line numbers are 1-based, as code scanning's start_line and end_line are.

/** A file of `n` lines: "line 1" ... "line n", LF-separated, with a final newline. */
const file = (n: number, eol = "\n") => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join(eol) + eol;
const numbers = (s: SnippetLine[]) => s.map((l) => l.number);
const targets = (s: SnippetLine[]) => s.filter((l) => l.target).map((l) => l.number);

describe("AS-6: context and target lines", () => {
  it("returns 3 lines either side of a single-line alert, with only that line marked", () => {
    const s = codeSnippet(file(20), 10, 10);
    expect(numbers(s), "Expected lines 7 to 13").toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(targets(s), "Expected only line 10 marked").toEqual([10]);
  });

  it("carries each line's text without its line ending", () => {
    expect(codeSnippet(file(20), 10, 10).find((l) => l.number === 10), "Expected line 10 and its text").toEqual({ number: 10, text: "line 10", target: true });
  });

  it("marks every line of a multi-line range and adds context around the whole range", () => {
    const s = codeSnippet(file(30), 12, 14);
    expect(numbers(s), "Expected lines 9 to 17").toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(targets(s), "Expected lines 12 to 14 marked").toEqual([12, 13, 14]);
  });

  it("an alert with no end line is a single line", () => {
    expect(targets(codeSnippet(file(20), 10)), "Expected only line 10 marked").toEqual([10]);
  });

  it("an end line before the start line is raised to the start", () => {
    expect(targets(codeSnippet(file(20), 10, 4)), "Expected only line 10 marked").toEqual([10]);
  });

  it("the context size can be changed, and 0 gives just the target lines", () => {
    expect(numbers(codeSnippet(file(20), 10, 11, 1)), "Expected lines 9 to 12 with a context of 1").toEqual([9, 10, 11, 12]);
    expect(numbers(codeSnippet(file(20), 10, 11, 0)), "Expected lines 10 and 11 with no context").toEqual([10, 11]);
  });
});

describe("AS-6: out-of-range lines", () => {
  it("near the top of the file, starts at line 1", () => {
    const s = codeSnippet(file(20), 2, 2);
    expect(numbers(s), "Expected lines 1 to 5").toEqual([1, 2, 3, 4, 5]);
    expect(targets(s), "Expected line 2 marked").toEqual([2]);
  });

  it("near the bottom of the file, stops at the last line", () => {
    const s = codeSnippet(file(20), 19, 19);
    expect(numbers(s), "Expected lines 16 to 20").toEqual([16, 17, 18, 19, 20]);
    expect(targets(s), "Expected line 19 marked").toEqual([19]);
  });

  it("a range that runs past the end marks only the lines that exist", () => {
    const s = codeSnippet(file(20), 19, 40);
    expect(numbers(s), "Expected lines 16 to 20").toEqual([16, 17, 18, 19, 20]);
    expect(targets(s), "Expected lines 19 and 20 marked").toEqual([19, 20]);
  });

  it("a start line past the end of the file gives no lines (the file has changed since the analysis)", () => {
    expect(codeSnippet(file(20), 21, 21), "Expected no lines for line 21 of 20").toEqual([]);
    expect(codeSnippet(file(20), 500, 510), "Expected no lines for line 500 of 20").toEqual([]);
  });

  it("a start line that is not a positive integer gives no lines", () => {
    for (const bad of [0, -5, 1.5, NaN]) expect(codeSnippet(file(20), bad, bad), `Expected no lines for start line ${bad}`).toEqual([]);
  });

  it("the last line counts as a line whether or not the file ends with a newline", () => {
    expect(numbers(codeSnippet("a\nb\nc", 3, 3)), "Expected line 3 without a final newline").toEqual([1, 2, 3]);
    expect(numbers(codeSnippet("a\nb\nc\n", 3, 3)), "Expected the final newline not to add a line 4").toEqual([1, 2, 3]);
    expect(codeSnippet("a\nb\nc\n", 4, 4), "Expected line 4 not to exist").toEqual([]);
  });

  it("an empty file has no lines", () => {
    expect(codeSnippet("", 1, 1), "Expected no lines for empty text").toEqual([]);
  });
});

describe("AS-6: line endings", () => {
  it("CRLF files give the same lines as LF files, with no carriage returns left in the text", () => {
    const lf = codeSnippet(file(20, "\n"), 10, 11);
    const crlf = codeSnippet(file(20, "\r\n"), 10, 11);
    expect(crlf, "Expected CRLF to give the same snippet as LF").toEqual(lf);
    expect(crlf.some((l) => l.text.includes("\r")), "Expected no \\r in any line's text").toBe(false);
  });

  it("a mix of LF and CRLF is split line by line", () => {
    const s = codeSnippet("one\r\ntwo\nthree\r\nfour", 2, 3, 0);
    expect(s, "Expected lines 2 and 3, clean").toEqual([
      { number: 2, text: "two", target: true },
      { number: 3, text: "three", target: true },
    ]);
  });

  it("keeps blank lines and indentation", () => {
    const s = codeSnippet("a\r\n\r\n    b\r\nc", 3, 3, 1);
    expect(s, "Expected the blank line and the indented line as they are").toEqual([
      { number: 2, text: "", target: false },
      { number: 3, text: "    b", target: true },
      { number: 4, text: "c", target: false },
    ]);
  });
});

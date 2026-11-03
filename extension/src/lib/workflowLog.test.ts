import { describe, it, expect } from "vitest";
import { ansiSpans, parseLog, foldRanges, stepRanges, logCounts, type AnsiSpan, type LogKind, type LogLine } from "./workflowLog";

// Module under test: src/lib/workflowLog.ts (frozen contract; every body throws "not implemented" until the developers fill them in).
// Requirement IDs: ACT-7 is the job log view (ANSI colours, timestamps, ##[group] folding, error/warning highlighting, per-step jump) and ACT-8 is the
// log toolbar (error and warning counts). Each describe block quotes the sentence of the contract that it proves. The text fixtures copy the shape of a
// real GitHub job log (GET /actions/jobs/{id}/logs, TrueNorthIT/ado-github-repos job 125855973951): a BOM, "<ISO timestamp> <text>", ##[group] and
// ##[endgroup] markers, and ESC[36;1m ... ESC[0m around echoed commands.
// foldRanges, stepRanges and logCounts are tested on hand-built LogLine arrays, so they do not depend on parseLog being finished.

const ESC = "\u001b";
const sgr = (codes: string, text: string) => `${ESC}[${codes}m${text}`;

/** Spans with falsy style flags removed, so `bold: false` and an absent `bold` compare equal (the contract leaves that choice open). */
const clean = (spans: AnsiSpan[]) => spans.map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== false)));

// ---------------------------------------------------------------------------------------------------------------------------------
// ansiSpans
// ---------------------------------------------------------------------------------------------------------------------------------

describe("ACT-7: ansiSpans splits SGR escapes into styled spans", () => {
  // Given text with ESC [ ... m escapes, `ansiSpans` returns runs of text with one style each.
  it("returns one unstyled span for plain text", () => {
    expect(clean(ansiSpans("added 312 packages in 4s")), "Expected a single span holding the text").toEqual([{ text: "added 312 packages in 4s" }]);
  });

  it("returns [] for an empty string", () => {
    expect(ansiSpans(""), "Expected no spans for ''").toEqual([]);
  });

  it("colours text red with 31 until a reset (0), and the text after is unstyled", () => {
    expect(clean(ansiSpans(`${sgr("31", "red")}${sgr("0", " plain")}`)), "Expected red as palette index 1, then an unstyled span").toEqual([{ text: "red", fg: 1 }, { text: " plain" }]);
  });

  it("maps 30-37 to palette indices 0-7", () => {
    for (let code = 30; code <= 37; code++) {
      expect(clean(ansiSpans(sgr(String(code), "x"))), `Expected SGR ${code} to be fg ${code - 30}`).toEqual([{ text: "x", fg: code - 30 }]);
    }
  });

  it("maps 90-97 (bright) to palette indices 8-15", () => {
    expect(clean(ansiSpans(sgr("90", "grey"))), "Expected 90 to be fg 8").toEqual([{ text: "grey", fg: 8 }]);
    expect(clean(ansiSpans(sgr("91", "red"))), "Expected 91 to be fg 9").toEqual([{ text: "red", fg: 9 }]);
    expect(clean(ansiSpans(sgr("97", "white"))), "Expected 97 to be fg 15").toEqual([{ text: "white", fg: 15 }]);
  });

  it("maps 40-47 and 100-107 to background palette indices", () => {
    expect(clean(ansiSpans(sgr("41", "x"))), "Expected 41 to be bg 1").toEqual([{ text: "x", bg: 1 }]);
    expect(clean(ansiSpans(sgr("47", "x"))), "Expected 47 to be bg 7").toEqual([{ text: "x", bg: 7 }]);
    expect(clean(ansiSpans(sgr("100", "x"))), "Expected 100 to be bg 8").toEqual([{ text: "x", bg: 8 }]);
    expect(clean(ansiSpans(sgr("107", "x"))), "Expected 107 to be bg 15").toEqual([{ text: "x", bg: 15 }]);
  });

  it("reads 38;5;n as the 256-colour palette index n, and 48;5;n for the background", () => {
    expect(clean(ansiSpans(sgr("38;5;208", "orange"))), "Expected fg 208").toEqual([{ text: "orange", fg: 208 }]);
    expect(clean(ansiSpans(sgr("48;5;21", "blue"))), "Expected bg 21").toEqual([{ text: "blue", bg: 21 }]);
  });

  it("reads 38;2;r;g;b as a lower-case #rrggbb string, and 48;2;r;g;b for the background", () => {
    expect(clean(ansiSpans(sgr("38;2;255;128;0", "orange"))), "Expected fg #ff8000").toEqual([{ text: "orange", fg: "#ff8000" }]);
    expect(clean(ansiSpans(sgr("48;2;1;2;3", "dark"))), "Expected bg #010203 (zero-padded)").toEqual([{ text: "dark", bg: "#010203" }]);
    expect(clean(ansiSpans(sgr("38;2;171;205;239", "x"))), "Expected lower-case hex digits").toEqual([{ text: "x", fg: "#abcdef" }]);
  });

  it("sets bold with 1, italic with 3 and underline with 4", () => {
    expect(clean(ansiSpans(sgr("1", "b"))), "Expected bold").toEqual([{ text: "b", bold: true }]);
    expect(clean(ansiSpans(sgr("3", "i"))), "Expected italic").toEqual([{ text: "i", italic: true }]);
    expect(clean(ansiSpans(sgr("4", "u"))), "Expected underline").toEqual([{ text: "u", underline: true }]);
  });

  it("unsets bold, italic and underline with 22, 23 and 24", () => {
    expect(clean(ansiSpans(`${sgr("1", "a")}${sgr("22", "b")}`)), "Expected 22 to unset bold").toEqual([{ text: "a", bold: true }, { text: "b" }]);
    expect(clean(ansiSpans(`${sgr("3", "a")}${sgr("23", "b")}`)), "Expected 23 to unset italic").toEqual([{ text: "a", italic: true }, { text: "b" }]);
    expect(clean(ansiSpans(`${sgr("4", "a")}${sgr("24", "b")}`)), "Expected 24 to unset underline").toEqual([{ text: "a", underline: true }, { text: "b" }]);
  });

  it("resets only the foreground with 39 and only the background with 49", () => {
    expect(clean(ansiSpans(`${sgr("31;42", "a")}${sgr("39", "b")}`)), "Expected 39 to keep the background").toEqual([{ text: "a", fg: 1, bg: 2 }, { text: "b", bg: 2 }]);
    expect(clean(ansiSpans(`${sgr("31;42", "a")}${sgr("49", "b")}`)), "Expected 49 to keep the foreground").toEqual([{ text: "a", fg: 1, bg: 2 }, { text: "b", fg: 1 }]);
  });

  it("combines parameters in one escape (36;1 is cyan and bold, as GitHub echoes commands)", () => {
    expect(clean(ansiSpans(`${sgr("36;1", "npm ci")}${sgr("0", "")}`)), "Expected cyan (6) and bold").toEqual([{ text: "npm ci", fg: 6, bold: true }]);
  });

  it("clears every style with 0 inside a multi-parameter escape, then applies the rest (0;32 is green only)", () => {
    expect(clean(ansiSpans(`${sgr("1;31", "A")}${sgr("0;32", "B")}`)), "Expected B to be green without bold").toEqual([{ text: "A", fg: 1, bold: true }, { text: "B", fg: 2 }]);
  });

  it("treats an escape with no parameters (ESC[m) as a reset", () => {
    expect(clean(ansiSpans(`${sgr("31", "a")}${ESC}[mb`)), "Expected ESC[m to reset the colour").toEqual([{ text: "a", fg: 1 }, { text: "b" }]);
  });

  it("merges adjacent text that has the same style", () => {
    expect(clean(ansiSpans(`${sgr("31", "ab")}${sgr("31", "cd")}`)), "Expected one red span 'abcd'").toEqual([{ text: "abcd", fg: 1 }]);
    expect(clean(ansiSpans(`a${sgr("0", "b")}`)), "Expected a no-op reset not to split plain text").toEqual([{ text: "ab" }]);
  });

  it("drops empty spans (an escape with no text between)", () => {
    expect(clean(ansiSpans(`${sgr("31", "")}${sgr("0", "text")}`)), "Expected no empty red span").toEqual([{ text: "text" }]);
    expect(clean(ansiSpans(`text${sgr("0", "")}`)), "Expected no trailing empty span").toEqual([{ text: "text" }]);
  });

  it("removes escapes that are not SGR (clear line, hide cursor) and keeps the text", () => {
    expect(clean(ansiSpans(`${ESC}[2Kcleared`)), "Expected ESC[2K removed").toEqual([{ text: "cleared" }]);
    expect(clean(ansiSpans(`${ESC}[?25lhidden${ESC}[?25h`)), "Expected ESC[?25l and ESC[?25h removed").toEqual([{ text: "hidden" }]);
    expect(clean(ansiSpans(`a${ESC}[1Ab`)), "Expected a cursor move removed and the text joined").toEqual([{ text: "ab" }]);
  });

  it("ignores an SGR code it does not know (5, blink) and keeps the text unstyled", () => {
    expect(clean(ansiSpans(sgr("5", "blink"))), "Expected the unknown code to leave the style alone").toEqual([{ text: "blink" }]);
  });

  it("never leaves an ESC character in a span's text", () => {
    const text = `${sgr("31;1", "a")}${ESC}[2K${sgr("0", "b")}${ESC}[?25l`;
    expect(ansiSpans(text).map((s) => s.text).join(""), "Expected the joined span text to be 'ab'").toBe("ab");
  });

  it("keeps the text between escapes in order", () => {
    expect(clean(ansiSpans(`one ${sgr("32", "two")}${sgr("0", " three ")}${sgr("1", "four")}`)), "Expected four spans in text order").toEqual([
      { text: "one " },
      { text: "two", fg: 2 },
      { text: " three " },
      { text: "four", bold: true },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// parseLog
// ---------------------------------------------------------------------------------------------------------------------------------

const T = (suffix: string) => `2026-11-03T10:16:${suffix}Z`;

describe("ACT-7: parseLog parses a whole job log into lines", () => {
  // Given the text of GET .../jobs/{id}/logs, `parseLog` returns one LogLine per line, numbered from 1.
  it("is [] for empty text", () => {
    expect(parseLog(""), "Expected no lines for ''").toEqual([]);
  });

  it("parses a timestamped plain line: number, timestamp, kind, text, spans and depth", () => {
    const [line] = parseLog(`${T("55.2597204")} Current runner version: '2.338.2'`);
    expect(line.n, "Expected the first line to be numbered 1").toBe(1);
    expect(line.kind, "Expected a plain line to be 'normal'").toBe("normal");
    expect(line.text, "Expected the text without its timestamp").toBe("Current runner version: '2.338.2'");
    expect(clean(line.spans), "Expected one unstyled span").toEqual([{ text: "Current runner version: '2.338.2'" }]);
    expect(line.depth, "Expected depth 0 outside any group").toBe(0);
    expect(line.ts, "Expected a timestamp").toBeInstanceOf(Date);
  });

  it("reads the leading timestamp at the right instant (to the second)", () => {
    const [line] = parseLog(`${T("55.2597204")} x`);
    expect(Math.floor(line.ts!.getTime() / 1000) * 1000, "Expected 2026-11-03T10:16:55Z to the second").toBe(Date.parse("2026-11-03T10:16:55Z"));
  });

  it("orders timestamps from the log's own times", () => {
    const [a, b] = parseLog(`${T("55.1000000")} first\n${T("56.2000000")} second`);
    expect(b.ts!.getTime() - a.ts!.getTime(), "Expected the second line to be about 1.1 s after the first").toBeGreaterThan(1000);
  });

  it("strips a leading UTF-8 byte order mark so the first line still has its timestamp", () => {
    const [line] = parseLog(`﻿${T("55.2597204")} Current runner version`);
    expect(line.ts, "Expected the BOM not to hide the timestamp").toBeInstanceOf(Date);
    expect(line.text, "Expected the text without the BOM or the timestamp").toBe("Current runner version");
  });

  it("splits on \\n and on \\r\\n without leaving \\r in the text", () => {
    const lines = parseLog(`${T("55.1000000")} one\r\n${T("55.2000000")} two\r\n${T("55.3000000")} three`);
    expect(lines.map((l) => l.text), "Expected three clean lines").toEqual(["one", "two", "three"]);
    expect(lines.map((l) => l.n), "Expected numbers 1, 2, 3").toEqual([1, 2, 3]);
  });

  it("does not make an extra line for a trailing newline", () => {
    expect(parseLog(`${T("55.1000000")} one\n${T("55.2000000")} two\n`), "Expected two lines for text ending in \\n").toHaveLength(2);
    expect(parseLog(`${T("55.1000000")} one\r\n`), "Expected one line for text ending in \\r\\n").toHaveLength(1);
  });

  it("keeps a blank line in the middle as an empty line with the next numbers after it", () => {
    const lines = parseLog(`${T("55.1000000")} one\n${T("55.2000000")} \n${T("55.3000000")} three`);
    expect(lines.map((l) => l.text), "Expected an empty second line").toEqual(["one", "", "three"]);
    expect(lines[2].n, "Expected the third line to be numbered 3").toBe(3);
  });

  it("leaves ts undefined for a line without a timestamp, keeping its text and its number", () => {
    const lines = parseLog(`${T("55.1000000")} first\njust text\n${T("55.2000000")} third`);
    expect(lines[1].ts, "Expected no timestamp on the middle line").toBeUndefined();
    expect(lines[1].text, "Expected the whole line as text").toBe("just text");
    expect(lines[1].n, "Expected line number 2").toBe(2);
    expect(lines[2].ts, "Expected the third line's own timestamp").toBeInstanceOf(Date);
  });

  const markers: [string, LogKind, string][] = [
    ["##[group]Run npm ci", "group", "Run npm ci"],
    ["##[endgroup]", "endgroup", ""],
    ["##[error]Process completed with exit code 1.", "error", "Process completed with exit code 1."],
    ["##[warning]Node.js 20 actions are deprecated.", "warning", "Node.js 20 actions are deprecated."],
    ["##[notice]Cache restored from key: npm-abc", "notice", "Cache restored from key: npm-abc"],
    ["##[debug]Evaluating condition for step", "debug", "Evaluating condition for step"],
    ["##[command]/usr/bin/git version", "command", "/usr/bin/git version"],
    ["##[section]Starting: Build", "section", "Starting: Build"],
  ];
  for (const [raw, kind, text] of markers) {
    it(`reads ${raw.slice(0, raw.indexOf("]") + 1)} as kind '${kind}' and removes the marker from the text`, () => {
      const [line] = parseLog(`${T("55.2597204")} ${raw}`);
      expect(line.kind, `Expected kind ${kind}`).toBe(kind);
      expect(line.text, "Expected the marker and the timestamp removed from the text").toBe(text);
    });
  }

  it("reads a marker on a line that has no timestamp", () => {
    const [line] = parseLog("##[error]no timestamp here");
    expect(line.kind, "Expected kind error").toBe("error");
    expect(line.text, "Expected the text after the marker").toBe("no timestamp here");
    expect(line.ts, "Expected no timestamp").toBeUndefined();
  });

  it("removes ANSI escapes from the text and puts them in the spans", () => {
    const [line] = parseLog(`${T("58.6908009")} ${sgr("36;1", "npm ci")}${sgr("0", "")}`);
    expect(line.text, "Expected the plain text 'npm ci' without escapes").toBe("npm ci");
    expect(clean(line.spans), "Expected one cyan bold span").toEqual([{ text: "npm ci", fg: 6, bold: true }]);
  });

  it("gives group header lines the depth outside the group and its content the depth inside", () => {
    const text = [
      `${T("58.0000001")} before`,
      `${T("58.0000002")} ##[group]Run npm ci`,
      `${T("58.0000003")} added 312 packages`,
      `${T("58.0000004")} up to date`,
      `${T("58.0000005")} ##[endgroup]`,
      `${T("58.0000006")} after`,
    ].join("\n");
    const lines = parseLog(text);
    expect(lines[0].depth, "Expected 'before' outside the group").toBe(0);
    expect(lines[1].depth, "Expected the ##[group] header at the depth outside the group").toBe(0);
    expect(lines[2].depth, "Expected the group's first content line at depth 1").toBe(1);
    expect(lines[3].depth, "Expected the group's second content line at depth 1").toBe(1);
    expect(lines[5].depth, "Expected the line after ##[endgroup] back at depth 0").toBe(0);
  });

  it("counts nested groups: the inner header is at the outer's depth and its content one deeper", () => {
    const text = [
      "##[group]outer",
      "in outer",
      "##[group]inner",
      "in inner",
      "##[endgroup]",
      "back in outer",
      "##[endgroup]",
      "outside",
    ].join("\n");
    const depths = parseLog(text).map((l) => l.depth);
    expect(depths[0], "Expected the outer header at depth 0").toBe(0);
    expect(depths[1], "Expected outer content at depth 1").toBe(1);
    expect(depths[2], "Expected the inner header at depth 1 (the outer group's depth)").toBe(1);
    expect(depths[3], "Expected inner content at depth 2").toBe(2);
    expect(depths[5], "Expected the line after the inner ##[endgroup] at depth 1").toBe(1);
    expect(depths[7], "Expected the line after the outer ##[endgroup] at depth 0").toBe(0);
  });

  it("keeps depth 1 to the end for an unclosed group", () => {
    const depths = parseLog("##[group]never closed\nline one\nline two").map((l) => l.depth);
    expect(depths, "Expected the header at 0 and everything after it at 1").toEqual([0, 1, 1]);
  });

  it("never lets depth go below 0 for a stray ##[endgroup]", () => {
    const depths = parseLog("##[endgroup]\nplain\n##[group]g\nin g").map((l) => l.depth);
    expect(depths[1], "Expected a plain line after a stray ##[endgroup] at depth 0").toBe(0);
    expect(depths[3], "Expected a later group to still count from 0").toBe(1);
  });

  it("numbers every line from 1 in order across groups and plain lines", () => {
    const lines = parseLog("a\n##[group]g\nb\n##[endgroup]\nc");
    expect(lines.map((l) => l.n), "Expected 1 to 5").toEqual([1, 2, 3, 4, 5]);
  });

  it("parses a realistic log excerpt: groups, an echoed command, a warning and a failure", () => {
    const text = [
      `﻿${T("58.6900000")} ##[group]Run npm ci`,
      `${T("58.6908009")} ${sgr("36;1", "npm ci")}${sgr("0", "")}`,
      `${T("58.6910000")} shell: /usr/bin/bash -e {0}`,
      `${T("58.6911000")} ##[endgroup]`,
      `2026-11-03T10:17:02.1000000Z added 312 packages in 4s`,
      `2026-11-03T10:17:15.0000000Z ##[warning]Node.js 20 actions are deprecated.`,
      `2026-11-03T10:17:15.5000000Z ##[error]Process completed with exit code 1.`,
      "",
    ].join("\r\n");
    const lines = parseLog(text);
    expect(lines.map((l) => l.kind), "Expected group, normal, normal, endgroup, normal, warning, error").toEqual(["group", "normal", "normal", "endgroup", "normal", "warning", "error"]);
    expect(lines.map((l) => l.n), "Expected 1 to 7 with no line for the trailing newline").toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(lines[1].text, "Expected the echoed command without its escapes").toBe("npm ci");
    expect(lines[1].depth, "Expected the command inside the group").toBe(1);
    expect(lines[4].depth, "Expected 'added 312 packages' outside the group").toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// foldRanges, logCounts, stepRanges (hand-built lines)
// ---------------------------------------------------------------------------------------------------------------------------------

/** A LogLine with just what these functions read; text and spans are filler. */
function line(n: number, kind: LogKind = "normal", ts?: Date, depth = 0): LogLine {
  return { n, kind, ts, text: `line ${n}`, spans: [{ text: `line ${n}` }], depth };
}
const kinds = (...ks: LogKind[]): LogLine[] => ks.map((k, i) => line(i + 1, k));
const byStart = (r: { start: number; end: number }[]) => [...r].sort((a, b) => a.start - b.start);

describe("ACT-7: foldRanges gives each ##[group] line's range to its ##[endgroup]", () => {
  // Given parsed lines, `foldRanges` returns { start, end } line numbers (inclusive) for every group.
  it("is [] when there are no groups", () => {
    expect(foldRanges(kinds("normal", "normal", "error")), "Expected no ranges").toEqual([]);
    expect(foldRanges([]), "Expected no ranges for no lines").toEqual([]);
  });

  it("runs a group from its header to its endgroup, inclusive", () => {
    expect(foldRanges(kinds("normal", "group", "normal", "normal", "endgroup", "normal")), "Expected 2 to 5").toEqual([{ start: 2, end: 5 }]);
  });

  it("gives an empty group (header then endgroup) a range of two lines", () => {
    expect(foldRanges(kinds("group", "endgroup")), "Expected 1 to 2").toEqual([{ start: 1, end: 2 }]);
  });

  it("gives each of several sequential groups its own range", () => {
    const ranges = foldRanges(kinds("group", "normal", "endgroup", "normal", "group", "normal", "normal", "endgroup"));
    expect(byStart(ranges), "Expected 1 to 3 and 5 to 8").toEqual([{ start: 1, end: 3 }, { start: 5, end: 8 }]);
  });

  it("nests ranges: an inner group's range sits inside the outer's, matching each endgroup to the nearest open group", () => {
    // 1 group outer, 2 normal, 3 group inner, 4 normal, 5 endgroup (inner), 6 normal, 7 endgroup (outer)
    const ranges = foldRanges(kinds("group", "normal", "group", "normal", "endgroup", "normal", "endgroup"));
    expect(byStart(ranges), "Expected outer 1 to 7 and inner 3 to 5").toEqual([{ start: 1, end: 7 }, { start: 3, end: 5 }]);
  });

  it("runs an unclosed group to the last line", () => {
    expect(foldRanges(kinds("normal", "group", "normal", "normal")), "Expected 2 to 4").toEqual([{ start: 2, end: 4 }]);
  });

  it("closes the inner group with the one endgroup and runs the unclosed outer group to the last line", () => {
    // 1 group outer, 2 group inner, 3 endgroup (inner), 4 normal, 5 normal; the outer never closes.
    expect(byStart(foldRanges(kinds("group", "group", "endgroup", "normal", "normal"))), "Expected outer 1 to 5 and inner 2 to 3").toEqual([{ start: 1, end: 5 }, { start: 2, end: 3 }]);
  });

  it("ignores a stray endgroup with no open group", () => {
    expect(foldRanges(kinds("endgroup", "normal", "group", "endgroup")), "Expected only 3 to 4").toEqual([{ start: 3, end: 4 }]);
  });

  it("uses the lines' own numbers, not their positions in the array", () => {
    const lines = [line(10, "group"), line(11), line(12, "endgroup")];
    expect(foldRanges(lines), "Expected 10 to 12").toEqual([{ start: 10, end: 12 }]);
  });
});

describe("ACT-8: logCounts counts errors and warnings for the log toolbar", () => {
  // Given parsed lines, `logCounts` returns { errors, warnings } (kind 'error' and kind 'warning').
  it("is zero for no lines", () => {
    expect(logCounts([]), "Expected 0 errors and 0 warnings").toEqual({ errors: 0, warnings: 0 });
  });

  it("counts lines of kind error and kind warning", () => {
    const lines = kinds("normal", "error", "warning", "error", "normal", "error", "warning");
    expect(logCounts(lines), "Expected 3 errors and 2 warnings").toEqual({ errors: 3, warnings: 2 });
  });

  it("does not count notices, debug, commands, sections or groups", () => {
    const lines = kinds("notice", "debug", "command", "section", "group", "endgroup", "normal");
    expect(logCounts(lines), "Expected nothing counted").toEqual({ errors: 0, warnings: 0 });
  });

  it("counts a log with only warnings", () => {
    expect(logCounts(kinds("warning", "warning")), "Expected 0 errors and 2 warnings").toEqual({ errors: 0, warnings: 2 });
  });
});

describe("ACT-7: stepRanges assigns lines to steps by timestamp", () => {
  // Given parsed lines and the job's steps, `stepRanges` returns step number -> [first, last] line numbers for each step that got lines.
  const at = (s: string) => new Date(`2026-11-03T10:00:${s}Z`);
  const steps = [
    { number: 1, startedAt: at("00") },
    { number: 2, startedAt: at("10") },
    { number: 3, startedAt: at("20") },
  ];

  it("gives each step the lines from its start time up to the next step's start", () => {
    const lines = [line(1, "normal", at("00.000")), line(2, "normal", at("05.000")), line(3, "normal", at("12.000")), line(4, "normal", at("19.999")), line(5, "normal", at("25.000"))];
    expect([...stepRanges(lines, steps)], "Expected step 1 -> [1,2], 2 -> [3,4], 3 -> [5,5]").toEqual([[1, [1, 2]], [2, [3, 4]], [3, [5, 5]]]);
  });

  it("gives a line stamped exactly at a step's start to that step (at or before)", () => {
    const lines = [line(1, "normal", at("05.000")), line(2, "normal", at("10.000"))];
    const ranges = stepRanges(lines, steps);
    expect(ranges.get(1), "Expected step 1 to end at line 1").toEqual([1, 1]);
    expect(ranges.get(2), "Expected line 2, stamped exactly at step 2's start, to begin step 2").toEqual([2, 2]);
  });

  it("matches sub-second log timestamps to whole-second step start times", () => {
    const lines = [line(1, "normal", at("10.500")), line(2, "normal", at("10.900"))];
    expect(stepRanges(lines, steps).get(2), "Expected both lines in step 2").toEqual([1, 2]);
  });

  it("gives lines before the first step to the first step", () => {
    const lines = [line(1, "normal", new Date("2026-11-03T09:59:58Z")), line(2, "normal", new Date("2026-11-03T09:59:59Z")), line(3, "normal", at("01.000")), line(4, "normal", at("11.000"))];
    expect([...stepRanges(lines, steps)], "Expected step 1 -> [1,3] and step 2 -> [4,4]").toEqual([[1, [1, 3]], [2, [4, 4]]]);
  });

  it("gives a line without a timestamp to the previous line's step", () => {
    const lines = [line(1, "normal", at("12.000")), line(2), line(3), line(4, "normal", at("21.000")), line(5)];
    expect([...stepRanges(lines, steps)], "Expected step 2 -> [1,3] and step 3 -> [4,5]").toEqual([[2, [1, 3]], [3, [4, 5]]]);
  });

  it("gives leading lines without a timestamp to the first step", () => {
    const lines = [line(1), line(2), line(3, "normal", at("12.000"))];
    const ranges = stepRanges(lines, steps);
    expect(ranges.get(1), "Expected the two untimed leading lines in the first step").toEqual([1, 2]);
    expect(ranges.get(2), "Expected the timed line in step 2").toEqual([3, 3]);
  });

  it("leaves a step with no lines out of the result", () => {
    const lines = [line(1, "normal", at("01.000")), line(2, "normal", at("25.000"))];
    const ranges = stepRanges(lines, steps);
    expect([...ranges.keys()], "Expected steps 1 and 3 only; step 2 had no lines").toEqual([1, 3]);
  });

  it("gives steps without a startedAt no lines, and the lines fall to the previous step that has a start", () => {
    const withGap = [{ number: 1, startedAt: at("00") }, { number: 2 }, { number: 3, startedAt: at("20") }];
    const lines = [line(1, "normal", at("05.000")), line(2, "normal", at("15.000")), line(3, "normal", at("22.000"))];
    const ranges = stepRanges(lines, withGap);
    expect(ranges.has(2), "Expected no entry for the step without a startedAt").toBe(false);
    expect(ranges.get(1), "Expected step 1 to keep the lines up to step 3's start").toEqual([1, 2]);
    expect(ranges.get(3), "Expected step 3 from its start").toEqual([3, 3]);
  });

  it("gives all lines to the later step when two steps start in the same instant (GitHub's start times are whole seconds)", () => {
    const tied = [{ number: 1, startedAt: at("00") }, { number: 2, startedAt: at("10") }, { number: 3, startedAt: at("10") }];
    const lines = [line(1, "normal", at("03.000")), line(2, "normal", at("10.400")), line(3, "normal", at("10.800"))];
    const ranges = stepRanges(lines, tied);
    expect(ranges.has(2), "Expected step 2 to get none: step 3 is the last step started at or before those lines").toBe(false);
    expect(ranges.get(3), "Expected step 3 to take both lines").toEqual([2, 3]);
  });

  it("is empty when there are no steps", () => {
    expect(stepRanges([line(1, "normal", at("05.000"))], []).size, "Expected an empty map for no steps").toBe(0);
  });

  it("is empty when there are no lines", () => {
    expect(stepRanges([], steps).size, "Expected an empty map for no lines").toBe(0);
  });

  it("is empty when no step has a startedAt", () => {
    expect(stepRanges([line(1, "normal", at("05.000"))], [{ number: 1 }, { number: 2 }]).size, "Expected an empty map when no step has a start").toBe(0);
  });

  it("uses line numbers (n), not array positions, in the ranges", () => {
    const lines = [line(40, "normal", at("01.000")), line(41, "normal", at("02.000")), line(42, "normal", at("11.000"))];
    expect([...stepRanges(lines, steps)], "Expected [40,41] and [42,42]").toEqual([[1, [40, 41]], [2, [42, 42]]]);
  });
});

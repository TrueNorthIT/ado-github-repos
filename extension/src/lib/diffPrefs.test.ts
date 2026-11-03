import { describe, it, expect } from "vitest";
import {
  BUILT_IN_SIDE_BY_SIDE,
  WHITESPACE_ONLY_TEXT,
  parseDiffHash,
  applyDiffHash,
  storedSideBySide,
  resolveSideBySide,
  isWhitespaceOnlyPatch,
  whitespaceNotice,
} from "./diffPrefs";
import { parse, serialize } from "./browseState";

// Module under test: src/lib/diffPrefs.ts (stubs until the developer implements them).
// VW-2: "Side-by-side in PR Files. A pure preference model. The per-user default comes from extension data, and the hash override comes from browseState. Pin the precedence."
// VW-4: "Whitespace. Monaco's ignoreTrimWhitespace handles display. Also pin a pure function that says whether a file's patch is whitespace-only (so it can say "Only whitespace changes"), plus the hash key ws=1."
// The facts and decisions (precedence, key names, whitespace rule) are in the header of src/lib/diffPrefs.ts.

describe("VW-2: resolveSideBySide pins the precedence hash override > per-user default > built-in", () => {
  it("is inline by default, as PR Files is today", () => {
    expect(BUILT_IN_SIDE_BY_SIDE, "Expected the built-in default to be inline").toBe(false);
    expect(resolveSideBySide(undefined, undefined), "Expected inline with nothing set").toBe(false);
  });

  it("uses the per-user default when the hash says nothing", () => {
    expect(resolveSideBySide(undefined, true), "Expected the stored side-by-side default to apply").toBe(true);
    expect(resolveSideBySide(undefined, false), "Expected the stored inline default to apply").toBe(false);
  });

  it("lets the hash override beat the per-user default in both directions", () => {
    expect(resolveSideBySide(true, false), "Expected sbs=1 to beat a stored inline default").toBe(true);
    expect(resolveSideBySide(false, true), "Expected sbs=0 to beat a stored side-by-side default").toBe(false);
  });

  it("lets the hash override beat the built-in default", () => {
    expect(resolveSideBySide(true, undefined), "Expected sbs=1 to give side-by-side with no stored default").toBe(true);
  });
});

describe("VW-2: storedSideBySide reads the per-user default from the stored prefs document", () => {
  it("returns the stored prSideBySide boolean", () => {
    expect(storedSideBySide({ prSideBySide: true }), "Expected true").toBe(true);
    expect(storedSideBySide({ prSideBySide: false }), "Expected false").toBe(false);
  });

  it("returns undefined (not set) for nothing stored, a missing key or a value that is not a boolean", () => {
    expect(storedSideBySide(undefined), "Expected undefined for no document").toBeUndefined();
    expect(storedSideBySide(null), "Expected undefined for null").toBeUndefined();
    expect(storedSideBySide({}), "Expected undefined when the key is absent").toBeUndefined();
    expect(storedSideBySide({ prSideBySide: "true" }), "Expected the string \"true\" to be ignored").toBeUndefined();
  });
});

describe("VW-2 and VW-4: the sbs and ws hash keys", () => {
  it("reads sbs=1 as side-by-side, sbs=0 as inline and ws=1 as ignore-whitespace", () => {
    expect(parseDiffHash("#repo=o%2Fr&view=prs&pr=3&sbs=1&ws=1"), "Expected side-by-side and whitespace ignored").toEqual({ sideBySide: true, ignoreWhitespace: true });
    expect(parseDiffHash("sbs=0"), "Expected inline, with or without the leading #").toEqual({ sideBySide: false });
  });

  it("accepts the doubled ## that ADO's breadcrumb produces", () => {
    expect(parseDiffHash("##sbs=1"), "Expected ##sbs=1 to read as side-by-side").toEqual({ sideBySide: true });
  });

  it("leaves a key out when it is absent or not valid", () => {
    expect(parseDiffHash("#view=prs"), "Expected {} when neither key is present").toEqual({});
    expect(parseDiffHash("#sbs=2&ws=0"), "Expected invalid sbs and ws=0 to be absent").toEqual({});
    expect(parseDiffHash("#sbs=&ws=true"), "Expected empty and non-numeric values to be absent").toEqual({});
    expect(parseDiffHash(""), "Expected {} for an empty hash").toEqual({});
  });

  it("writes sbs and ws at the end, keeping the other segments verbatim and in order", () => {
    const out = applyDiffHash("#repo=o%2Fr&path=a%20b&view=prs&pr=3", { sideBySide: true, ignoreWhitespace: true });
    expect(out, "Expected the existing segments untouched and sbs=1&ws=1 appended").toBe("#repo=o%2Fr&path=a%20b&view=prs&pr=3&sbs=1&ws=1");
  });

  it("writes sbs=0 for inline and nothing for an undefined layout or whitespace off", () => {
    expect(applyDiffHash("#view=prs", { sideBySide: false }), "Expected sbs=0 for an explicit inline choice").toBe("#view=prs&sbs=0");
    expect(applyDiffHash("#view=prs", { sideBySide: undefined, ignoreWhitespace: false }), "Expected neither key").toBe("#view=prs");
  });

  it("replaces its own earlier keys instead of repeating them", () => {
    expect(applyDiffHash("#view=prs&sbs=1&ws=1&pr=3", { sideBySide: false }), "Expected sbs=0 only, ws removed, pr kept").toBe("#view=prs&pr=3&sbs=0");
  });

  it("starts with # even when the hash did not", () => {
    expect(applyDiffHash("view=prs", { ignoreWhitespace: true }), "Expected a leading #").toBe("#view=prs&ws=1");
  });

  it("round-trips through browseState without disturbing it: browseState ignores the keys and parseDiffHash ignores browseState's", () => {
    const state = { repo: "octo/demo", view: "prs" as const, pr: 5, prPage: "files" as const, file: "src/a b.ts" };
    const hash = applyDiffHash(serialize(state), { sideBySide: true, ignoreWhitespace: true });
    expect(parse(hash), "Expected browseState to read the same state back").toEqual(state);
    expect(parseDiffHash(hash), "Expected the diff keys back").toEqual({ sideBySide: true, ignoreWhitespace: true });
  });
});

describe("VW-4: isWhitespaceOnlyPatch says when every change vanishes with whitespace ignored", () => {
  const hunk = (...lines: string[]) => ["@@ -1,3 +1,3 @@", ...lines].join("\n");

  it("is true when a block is only re-indented", () => {
    expect(isWhitespaceOnlyPatch(hunk(" keep", "-  foo();", "-  bar();", "+    foo();", "+    bar();")), "Expected an indentation-only change to be whitespace-only").toBe(true);
  });

  it("is true for trailing whitespace and for spaces inside a line (git diff -w ignores all whitespace)", () => {
    expect(isWhitespaceOnlyPatch(hunk("-a = 1;  ", "+a = 1;")), "Expected trailing whitespace to count").toBe(true);
    expect(isWhitespaceOnlyPatch(hunk("-a  =  1;", "+a = 1;")), "Expected interior whitespace to count").toBe(true);
  });

  it("is true when only blank lines were added or removed", () => {
    expect(isWhitespaceOnlyPatch(hunk(" a", "+", "+  ", " b")), "Expected added blank lines to count").toBe(true);
    expect(isWhitespaceOnlyPatch(hunk(" a", "-", " b")), "Expected a removed blank line to count").toBe(true);
  });

  it("ignores a '\\ No newline at end of file' marker", () => {
    expect(isWhitespaceOnlyPatch(hunk("-foo", "\\ No newline at end of file", "+foo")), "Expected the marker not to be a change").toBe(true);
  });

  it("is false when any line really changed", () => {
    expect(isWhitespaceOnlyPatch(hunk("-foo();", "+bar();")), "Expected a real edit to be false").toBe(false);
    expect(isWhitespaceOnlyPatch(hunk("-  foo();", "+    foo();", "-x", "+y")), "Expected one real edit among whitespace changes to be false").toBe(false);
  });

  it("is false when a non-blank line was only added or only removed", () => {
    expect(isWhitespaceOnlyPatch(hunk(" a", "+b", " c")), "Expected a pure addition to be false").toBe(false);
    expect(isWhitespaceOnlyPatch(hunk(" a", "-b", " c")), "Expected a pure deletion to be false").toBe(false);
  });

  it("is false when the deleted and added lines do not pair up equal in order", () => {
    expect(isWhitespaceOnlyPatch(hunk("-a", "-b", "+b", "+a")), "Expected swapped lines to be a real change").toBe(false);
  });

  it("judges each hunk and is false if any hunk has a real change", () => {
    const two = [hunk("-  a", "+a"), "@@ -20,1 +20,1 @@", "-x", "+y"].join("\n");
    expect(isWhitespaceOnlyPatch(two), "Expected the second hunk's real edit to make the file false").toBe(false);
  });

  it("is true across several hunks that are all whitespace", () => {
    const two = [hunk("-  a", "+a"), "@@ -20,1 +20,1 @@", "-x ", "+x"].join("\n");
    expect(isWhitespaceOnlyPatch(two), "Expected two whitespace-only hunks to be true").toBe(true);
  });

  it("is false for a missing, null, empty or change-free patch (nothing to say)", () => {
    expect(isWhitespaceOnlyPatch(undefined), "Expected undefined to be false").toBe(false);
    expect(isWhitespaceOnlyPatch(null), "Expected null to be false").toBe(false);
    expect(isWhitespaceOnlyPatch(""), "Expected an empty patch to be false").toBe(false);
    expect(isWhitespaceOnlyPatch(hunk(" a", " b", " c")), "Expected a patch with only context lines to be false").toBe(false);
  });
});

describe("VW-4: whitespaceNotice says 'Only whitespace changes' when it applies", () => {
  const wsOnly = "@@ -1,1 +1,1 @@\n-  a\n+a";
  const real = "@@ -1,1 +1,1 @@\n-a\n+b";

  it("words the notice as in the requirement", () => {
    expect(WHITESPACE_ONLY_TEXT, "Expected the text from the requirement").toBe("Only whitespace changes");
  });

  it("shows it for a whitespace-only patch while whitespace is ignored", () => {
    expect(whitespaceNotice(wsOnly, true), "Expected the notice").toBe("Only whitespace changes");
  });

  it("shows nothing when whitespace is not being ignored, or the patch has a real change, or there is no patch", () => {
    expect(whitespaceNotice(wsOnly, false), "Expected no notice with whitespace shown").toBeNull();
    expect(whitespaceNotice(real, true), "Expected no notice for a real change").toBeNull();
    expect(whitespaceNotice(undefined, true), "Expected no notice without a patch").toBeNull();
  });
});

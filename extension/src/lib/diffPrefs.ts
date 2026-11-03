// Batch 4, PR Files diff display preferences: side-by-side (VW-2) and whitespace (VW-4).
//
// Facts:
//  - Monaco's `ignoreTrimWhitespace` (set today to false in monacoChunk.createDiff) does the display work for whitespace; this module only decides when to turn it on and when to say "Only whitespace changes".
//  - GitHub's own "Hide whitespace" is the `w=1` URL parameter and ignores ALL whitespace; isWhitespaceOnlyPatch follows that (git diff -w), which is wider than Monaco's trim-only option.
//  - REST GET /pulls/{n}/files `patch` has hunks only, no file header, so every line starting "-" is a deletion and every line starting "+" an addition; "\ No newline at end of file" lines carry no content.
//  - prefs.ts already keeps `sideBySide` for the COMMIT detail page (default true). PR Files gets its own stored key, `prSideBySide`, because PR Files is inline today (FilesView sideBySide = false): the
//    built-in default for PR Files is inline.
//
// Decisions fixed by the tests (diffPrefs.test.ts):
//  - Precedence for side-by-side: hash `sbs` override, then the stored per-user `prSideBySide`, then BUILT_IN_SIDE_BY_SIDE (false, inline).
//  - Hash keys, owned by this module and not in browseState.ts (collision-checked against its keys): `sbs` (1 = side-by-side, 0 = inline; anything else is absent) and `ws` (1 = ignore whitespace; absent otherwise).
//  - applyDiffHash keeps every other segment of the hash verbatim and in order, and appends this module's keys last.
export const BUILT_IN_SIDE_BY_SIDE = false;
/** Shown over a file whose changes disappear when whitespace is ignored. */
export const WHITESPACE_ONLY_TEXT = "Only whitespace changes";

export interface DiffHashState {
  /** undefined when the hash carries no (valid) `sbs`. */
  sideBySide?: boolean;
  /** true when the hash has ws=1; undefined otherwise. */
  ignoreWhitespace?: true;
}

/** Reads `sbs` and `ws` from a location hash (with or without leading "#" or several). Never throws; garbage gives {}. */
export function parseDiffHash(hash: string): DiffHashState {
  const out: DiffHashState = {};
  for (const seg of hash.replace(/^#+/, "").split("&")) {
    if (seg === "sbs=1") out.sideBySide = true;
    else if (seg === "sbs=0") out.sideBySide = false;
    else if (seg === "ws=1") out.ignoreWhitespace = true;
  }
  return out;
}

/**
 * Returns `hash` (starting "#") with this module's keys replaced: sbs=1 or sbs=0 when sideBySide is a boolean, ws=1 when ignoreWhitespace is true, neither key otherwise.
 * Other segments are kept verbatim and in order; the new keys go last, sbs before ws.
 */
export function applyDiffHash(hash: string, state: { sideBySide?: boolean; ignoreWhitespace?: boolean }): string {
  const kept = hash.replace(/^#+/, "").split("&").filter((s) => s && !/^(sbs|ws)=/.test(s));
  if (typeof state.sideBySide === "boolean") kept.push(`sbs=${state.sideBySide ? 1 : 0}`);
  if (state.ignoreWhitespace === true) kept.push("ws=1");
  return "#" + kept.join("&");
}

/** The stored per-user default: `prSideBySide` when the stored prefs document has it as a real boolean, otherwise undefined (not set). Accepts null and undefined. */
export function storedSideBySide(stored: { prSideBySide?: unknown } | null | undefined): boolean | undefined {
  return typeof stored?.prSideBySide === "boolean" ? stored.prSideBySide : undefined;
}

/** hash override, else per-user default, else BUILT_IN_SIDE_BY_SIDE. */
export function resolveSideBySide(hashValue: boolean | undefined, userDefault: boolean | undefined): boolean {
  return hashValue ?? userDefault ?? BUILT_IN_SIDE_BY_SIDE;
}

/**
 * True when the file's REST `patch` changes nothing once whitespace is ignored: within each hunk, drop deleted and added lines that are blank, then the remaining deleted and added lines pair up in order
 * and each pair is equal after removing ALL whitespace. A missing, null or empty patch, or one with no changed lines, is false (nothing to say).
 */
export function isWhitespaceOnlyPatch(patch: string | null | undefined): boolean {
  if (!patch) return false;
  const strip = (l: string) => l.slice(1).replace(/\s+/g, "");
  let changed = false;
  let del: string[] = [];
  let add: string[] = [];
  const close = () => {
    const d = del.filter(Boolean), a = add.filter(Boolean);
    changed = changed || del.length > 0 || add.length > 0;
    const same = d.length === a.length && d.every((x, i) => x === a[i]);
    del = [];
    add = [];
    return same;
  };
  for (const l of patch.split("\n")) {
    if (l.startsWith("-")) del.push(strip(l));
    else if (l.startsWith("+")) add.push(strip(l));
    else if (l.startsWith("\\")) continue;
    else if (!close()) return false;
  }
  return close() && changed;
}

/** WHITESPACE_ONLY_TEXT when `ignoreWhitespace` is on AND the patch is whitespace-only; null otherwise. */
export function whitespaceNotice(patch: string | null | undefined, ignoreWhitespace: boolean): string | null {
  return ignoreWhitespace && isWhitespaceOnlyPatch(patch) ? WHITESPACE_ONLY_TEXT : null;
}

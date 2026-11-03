// Batch 3, formatting toolbar for the comment box (CM-9). STUBS: the developer implements them. Every function throws "Not implemented" except the types.
//
// No GraphQL here: pure text edits over a textarea's (value, selStart, selEnd). Facts the rules rest on (GitHub-flavoured markdown, as GitHub's own toolbar writes it):
//  - bold is **text**, italic is _text_, inline code is `text`, a link is [text](url), a quote line starts "> ", lists start "- ", "1. " and "- [ ] ", a heading is "### " (the toolbar's Heading button).
//  - a suggestion is a fenced block with info string `suggestion` (see suggestions.ts); its fence is lengthened when the content has a fence of its own.
//  - A textarea selection is [selStart, selEnd) with selStart <= selEnd; every function here expects that order and returns the new selection in the same terms.
//
// Selection rule for line-prefix edits (quote, lists, heading): the selection keeps covering the same text. selStart moves by the change made on its own line; selEnd by all the changes on
// lines up to and including its own. A caret (selStart == selEnd) is the same rule, so a caret at column 0 ends up after the new prefix.
//
// Not covered by these rules (decisions, so the developer need not guess): indentation before a list marker is kept; a multi-line selection is wrapped as a whole by bold, italic and inline code
// (no per-line wrapping); the suggestion button does not toggle (pressing it twice adds a second block, as on GitHub).

export interface TextEdit {
  value: string;
  selStart: number;
  selEnd: number;
}

export type ToolbarAction = "bold" | "italic" | "code" | "link" | "quote" | "bulletList" | "numberedList" | "taskList" | "heading" | "suggestion";

const NOT_IMPLEMENTED = "Not implemented";

/**
 * **bold**. Non-empty selection "x":
 *  - already wrapped, with the markers just outside the selection ("**|x|**") or inside it ("|**x**|"): the markers are removed and the text stays selected;
 *  - otherwise wrapped as "**x**" with the text (not the markers) selected.
 * Empty selection: inserts "****" with the caret between; if the caret is already between an empty pair ("**|**") the pair is removed.
 */
export function bold(_value: string, _selStart: number, _selEnd: number): TextEdit {
  throw new Error(NOT_IMPLEMENTED);
}

/** _italic_ with the same rules as bold, marker "_". Only "_" counts as italic, so text inside ** ** is wrapped, not unwrapped. */
export function italic(_value: string, _selStart: number, _selEnd: number): TextEdit {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Code. A selection with no line break is wrapped in single backticks with the same toggle rules as bold (marker "`"; empty selection gives "``" with the caret between).
 * A selection containing a line break is widened to whole lines and fenced: "```\n<lines>\n```", the inner lines selected, any text after the fence (including a final newline) kept.
 * If the widened lines already sit between a line that is exactly "```" and another that is exactly "```", the two fence lines are removed instead and the inner lines stay selected.
 */
export function code(_value: string, _selStart: number, _selEnd: number): TextEdit {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * [text](url).
 *  - a selection that is already a link "[text](target)" or sits exactly on the text of one ("[|text|](target)") becomes "text", selected;
 *  - a selection that starts with http:// or https:// becomes "[](the url)" with the caret between the brackets;
 *  - any other non-empty selection "text" becomes "[text](url)" with the placeholder `url` selected;
 *  - an empty selection inserts "[](url)" with the caret between the brackets.
 */
export function link(_value: string, _selStart: number, _selEnd: number): TextEdit {
  throw new Error(NOT_IMPLEMENTED);
}

/** "> " on every non-blank line the selection touches (blank lines are left as they are; a lone empty line gets the prefix). If every non-blank touched line already starts with "> ", one "> " is removed from each instead. See the selection rule above. */
export function quote(_value: string, _selStart: number, _selEnd: number): TextEdit {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Bulleted list: "- " on each non-blank touched line. A line's list kind is task ("- [ ] " or "- [x] ", also with * or +), else bullet ("- ", "* ", "+ "), else numbered ("1. " or "1) "), else none.
 * If every non-blank touched line is already a bullet, the markers are removed. Otherwise any existing marker on each line (of any kind) is replaced by "- ". Blank lines are untouched.
 */
export function bulletList(_value: string, _selStart: number, _selEnd: number): TextEdit {
  throw new Error(NOT_IMPLEMENTED);
}

/** Numbered list: "1. ", "2. ", ... on the non-blank touched lines in order (blank lines are skipped and not counted). Same kind detection, toggle-off and replacement rules as bulletList. */
export function numberedList(_value: string, _selStart: number, _selEnd: number): TextEdit {
  throw new Error(NOT_IMPLEMENTED);
}

/** Task list: "- [ ] " on each non-blank touched line. Same kind detection, toggle-off (every line already a task, checked or not) and replacement rules as bulletList. */
export function taskList(_value: string, _selStart: number, _selEnd: number): TextEdit {
  throw new Error(NOT_IMPLEMENTED);
}

/** "### " on each non-blank touched line. A line that already starts with 1 to 6 "#" and a space has that prefix replaced by "### ". If every non-blank touched line already starts with exactly "### ", it is removed instead. */
export function heading(_value: string, _selStart: number, _selEnd: number): TextEdit {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Replaces the selection with a suggestion block holding `originalLines` (the thread's lines as they stand, so the author edits them in place):
 * "```suggestion\n" + originalLines.join("\n") + "\n```", the fence one backtick longer than any backtick run that starts one of the lines when that is 3 or more (as suggestions.buildSuggestionBody does).
 * The block starts on its own line (a "\n" is added before it when the selection start is not at the start of the text or of a line) and is followed by a line break (a "\n" is added after it when text follows
 * on the same line). The selection afterwards covers the original lines inside the block. Throws "original lines are required" for an empty array.
 */
export function suggestion(_value: string, _selStart: number, _selEnd: number, _originalLines: string[]): TextEdit {
  throw new Error(NOT_IMPLEMENTED);
}

export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Ctrl (or Cmd) + B bold, I italic, K link, E code; the letter in either case. Any other key, no Ctrl/Cmd, or Alt or Shift held, gives null. */
export function shortcutAction(_e: ShortcutKey): ToolbarAction | null {
  throw new Error(NOT_IMPLEMENTED);
}

/** Runs the named action: the same result as calling that function directly. `originalLines` is used by "suggestion" only (which throws "original lines are required" when it is missing). */
export function applyToolbar(_action: ToolbarAction, _value: string, _selStart: number, _selEnd: number, _ctx?: { originalLines?: string[] }): TextEdit {
  throw new Error(NOT_IMPLEMENTED);
}

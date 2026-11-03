// Batch 3, formatting toolbar for the comment box (CM-9): pure text edits over a textarea's (value, selStart, selEnd).
// Markers are GitHub's own: **bold**, _italic_, `code`, [text](url), "> " quote, "- " / "1. " / "- [ ] " lists, "### " heading, ```suggestion fence.
// Selection rule for line-prefix edits: selStart moves by the change on its own line, selEnd by every change up to and including its line.

export interface TextEdit {
  value: string;
  selStart: number;
  selEnd: number;
}

export type ToolbarAction = "bold" | "italic" | "code" | "link" | "quote" | "bulletList" | "numberedList" | "taskList" | "heading" | "suggestion";

const edit = (value: string, selStart: number, selEnd: number): TextEdit => ({ value, selStart, selEnd });
const NL = String.fromCharCode(10);
const FENCE = "```";

/** Toggle a symmetric marker around the selection (bold, italic, inline code). */
function wrap(m: string, value: string, s: number, e: number): TextEdit {
  const n = m.length;
  const sel = value.slice(s, e);
  const around = s - n >= 0 && value.slice(s - n, s) === m && value.slice(e, e + n) === m;
  if (s === e) return around ? edit(value.slice(0, s - n) + value.slice(e + n), s - n, s - n) : edit(value.slice(0, s) + m + m + value.slice(e), s + n, s + n);
  if (sel.length >= 2 * n && sel.startsWith(m) && sel.endsWith(m)) return edit(value.slice(0, s) + sel.slice(n, -n) + value.slice(e), s, e - 2 * n);
  if (around) return edit(value.slice(0, s - n) + sel + value.slice(e + n), s - n, e - n);
  return edit(value.slice(0, s) + m + sel + m + value.slice(e), s + n, e + n);
}

/** **bold**; toggles off. */
export function bold(value: string, selStart: number, selEnd: number): TextEdit {
  return wrap("**", value, selStart, selEnd);
}

/** _italic_; toggles off. Only "_" counts, so text inside ** ** is wrapped, not unwrapped. */
export function italic(value: string, selStart: number, selEnd: number): TextEdit {
  return wrap("_", value, selStart, selEnd);
}

/** Inline code for a one-line selection; a fenced block (whole lines) when the selection spans lines; toggles both off. */
export function code(value: string, selStart: number, selEnd: number): TextEdit {
  if (!value.slice(selStart, selEnd).includes(NL)) return wrap("`", value, selStart, selEnd);
  const end = value[selEnd - 1] === NL ? selEnd - 1 : selEnd;
  const ls = value.lastIndexOf(NL, selStart - 1) + 1;
  const nl = value.indexOf(NL, end);
  const le = nl < 0 ? value.length : nl;
  const lines = value.slice(ls, le);
  const prevStart = ls > 0 ? value.lastIndexOf(NL, ls - 2) + 1 : 0;
  const rest = value.slice(le + 1);
  const fenceEnd = rest.indexOf(NL);
  if (ls > 0 && le < value.length && value.slice(prevStart, ls - 1) === FENCE && (fenceEnd < 0 ? rest : rest.slice(0, fenceEnd)) === FENCE) {
    return edit(value.slice(0, prevStart) + lines + (fenceEnd < 0 ? "" : rest.slice(fenceEnd)), prevStart, prevStart + lines.length);
  }
  return edit(value.slice(0, ls) + FENCE + NL + lines + NL + FENCE + value.slice(le), ls + 4, ls + 4 + lines.length);
}

/** [text](url); a selected link becomes its text again. */
export function link(value: string, selStart: number, selEnd: number): TextEdit {
  const s = selStart, e = selEnd;
  const sel = value.slice(s, e);
  const whole = /^\[([^\]]*)\]\([^)]*\)$/.exec(sel);
  if (whole) return edit(value.slice(0, s) + whole[1] + value.slice(e), s, s + whole[1].length);
  const tail = /^\]\([^)]*\)/.exec(value.slice(e));
  if (sel && value[s - 1] === "[" && tail) return edit(value.slice(0, s - 1) + sel + value.slice(e + tail[0].length), s - 1, e - 1);
  if (/^https?:\/\//.test(sel)) return edit(value.slice(0, s) + `[](${sel})` + value.slice(e), s + 1, s + 1);
  if (!sel) return edit(value.slice(0, s) + "[](url)" + value.slice(e), s + 1, s + 1);
  const urlAt = s + sel.length + 3;
  return edit(value.slice(0, s) + `[${sel}](url)` + value.slice(e), urlAt, urlAt + 3);
}

/** Applies `fn` to the touched lines that matter (non-blank ones, or all when every touched line is blank) and moves the selection by the rule in the header. */
function lineEdit(value: string, s: number, e: number, fn: (targets: string[]) => string[]): TextEdit {
  const ls = value.lastIndexOf(NL, s - 1) + 1;
  const nl = value.indexOf(NL, e);
  const le = nl < 0 ? value.length : nl;
  const old = value.slice(ls, le).split(NL);
  let targets = old.map((_, i) => i).filter((i) => old[i].trim() !== "");
  if (!targets.length) targets = old.map((_, i) => i);
  const out = [...old];
  fn(targets.map((i) => old[i])).forEach((l, k) => (out[targets[k]] = l));
  let pos = ls, shift = 0, newS = s, newE = e;
  old.forEach((l, i) => {
    const delta = out[i].length - l.length;
    const lineStartNew = pos + shift;
    if (s >= pos && s <= pos + l.length) newS = Math.max(lineStartNew, s + shift + delta);
    shift += delta;
    if (e >= pos && e <= pos + l.length) newE = Math.max(lineStartNew, e + shift);
    pos += l.length + 1;
  });
  return edit(value.slice(0, ls) + out.join(NL) + value.slice(le), newS, newE);
}

/** "> " on the touched lines; removed when all already have it. */
export function quote(value: string, selStart: number, selEnd: number): TextEdit {
  return lineEdit(value, selStart, selEnd, (ls) => {
    const all = ls.every((l) => l.startsWith("> "));
    return ls.map((l) => (all ? l.slice(2) : "> " + l));
  });
}

const MARKER = { task: /^(\s*)[-*+] \[[ xX]\] /, bullet: /^(\s*)[-*+] /, numbered: /^(\s*)\d+[.)] / };
const kindOf = (l: string) => (MARKER.task.test(l) ? "task" : MARKER.bullet.test(l) ? "bullet" : MARKER.numbered.test(l) ? "numbered" : null);

function listEdit(value: string, s: number, e: number, want: "bullet" | "numbered" | "task"): TextEdit {
  return lineEdit(value, s, e, (ls) => {
    const off = ls.every((l) => kindOf(l) === want);
    let n = 0;
    return ls.map((l) => {
      const k = kindOf(l);
      const bare = k ? l.replace(MARKER[k], "$1") : l;
      if (off) return bare;
      const ind = /^\s*/.exec(bare)![0];
      return ind + (want === "bullet" ? "- " : want === "task" ? "- [ ] " : `${++n}. `) + bare.slice(ind.length);
    });
  });
}

/** "- " list; toggles off when every line is a bullet, otherwise replaces any other marker. */
export function bulletList(value: string, selStart: number, selEnd: number): TextEdit {
  return listEdit(value, selStart, selEnd, "bullet");
}

/** "1. " list, skipping blank lines when counting. */
export function numberedList(value: string, selStart: number, selEnd: number): TextEdit {
  return listEdit(value, selStart, selEnd, "numbered");
}

/** "- [ ] " list. */
export function taskList(value: string, selStart: number, selEnd: number): TextEdit {
  return listEdit(value, selStart, selEnd, "task");
}

/** "### " on the touched lines; another level is replaced, an existing "### " removed. */
export function heading(value: string, selStart: number, selEnd: number): TextEdit {
  return lineEdit(value, selStart, selEnd, (ls) => {
    const all = ls.every((l) => l.startsWith("### "));
    return ls.map((l) => (all ? l.slice(4) : "### " + l.replace(/^#{1,6} /, "")));
  });
}

/** A suggestion block holding `originalLines`, on its own lines, with the original lines selected. The fence grows when a line starts a fence of its own. */
export function suggestion(value: string, selStart: number, selEnd: number, originalLines: string[]): TextEdit {
  if (!originalLines.length) throw new Error("original lines are required");
  const longest = Math.max(0, ...originalLines.map((l) => /^ *(`{3,})/.exec(l)?.[1].length ?? 0));
  const fence = "`".repeat(longest >= 3 ? longest + 1 : 3);
  const pre = selStart > 0 && value[selStart - 1] !== NL ? NL : "";
  const post = selEnd < value.length && value[selEnd] !== NL ? NL : "";
  const open = `${fence}suggestion${NL}`;
  const text = originalLines.join(NL);
  const start = selStart + pre.length + open.length;
  return edit(value.slice(0, selStart) + pre + open + text + NL + fence + post + value.slice(selEnd), start, start + text.length);
}

export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const SHORTCUTS: Record<string, ToolbarAction> = { b: "bold", i: "italic", k: "link", e: "code" };

/** Ctrl (or Cmd) + B bold, I italic, K link, E code; any other key, no Ctrl/Cmd, or Alt or Shift held, gives null. */
export function shortcutAction(e: ShortcutKey): ToolbarAction | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null;
  return SHORTCUTS[e.key.toLowerCase()] ?? null;
}

/** Runs the named action. `originalLines` is for "suggestion" only. */
export function applyToolbar(action: ToolbarAction, value: string, selStart: number, selEnd: number, ctx?: { originalLines?: string[] }): TextEdit {
  if (action === "suggestion") return suggestion(value, selStart, selEnd, ctx?.originalLines ?? []);
  return { bold, italic, code, link, quote, bulletList, numberedList, taskList, heading }[action](value, selStart, selEnd);
}

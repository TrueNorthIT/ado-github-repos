// Lazy chunk: loaded by dynamic import() only when a file is opened. Core editor, Monarch (main-thread) tokenisers
// for each language loaded on demand, and the few contributions a read-only viewer needs. No language workers.
import "monaco-editor/editor/browser/coreCommands.js";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/folding/browser/folding.js";
// Only the editable variant needs these two: Ctrl+M lets Tab leave the editor (a keyboard trap otherwise), and the line shortcuts people expect when typing.
import "monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js";
import "monaco-editor/basic-languages/monaco.contribution.js";
import "../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import * as monaco from "monaco-editor/editor/editor.api.js";
import { afterModifiedLine } from "./lib/diffMap";

// Only Monaco's base editor worker is bundled (editor.worker.js, built beside monaco.js): it computes the PR diffs.
// No language workers, so JSON/TS/CSS language services stay off. The URL is next to this file, so on the gallery CDN it is same-origin.
// The worker gets no tokens: file contents are fetched on the main thread and passed in as models.
(self as any).MonacoEnvironment = { getWorker: () => new Worker(new URL("editor.worker.js", import.meta.url), { type: "module" }) };

// Monaco's own JSON highlighting ships with its (worker-backed) JSON language service, which we leave out; this is a plain Monarch one.
monaco.languages.register({ id: "json", extensions: [".json", ".jsonc"] });
monaco.languages.setMonarchTokensProvider("json", {
  tokenizer: {
    root: [
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, "string.key"],
      [/"(?:[^"\\]|\\.)*"/, "string"],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
      [/\b(?:true|false|null)\b/, "keyword"],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/[{}[\]]/, "delimiter.bracket"],
      [/[:,]/, "delimiter"],
    ],
    comment: [
      [/[^*/]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[*/]/, "comment"],
    ],
  },
});

// ADO's light editor has dark-blue line numbers; "vs" has teal ones.
// Native PR diffs tint whole lines (sampled from Repos: red rgb(250,232,232), green rgb(234,244,235)) and don't mark changed words.
const diffColors = (removed: string, added: string) => ({
  "diffEditor.removedLineBackground": removed, "diffEditor.insertedLineBackground": added,
  "diffEditor.removedTextBackground": "#00000000", "diffEditor.insertedTextBackground": "#00000000",
});
monaco.editor.defineTheme("ado-light", { base: "vs", inherit: true, rules: [], colors: { "editorLineNumber.foreground": "#0b216f", "editorLineNumber.activeForeground": "#0b216f", ...diffColors("#fae8e8", "#eaf4eb") } });
monaco.editor.defineTheme("ado-dark", { base: "vs-dark", inherit: true, rules: [], colors: diffColors("#4b1818", "#1b3a1f") });
// Native Pipelines' log is always dark (sampled: pane rgb(32,31,30), text rgb(225,223,221), line numbers rgb(161,159,157)). Monaco's theme is global
// (a per-editor `theme` option calls the same setTheme), so the log viewer switches to this theme while it is open; file viewers set their own on creation.
monaco.editor.defineTheme("ado-log", { base: "vs-dark", inherit: true, rules: [], colors: { "editor.background": "#201f1e", "editor.foreground": "#e1dfdd", "editorLineNumber.foreground": "#a19f9d", "editorLineNumber.activeForeground": "#e1dfdd", "editorGutter.background": "#201f1e" } });
const themeName = (dark: boolean) => (dark ? "ado-dark" : "ado-light");

export function createViewer(el: HTMLElement, value: string, language: string, dark: boolean, label: string) {
  monaco.editor.setTheme(themeName(dark));
  return monaco.editor.create(el, {
    value,
    language,
    readOnly: true,
    domReadOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: "on",
    links: false,
    colorDecorators: false,
    occurrencesHighlight: "off",
    quickSuggestions: false,
    renderLineHighlight: "none",
    wordBasedSuggestions: "off",
    ariaLabel: label,
    // Repos' own editor metrics: 12px Consolas on a 16px line.
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Consolas, "Courier New", monospace',
  });
}

/** The same editor, editable: for a web edit. `onChange` runs after each edit. The caller reads `getValue()` (the model keeps the file's line endings) and disposes the editor. */
export function createEditor(el: HTMLElement, value: string, language: string, dark: boolean, label: string, onChange: () => void) {
  const editor = createViewer(el, value, language, dark, label);
  editor.updateOptions({ readOnly: false, domReadOnly: false, renderLineHighlight: "line", scrollBeyondLastLine: false, ariaLabel: `${label}. Press Ctrl+M to make Tab move focus out of the editor.` });
  const sub = editor.onDidChangeModelContent(onChange);
  return { editor, dispose: () => { sub.dispose(); editor.dispose(); } };
}

/** A link to lines (Files: `line`/`lineEnd`): tints them like native Repos and scrolls them to the middle. Lines past the end are clamped. */
export function highlightLines(editor: monaco.editor.IStandaloneCodeEditor, line: number, lineEnd: number) {
  const last = editor.getModel()?.getLineCount() ?? 1;
  const a = Math.min(line, last), b = Math.min(Math.max(line, lineEnd), last);
  const c = editor.createDecorationsCollection([{ range: new monaco.Range(a, 1, b, 1), options: { isWholeLine: true, className: "gh-line-linked", linesDecorationsClassName: "gh-line-linked-gutter" } }]);
  editor.revealLinesInCenter(a, b);
  return () => c.clear();
}

/** Calls `cb` with each selection the user makes (mouse or keyboard), for "Copy link to lines". */
export function onUserSelection(editor: monaco.editor.IStandaloneCodeEditor, cb: (s: { startLineNumber: number; endLineNumber: number; endColumn: number }) => void) {
  return editor.onDidChangeCursorSelection((e) => { if (e.source === "mouse" || e.source === "keyboard") cb(e.selection); });
}

export const setLanguage =(editor: monaco.editor.IStandaloneCodeEditor, language: string) => monaco.editor.setModelLanguage(editor.getModel()!, language);

export const setTheme = (dark: boolean) => monaco.editor.setTheme(themeName(dark));

/** A read-only diff, inline unless `sideBySide`, with unchanged regions collapsed. Dispose the editor and both models when done. */
export function createDiff(el: HTMLElement, original: string, modified: string, language: string, dark: boolean, label: string, sideBySide = false) {
  monaco.editor.setTheme(themeName(dark));
  const o = monaco.editor.createModel(original, language);
  const m = monaco.editor.createModel(modified, language);
  const editor = monaco.editor.createDiffEditor(el, {
    readOnly: true,
    originalEditable: false,
    domReadOnly: true,
    renderSideBySide: sideBySide,
    useInlineViewWhenSpaceIsLimited: false,
    hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 },
    renderOverviewRuler: false,
    renderMarginRevertIcon: false,
    renderIndicators: true,
    ignoreTrimWhitespace: false,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    scrollbar: { vertical: "hidden", handleMouseWheel: false, alwaysConsumeMouseWheel: false, horizontal: "auto" },
    minimap: { enabled: false },
    renderLineHighlight: "none",
    ariaLabel: label,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Consolas, "Courier New", monospace',
  });
  editor.setModel({ original: o, modified: m });
  const dispose = () => { editor.dispose(); o.dispose(); m.dispose(); };
  return { editor, dispose };
}

/** An added or deleted file: one read-only editor with every line tinted, so no phantom empty line from diffing against "". */
export function createWholeFile(el: HTMLElement, text: string, language: string, dark: boolean, label: string, kind: "added" | "removed") {
  const editor = createViewer(el, text.replace(/\n$/, ""), language, dark, label);
  const model = editor.getModel()!;
  editor.updateOptions({ lineDecorationsWidth: 18, scrollbar: { vertical: "hidden", handleMouseWheel: false, alwaysConsumeMouseWheel: false } });
  editor.createDecorationsCollection([{
    range: new monaco.Range(1, 1, model.getLineCount(), 1),
    options: { isWholeLine: true, className: `gh-pr-line-${kind}`, linesDecorationsClassName: `gh-pr-gutter-${kind}` },
  }]);
  return { editor, dispose: () => { editor.dispose(); model.dispose(); } };
}

// ---------- inline comment threads (AF-6): view zones that host React content ----------

/** A view zone after `afterLine` of `ed` hosting `node`. Monaco fixes a zone's own height, so `node` sits inside a wrapper and its content height is observed; the zone follows it. */
function addZone(ed: monaco.editor.ICodeEditor, afterLine: number, node: HTMLElement): () => void {
  const wrap = document.createElement("div");
  wrap.appendChild(node);
  // Monaco sizes a zone to the content's scroll width, so a long line made the card wider than the diff and hid its
  // right-hand buttons (seen live in 0.19.0). Keep it to the visible text area and pinned while the code scrolls sideways.
  const fit = () => {
    const l = ed.getLayoutInfo();
    wrap.style.width = `${Math.max(200, l.contentWidth - l.verticalScrollbarWidth)}px`;
    wrap.style.transform = `translateX(${ed.getScrollLeft()}px)`;
  };
  fit();
  const subs = [ed.onDidLayoutChange(fit), ed.onDidScrollChange((e) => { if (e.scrollLeftChanged) fit(); })];
  let id = "";
  // suppressMouseDown must stay false: true makes Monaco preventDefault every mousedown in the zone, so the reply box
  // never took focus and dropdowns never opened (seen live in 0.25.0). With false Monaco ignores the zone entirely.
  // Don't stopPropagation on `wrap` either: React 16 handles events at document, so the card's own handlers would die.
  const zone: monaco.editor.IViewZone = { afterLineNumber: afterLine, heightInPx: 120, domNode: wrap, suppressMouseDown: false };
  ed.changeViewZones((a) => { id = a.addZone(zone); });
  const ro = new ResizeObserver(() => {
    const h = Math.ceil(node.getBoundingClientRect().height);
    if (h > 0 && h !== zone.heightInPx) {
      zone.heightInPx = h;
      ed.changeViewZones((a) => a.layoutZone(id));
    }
  });
  ro.observe(node);
  return () => {
    ro.disconnect();
    subs.forEach((s) => s.dispose());
    try { ed.changeViewZones((a) => a.removeZone(id)); } catch { /* the editor is already gone */ }
  };
}

export interface ZonePlan { side: "LEFT" | "RIGHT"; line: number; node: HTMLElement }
export type ZoneTarget = { kind: "diff"; editor: monaco.editor.IStandaloneDiffEditor } | { kind: "whole"; editor: monaco.editor.IStandaloneCodeEditor; /** Which side the one editor shows: an added file is RIGHT, a deleted one LEFT. */ side?: "LEFT" | "RIGHT" };

/**
 * Puts each plan's node under its line. In the inline diff the modified editor hosts every zone: RIGHT lines are its own,
 * LEFT (base) lines are mapped through the diff once it is computed. A whole-file editor shows one side, so every line is its own.
 * Returns a function that removes them all.
 */
export function placeZones(target: ZoneTarget, plans: ZonePlan[]): () => void {
  const removers: (() => void)[] = [];
  let off: monaco.IDisposable | undefined;
  if (target.kind === "whole") {
    for (const p of plans) removers.push(addZone(target.editor, p.line, p.node));
  } else {
    const ed = target.editor;
    const modified = ed.getModifiedEditor();
    for (const p of plans) if (p.side === "RIGHT") removers.push(addZone(modified, p.line, p.node));
    const left = plans.filter((p) => p.side === "LEFT");
    const placeLeft = () => { for (const p of left) removers.push(addZone(modified, afterModifiedLine(p.line, ed.getLineChanges() ?? []), p.node)); };
    if (left.length) {
      if (ed.getLineChanges()) placeLeft();
      else off = ed.onDidUpdateDiff(() => { off?.dispose(); off = undefined; placeLeft(); });
    }
  }
  return () => { off?.dispose(); removers.forEach((r) => r()); };
}

// ---------- commenting on lines (CM-1): the gutter "+", drag and shift-click ranges, and a keyboard shortcut ----------

export interface LineSpan {
  side: "LEFT" | "RIGHT";
  startLine: number;
  endLine: number;
}
export interface LineCommentOptions {
  /** Whether a single line of that side can take a comment (it lies in a diff hunk). */
  allow: (side: "LEFT" | "RIGHT", line: number) => boolean;
  /** The user picked a line or a range (by click, drag, shift-click or the keyboard). */
  onSelect: (span: LineSpan) => void;
}

const BUTTON = 18;

/** One editor: a real <button> that follows the pointer along the gutter. Plain click is one line, drag or shift-click a range, Ctrl+Alt+M uses the editor's own selection. */
function lineComments(ed: monaco.editor.IStandaloneCodeEditor, side: "LEFT" | "RIGHT", o: LineCommentOptions): { dispose(): void; highlight(span: LineSpan | null): void } {
  ed.updateOptions({ lineDecorationsWidth: BUTTON + 4 });
  const host = ed.getDomNode();
  const noop = { dispose() {}, highlight() {} };
  if (!host) return noop;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gh-add-comment";
  btn.textContent = "+";
  btn.title = "Add a comment (drag or Shift-click for several lines)";
  btn.setAttribute("aria-label", "Add a comment on this line");
  btn.tabIndex = -1; // hover affordance for the mouse: the keyboard path is Ctrl+Alt+M in the editor
  btn.style.display = "none";
  host.appendChild(btn);
  const marker = ed.createDecorationsCollection([]);
  let line = 0;
  let anchor = 0;
  let last = 0;
  let dragging = false;
  let overButton = false;

  const show = (l: number) => {
    line = l;
    const lh = ed.getOption(monaco.editor.EditorOption.lineHeight);
    btn.style.top = `${ed.getTopForLineNumber(l) - ed.getScrollTop() + Math.max(0, (lh - BUTTON) / 2)}px`;
    btn.style.left = `${ed.getLayoutInfo().decorationsLeft + 1}px`;
    btn.style.display = "";
  };
  const hide = () => { if (!dragging && !overButton) btn.style.display = "none"; };
  const mark = (span: LineSpan | null) => marker.set(span ? [{ range: new monaco.Range(Math.min(span.startLine, span.endLine), 1, Math.max(span.startLine, span.endLine), 1), options: { isWholeLine: true, className: "gh-comment-range" } }] : []);
  const lineAt = (e: { clientX: number; clientY: number }) => ed.getTargetAtClientPoint(e.clientX, e.clientY)?.position?.lineNumber ?? 0;
  const gutter = (t: monaco.editor.IMouseTarget) => t.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS || t.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS || t.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;

  const subs = [
    ed.onMouseMove((e) => {
      if (dragging) return;
      const l = e.target.position?.lineNumber;
      if (l && gutter(e.target) && o.allow(side, l)) show(l);
      else hide();
    }),
    ed.onMouseLeave(() => hide()),
    ed.onDidScrollChange(() => { if (!dragging) btn.style.display = "none"; }),
    // a click on the line number itself is a click on the button; with Shift it extends from the last line
    ed.onMouseDown((e) => {
      const l = e.target.position?.lineNumber;
      if (!l || !gutter(e.target) || !o.allow(side, l)) return;
      if (e.event.shiftKey && last) {
        const span = { side, startLine: Math.min(last, l), endLine: Math.max(last, l) };
        mark(span);
        o.onSelect(span);
      } else {
        last = l;
        const span = { side, startLine: l, endLine: l };
        mark(span);
        o.onSelect(span);
      }
    }),
  ];
  const action = ed.addAction({
    id: "gh.addComment",
    label: "Add a comment on the selected lines",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM],
    run: (editor) => {
      const s = editor.getSelection();
      if (!s) return;
      const end = s.endLineNumber > s.startLineNumber && s.endColumn === 1 ? s.endLineNumber - 1 : s.endLineNumber;
      if (o.allow(side, s.startLineNumber) && o.allow(side, end)) o.onSelect({ side, startLine: s.startLineNumber, endLine: end });
    },
  });

  btn.addEventListener("mouseenter", () => { overButton = true; });
  btn.addEventListener("mouseleave", () => { overButton = false; hide(); });
  // Native listeners on purpose: this button lives inside Monaco's DOM, outside React.
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    anchor = e.shiftKey && last ? last : line;
    dragging = true;
    const move = (m: MouseEvent) => {
      const l = lineAt(m);
      if (l) mark({ side, startLine: anchor, endLine: l });
    };
    const up = (m: MouseEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      dragging = false;
      const l = lineAt(m) || line;
      const span = { side, startLine: Math.min(anchor, l), endLine: Math.max(anchor, l) };
      last = l;
      // a drag across a gap in the diff cannot be one comment: keep what is allowed at both ends and let the caller check the range
      mark(span);
      o.onSelect(span);
      hide();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
  return {
    highlight: mark,
    dispose() {
      subs.forEach((s) => s.dispose());
      action.dispose();
      marker.clear();
      btn.remove();
    },
  };
}

/** Wires the gutter "+" into every editor of a diff (the original side only shows in side-by-side). Returns a way to mark the commented range and to undo it all. */
export function enableLineComments(target: ZoneTarget, o: LineCommentOptions): { dispose(): void; highlight(span: LineSpan | null): void } {
  const parts =
    target.kind === "whole"
      ? [lineComments(target.editor, target.side ?? "RIGHT", o)]
      : [lineComments(target.editor.getModifiedEditor() as monaco.editor.IStandaloneCodeEditor, "RIGHT", o), lineComments(target.editor.getOriginalEditor() as monaco.editor.IStandaloneCodeEditor, "LEFT", o)];
  return {
    highlight: (span) => parts.forEach((p, i) => p.highlight(span && (target.kind === "whole" ? true : span.side === (i === 0 ? "RIGHT" : "LEFT")) ? span : null)),
    dispose: () => parts.forEach((p) => p.dispose()),
  };
}

// ---------- the Actions job log (ACT-7): one big read-only model, ANSI colours and error lines as decorations, folding from ##[group] ----------

const PAL_LIGHT = ["#24292f", "#cf222e", "#1a7f37", "#9a6700", "#0969da", "#8250df", "#1b7c83", "#6e7781", "#57606a", "#a40e26", "#2da44e", "#bf8700", "#218bff", "#a475f9", "#3192aa", "#8c959f"];
const PAL_DARK = ["#6e7681", "#ff7b72", "#3fb950", "#d29922", "#58a6ff", "#bc8cff", "#39c5cf", "#b1bac4", "#8b949e", "#ffa198", "#56d364", "#e3b341", "#79c0ff", "#d2a8ff", "#56d4dd", "#f0f6fc"];
let ansiSheet: HTMLStyleElement | undefined;
const ansiDone = new Set<string>();
function ansiRule(sel: string, css: string) {
  if (!ansiSheet) { ansiSheet = document.createElement("style"); document.head.appendChild(ansiSheet); }
  ansiSheet.appendChild(document.createTextNode(`${sel}{${css}}
`));
}
const cube = (i: number) => {
  if (i >= 232) { const v = 8 + (i - 232) * 10; return `rgb(${v},${v},${v})`; }
  const n = i - 16, c = (x: number) => (x ? 55 + x * 40 : 0);
  return `rgb(${c(Math.floor(n / 36))},${c(Math.floor(n / 6) % 6)},${c(n % 6)})`;
};
/** The CSS class for a colour (palette index or "#rrggbb"), created on first use. 0-15 follow the editor theme. */
function ansiColour(kind: "f" | "b", c: number | string): string {
  const name = `gh-a-${kind}-${typeof c === "number" ? c : c.slice(1)}`;
  if (ansiDone.has(name)) return name;
  ansiDone.add(name);
  const prop = kind === "f" ? "color" : "background-color";
  if (typeof c === "number" && c < 16) {
    ansiRule(`.monaco-editor.vs .${name}`, `${prop}:${PAL_LIGHT[c]}`);
    ansiRule(`.monaco-editor.vs-dark .${name}`, `${prop}:${PAL_DARK[c]}`);
  } else ansiRule(`.${name}`, `${prop}:${typeof c === "number" ? cube(c) : c}`);
  return name;
}
const ansiClass = (s: { fg?: number | string; bg?: number | string; bold?: boolean; italic?: boolean; underline?: boolean }) =>
  [s.fg !== undefined && ansiColour("f", s.fg), s.bg !== undefined && ansiColour("b", s.bg), s.bold && "gh-a-bold", s.italic && "gh-a-italic", s.underline && "gh-a-underline"].filter(Boolean).join(" ");

monaco.languages.register({ id: "ghlog" });

export interface LogDoc {
  text: string;
  marks: { line: number; start: number; end: number; span: { fg?: number | string; bg?: number | string; bold?: boolean; italic?: boolean; underline?: boolean } }[];
  levels: { line: number; kind: "error" | "warning" }[];
  folds: { start: number; end: number }[];
}

export function createLogViewer(el: HTMLElement, label: string, onLineClick: (line: number) => void) {
  monaco.editor.setTheme("ado-log");
  let folds: { start: number; end: number }[] = [];
  const provider = monaco.languages.registerFoldingRangeProvider("ghlog", { provideFoldingRanges: () => folds.map((f) => ({ start: f.start, end: f.end })) });
  const editor = monaco.editor.create(el, {
    value: "",
    language: "ghlog",
    readOnly: true,
    domReadOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: "on",
    folding: true,
    showFoldingControls: "always",
    largeFileOptimizations: false,
    renderLineHighlight: "none",
    occurrencesHighlight: "off",
    links: false,
    quickSuggestions: false,
    wordWrap: "off",
    ariaLabel: label,
    fontSize: 12,
    lineHeight: 20, // native Pipelines' log: 12px Cascadia Mono on 20px lines
    fontFamily: '"Cascadia Mono", Menlo, Consolas, "Courier New", monospace',
  });
  const styled = editor.createDecorationsCollection([]);
  const hl = editor.createDecorationsCollection([]);
  const down = editor.onMouseDown((e) => {
    if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS && e.target.position) onLineClick(e.target.position.lineNumber);
  });
  return {
    setDoc(d: LogDoc) {
      const top = editor.getScrollTop();
      folds = d.folds;
      editor.setValue(d.text);
      const decs: monaco.editor.IModelDeltaDecoration[] = d.marks.map((m) => ({ range: new monaco.Range(m.line, m.start, m.line, m.end), options: { inlineClassName: ansiClass(m.span) } }));
      for (const l of d.levels) decs.push({ range: new monaco.Range(l.line, 1, l.line, 1), options: { isWholeLine: true, className: l.kind === "error" ? "gh-log-error" : "gh-log-warning", overviewRuler: { color: l.kind === "error" ? "#cf222e" : "#bf8700", position: monaco.editor.OverviewRulerLane.Full } } });
      styled.set(decs);
      editor.setScrollTop(top);
    },
    /** Scrolls the line near the top; `mark` also highlights it. */
    reveal(line: number, mark = false, scroll = true) {
      const n = Math.min(Math.max(1, line), editor.getModel()?.getLineCount() ?? 1);
      if (scroll) editor.revealLineNearTop(n);
      editor.setPosition({ lineNumber: n, column: 1 });
      hl.set(mark ? [{ range: new monaco.Range(n, 1, n, 1), options: { isWholeLine: true, className: "gh-log-hl" } }] : []);
    },
    find() { editor.focus(); void editor.getAction("actions.find")?.run(); },
    dispose() { down.dispose(); provider.dispose(); const m = editor.getModel(); editor.dispose(); m?.dispose(); },
  };
}

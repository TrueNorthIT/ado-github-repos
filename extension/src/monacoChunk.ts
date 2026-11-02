// Lazy chunk: loaded by dynamic import() only when a file is opened. Core editor, Monarch (main-thread) tokenisers
// for each language loaded on demand, and the few contributions a read-only viewer needs. No language workers.
import "monaco-editor/editor/browser/coreCommands.js";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/basic-languages/monaco.contribution.js";
import "../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import * as monaco from "monaco-editor/editor/editor.api.js";

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

export const setTheme = (dark: boolean) => monaco.editor.setTheme(themeName(dark));

/** A read-only unified (inline) diff with unchanged regions collapsed. Dispose the editor and both models when done. */
export function createDiff(el: HTMLElement, original: string, modified: string, language: string, dark: boolean, label: string) {
  monaco.editor.setTheme(themeName(dark));
  const o = monaco.editor.createModel(original, language);
  const m = monaco.editor.createModel(modified, language);
  const editor = monaco.editor.createDiffEditor(el, {
    readOnly: true,
    originalEditable: false,
    domReadOnly: true,
    renderSideBySide: false,
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

// Lazy chunk: loaded by dynamic import() only when a file is opened. Core editor, Monarch (main-thread) tokenisers
// for each language loaded on demand, and the few contributions a read-only viewer needs. No language workers.
import "monaco-editor/editor/browser/coreCommands.js";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/basic-languages/monaco.contribution.js";
import "../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import * as monaco from "monaco-editor/editor/editor.api.js";

// Monaco asks for a worker for links, colour decorators and word suggestions. Hand it an inert one so it neither
// tries to start a real worker (nothing bundles one) nor logs; those features are off in createViewer anyway.
class InertWorker {
  onmessage = null;
  onmessageerror = null;
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}
(self as any).MonacoEnvironment = { getWorker: () => new InertWorker() };

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
monaco.editor.defineTheme("ado-light", { base: "vs", inherit: true, rules: [], colors: { "editorLineNumber.foreground": "#0b216f", "editorLineNumber.activeForeground": "#0b216f" } });
const themeName = (dark: boolean) => (dark ? "vs-dark" : "ado-light");

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

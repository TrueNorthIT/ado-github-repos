// Lazy chunk: loaded by dynamic import() only when rendered markdown holds a ```mermaid block (see Browser.tsx, Markdown). Mermaid's own
// diagram types are further dynamic imports inside it, so esbuild splits them into chunks of their own and a flowchart loads only the flowchart code.
import mermaid from "mermaid";
import DOMPurify from "dompurify";

let seq = 0;
let configured: string | undefined;

function configure(dark: boolean) {
  const fontFamily = getComputedStyle(document.body).fontFamily || "Segoe UI, sans-serif";
  const key = `${dark}|${fontFamily}`;
  if (configured === key) return;
  configured = key;
  // strict: no click handlers or script in labels, and label HTML goes through mermaid's DOMPurify. neutral is mermaid's grey theme, closest to ADO's light UI.
  // htmlLabels off: labels are SVG <text>, not HTML in a <foreignObject>, so the result is plain SVG and the second sanitising pass needs no HTML.
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: dark ? "dark" : "neutral", fontFamily, themeVariables: { fontFamily, fontSize: "14px" }, htmlLabels: false, flowchart: { htmlLabels: false }, sequence: { actorFontSize: 14, messageFontSize: 14, noteFontSize: 14 } });
}

/** The diagram as sanitised SVG markup. Throws when mermaid cannot parse or draw the source. */
export async function renderMermaid(source: string, dark: boolean): Promise<string> {
  configure(dark);
  const id = `gh-mermaid-${++seq}`;
  let svg: string;
  try {
    ({ svg } = await mermaid.render(id, source));
  } finally {
    document.getElementById(`d${id}`)?.remove(); // the scratch container mermaid draws in, should a failure leave it behind
  }
  // Mermaid's strict mode already sanitises labels; this second pass keeps the SVG to drawing elements whatever mermaid lets through.
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["a", "foreignObject"] });
}

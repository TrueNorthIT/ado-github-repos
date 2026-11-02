/** Preview classification for a file (B-9). */
export type FileKind = "image" | "markdown" | "text" | "binary" | "tooLarge";

const MB = 1048576;
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]);
const BINARY = new Set([
  "zip", "gz", "tgz", "tar", "7z", "rar", "exe", "dll", "so", "dylib", "bin", "o", "obj", "class", "jar", "nupkg", "vsix",
  "pdf", "woff", "woff2", "ttf", "otf", "eot", "mp3", "mp4", "mov", "avi", "wav", "psd", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdb", "wasm",
]);

const base = (name: string) => name.slice(name.lastIndexOf("/") + 1);
const ext = (name: string) => {
  const b = base(name);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
};

/** Classifies by name, size in bytes and (optionally) the first bytes of the content. */
export function classifyFile(name: string, size: number, head?: Uint8Array): FileKind {
  const e = ext(name);
  if (IMAGE.has(e)) return size > 10 * MB ? "tooLarge" : "image";
  if (size > MB) return "tooLarge";
  if (BINARY.has(e) || head?.subarray(0, 8000).includes(0)) return "binary";
  return e === "md" || e === "markdown" ? "markdown" : "text";
}

const LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json", cs: "csharp", py: "python", yml: "yaml", yaml: "yaml",
  xml: "xml", csproj: "xml", config: "xml", md: "markdown", markdown: "markdown",
  html: "html", htm: "html", css: "css", scss: "scss", less: "less", sql: "sql",
  ps1: "powershell", psm1: "powershell", sh: "shell", bash: "shell", zsh: "shell",
  java: "java", go: "go", rs: "rust", rb: "ruby", php: "php", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp",
  bat: "bat", cmd: "bat", ini: "ini", dockerfile: "dockerfile", kt: "kotlin", swift: "swift", lua: "lua", r: "r", vb: "vb", fs: "fsharp",
};

/** Monaco language id from a file name; "plaintext" when unknown. */
export function monacoLanguage(name: string): string {
  const b = base(name).toLowerCase();
  return b === "dockerfile" ? "dockerfile" : LANG[ext(name)] ?? "plaintext";
}

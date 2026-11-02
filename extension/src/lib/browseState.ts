/** Hub URL hash state for the GitHub file browser (B-8). */
export interface BrowseState {
  /** "owner/name"; absent means the repo list view. */
  repo?: string;
  ref?: string;
  /** Repo-relative path with no leading slash and no ".." segments; absent means the root. */
  path?: string;
  /** Selected tab on a file or folder ("contents" or "preview"); absent means that view's default. */
  tab?: string;
  /** One-shot request (from the header breadcrumb) to open the repo switcher. Only meaningful with a repo. */
  switch?: boolean;
}

/** Resolves "." and ".." and drops empty segments; ".." above the root is clamped to the root. Never returns a leading slash. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

const REPO = /^[\w.-]+\/[\w.-]+$/;
const validRepo = (r: string) => REPO.test(r) && r.split("/").every((s) => s !== "." && s !== "..");

/** Parses a location hash (with or without the leading "#"). Never throws; garbage gives {}. */
export function parse(hash: string): BrowseState {
  try {
    const p = new URLSearchParams(hash.replace(/^#/, ""));
    const repo = p.get("repo");
    if (!repo || !validRepo(repo)) return {};
    const out: BrowseState = { repo };
    const ref = p.get("ref");
    if (ref) out.ref = ref;
    const path = normalizePath(p.get("path") ?? "");
    if (path) out.path = path;
    const tab = p.get("tab");
    if (tab && /^[a-z]{1,20}$/.test(tab)) out.tab = tab;
    if (p.get("switch") === "1") out.switch = true;
    return out;
  } catch {
    return {};
  }
}

/** Builds a hash (starting "#") that parse() turns back into the same state. */
export function serialize(state: BrowseState): string {
  if (!state.repo) return "#";
  let h = `#repo=${encodeURIComponent(state.repo)}`;
  if (state.ref) h += `&ref=${encodeURIComponent(state.ref)}`;
  const path = normalizePath(state.path ?? "");
  if (path) h += `&path=${encodeURIComponent(path)}`;
  if (state.tab) h += `&tab=${encodeURIComponent(state.tab)}`;
  if (state.switch) h += "&switch=1";
  return h;
}

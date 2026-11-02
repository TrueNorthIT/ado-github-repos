import type { PrTab } from "./prQuery";

export type PrPage = "overview" | "files" | "commits";

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
  /** Pull requests page (PR-1). Hash key `view=prs`. The four keys below are only honoured with view "prs". */
  view?: "prs";
  /** Hash key `prTab`. */
  prTab?: PrTab;
  /** Hash key `pr`; a positive integer. */
  pr?: number;
  /** Hash key `prPage`; only honoured with `pr`. */
  prPage?: PrPage;
  /** Hash key `file`; a changed file's path, normalised like `path`. Only honoured with `pr`. */
  file?: string;
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

const PR_TABS: PrTab[] = ["mine", "active", "completed", "abandoned"];
const PR_PAGES: PrPage[] = ["overview", "files", "commits"];
const REPO = /^[\w.-]+\/[\w.-]+$/;
const validRepo = (r: string) => REPO.test(r) && r.split("/").every((s) => s !== "." && s !== "..");

/** Parses a location hash (with or without the leading "#"). Never throws; garbage gives {}. */
export function parse(hash: string): BrowseState {
  try {
    // ADO's header breadcrumb prefixes its own "#" to an item's "#..." href, giving "##repo=...": accept any number.
    const p = new URLSearchParams(hash.replace(/^#+/, ""));
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
    if (p.get("view") === "prs") {
      out.view = "prs";
      const prTab = p.get("prTab") as PrTab | null;
      if (prTab && PR_TABS.includes(prTab)) out.prTab = prTab;
      const prRaw = p.get("pr") ?? "";
      const pr = /^[1-9]\d*$/.test(prRaw) ? Number(prRaw) : 0;
      if (Number.isSafeInteger(pr) && pr > 0) {
        out.pr = pr;
        const prPage = p.get("prPage") as PrPage | null;
        if (prPage && PR_PAGES.includes(prPage)) out.prPage = prPage;
        const file = normalizePath(p.get("file") ?? "");
        if (file) out.file = file;
      }
    }
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
  if (state.view === "prs") {
    h += "&view=prs";
    if (state.prTab && PR_TABS.includes(state.prTab)) h += `&prTab=${state.prTab}`;
    if (state.pr && Number.isSafeInteger(state.pr) && state.pr > 0) {
      h += `&pr=${state.pr}`;
      if (state.prPage && PR_PAGES.includes(state.prPage)) h += `&prPage=${state.prPage}`;
      const file = normalizePath(state.file ?? "");
      if (file) h += `&file=${encodeURIComponent(file)}`;
    }
  }
  return h;
}

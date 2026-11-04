// Code search's place in the location hash (Files hub). Sits beside browseState.ts without editing it, as securityHash.ts and actionsHash.ts do.
//
// Keys: `search` (the search text; its presence opens the Code search view, even when blank), `searchAll` ("1": every connected repository
// instead of the current one), `searchPath`, `searchExt` and `searchHit` (the selected result, "owner/name/path").
// Collision-checked against browseState.ts (repo, ref, path, tab, switch, view, prTab, pr, prPage, file, commit, commitTab, parent, branchTab, q,
// tagTab, release, releaseForm, relPage, relKind) and the other hash modules: every key here starts with `search`.
//
// browseState.parse keeps `repo` (and `ref`) and ignores these keys, so the Files hub still knows its repo; any in-app navigation through
// BrowseState drops them, which is how "open the file" leaves the search view.

export interface SearchHashState {
  /** "owner/name": the repository the Files hub has open, and the default scope. */
  repo: string;
  /** The search text as typed (trimmed, at most 200 characters). Blank means "nothing searched yet". */
  text: string;
  /** Search every connected repository rather than `repo`. */
  all?: boolean;
  /** A `path:` filter. */
  path?: string;
  /** An `extension:` filter, without the dot. */
  ext?: string;
  /** The selected result as "owner/name/path". */
  hit?: string;
}

const REPO = /^[\w.-]+\/[\w.-]+$/;
const validRepo = (r: string) => REPO.test(r) && r.split("/").every((s) => s !== "." && s !== "..");
const KEYS = ["search", "searchAll", "searchPath", "searchExt", "searchHit"];
export const SEARCH_TEXT_MAX = 200;
const PATH_MAX = 255;

/** "ts", ".ts" -> "ts"; anything that isn't a plain extension -> undefined. */
export function cleanExt(v: string | null | undefined): string | undefined {
  const t = (v ?? "").trim().replace(/^\.+/, "");
  return /^[\w+-]{1,32}$/.test(t) ? t : undefined;
}

/** A path filter: trimmed, without leading or trailing slashes, no "..". */
export function cleanPath(v: string | null | undefined): string | undefined {
  const t = (v ?? "").trim().replace(/^\/+|\/+$/g, "").slice(0, PATH_MAX);
  return t && !t.split("/").includes("..") ? t : undefined;
}

/** "owner/name/path/to/file" -> { repo, path }, or undefined. */
export function splitHit(hit: string | undefined): { repo: string; path: string } | undefined {
  const m = /^([^/]+\/[^/]+)\/(.+)$/.exec(hit ?? "");
  return m && validRepo(m[1]) && !m[2].split("/").includes("..") ? { repo: m[1], path: m[2] } : undefined;
}

/** The Code search state of a hash, or null when the hash has no `search` key or no valid repo. Never throws. */
export function parseSearch(hash: string): SearchHashState | null {
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(hash.replace(/^#+/, ""));
  } catch {
    return null;
  }
  const repo = p.get("repo");
  if (!p.has("search") || !repo || !validRepo(repo)) return null;
  const out: SearchHashState = { repo, text: (p.get("search") ?? "").trim().slice(0, SEARCH_TEXT_MAX) };
  if (p.get("searchAll") === "1") out.all = true;
  const path = cleanPath(p.get("searchPath"));
  if (path) out.path = path;
  const ext = cleanExt(p.get("searchExt"));
  if (ext) out.ext = ext;
  const hit = p.get("searchHit") ?? "";
  if (splitHit(hit)) out.hit = hit;
  return out;
}

/** `hash` with this module's keys replaced by the given state (the other segments kept, in order). Always starts with "#". */
export function applySearch(hash: string, s: Omit<SearchHashState, "repo">): string {
  const kept = hash.replace(/^#+/, "").split("&").filter((x) => x && !KEYS.includes(x.split("=")[0]));
  kept.push(`search=${encodeURIComponent(s.text.trim().slice(0, SEARCH_TEXT_MAX))}`);
  if (s.all) kept.push("searchAll=1");
  const path = cleanPath(s.path);
  if (path) kept.push(`searchPath=${encodeURIComponent(path)}`);
  const ext = cleanExt(s.ext);
  if (ext) kept.push(`searchExt=${encodeURIComponent(ext)}`);
  if (splitHit(s.hit)) kept.push(`searchHit=${encodeURIComponent(s.hit!)}`);
  return "#" + kept.join("&");
}

/** `hash` with every Code search key removed: back to the file view it was opened from. */
export function clearSearch(hash: string): string {
  return "#" + hash.replace(/^#+/, "").split("&").filter((x) => x && !KEYS.includes(x.split("=")[0])).join("&");
}

/** The search view of a repo: `#repo=...&search=...`. */
export function serializeSearch(s: SearchHashState): string {
  const { repo, ...rest } = s;
  return applySearch(`#repo=${encodeURIComponent(repo)}`, rest);
}

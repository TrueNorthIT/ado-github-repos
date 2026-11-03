// The branch comparison page's place in the location hash. Sits alongside browseState.ts without editing it, as newPrHash.ts does.
// Hash keys: `view=compare`, `cmpBase`, `cmpHead` and `cmpTab`. (`base` is not used: prListFilters owns it.)
//  - browseState.parse keeps a valid `repo` for these hashes and DROPS the view and every key here, so the app reads parseCompare(hash)
//    BEFORE it routes on browseState.parse, and a hash browseState rewrote is put back with applyCompare.
//  - `view=newpr` (the "New pull request" button, newPrHash.applyNewPr) replaces `view=compare`: applyNewPr drops every earlier `view`.
//  - cmpTab is `commits` (the default, not written) or `files`.
import { serialize } from "./browseState";

const REPO = /^[\w.-]+\/[\w.-]+$/;
const KEYS = ["view", "cmpBase", "cmpHead", "cmpTab"];

export type CompareTab = "commits" | "files";

export interface CompareHashState {
  /** "owner/name". */
  repo: string;
  base: string;
  head: string;
  tab: CompareTab;
}

const clean = (v: string | null) => (v ?? "").trim().slice(0, 255);

/** The compare state of a hash, or null unless it has view=compare, a valid repo and both refs. Never throws. */
export function parseCompare(hash: string): CompareHashState | null {
  try {
    const p = new URLSearchParams(hash.replace(/^#+/, ""));
    const repo = p.get("repo");
    if (p.get("view") !== "compare" || !repo || !REPO.test(repo) || repo.split("/").some((s) => s === "." || s === "..")) return null;
    const base = clean(p.get("cmpBase"));
    const head = clean(p.get("cmpHead"));
    if (!base || !head) return null;
    return { repo, base, head, tab: p.get("cmpTab") === "files" ? "files" : "commits" };
  } catch {
    return null;
  }
}

/** `hash` with view, cmpBase, cmpHead and cmpTab replaced; the other segments keep their order. Starts with "#". */
export function applyCompare(hash: string, s: { base: string; head: string; tab?: CompareTab }): string {
  const kept = hash.replace(/^#+/, "").split("&").filter((x) => x && !KEYS.includes(x.split("=")[0]));
  kept.push("view=compare", `cmpBase=${encodeURIComponent(clean(s.base))}`, `cmpHead=${encodeURIComponent(clean(s.head))}`);
  if (s.tab === "files") kept.push("cmpTab=files");
  return "#" + kept.join("&");
}

export function serializeCompare(s: { repo: string; base: string; head: string; tab?: CompareTab }): string {
  return applyCompare(serialize({ repo: s.repo }), s);
}

/** Entry point: a branch row's Compare action. `head` is the branch, `base` what it is compared against. */
export function branchCompareHash(repo: string, head: string, base: string): string {
  return serializeCompare({ repo, base, head });
}

/** The base a Compare action uses for `head`: the user's remembered compare branch, else the default branch; null when neither differs from `head`. */
export function compareBaseFor(remembered: string | undefined, defaultBranch: string | undefined, head: string): string | null {
  if (remembered && remembered !== head) return remembered;
  return defaultBranch && defaultBranch !== head ? defaultBranch : null;
}

/** `map` with `repo`'s compare branch set to `branch`, or forgotten for null. A new object. */
export function withCompareBase(map: Record<string, string> | undefined, repo: string, branch: string | null): Record<string, string> {
  const { [repo]: _old, ...rest } = map ?? {};
  return branch ? { ...rest, [repo]: branch } : rest;
}

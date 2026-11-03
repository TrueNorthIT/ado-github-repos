// Batch 5, the New pull request page's place in the location hash (CP-6). STUBS: the developer implements them. Every function throws "Not implemented".
//
// Sits alongside browseState.ts without editing it, as prListFilters.ts does. Hash keys: `view=newpr` plus `source` and `target` (collision-checked against browseState.ts: it knows repo, ref, path, tab, switch,
// view, prTab, pr, prPage, file, commit, commitTab, parent, branchTab and q).
//
// Decisions fixed by the tests (newPrHash.test.ts):
//  - `view` is shared with browseState, which only knows prs and repos: browseState.parse keeps a valid `repo` for `#repo=o/n&view=newpr&...` but DROPS the view, source and target. So the app must read
//    parseNewPr(hash) BEFORE it routes on browseState.parse, and a hash that browseState rewrites must be put back with applyNewPr (the same dance as applyListFilters).
//  - serializeNewPr writes `#repo=...&view=newpr&source=...&target=...` (source and target only when non-blank, values encodeURIComponent-encoded, each capped at 255 characters).
//  - applyNewPr keeps the other segments verbatim and in order, drops every earlier `view`, `source` and `target`, and appends `view=newpr` then source then target.
//  - parseNewPr is null unless the hash has view=newpr AND a valid repo (browseState's own rule); blank source or target are dropped; it never throws.
//  - The Branches row action carries the branch as source and no target (the page defaults the target); the PR list's button carries neither.
import { serialize } from "./browseState";

const REPO = /^[\w.-]+\/[\w.-]+$/;

export interface NewPrHashState {
  /** "owner/name". */
  repo: string;
  source?: string;
  target?: string;
}

/** The New pull request state of a hash, or null (see the decisions above). */
export function parseNewPr(hash: string): NewPrHashState | null {
  const p = new URLSearchParams(hash.replace(/^#+/, ""));
  const repo = p.get("repo");
  if (p.get("view") !== "newpr" || !repo || !REPO.test(repo) || repo.split("/").some((s) => s === "." || s === "..")) return null;
  const out: NewPrHashState = { repo };
  const source = (p.get("source") ?? "").trim();
  const target = (p.get("target") ?? "").trim();
  if (source) out.source = source.slice(0, 255);
  if (target) out.target = target.slice(0, 255);
  return out;
}

/** `#repo=...&view=newpr&source=...&target=...` (see the decisions above). */
export function serializeNewPr(s: NewPrHashState): string {
  return applyNewPr(`#repo=${encodeURIComponent(s.repo)}`, s);
}

/** `hash` (with or without "#") with view, source and target replaced by view=newpr and the given source and target; the other segments are kept. Always starts with "#". */
export function applyNewPr(hash: string, s: { source?: string; target?: string }): string {
  const kept = hash.replace(/^#+/, "").split("&").filter((x) => x && !["view", "source", "target"].includes(x.split("=")[0]));
  kept.push("view=newpr");
  for (const k of ["source", "target"] as const) {
    const v = (s[k] ?? "").trim().slice(0, 255);
    if (v) kept.push(`${k}=${encodeURIComponent(v)}`);
  }
  return "#" + kept.join("&");
}

/** Entry point: a branch row's (or the Branches page's) "New pull request" action. */
export function branchRowNewPrHash(repo: string, branch: string): string {
  return serializeNewPr({ repo, source: branch });
}

/** Entry point: the PR list's "New pull request" button. */
export function prListNewPrHash(repo: string): string {
  return serializeNewPr({ repo });
}

/** CP-1 "View the existing pull request": the same hash browseState.serialize gives for { repo, view: "prs", pr: number }. */
export function existingPrHash(repo: string, number: number): string {
  return serialize({ repo, view: "prs", pr: number });
}

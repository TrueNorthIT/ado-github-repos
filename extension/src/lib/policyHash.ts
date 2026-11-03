// The Branch policies page's place in the location hash (Branches hub). Sits alongside browseState.ts without editing it, as compareHash.ts does.
// Hash keys: `view=policies` and `polBranch`. browseState.parse keeps `repo` and drops both, so the hub reads parsePolicies(hash) first.
import { serialize } from "./browseState";

const REPO = /^[\w.-]+\/[\w.-]+$/;

export interface PolicyHashState {
  /** "owner/name". */
  repo: string;
  branch: string;
}

/** The policies state of a hash, or null unless it has view=policies, a valid repo and a branch. Never throws. */
export function parsePolicies(hash: string): PolicyHashState | null {
  try {
    const p = new URLSearchParams(hash.replace(/^#+/, ""));
    const repo = p.get("repo");
    if (p.get("view") !== "policies" || !repo || !REPO.test(repo) || repo.split("/").some((s) => s === "." || s === "..")) return null;
    const branch = (p.get("polBranch") ?? "").trim().slice(0, 255);
    return branch ? { repo, branch } : null;
  } catch {
    return null;
  }
}

/** Entry point: a branch row's "Branch policies" action. Starts with "#". */
export function serializePolicies(s: PolicyHashState): string {
  return `${serialize({ repo: s.repo })}&view=policies&polBranch=${encodeURIComponent(s.branch.trim().slice(0, 255))}`;
}

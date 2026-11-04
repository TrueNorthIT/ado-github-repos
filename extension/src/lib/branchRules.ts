// The repository rules (rulesets) that apply to one branch, read over REST: `GET /repos/{owner}/{repo}/rules/branches/{branch}`.
// The Branch policies page (branchPolicies.ts toPolicies) and the PR page both read it through here. Anyone who can read the repository may call it; it lists every active rule from the repository's and its organisation's rulesets
// (classic branch protection is NOT in it: that comes from GraphQL Ref.branchProtectionRule in actionsQuery.ts).
// Each entry is { type, parameters?, ruleset_source_type, ruleset_source, ruleset_id }. The two this extension reads:
//  - `pull_request` with parameters.require_code_owner_review (the branch needs a code owner's approval);
//  - `non_fast_forward` (force pushes are refused, so a rebase of the branch is too) and `update` (nobody may push to it at all).
// Bypass lists are not in the answer, so an admin who may bypass a rule still sees it here.
import type { RestRequest } from "./restRequest";

export interface BranchRule {
  type: string;
  parameters?: Record<string, unknown> | null;
  /** The ruleset the rule comes from, and where that ruleset lives ("Repository", "Organization", "Enterprise"). */
  ruleset_id?: number;
  ruleset_source_type?: string;
  ruleset_source?: string;
}

const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** GET of the rules for `branch` (each path segment encoded, the slashes kept). Throws on a blank branch. */
export function branchRulesRequest(repo: string, branch: string): RestRequest {
  if (!branch.trim()) throw new Error("branch is required");
  return { method: "GET", path: `/repos/${repo}/rules/branches/${encPath(branch)}` };
}

/** The answer as rules; anything that is not an array of objects with a string `type` is dropped. */
export function toBranchRules(body: unknown): BranchRule[] {
  if (!Array.isArray(body)) return [];
  return body.filter((r): r is BranchRule => !!r && typeof r === "object" && typeof (r as BranchRule).type === "string");
}

/** A ruleset requires a code owner's review on this branch. */
export const rulesRequireCodeOwnerReview = (rules: BranchRule[]): boolean =>
  rules.some((r) => r.type === "pull_request" && r.parameters?.require_code_owner_review === true);

/** A ruleset refuses a rewrite of this branch (force push, or any push). */
export const rulesBlockForcePush = (rules: BranchRule[]): boolean => rules.some((r) => r.type === "non_fast_forward" || r.type === "update");

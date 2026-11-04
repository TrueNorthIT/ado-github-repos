// Editing branch policies (Branches hub, view=policies) and locking a branch, for repository admins.
// Every edit is saved to ONE repository ruleset per branch that the extension owns: named "Azure DevOps policies: <branch>",
// targeting branches, with a single ref_name condition `refs/heads/<branch>`. Rulesets and classic protection the extension did
// not create are never written: the page shows them read-only, and GitHub enforces the union of every rule.
//  - GET    /repos/{o}/{r}/rulesets?includes_parents=false&targets=branch  (summaries: id, name, target, source_type, enforcement)
//  - GET    /repos/{o}/{r}/rulesets/{id}                                   (conditions and rules)
//  - POST   /repos/{o}/{r}/rulesets          create the owned ruleset
//  - PUT    /repos/{o}/{r}/rulesets/{id}     replace its rules (bypass list and enforcement left as they are)
//  - DELETE /repos/{o}/{r}/rulesets/{id}     when nothing is left in it
// Locking is the owned ruleset's `update` rule (nobody may push to the branch); the policy form leaves it alone.
// All pure: the form model, the rules it becomes, the diff for Save, and the request to send.
import type { RestRequest } from "./restRequest";

export const OWNED_PREFIX = "Azure DevOps policies: ";
export const ownedRulesetName = (branch: string) => OWNED_PREFIX + branch;
export const branchRef = (branch: string) => `refs/heads/${branch}`;

export interface RulesetRule {
  type: string;
  parameters?: Record<string, any>;
}

/** A ruleset summary (list) or a full ruleset (GET by id; it adds conditions and rules). */
export interface Ruleset {
  id: number;
  name: string;
  target?: string;
  source_type?: string;
  enforcement?: string;
  conditions?: { ref_name?: { include?: string[]; exclude?: string[] } } | null;
  rules?: RulesetRule[];
}

export const MERGE_METHODS = ["merge", "squash", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];
export const MAX_REVIEWERS = 10;

export interface PolicyForm {
  /** "Require a minimum number of reviewers": on when the ruleset has a pull_request rule. count 0 means a pull request is required with no approval. */
  reviewers: { on: boolean; count: number; dismissStale: boolean; lastPushApproval: boolean; codeOwners: boolean };
  /** pull_request.required_review_thread_resolution. */
  commentResolution: boolean;
  /** pull_request.allowed_merge_methods, when it allows fewer than all three. */
  mergeTypes: { on: boolean; methods: MergeMethod[] };
  /** required_status_checks: on while there is at least one context. strict: branches must be up to date before merging. */
  checks: { contexts: string[]; strict: boolean };
  blockForcePush: boolean;
  restrictDeletion: boolean;
  requireSignatures: boolean;
}

export const EMPTY_FORM: PolicyForm = {
  reviewers: { on: false, count: 1, dismissStale: false, lastPushApproval: false, codeOwners: false },
  commentResolution: false,
  mergeTypes: { on: false, methods: ["squash"] },
  checks: { contexts: [], strict: false },
  blockForcePush: false,
  restrictDeletion: false,
  requireSignatures: false,
};

/** The rule types the policy form writes. Anything else in the owned ruleset (update, merge_queue…) is kept as it is. */
const FORM_TYPES = new Set(["pull_request", "required_status_checks", "non_fast_forward", "deletion", "required_signatures"]);

const clampCount = (n: unknown) => Math.max(0, Math.min(MAX_REVIEWERS, Math.floor(Number(n) || 0)));

/** Whether a ruleset (summary or full) is the one the extension owns for `branch`: its name, a branch target, in the repository itself, and (when the conditions are known) exactly that one branch. */
export function isOwnedRuleset(rs: Ruleset | null | undefined, branch: string): boolean {
  if (!rs || rs.name !== ownedRulesetName(branch)) return false;
  if (rs.target && rs.target !== "branch") return false;
  if (rs.source_type && rs.source_type !== "Repository") return false;
  if (rs.conditions === undefined) return true; // a summary: the conditions come with the full read
  const inc = rs.conditions?.ref_name?.include ?? [];
  const exc = rs.conditions?.ref_name?.exclude ?? [];
  return inc.length === 1 && inc[0] === branchRef(branch) && !exc.length;
}

/** Which of the listed rulesets is the owned one for `branch` (by name; check the full read with isOwnedRuleset). */
export const findOwnedSummary = (list: unknown, branch: string): Ruleset | undefined =>
  Array.isArray(list) ? (list as Ruleset[]).find((rs) => isOwnedRuleset(rs, branch)) : undefined;

/** The branch an owned ruleset name is for, or null when the name isn't one of ours. */
export const ownedBranchOf = (name: string): string | null => (name.startsWith(OWNED_PREFIX) && name.length > OWNED_PREFIX.length ? name.slice(OWNED_PREFIX.length) : null);

/** The form for the owned ruleset's rules (EMPTY_FORM when there is no ruleset yet). */
export function formFromRules(rules: RulesetRule[] | undefined): PolicyForm {
  const f: PolicyForm = JSON.parse(JSON.stringify(EMPTY_FORM));
  for (const r of rules ?? []) {
    const p = r.parameters ?? {};
    switch (r.type) {
      case "pull_request": {
        f.reviewers = { on: true, count: clampCount(p.required_approving_review_count), dismissStale: !!p.dismiss_stale_reviews_on_push, lastPushApproval: !!p.require_last_push_approval, codeOwners: !!p.require_code_owner_review };
        f.commentResolution = !!p.required_review_thread_resolution;
        const methods = Array.isArray(p.allowed_merge_methods) ? MERGE_METHODS.filter((m) => p.allowed_merge_methods.includes(m)) : [];
        if (methods.length && methods.length < MERGE_METHODS.length) f.mergeTypes = { on: true, methods };
        break;
      }
      case "required_status_checks":
        f.checks = { contexts: [...new Set<string>((p.required_status_checks ?? []).map((c: any) => String(c?.context ?? "")).filter(Boolean))], strict: !!p.strict_required_status_checks_policy };
        break;
      case "non_fast_forward": f.blockForcePush = true; break;
      case "deletion": f.restrictDeletion = true; break;
      case "required_signatures": f.requireSignatures = true; break;
    }
  }
  return f;
}

/** Turning reviewers off also turns off what GitHub keeps in the same pull_request rule (comment resolution, merge types, code owners). */
export function setReviewersOn(f: PolicyForm, on: boolean): PolicyForm {
  if (on) return { ...f, reviewers: { ...f.reviewers, on: true, count: f.reviewers.count || 1 } };
  return { ...f, reviewers: { ...f.reviewers, on: false, codeOwners: false }, commentResolution: false, mergeTypes: { ...f.mergeTypes, on: false } };
}

/** Turning on a policy that lives in the pull_request rule while reviewers are off turns the rule on with no approval required (count 0). */
export function setPrPolicy(f: PolicyForm, key: "commentResolution" | "mergeTypes" | "codeOwners", on: boolean): PolicyForm {
  const reviewers = on && !f.reviewers.on ? { ...f.reviewers, on: true, count: 0 } : f.reviewers;
  if (key === "commentResolution") return { ...f, reviewers, commentResolution: on };
  if (key === "mergeTypes") return { ...f, reviewers, mergeTypes: { ...f.mergeTypes, on } };
  return { ...f, reviewers: { ...reviewers, codeOwners: on } };
}

/** A status check name as typed: trimmed, and empty when blank. */
export const cleanContext = (s: string) => s.trim().slice(0, 255);

export function addContext(f: PolicyForm, name: string): PolicyForm {
  const c = cleanContext(name);
  if (!c || f.checks.contexts.includes(c)) return f;
  return { ...f, checks: { ...f.checks, contexts: [...f.checks.contexts, c] } };
}
export const removeContext = (f: PolicyForm, name: string): PolicyForm => ({ ...f, checks: { ...f.checks, contexts: f.checks.contexts.filter((c) => c !== name) } });

/** What stops a Save: each problem as a sentence. */
export function formErrors(f: PolicyForm): string[] {
  const out: string[] = [];
  if (f.reviewers.on && (!Number.isInteger(f.reviewers.count) || f.reviewers.count < 0 || f.reviewers.count > MAX_REVIEWERS)) out.push(`The minimum number of reviewers must be a whole number from 0 to ${MAX_REVIEWERS}.`);
  if (f.mergeTypes.on && !f.mergeTypes.methods.length) out.push("Choose at least one merge type.");
  return out;
}

/**
 * The owned ruleset's rules after a Save: the form's rules, in place of the ones the form writes, and every other rule of the
 * existing ruleset kept as it was (the lock, rules added on GitHub). Parameters the form doesn't know (status check integration
 * ids, Copilot review, required reviewers) are carried over from the existing rule.
 */
export function rulesFromForm(f: PolicyForm, existing: RulesetRule[] = []): RulesetRule[] {
  const old = (type: string) => existing.find((r) => r.type === type)?.parameters ?? {};
  const out: RulesetRule[] = [];
  if (f.reviewers.on) {
    const p: Record<string, any> = {
      ...old("pull_request"),
      required_approving_review_count: clampCount(f.reviewers.count),
      dismiss_stale_reviews_on_push: f.reviewers.dismissStale,
      require_code_owner_review: f.reviewers.codeOwners,
      require_last_push_approval: f.reviewers.lastPushApproval,
      required_review_thread_resolution: f.commentResolution,
    };
    const methods = MERGE_METHODS.filter((m) => f.mergeTypes.methods.includes(m));
    if (f.mergeTypes.on && methods.length) p.allowed_merge_methods = methods;
    else delete p.allowed_merge_methods; // GitHub reads a missing list as every method
    out.push({ type: "pull_request", parameters: p });
  }
  if (f.checks.contexts.length) {
    const prev = old("required_status_checks");
    const ids = new Map<string, any>((prev.required_status_checks ?? []).map((c: any) => [c?.context, c?.integration_id]));
    out.push({
      type: "required_status_checks",
      parameters: {
        ...prev,
        strict_required_status_checks_policy: f.checks.strict,
        required_status_checks: f.checks.contexts.map((context) => (ids.get(context) != null ? { context, integration_id: ids.get(context) } : { context })),
      },
    });
  }
  if (f.blockForcePush) out.push({ type: "non_fast_forward" });
  if (f.restrictDeletion) out.push({ type: "deletion" });
  if (f.requireSignatures) out.push({ type: "required_signatures" });
  return [...out, ...existing.filter((r) => !FORM_TYPES.has(r.type))];
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The policies that differ between two forms, by the name the page shows them under (empty: nothing to save). */
export function changedPolicies(a: PolicyForm, b: PolicyForm): string[] {
  const out: string[] = [];
  const ra = a.reviewers, rb = b.reviewers;
  if (ra.on !== rb.on || (rb.on && (ra.count !== rb.count || ra.dismissStale !== rb.dismissStale || ra.lastPushApproval !== rb.lastPushApproval))) out.push("Minimum number of reviewers");
  if (a.commentResolution !== b.commentResolution) out.push("Comment resolution");
  if (a.mergeTypes.on !== b.mergeTypes.on || (b.mergeTypes.on && !sameList([...a.mergeTypes.methods].sort(), [...b.mergeTypes.methods].sort()))) out.push("Limit merge types");
  if (!sameList(a.checks.contexts, b.checks.contexts) || (b.checks.contexts.length > 0 && a.checks.strict !== b.checks.strict)) out.push("Build validation");
  if (ra.codeOwners !== rb.codeOwners) out.push("Code owners");
  if (a.blockForcePush !== b.blockForcePush) out.push("Block force pushes");
  if (a.restrictDeletion !== b.restrictDeletion) out.push("Restrict deletions");
  if (a.requireSignatures !== b.requireSignatures) out.push("Require signed commits");
  return out;
}

/** What a Save or a Lock sends: create, replace the rules, delete the emptied ruleset, or nothing. */
export type SavePlan = { kind: "none" } | { kind: "create" | "update" | "delete"; req: RestRequest };

const createBody = (branch: string, rules: RulesetRule[]) => ({
  name: ownedRulesetName(branch),
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: [branchRef(branch)], exclude: [] } },
  rules,
});

/**
 * The request that leaves the owned ruleset with `rules`: POST when there is none yet, PUT of the rules (and the extension's
 * name and condition, in case they were edited on GitHub) when there is, DELETE when no rule is left. Enforcement and bypass
 * actors of an existing ruleset are not sent, so a change made to them on GitHub stays.
 */
export function savePlan(repo: string, branch: string, owned: Ruleset | null, rules: RulesetRule[]): SavePlan {
  if (!owned) return rules.length ? { kind: "create", req: { method: "POST", path: `/repos/${repo}/rulesets`, body: createBody(branch, rules) } } : { kind: "none" };
  const path = `/repos/${repo}/rulesets/${owned.id}`;
  if (!rules.length) return { kind: "delete", req: { method: "DELETE", path } };
  const { enforcement: _e, ...body } = createBody(branch, rules);
  return { kind: "update", req: { method: "PUT", path, body } };
}

/** The branch is locked by the owned ruleset (its `update` rule). */
export const isLocked = (owned: Ruleset | null | undefined) => !!owned?.rules?.some((r) => r.type === "update");

/** Lock adds the `update` rule to the owned ruleset (creating it when needed); Unlock removes it (deleting the ruleset when it was all that was left). */
export function lockPlan(repo: string, branch: string, owned: Ruleset | null, lock: boolean): SavePlan {
  const rules = owned?.rules ?? [];
  if (lock === isLocked(owned)) return { kind: "none" };
  return savePlan(repo, branch, owned, lock ? [...rules, { type: "update" }] : rules.filter((r) => r.type !== "update"));
}

/** GET of the repository's own branch rulesets (not the organisation's: the extension never owns those). */
export const rulesetsListRequest = (repo: string): RestRequest => ({ method: "GET", path: `/repos/${repo}/rulesets?includes_parents=false&targets=branch&per_page=100` });
export const rulesetRequest = (repo: string, id: number): RestRequest => ({ method: "GET", path: `/repos/${repo}/rulesets/${id}` });

/** The branches the listed owned rulesets are for (their names), so the branch list only reads the rulesets that may lock a branch. */
export const ownedSummaries = (list: unknown): { id: number; branch: string }[] =>
  (Array.isArray(list) ? (list as Ruleset[]) : [])
    .filter((rs) => (!rs.target || rs.target === "branch") && (!rs.source_type || rs.source_type === "Repository"))
    .map((rs) => ({ id: Number(rs.id), branch: ownedBranchOf(String(rs.name ?? "")) }))
    .filter((x): x is { id: number; branch: string } => !!x.branch && x.id > 0);

export const ADMIN_NEEDED = "You need admin rights on this repository";

/**
 * A refused write as the page words it. 403/404: admin rights are missing (for the person, or for the GitHub App, which needs the
 * Administration permission), with GitHub's own words as the detail. 422: GitHub's message. Anything else: null (the generic error).
 */
export function policyWriteError(status: number, apiMessage?: string): { admin: boolean; text: string } | null {
  if (status === 403 || status === 404) return { admin: true, text: apiMessage ? `${ADMIN_NEEDED}. GitHub said: ${apiMessage}` : `${ADMIN_NEEDED}.` };
  if (status === 422) return { admin: false, text: apiMessage || "GitHub refused the change (validation failed)." };
  return null;
}

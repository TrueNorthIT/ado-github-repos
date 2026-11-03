// The Branch policies page (Branches hub, view=policies): the GitHub rules that apply to one branch, worded as Azure DevOps branch policies.
// Three REST reads feed it, all optional apart from the rules:
//  - GET /repos/{o}/{r}/rules/branches/{branch}: every active ruleset rule for the branch (read access is enough).
//  - GET /repos/{o}/{r}/branches/{branch}/protection: the classic branch protection rule (needs admin; 403 or 404 otherwise).
//  - GET /repos/{o}/{r}/branches/{branch}: `protected` and, for readers, protection.required_status_checks.
// The mapping is pure (toPolicies) so it can be tested without the network.

/** Where a rule comes from: a ruleset (by id) or the classic branch protection rule. */
export type PolicySource = { kind: "ruleset"; id: number; scope: string } | { kind: "classic" };

export interface ReviewerPolicy {
  /** Required approving reviews (0 means a pull request is required but no approval). */
  count: number;
  dismissStale: boolean;
  codeOwners: boolean;
  lastPushApproval: boolean;
  sources: PolicySource[];
}

export interface CheckPolicy {
  context: string;
  /** The branch must be up to date with the base before merging (ADO: build expiration "immediately when the branch is updated"); null when GitHub doesn't say (classic rule, viewer not an admin). */
  strict: boolean | null;
  source: PolicySource;
}

export interface OtherRule {
  id: string;
  title: string;
  detail?: string;
  sources: PolicySource[];
}

export interface BranchPolicies {
  reviewers: ReviewerPolicy | null;
  commentResolution: PolicySource[] | null;
  /** Allowed merge methods (GitHub names: merge, squash, rebase); empty when only linear history limits them. */
  mergeTypes: { methods: string[]; linear: boolean; sources: PolicySource[] } | null;
  checks: CheckPolicy[];
  other: OtherRule[];
}

/** What the classic protection read gave: the rule, none on this branch, or not readable without admin. */
export type ClassicState = { t: "read"; body: any } | { t: "none" } | { t: "denied" };

export const EMPTY_POLICIES: BranchPolicies = { reviewers: null, commentResolution: null, mergeTypes: null, checks: [], other: [] };

const sourceOf = (r: any): PolicySource => ({ kind: "ruleset", id: Number(r?.ruleset_id) || 0, scope: String(r?.ruleset_source_type ?? "Repository") });
const sameSource = (a: PolicySource, b: PolicySource) => a.kind === b.kind && (a.kind === "classic" || (b.kind === "ruleset" && a.id === b.id));
const addSource = (list: PolicySource[], s: PolicySource) => (list.some((x) => sameSource(x, s)) ? list : [...list, s]);

/** The GitHub-only rules, worded as ADO's branch security settings. `detail` is filled in per rule where it has parameters. */
const OTHER_TITLES: Record<string, string> = {
  non_fast_forward: "Block force pushes",
  deletion: "Restrict deletions",
  creation: "Restrict creations",
  update: "Restrict updates",
  required_signatures: "Require signed commits",
  merge_queue: "Require a merge queue",
  required_deployments: "Require deployments to succeed",
  code_scanning: "Require code scanning results",
  code_quality: "Require code quality results",
  copilot_code_review: "Request a Copilot code review",
  commit_message_pattern: "Commit message pattern",
  commit_author_email_pattern: "Commit author email pattern",
  committer_email_pattern: "Committer email pattern",
  branch_name_pattern: "Branch name pattern",
  file_path_restriction: "Restrict file paths",
  max_file_path_length: "Restrict file path length",
  file_extension_restriction: "Restrict file extensions",
  max_file_size: "Restrict file size",
  workflows: "Require workflows to pass",
  lock_branch: "Lock branch (read-only)",
  enforce_admins: "Apply to administrators",
};

const MERGE_NAME: Record<string, string> = { merge: "Basic merge (no fast-forward)", squash: "Squash merge", rebase: "Rebase and fast-forward" };
export const mergeTypeName = (m: string) => MERGE_NAME[m] ?? m;

function otherDetail(type: string, p: any): string | undefined {
  if (!p) return undefined;
  if (type === "required_deployments") return (p.required_deployment_environments ?? []).join(", ") || undefined;
  if (type === "code_scanning") return (p.code_scanning_tools ?? []).map((t: any) => t.tool).filter(Boolean).join(", ") || undefined;
  if (type === "merge_queue") return p.merge_method ? `Merges with ${mergeTypeName(String(p.merge_method).toLowerCase())}` : undefined;
  if (type === "update" && p.update_allows_fetch_and_merge) return "Fetch and merge is still allowed";
  if (/_pattern$/.test(type) && p.pattern) return `${p.negate ? "Must not" : "Must"} ${String(p.operator ?? "match").replace(/_/g, " ")} ${p.pattern}`;
  if (type === "max_file_size" && p.max_file_size) return `${p.max_file_size} MB`;
  if (type === "max_file_path_length" && p.max_file_path_length) return `${p.max_file_path_length} characters`;
  if (type === "file_extension_restriction") return (p.restricted_file_extensions ?? []).join(", ") || undefined;
  if (type === "file_path_restriction") return (p.restricted_file_paths ?? []).join(", ") || undefined;
  if (type === "workflows") return (p.workflows ?? []).map((w: any) => w.path).filter(Boolean).join(", ") || undefined;
  return undefined;
}

class Builder {
  out: BranchPolicies = { reviewers: null, commentResolution: null, mergeTypes: null, checks: [], other: [] };

  reviewers(p: Partial<Omit<ReviewerPolicy, "sources">>, s: PolicySource) {
    const r = this.out.reviewers ?? { count: 0, dismissStale: false, codeOwners: false, lastPushApproval: false, sources: [] };
    this.out.reviewers = {
      count: Math.max(r.count, Number(p.count) || 0),
      dismissStale: r.dismissStale || !!p.dismissStale,
      codeOwners: r.codeOwners || !!p.codeOwners,
      lastPushApproval: r.lastPushApproval || !!p.lastPushApproval,
      sources: addSource(r.sources, s),
    };
  }
  resolution(s: PolicySource) { this.out.commentResolution = addSource(this.out.commentResolution ?? [], s); }
  merge(methods: string[], linear: boolean, s: PolicySource) {
    const m = this.out.mergeTypes ?? { methods: [], linear: false, sources: [] };
    // Two rules each limiting the methods: only what both allow is left.
    const both = !methods.length ? m.methods : !m.methods.length ? methods : m.methods.filter((x) => methods.includes(x));
    this.out.mergeTypes = { methods: both, linear: m.linear || linear, sources: addSource(m.sources, s) };
  }
  check(context: string, strict: boolean | null, s: PolicySource) {
    const hit = this.out.checks.find((c) => c.context === context);
    if (hit) hit.strict = hit.strict || strict || (hit.strict === null || strict === null ? null : false);
    else this.out.checks.push({ context, strict, source: s });
  }
  other(id: string, s: PolicySource, detail?: string) {
    const hit = this.out.other.find((o) => o.id === id);
    if (hit) { hit.sources = addSource(hit.sources, s); hit.detail ??= detail; return; }
    this.out.other.push({ id, title: OTHER_TITLES[id] ?? id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), detail, sources: [s] });
  }
}

/**
 * The policies of a branch from its ruleset rules, the classic protection rule (when readable) and, when it is not, the
 * required status checks GitHub shows readers on GET /branches/{branch}. Rules of the same kind merge: the highest reviewer
 * count, any flag that is on, every check once.
 */
export function toPolicies(rules: any[], classic: ClassicState, branch?: any): BranchPolicies {
  const b = new Builder();
  for (const r of Array.isArray(rules) ? rules : []) {
    const s = sourceOf(r);
    const p = r?.parameters ?? {};
    switch (r?.type) {
      case "pull_request":
        b.reviewers({ count: p.required_approving_review_count, dismissStale: p.dismiss_stale_reviews_on_push, codeOwners: p.require_code_owner_review, lastPushApproval: p.require_last_push_approval }, s);
        if (p.required_review_thread_resolution) b.resolution(s);
        if (Array.isArray(p.allowed_merge_methods) && p.allowed_merge_methods.length && p.allowed_merge_methods.length < 3) b.merge(p.allowed_merge_methods.map(String), false, s);
        break;
      case "required_status_checks":
        for (const c of p.required_status_checks ?? []) if (c?.context) b.check(String(c.context), !!p.strict_required_status_checks_policy, s);
        break;
      case "required_linear_history":
        b.merge([], true, s);
        break;
      default:
        if (typeof r?.type === "string") b.other(r.type, s, otherDetail(r.type, p));
    }
  }
  const c: PolicySource = { kind: "classic" };
  if (classic.t === "read") {
    const x = classic.body ?? {};
    const pr = x.required_pull_request_reviews;
    if (pr) b.reviewers({ count: pr.required_approving_review_count, dismissStale: pr.dismiss_stale_reviews, codeOwners: pr.require_code_owner_reviews, lastPushApproval: pr.require_last_push_approval }, c);
    if (x.required_conversation_resolution?.enabled) b.resolution(c);
    if (x.required_linear_history?.enabled) b.merge([], true, c);
    const rsc = x.required_status_checks;
    if (rsc) for (const ctx of checkNames(rsc)) b.check(ctx, !!rsc.strict, c);
    if (x.allow_force_pushes && !x.allow_force_pushes.enabled) b.other("non_fast_forward", c);
    if (x.allow_deletions && !x.allow_deletions.enabled) b.other("deletion", c);
    if (x.required_signatures?.enabled) b.other("required_signatures", c);
    if (x.lock_branch?.enabled) b.other("lock_branch", c);
    if (x.block_creations?.enabled) b.other("creation", c);
    if (x.enforce_admins?.enabled) b.other("enforce_admins", c);
  } else if (classic.t === "denied") {
    const rsc = branch?.protection?.required_status_checks;
    if (rsc && rsc.enforcement_level !== "off") for (const ctx of checkNames(rsc)) b.check(ctx, null, c);
  }
  return b.out;
}

/** Status check names from a protection body's required_status_checks (`checks[].context`, else the older `contexts`). */
function checkNames(rsc: any): string[] {
  const names: string[] = (rsc?.checks ?? []).map((x: any) => x?.context).filter(Boolean);
  return names.length ? names : (rsc?.contexts ?? []).filter((x: unknown) => typeof x === "string");
}

/** Whether any policy applies. */
export const hasPolicies = (p: BranchPolicies) => !!(p.reviewers || p.commentResolution || p.mergeTypes || p.checks.length || p.other.length);

/**
 * How the classic protection read went: 200 is the rule; 404 on an unprotected branch means none; 403, or 404 on a branch
 * GitHub calls protected, means the viewer (or the GitHub App) lacks admin.
 */
export function classicState(res: { ok: true; body: any } | { ok: false; status: number }, branchProtected: boolean): ClassicState {
  if (res.ok) return { t: "read", body: res.body };
  if (res.status === 404 && !branchProtected) return { t: "none" };
  return res.status === 403 || res.status === 404 ? { t: "denied" } : { t: "none" };
}

/** "Ruleset 12", "Organisation ruleset 7", "Branch protection rule". */
export function sourceText(s: PolicySource): string {
  if (s.kind === "classic") return "Branch protection rule";
  return `${s.scope === "Organization" ? "Organisation ruleset" : s.scope === "Enterprise" ? "Enterprise ruleset" : "Ruleset"} ${s.id}`;
}

/** Where a source is edited on GitHub: the ruleset's page, or the repository's branch protection settings. */
export function sourceHref(repo: string, s: PolicySource): string {
  if (s.kind === "classic") return `https://github.com/${repo}/settings/branches`;
  return s.scope === "Repository" ? `https://github.com/${repo}/rules/${s.id}` : `https://github.com/${repo}/settings/rules`;
}

/** The "Edit on GitHub" target for the whole page: the repository's rulesets settings. */
export const rulesSettingsHref = (repo: string) => `https://github.com/${repo}/settings/rules`;

/** The sentence under "Require a minimum number of reviewers". */
export function reviewerSummary(r: ReviewerPolicy): string {
  if (r.count <= 0) return "Changes must go through a pull request. No approval is required.";
  return `Require ${r.count} approving review${r.count === 1 ? "" : "s"} before a pull request can be completed.`;
}

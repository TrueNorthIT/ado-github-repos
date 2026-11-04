// __TN_MOCK__ Mock GitHub answers for the Branches hub's REST extras: branch policies (rulesets, classic protection, the branch
// itself), rename, set as default branch and the tag names for the compare pickers.
// Fixtures: on truenorthit/github-repos, `main` has a ruleset with several rules plus a classic protection rule, `release/1.0`
// has only a classic rule, and the rest have none. Scenarios: `readOnly` and `notAdmin` make the viewer a non-admin (no
// "Set as default branch", classic protection answers 403 so the page shows what readers see); `refsFail` makes writes 403.
// Rulesets (batch J): GET/POST /rulesets and GET/PUT/DELETE /rulesets/{id}, kept in memory so edits last the session. Ruleset 4211
// ("Protect main") is someone else's; on truenorthit/github-repos the extension's own ruleset for release/2.0 locks it.
// Scenarios: `rulesetsDenied` (an admin whose GitHub App lacks Administration: writes 403), `rulesetsInvalid` (writes 422).
import { PR_REPO } from "./fixtures/prs";
import { refsOf } from "./fixtures/refs";
import { repoOf } from "./fixtures/repos";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fail = (code: number, message: string) => json({ message }, code);

const defaults = new Map<string, string>();
/** The repository's default branch (changed by "Set as default branch"); "main" until then. */
export const defaultBranchOf = (fullName: string) => defaults.get(fullName.toLowerCase()) ?? "main";

export const isAdmin = (sc: string) => sc !== "readOnly" && sc !== "notAdmin";

const MAIN_RULES = [
  {
    type: "pull_request", ruleset_source_type: "Repository", ruleset_source: "TrueNorthIT/github-repos", ruleset_id: 4211,
    parameters: { required_approving_review_count: 2, dismiss_stale_reviews_on_push: true, require_code_owner_review: true, require_last_push_approval: true, required_review_thread_resolution: true, allowed_merge_methods: ["squash", "rebase"] },
  },
  {
    type: "required_status_checks", ruleset_source_type: "Repository", ruleset_source: "TrueNorthIT/github-repos", ruleset_id: 4211,
    parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "CI / lint" }, { context: "CI / test (ubuntu-latest)" }, { context: "CI / build" }] },
  },
  { type: "non_fast_forward", ruleset_source_type: "Repository", ruleset_source: "TrueNorthIT/github-repos", ruleset_id: 4211 },
  { type: "deletion", ruleset_source_type: "Repository", ruleset_source: "TrueNorthIT/github-repos", ruleset_id: 4211 },
  { type: "required_linear_history", ruleset_source_type: "Repository", ruleset_source: "TrueNorthIT/github-repos", ruleset_id: 4211 },
  { type: "required_signatures", ruleset_source_type: "Organization", ruleset_source: "TrueNorthIT", ruleset_id: 88 },
  { type: "required_deployments", ruleset_source_type: "Organization", ruleset_source: "TrueNorthIT", ruleset_id: 88, parameters: { required_deployment_environments: ["staging"] } },
];

const MAIN_CLASSIC = {
  required_status_checks: { strict: false, contexts: ["license/cla"], checks: [{ context: "license/cla", app_id: null }] },
  enforce_admins: { enabled: true },
  required_pull_request_reviews: { dismiss_stale_reviews: false, require_code_owner_reviews: false, required_approving_review_count: 1, require_last_push_approval: false },
  required_signatures: { enabled: false },
  required_linear_history: { enabled: false },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  required_conversation_resolution: { enabled: false },
  lock_branch: { enabled: false },
};

const RELEASE_CLASSIC = {
  required_status_checks: { strict: true, contexts: ["CI / build"], checks: [{ context: "CI / build", app_id: 15368 }] },
  enforce_admins: { enabled: false },
  required_pull_request_reviews: { dismiss_stale_reviews: true, require_code_owner_reviews: false, required_approving_review_count: 1, require_last_push_approval: false },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  required_conversation_resolution: { enabled: true },
};

/** Per repo: the branch each fixture policy is on (follows a rename). */
const policyBranch = new Map<string, { main: string; release: string }>();
const where = (fullName: string) => {
  const k = fullName.toLowerCase();
  if (!policyBranch.has(k)) policyBranch.set(k, { main: "main", release: "release/1.0" });
  return policyBranch.get(k)!;
};

interface MockRuleset { id: number; name: string; target: string; source_type: string; source: string; enforcement: string; conditions: any; rules: { type: string; parameters?: any }[]; bypass_actors: unknown[] }
const rulesets = new Map<string, MockRuleset[]>();
let nextRulesetId = 5000;
/** The repository's own rulesets: "Protect main" (4211, mirrors MAIN_RULES) and, on the PR repo, the extension's lock on release/2.0. */
function rulesetsOf(fullName: string): MockRuleset[] {
  const k = fullName.toLowerCase();
  if (!rulesets.has(k)) {
    const list: MockRuleset[] = [{
      id: 4211, name: "Protect main", target: "branch", source_type: "Repository", source: fullName, enforcement: "active", bypass_actors: [],
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: MAIN_RULES.filter((r) => r.ruleset_id === 4211).map((r) => ({ type: r.type, ...(r.parameters && { parameters: r.parameters }) })),
    }];
    if (k === PR_REPO) list.push({
      id: 4999, name: "Azure DevOps policies: release/2.0", target: "branch", source_type: "Repository", source: fullName, enforcement: "active", bypass_actors: [],
      conditions: { ref_name: { include: ["refs/heads/release/2.0"], exclude: [] } }, rules: [{ type: "update" }, { type: "deletion" }],
    });
    rulesets.set(k, list);
  }
  return rulesets.get(k)!;
}
/** The rules of the rulesets added in the session (and the seeded lock) that apply to `branch`, as GET /rules/branches lists them. */
const sessionRules = (fullName: string, branch: string) =>
  rulesetsOf(fullName).filter((rs) => rs.id !== 4211 && rs.enforcement === "active" && (rs.conditions?.ref_name?.include ?? []).includes(`refs/heads/${branch}`))
    .flatMap((rs) => rs.rules.map((r) => ({ ...r, ruleset_source_type: "Repository", ruleset_source: fullName, ruleset_id: rs.id })));

function rulesFor(fullName: string, branch: string): unknown[] {
  return [...(branch === where(fullName).main ? MAIN_RULES.map((r) => ({ ...r, ruleset_source: fullName })) : []), ...sessionRules(fullName, branch)];
}

const summary = ({ conditions: _c, rules: _r, bypass_actors: _b, ...rest }: MockRuleset) => rest;

/** /rulesets and /rulesets/{id}. Readers may list and read; writes need admin, and GitHub checks the rules it is sent. */
function rulesetsRest(fullName: string, rest: string, init: RequestInit | undefined, sc: string): Response | undefined {
  const method = init?.method ?? "GET";
  const list = rulesetsOf(fullName);
  const write = method !== "GET";
  if (write && (sc === "rulesetsDenied" || !isAdmin(sc))) return fail(403, "Resource not accessible by integration");
  if (write && sc === "rulesetsInvalid") return fail(422, "Validation Failed: Invalid rules: 'Required status checks'");
  const body = () => JSON.parse(String(init?.body ?? "{}"));
  const check = (b: any): string | null => {
    for (const r of b.rules ?? []) {
      if (r.type === "pull_request" && ["dismiss_stale_reviews_on_push", "require_code_owner_review", "require_last_push_approval", "required_approving_review_count", "required_review_thread_resolution"].some((k) => !(k in (r.parameters ?? {})))) return "Invalid property /rules/0: data matches no possible input";
      if (r.type === "required_status_checks" && !r.parameters?.required_status_checks?.length) return "Invalid rules: 'Required status checks'";
    }
    return null;
  };
  if (rest === "/rulesets") {
    if (method === "GET") return json(list.map(summary));
    if (method !== "POST") return undefined;
    const b = body();
    if (list.some((x) => x.name === b.name)) return fail(422, "Validation Failed: Name must be unique");
    const bad = check(b);
    if (bad) return fail(422, `Validation Failed: ${bad}`);
    const made: MockRuleset = { id: nextRulesetId++, name: b.name, target: b.target, source_type: "Repository", source: fullName, enforcement: b.enforcement ?? "disabled", conditions: b.conditions, rules: b.rules ?? [], bypass_actors: b.bypass_actors ?? [] };
    list.push(made);
    return json(made, 201);
  }
  const one = /^\/rulesets\/(\d+)$/.exec(rest);
  if (!one) return undefined;
  const at = list.findIndex((x) => x.id === Number(one[1]));
  if (at < 0) return fail(404, "Not Found");
  if (method === "GET") return json(list[at]);
  if (method === "DELETE") { list.splice(at, 1); return new Response(null, { status: 204 }); }
  if (method === "PUT") {
    const b = body();
    const bad = check(b);
    if (bad) return fail(422, `Validation Failed: ${bad}`);
    list[at] = { ...list[at], ...b, id: list[at].id };
    return json(list[at]);
  }
  return undefined;
}
function classicFor(fullName: string, branch: string): unknown | null {
  const w = where(fullName);
  if (branch === w.main) return MAIN_CLASSIC;
  if (branch === w.release && fullName.toLowerCase() === PR_REPO) return RELEASE_CLASSIC;
  return null;
}

/** REST routes under /repos/{o}/{r}; `rest` is "" for the repository itself. undefined when this module has no answer. */
export function policiesRest(fullName: string, rest: string, init: RequestInit | undefined, sc: string): Response | undefined {
  const method = init?.method ?? "GET";
  const rr = refsOf(fullName);
  if (rest === "" && method === "PATCH") {
    if (sc === "refsFail" || !isAdmin(sc)) return fail(403, "Must have admin rights to Repository.");
    const want = String(JSON.parse(String(init?.body ?? "{}")).default_branch ?? "");
    if (!rr.branches.some((b) => b.name === want)) return fail(422, "Validation Failed");
    defaults.set(fullName.toLowerCase(), want);
    return json({ default_branch: want, permissions: { admin: true, push: true } });
  }
  if (rest === "/tags" && method === "GET") return json([...rr.tags].sort((a, b) => b.at - a.at).map((t) => ({ name: t.name, commit: { sha: t.commit } })));
  if (rest.startsWith("/rulesets")) return rulesetsRest(fullName, rest, init, sc);
  const rules = /^\/rules\/branches\/(.+)$/.exec(rest);
  if (rules && method === "GET") return json(rulesFor(fullName, decodeURIComponent(rules[1])));
  const rename = /^\/branches\/(.+)\/rename$/.exec(rest);
  if (rename && method === "POST") {
    const from = decodeURIComponent(rename[1]);
    const to = String(JSON.parse(String(init?.body ?? "{}")).new_name ?? "");
    const b = rr.branches.find((x) => x.name === from);
    if (!b) return fail(404, "Branch not found");
    if (sc === "refsFail") return fail(403, "Resource not accessible by integration");
    if ((from === defaultBranchOf(fullName) || b.protected) && !isAdmin(sc)) return fail(403, "You must be an admin to rename this branch.");
    if (rr.branches.some((x) => x.name === to)) return fail(422, `Branch ${to} already exists.`);
    b.name = to;
    const listed = repoOf(fullName)?.branches; // the REST branch list the pickers read
    if (listed?.includes(from)) listed[listed.indexOf(from)] = to;
    if (from === defaultBranchOf(fullName)) defaults.set(fullName.toLowerCase(), to);
    const w = where(fullName);
    if (w.main === from) w.main = to;
    if (w.release === from) w.release = to;
    return json({ name: to, protected: b.protected }, 201);
  }
  const prot = /^\/branches\/(.+)\/protection$/.exec(rest);
  if (prot && method === "GET") {
    const c = classicFor(fullName, decodeURIComponent(prot[1]));
    if (!isAdmin(sc)) return fail(c ? 403 : 404, c ? "Resource not accessible by integration" : "Branch not protected");
    return c ? json(c) : fail(404, "Branch not protected");
  }
  const one = /^\/branches\/([^/]+)$/.exec(rest);
  if (one && method === "GET") {
    const name = decodeURIComponent(one[1]);
    const b = rr.branches.find((x) => x.name === name);
    if (!b) return fail(404, "Branch not found");
    const c = classicFor(fullName, name) as any;
    const rsc = c?.required_status_checks;
    return json({
      name, commit: { sha: b.tip }, protected: !!c || b.protected,
      protection: { enabled: !!c, required_status_checks: rsc ? { enforcement_level: "non_admins", contexts: rsc.contexts, checks: rsc.checks } : { enforcement_level: "off", contexts: [], checks: [] } },
    });
  }
  return undefined;
}

// The Actions page's place in the location hash (ACT-17). FROZEN CONTRACT (2026-11-03): bodies are filled in against actionsHash.test.ts.
//
// Follows securityHash.ts: it sits alongside browseState.ts without editing it. Hash keys: `view=actions`, then actTab, actWorkflow, actRun,
// actAttempt, actJob, actLine and the run filters actBranch, actStatus, actActor, actEvent. All carry the `act` prefix to stay clear of
// browseState (repo, ref, path, tab, switch, view, prTab, pr, prPage, file, commit, commitTab, parent, branchTab, q, tagTab, release,
// releaseForm, relPage, relKind), prListFilters, newPrHash, securityHash, compareHash and diffHash keys.
//
// Rules:
//  - parseActions is null unless the hash has view=actions AND a valid repo ("owner/name", browseState's rule). It never throws.
//    browseState.parse keeps the repo and drops the rest, so the app reads parseActions(hash) before routing (as for Security).
//  - Pages: no actWorkflow/actRun -> the landing page (tab: recent | all | runs; absent means recent).
//    actWorkflow (a workflow's numeric id) -> that workflow's runs, with the filters.
//    actRun (a run's numeric id) -> the run page; actAttempt (positive integer) picks an attempt, absent means the latest.
//    actJob (numeric id) with actRun -> the log view of that job; actLine (positive integer) only with actJob.
//  - Ids and numbers are positive safe integers written in decimal; anything else is dropped. A dropped parent drops its children
//    (no actRun -> no actAttempt/actJob/actLine; no actJob -> no actLine).
//  - Filters only with actWorkflow, or with tab=runs: actBranch (trimmed, max 255), actActor (trimmed, max 100),
//    actEvent (trimmed, max 50), actStatus one of RUN_STATUS_FILTERS. Blank values are dropped.
//  - actEnv (an environment name, trimmed, max 255) only with tab=environments and without actWorkflow/actRun: that environment's deployments.
//  - actRunTab (tests | artifacts) only with actRun and without actJob: the run page's tab; absent means Summary. Written last.
//  - serializeActions writes `#repo=...&view=actions` then the keys in the order listed above, leaving out anything absent, and
//    never writes tab=recent (the default). Values are encodeURIComponent-encoded.
//  - applyActions(hash, s) keeps the hash's other segments verbatim and in order, drops every earlier `view` and every key of this
//    module, and appends `view=actions` then the module's keys in the order above.

export type ActTab = "recent" | "all" | "runs" | "environments";

/** GitHub's run `status` filter values that the UI offers. */
export const RUN_STATUS_FILTERS = ["queued", "in_progress", "waiting", "completed", "success", "failure", "cancelled", "skipped"] as const;
export type RunStatusFilter = (typeof RUN_STATUS_FILTERS)[number];

export interface ActionsHashState {
  /** "owner/name". */
  repo: string;
  tab?: ActTab;
  workflow?: number;
  run?: number;
  attempt?: number;
  job?: number;
  line?: number;
  branch?: string;
  status?: RunStatusFilter;
  actor?: string;
  event?: string;
  /** An environment's name: its deployment history. Only with tab=environments (and no workflow or run). */
  env?: string;
  /** The run page's tab (native Pipelines: Summary, Tests, Artifacts...). Only with run and without job; absent means Summary. */
  runTab?: RunTab;
}

export type RunTab = "tests" | "artifacts";
const RUN_TABS: RunTab[] = ["tests", "artifacts"];

const REPO = /^[\w.-]+\/[\w.-]+$/;
const KEYS = ["view", "actTab", "actWorkflow", "actRun", "actAttempt", "actJob", "actLine", "actBranch", "actStatus", "actActor", "actEvent", "actEnv", "actRunTab"];
const TABS: ActTab[] = ["recent", "all", "runs", "environments"];

const id = (v: string | null): number | undefined => (v && /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

function params(hash: string): URLSearchParams {
  const body = hash.replace(/^#+/, "");
  try {
    return new URLSearchParams(body);
  } catch {
    return new URLSearchParams();
  }
}

export function parseActions(hash: string): ActionsHashState | null {
  const p = params(hash);
  const repo = p.get("repo");
  if (p.get("view") !== "actions" || !repo || !REPO.test(repo) || repo.split("/").some((x) => x === "." || x === "..")) return null;
  const out: ActionsHashState = { repo };
  const tab = p.get("actTab") as ActTab;
  if (TABS.includes(tab) && tab !== "recent") out.tab = tab;
  const workflow = id(p.get("actWorkflow"));
  if (workflow) out.workflow = workflow;
  const run = id(p.get("actRun"));
  if (run) {
    out.run = run;
    const attempt = id(p.get("actAttempt"));
    if (attempt) out.attempt = attempt;
    const job = id(p.get("actJob"));
    if (job) {
      out.job = job;
      const line = id(p.get("actLine"));
      if (line) out.line = line;
    } else {
      const runTab = p.get("actRunTab") as RunTab;
      if (RUN_TABS.includes(runTab)) out.runTab = runTab;
    }
  }
  if (workflow || out.tab === "runs") {
    const status = p.get("actStatus") as RunStatusFilter;
    for (const [k, key, cap] of [["branch", "actBranch", 255], ["actor", "actActor", 100], ["event", "actEvent", 50]] as const) {
      const v = (p.get(key) ?? "").trim().slice(0, cap);
      if (v) out[k] = v;
    }
    if (RUN_STATUS_FILTERS.includes(status)) out.status = status;
  }
  const env = (p.get("actEnv") ?? "").trim().slice(0, 255);
  if (env && out.tab === "environments" && !workflow && !run) out.env = env;
  return out;
}

export function serializeActions(s: ActionsHashState): string {
  const { repo, ...rest } = s;
  return applyActions(`#repo=${encodeURIComponent(repo)}`, rest);
}

export function applyActions(hash: string, s: Omit<ActionsHashState, "repo">): string {
  const kept = hash.replace(/^#+/, "").split("&").filter((x) => x && !KEYS.includes(x.split("=")[0]));
  kept.push("view=actions");
  const add = (k: string, v: string | number | undefined) => {
    const t = String(v ?? "").trim();
    if (t) kept.push(`${k}=${encodeURIComponent(t)}`);
  };
  if (s.tab !== "recent") add("actTab", s.tab);
  add("actWorkflow", s.workflow);
  add("actRun", s.run);
  add("actAttempt", s.attempt);
  add("actJob", s.job);
  add("actLine", s.line);
  add("actBranch", s.branch);
  add("actStatus", s.status);
  add("actActor", s.actor);
  add("actEvent", s.event);
  if (s.tab === "environments") add("actEnv", s.env?.trim().slice(0, 255));
  if (s.run && !s.job && s.runTab && RUN_TABS.includes(s.runTab)) add("actRunTab", s.runTab);
  return "#" + kept.join("&");
}

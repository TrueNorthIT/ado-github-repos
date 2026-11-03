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
//  - serializeActions writes `#repo=...&view=actions` then the keys in the order listed above, leaving out anything absent, and
//    never writes tab=recent (the default). Values are encodeURIComponent-encoded.
//  - applyActions(hash, s) keeps the hash's other segments verbatim and in order, drops every earlier `view` and every key of this
//    module, and appends `view=actions` then the module's keys in the order above.

export type ActTab = "recent" | "all" | "runs";

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
}

export function parseActions(hash: string): ActionsHashState | null {
  throw new Error("not implemented");
}

export function serializeActions(s: ActionsHashState): string {
  throw new Error("not implemented");
}

export function applyActions(hash: string, s: Omit<ActionsHashState, "repo">): string {
  throw new Error("not implemented");
}

// "Can it merge?" and the policies panel (A-3).

export type PolicyKind = "reviews" | "check" | "conflicts" | "draft" | "behind";
export type PolicyState = "success" | "failure" | "pending" | "neutral";

export interface PolicyRow {
  kind: PolicyKind;
  title: string;
  state: PolicyState;
  required: boolean;
  url?: string;
  detail?: string;
  /** Check rows: the accordion group, the Actions workflow name, else the check app's name; absent for status contexts (Other checks). */
  group?: string;
}

/** One entry of statusCheckRollup.contexts.nodes. `isRequired` comes from isRequired(pullRequestNumber:). */
export type CheckContext =
  | {
      __typename: "CheckRun"; name: string; status: string; conclusion: string | null; detailsUrl?: string | null; isRequired: boolean;
      startedAt?: string | null; completedAt?: string | null; checkSuite?: { workflowRun?: { workflow?: { name: string } | null } | null } | null;
      /** checkSuite again under an alias, for the workflow run id (the de-duplication selection of checkSuite is pinned by a test). */
      runSuite?: { workflowRun?: { databaseId: number } | null } | null;
      /** annotations(first: 1) { totalCount }: only the count, for the Overview row. */
      annotations?: { totalCount: number } | null;
      /** checkSuite under an alias again, for the app name (a group for checks that are not Actions jobs). */
      appSuite?: { app?: { name: string } | null } | null;
    }
  | { __typename: "StatusContext"; context: string; state: string; targetUrl?: string | null; isRequired: boolean; createdAt?: string | null };

export interface PolicyInput {
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  /** CLEAN | HAS_HOOKS | UNSTABLE | BLOCKED | BEHIND | DIRTY | UNKNOWN (| DRAFT: no longer in the schema, but tolerated). */
  mergeStateStatus: string;
  /** APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED, null when the branch does not require reviews. */
  reviewDecision: string | null;
  checks: CheckContext[];
  /** Repository.autoMergeAllowed. */
  autoMergeAllowed: boolean;
  /** PullRequest.autoMergeRequest, null when auto-merge is not enabled. */
  autoMergeRequest: { mergeMethod: string } | null;
}

export interface PolicyDecision {
  canComplete: boolean;
  canAutoComplete: boolean;
  primaryAction: "complete" | "autoComplete" | "publish" | "none";
  /** Human reasons the pull request cannot complete now; empty when canComplete. */
  blockers: string[];
  /** true when autoMergeRequest is set, so the UI offers "Cancel auto-complete". */
  autoCompleteEnabled: boolean;
}

const isDraft = (i: PolicyInput) => i.isDraft || i.mergeStateStatus === "DRAFT";

/** Conclusions the tests do not pin: STALE and a missing conclusion are neutral, STARTUP_FAILURE is a failure. */
function checkState(c: CheckContext): PolicyState {
  if (c.__typename === "StatusContext") return c.state === "SUCCESS" ? "success" : c.state === "FAILURE" || c.state === "ERROR" ? "failure" : "pending";
  if (c.status !== "COMPLETED") return "pending";
  switch (c.conclusion) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "CANCELLED":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "failure";
    default:
      return "neutral"; // NEUTRAL, SKIPPED, STALE, null
  }
}

const when = (c: CheckContext) => {
  const t = c.__typename === "CheckRun" ? c.completedAt ?? c.startedAt : c.createdAt;
  return t ? Date.parse(t) : Number.MAX_SAFE_INTEGER; // no timestamp yet: a queued run is the newest
};
const workflowOf = (c: CheckContext) => (c.__typename === "CheckRun" ? c.checkSuite?.workflowRun?.workflow?.name : undefined);

/** One entry per check: runs of the same job in the same workflow (re-runs, other events) collapse to the latest; jobs sharing a name across workflows are titled "{workflow} / {job}". */
export function dedupeChecks(checks: CheckContext[]): { c: CheckContext; title: string }[] {
  const latest = new Map<string, CheckContext>();
  for (const c of checks) {
    const key = c.__typename === "CheckRun" ? `run\u0000${workflowOf(c) ?? ""}\u0000${c.name}` : `ctx\u0000${c.context}`;
    const old = latest.get(key);
    if (!old || when(c) >= when(old)) latest.set(key, c); // ties go to the later node
  }
  const kept = [...latest.values()];
  const name = (c: CheckContext) => (c.__typename === "CheckRun" ? c.name : c.context);
  const clash = new Set(kept.filter((c, i) => c.__typename === "CheckRun" && kept.some((d, j) => j !== i && d.__typename === "CheckRun" && d.name === c.name)).map(name));
  return kept.map((c) => ({ c, title: clash.has(name(c)) && workflowOf(c) ? `${workflowOf(c)} / ${name(c)}` : name(c) }));
}

const RANK: Record<PolicyState, number> = { failure: 0, pending: 1, success: 2, neutral: 2 };
const REVIEWS = {
  APPROVED: { state: "success", detail: "The required approvals are in." },
  CHANGES_REQUESTED: { state: "failure", detail: "A reviewer has requested changes." },
  REVIEW_REQUIRED: { state: "pending", detail: "An approving review is required." },
} as const;

/** Rows for the policies panel, sorted: required first, then failure, pending, success (stable within a tie). */
export function policyRows(i: PolicyInput): PolicyRow[] {
  const rows: PolicyRow[] = [];
  const rev = i.reviewDecision ? REVIEWS[i.reviewDecision as keyof typeof REVIEWS] : undefined;
  if (rev) rows.push({ kind: "reviews", title: "Review approval", required: true, ...rev });
  if (isDraft(i)) rows.push({ kind: "draft", title: "Pull request is not a draft", state: "pending", required: true, detail: "Publish the draft to make it ready for review." });
  else {
    const s = i.mergeStateStatus;
    rows.push({
      kind: "conflicts",
      title: "No merge conflicts",
      required: true,
      state: s === "DIRTY" ? "failure" : s === "UNKNOWN" ? "pending" : "success",
      detail: s === "DIRTY" ? "This branch has conflicts that must be resolved." : s === "UNKNOWN" ? "GitHub is still checking for conflicts." : "No conflicts with the base branch.",
    });
  }
  if (i.mergeStateStatus === "BEHIND") rows.push({ kind: "behind", title: "Branch is up to date with the base branch", state: "failure", required: true, detail: "This branch is behind the base branch." });
  for (const { c, title } of dedupeChecks(i.checks)) {
    const url = c.__typename === "CheckRun" ? c.detailsUrl : c.targetUrl;
    const group = c.__typename === "CheckRun" ? workflowOf(c) ?? c.appSuite?.app?.name : undefined;
    rows.push({ kind: "check", title, state: checkState(c), required: c.isRequired, ...(url ? { url } : {}), ...(group ? { group } : {}) });
  }
  return rows.sort((a, b) => Number(b.required) - Number(a.required) || RANK[a.state] - RANK[b.state]);
}

const BLOCKER: Partial<Record<PolicyKind, (r: PolicyRow, i: PolicyInput) => string>> = {
  reviews: (_r, i) => (i.reviewDecision === "CHANGES_REQUESTED" ? "A reviewer has requested changes" : "An approving review is required"),
  conflicts: (r) => (r.state === "failure" ? "Merge conflicts must be resolved" : "Merge conflicts are still being checked"),
  behind: () => "The branch is behind the base branch",
};

export function mergeDecision(i: PolicyInput): PolicyDecision {
  const autoCompleteEnabled = i.autoMergeRequest !== null;
  const out = (primaryAction: PolicyDecision["primaryAction"], blockers: string[], canComplete = false, canAutoComplete = false): PolicyDecision => ({
    canComplete,
    canAutoComplete,
    primaryAction,
    blockers,
    autoCompleteEnabled,
  });
  if (i.state !== "OPEN") return out("none", []);
  if (isDraft(i)) return out("publish", ["This pull request is a draft"]);
  if (["CLEAN", "HAS_HOOKS", "UNSTABLE"].includes(i.mergeStateStatus)) return out("complete", [], true);
  const blockers = policyRows(i)
    .filter((r) => r.required && (r.state === "failure" || r.state === "pending"))
    .map((r) => BLOCKER[r.kind]?.(r, i) ?? r.title);
  if (!blockers.length) blockers.push("Blocked by the branch protection rules");
  const auto = (i.mergeStateStatus === "BLOCKED" || i.mergeStateStatus === "BEHIND") && i.autoMergeAllowed && !autoCompleteEnabled;
  return out(auto ? "autoComplete" : "none", blockers, false, auto);
}

/** How long a finished check run took, for the Checks tab; undefined while it runs, for a status context, or with a bad timestamp. */
export function checkDurationMs(c: CheckContext): number | undefined {
  if (c.__typename !== "CheckRun" || !c.startedAt || !c.completedAt) return undefined;
  const ms = Date.parse(c.completedAt) - Date.parse(c.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

// __TN_MOCK__ Fixture pull requests for acting on a PR (batch 1), their GitHub actions node, and mutations that change the fixture state.
// Per-PR repository settings stand in for per-repo ones: #308 is "a repo that only allows squash", #309 "a repo that deletes branches on merge".
import { ME, PRS, PR_REPO, type FixturePr } from "./prs";
import { headSha } from "./prDetail";
import { scenario } from "../mockSdk";

const MIN = 60e3;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

type Check =
  | { __typename: "CheckRun"; name: string; status: string; conclusion: string | null; detailsUrl: string | null; isRequired: boolean; startedAt?: string; completedAt?: string; checkSuite?: { workflowRun: { workflow: { name: string } } }; runSuite?: { workflowRun: { databaseId: number } | null }; annotations?: { totalCount: number }; appSuite?: { app: { name: string } } }
  | { __typename: "StatusContext"; context: string; state: string; targetUrl: string | null; isRequired: boolean; createdAt?: string };
const run = (name: string, conclusion: string | null, isRequired: boolean, status = conclusion ? "COMPLETED" : "IN_PROGRESS"): Check => ({
  __typename: "CheckRun", name, status, conclusion, detailsUrl: `https://github.com/${PR_REPO}/actions/runs/${1000 + name.length}`, isRequired,
});
/** A run of `name` in `workflow`, `minAgo` minutes ago: several of these make the duplicates a re-run or another event leaves behind. */
const wfRun = (name: string, workflow: string, minAgo: number, conclusion: string, isRequired = false): Check => ({
  ...(run(name, conclusion, isRequired) as Extract<Check, { __typename: "CheckRun" }>), startedAt: iso((minAgo + 1) * MIN), completedAt: iso(minAgo * MIN), checkSuite: { workflowRun: { workflow: { name: workflow } } },
});
/** A GitHub Actions job of workflow run `runId` (the id that re-run needs), with its annotation count. */
const job = (name: string, runId: number, conclusion: string | null, isRequired: boolean, annotations = 0, workflow = "Validate"): Check => ({
  ...(run(name, conclusion, isRequired) as Extract<Check, { __typename: "CheckRun" }>),
  detailsUrl: `https://github.com/${PR_REPO}/actions/runs/${runId}/job/${name.length}`,
  checkSuite: { workflowRun: { workflow: { name: workflow } } }, runSuite: { workflowRun: { databaseId: runId } }, annotations: { totalCount: annotations },
});
const GREEN = [run("build", "SUCCESS", true), run("unit tests", "SUCCESS", true), run("lint", "SUCCESS", false)];

interface Spec {
  title: string;
  author?: string;
  state?: "OPEN" | "CLOSED" | "MERGED";
  isDraft?: boolean;
  mergeStateStatus: string;
  reviewDecision: string | null;
  checks: Check[];
  body?: string;
  /** The first N fetches report mergeStateStatus UNKNOWN, as GitHub does right after a reopen. */
  unknownFetches?: number;
  /** The base branch requires a merge queue; `queued` starts the pull request in it. */
  queue?: { queued?: boolean };
  /** The head is in a fork the viewer can't push to (Rebase is disabled). */
  fork?: boolean;
  settings?: { merge?: boolean; squash?: boolean; rebase?: boolean; autoMerge?: boolean; deleteOnMerge?: boolean };
  /** The target has moved on (3 commits) but the branch rules don't require an up-to-date branch: Semi-linear merge rebases first. */
  baseMoved?: boolean;
  /** The head branch is protected against force pushes (classic rule): Semi-linear merge is disabled. */
  protectedHead?: boolean;
}
const WI = "Relates to AB#1000 and AB#1001.";
export const RERUN_RUN = 9001;
const SPECS: Record<number, Spec> = {
  301: { title: "Clean: required checks pass, ready to complete", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", checks: GREEN, body: `Everything is green. ${WI}`, settings: { autoMerge: true } },
  302: { title: "Blocked: a required check is failing", mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED", checks: [run("build", "FAILURE", true), run("unit tests", null, true), run("lint", "SUCCESS", false), run("docs preview", "SKIPPED", false)], body: `Auto-merge is allowed here. ${WI}`, settings: { autoMerge: true } },
  303: { title: "Conflicts: the branch can't merge as it is", mergeStateStatus: "DIRTY", reviewDecision: "APPROVED", checks: GREEN, body: "This one links no work items.", settings: { autoMerge: true } },
  304: { title: "Behind: the base branch has moved on", mergeStateStatus: "BEHIND", reviewDecision: "APPROVED", checks: GREEN, body: WI, settings: { autoMerge: true } },
  305: { title: "Draft: not ready for review yet", isDraft: true, mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED", checks: [run("build", "SUCCESS", true)], body: WI },
  306: { title: "Abandoned: closed without merging", state: "CLOSED", mergeStateStatus: "CLEAN", reviewDecision: null, checks: GREEN, body: WI },
  307: { title: "Yours: you are the author, so votes are off", author: ME, mergeStateStatus: "CLEAN", reviewDecision: null, checks: GREEN, body: WI },
  308: { title: "Squash only: the repository allows nothing else", mergeStateStatus: "CLEAN", reviewDecision: null, checks: GREEN, body: WI, settings: { merge: false, rebase: false } },
  309: { title: "Branch cleanup: the repository deletes merged branches", mergeStateStatus: "CLEAN", reviewDecision: null, checks: GREEN, body: WI, settings: { deleteOnMerge: true } },
  310: { title: "Settling: GitHub is still working out mergeability", mergeStateStatus: "CLEAN", reviewDecision: null, checks: GREEN, body: WI, unknownFetches: 2 },
  316: { title: "Merged: a completed pull request you can revert", state: "MERGED", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", checks: GREEN, body: WI },
  312: {
    title: "CI: failed jobs with annotations, deployments and signed commits", mergeStateStatus: "BLOCKED", reviewDecision: "APPROVED", body: WI, checks: ciChecks(),
  },
  313: { title: "Queue: the base branch requires a merge queue", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", checks: GREEN, body: WI, queue: {} },
  314: { title: "Queued: already waiting in the merge queue", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", checks: GREEN, body: WI, queue: { queued: true } },
  315: { title: "Fork behind: the head is in a fork you can't push to", mergeStateStatus: "BEHIND", reviewDecision: "APPROVED", checks: GREEN, body: WI, fork: true },
  317: { title: "Semi-linear: the target has moved on, so Semi-linear merge rebases first", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", checks: GREEN, body: WI, baseMoved: true },
  318: { title: "Protected head: the source branch refuses force pushes", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", checks: GREEN, body: WI, protectedHead: true },
  311: {
    title: "Duplicates: re-runs and other workflow events", mergeStateStatus: "CLEAN", reviewDecision: null, body: WI,
    checks: [
      wfRun("auto-merge", "Auto merge", 50, "SKIPPED"), wfRun("auto-merge", "Auto merge", 20, "SUCCESS"),
      wfRun("deploy", "CI", 60, "FAILURE", true), wfRun("deploy", "CI", 40, "CANCELLED", true), wfRun("deploy", "CI", 10, "SUCCESS", true), wfRun("deploy", "Release", 30, "SUCCESS"),
      wfRun("remove", "Cleanup", 45, "SUCCESS"), wfRun("remove", "Cleanup", 25, "SUCCESS"), wfRun("remove", "Cleanup", 5, "SUCCESS"),
    ],
  },
};

function ciChecks(): Check[] {
  return [
  job("build", RERUN_RUN, "SUCCESS", true),
  job("unit tests", RERUN_RUN, "FAILURE", true, 2),
  job("lint", RERUN_RUN, "FAILURE", false, 4),
  { ...(run("code quality", "FAILURE", false) as Extract<Check, { __typename: "CheckRun" }>), detailsUrl: `https://checks.example.test/${PR_REPO}/312`, annotations: { totalCount: 1 }, appSuite: { app: { name: "SonarCloud" } } },
  job("deploy preview", 9002, "SUCCESS", false, 0, "Storybook"),
  job("build storybook", 9002, "SUCCESS", false, 0, "Storybook"),
  job("screenshots", 9003, null, false, 0, "Screenshots"),
  { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS", targetUrl: null, isRequired: false },
  ];
}

interface Live {
  mergeStateStatus: string;
  reviewDecision: string | null;
  latestReview: { id: string; state: string } | null;
  autoMergeRequest: { enabledAt: string; mergeMethod: string; enabledBy: { login: string } } | null;
  headRefDeleted: boolean;
  subscription: string;
  unknownLeft: number;
  checks: Check[];
  /** Fetches left before the re-run jobs finish (they report IN_PROGRESS until then). */
  rerunLeft: number;
  /** Set while queued: fetches since it was added, which move it up the queue and finally merge it. */
  queue: { ticks: number } | null;
  copilotPending: boolean;
  /** The head after a rebase (else headSha(n)). */
  head?: string;
  /** REST pull request polls left that still report the old head after a rebase. */
  rebaseLeft?: number;
  /** Commits the head is behind the target (REST compare). */
  behind?: number;
}
const live = new Map<number, Live>();
/** The current head of fixture PR `n`: moved by a rebase. */
const curHead = (n: number) => live.get(n)?.head ?? headSha(n);
const specOf = (n: number) => SPECS[n];

// Register the fixtures as ordinary open and closed pull requests, newest first, so they head the Active list.
const template = PRS.find((p) => p.node.number === 199)!;
const authorOf = (login: string) => PRS.find((p) => p.node.author?.login === login)!.node.author;
function register(n: number, s: Spec, i: number) {
  const state = s.state ?? "OPEN";
  const pr: FixturePr = {
    reviewRequested: [],
    node: {
      ...template.node, number: n, title: s.title, url: `https://github.com/${PR_REPO}/pull/${n}`, state, isDraft: !!s.isDraft,
      createdAt: iso((i + 1) * 20 * MIN), updatedAt: iso((i + 1) * 10 * MIN), mergedAt: state === "MERGED" ? iso(5 * MIN) : null, closedAt: state === "CLOSED" ? iso(5 * MIN) : null,
      baseRefName: "main", author: authorOf(s.author ?? "ann"), labels: { nodes: [] }, reviewThreads: { totalCount: 0, nodes: [] }, comments: { totalCount: 0 },
      body: s.body ?? "", headRefName: `feature/pr-${n}`, mergeable: s.mergeStateStatus === "DIRTY" ? "CONFLICTING" : "MERGEABLE",
    },
  };
  PRS.unshift(pr);
  live.set(n, { mergeStateStatus: s.mergeStateStatus, reviewDecision: s.reviewDecision, latestReview: null, autoMergeRequest: null, headRefDeleted: false, subscription: (s.author ?? "ann") === ME ? "SUBSCRIBED" : "UNSUBSCRIBED", unknownLeft: s.unknownFetches ?? 0, checks: s.checks.map((c) => ({ ...c })), rerunLeft: 0, queue: s.queue?.queued || (n === 313 && scenario() === "queued") ? { ticks: 0 } : null, copilotPending: false, behind: s.baseMoved ? 3 : 0 });
}
Object.keys(SPECS).map(Number).sort((a, b) => b - a).forEach((n, i) => register(n, SPECS[n], i));
let nextRevert = 900;
PRS.sort((a, b) => Date.parse(b.node.updatedAt) - Date.parse(a.node.updatedAt));

/** Each fetch moves the fixtures along: re-run jobs finish, a queued pull request advances and is merged after a few fetches. */
function tick(n: number, l: Live, p: FixturePr) {
  if (l.rerunLeft > 0 && --l.rerunLeft === 0) {
    l.checks = l.checks.map((c) => (c.__typename === "CheckRun" && c.status !== "COMPLETED" ? { ...c, status: "COMPLETED", conclusion: "SUCCESS", annotations: { totalCount: 0 } } : c));
    if (!l.checks.some((c) => c.__typename === "CheckRun" && c.isRequired && c.conclusion !== "SUCCESS")) l.mergeStateStatus = "CLEAN";
  }
  if (l.queue && ++l.queue.ticks >= 9) {
    l.queue = null;
    Object.assign(p.node, { state: "MERGED", mergedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
}

/** POST .../actions/runs/{id}/rerun[-failed-jobs]: the failed (or, for "all", every) job of that run goes back to IN_PROGRESS, then succeeds. false when the run is unknown. */
export function rerunRun(runId: number, all: boolean): boolean {
  for (const [n, l] of live) {
    if (!l.checks.some((c) => c.__typename === "CheckRun" && c.runSuite?.workflowRun?.databaseId === runId)) continue;
    l.checks = l.checks.map((c) => (c.__typename === "CheckRun" && c.runSuite?.workflowRun?.databaseId === runId && (all || c.conclusion === "FAILURE") ? { ...c, status: "IN_PROGRESS", conclusion: null } : c));
    l.rerunLeft = 4;
    l.mergeStateStatus = "BLOCKED";
    void n;
    return true;
  }
  return false;
}

const prOf = (n: number) => PRS.find((p) => p.node.number === n);

/** The actionsDetailQuery repository node for fixture PR `n`, or null for a PR with no action fixture. */
export function actionsNode(n: number) {
  const p = prOf(n), l = live.get(n), s = specOf(n);
  if (!p || !l || !s) return null;
  const st = s.settings ?? {};
  const open = p.node.state === "OPEN";
  tick(n, l, p);
  const mergeStateStatus = l.unknownLeft > 0 ? (l.unknownLeft--, "UNKNOWN") : l.mergeStateStatus;
  const entry = l.queue && { position: Math.max(1, 3 - Math.floor(l.queue.ticks / 2)), state: "QUEUED", estimatedTimeToMerge: Math.max(1, 3 - Math.floor(l.queue.ticks / 2)) * 240 };
  return {
    mergeCommitAllowed: st.merge ?? true, squashMergeAllowed: st.squash ?? true, rebaseMergeAllowed: st.rebase ?? true,
    autoMergeAllowed: !!st.autoMerge, deleteBranchOnMerge: !!st.deleteOnMerge, viewerPermission: scenario() === "readOnlyViewer" ? "READ" : "ADMIN",
    defaultBranchRef: { name: "main" },
    pullRequest: {
      id: `PR_${n}`, state: p.node.state, isDraft: p.node.isDraft, merged: p.node.state === "MERGED", mergeStateStatus, reviewDecision: l.reviewDecision,
      baseRefName: p.node.baseRefName, headRefName: p.node.headRefName, headRefOid: curHead(n), isCrossRepository: !!s.fork, headRepository: { nameWithOwner: s.fork ? "contributor/github-repos" : PR_REPO, viewerPermission: s.fork ? "READ" : "ADMIN" },
      maintainerCanModify: false, viewerCanUpdateBranch: open && (mergeStateStatus === "BEHIND" || !!l.behind),
      isMergeQueueEnabled: !!s.queue, isInMergeQueue: !!l.queue, mergeQueueEntry: entry,
      reviewRequests: { nodes: l.copilotPending ? [{ requestedReviewer: { __typename: "Bot", login: "copilot-pull-request-reviewer" } }] : [] },
      // GitHub reports false here for every open PR; the app asks about push permission instead (lib/prActions.ts).
      headRef: l.headRefDeleted ? null : { id: `REF_${n}`, name: p.node.headRefName, branchProtectionRule: s.protectedHead ? { allowsDeletions: false, allowsForcePushes: false } : null },
      baseRef: { branchProtectionRule: null },
      viewerDidAuthor: p.node.author?.login === ME, viewerSubscription: l.subscription,
      viewerCanUpdate: open, viewerCanClose: open, viewerCanReopen: p.node.state === "CLOSED", viewerCanDeleteHeadRef: false,
      viewerCanEnableAutoMerge: open && !!st.autoMerge && !l.autoMergeRequest, viewerCanDisableAutoMerge: open && !!l.autoMergeRequest, viewerCanMergeAsAdmin: false,
      viewerLatestReview: l.latestReview, autoMergeRequest: l.autoMergeRequest,
      statusCheckRollup: { state: "SUCCESS", contexts: { pageInfo: { hasNextPage: false }, nodes: l.checks } },
    },
  };
}

export const branchNames = () => ["main", "develop", "release/1.0", "release/2.0", "hotfix/typo"];

/** What GitHub would suggest for the merge commit, for "Customize merge commit message". */
export function mergeMessages(n: number) {
  const t = prOf(n)?.node;
  return { mergeH: `Merge pull request #${n} from ${PR_REPO}/${t?.headRefName}`, mergeB: t?.title ?? "", squashH: `${t?.title} (#${n})`, squashB: "* Add the change\n\n* Address review comments" };
}

// ---------- mutations ----------

type Result = { code: number } | { data: unknown } | { errors: { type?: string; message: string }[] };
const num = (id: unknown) => Number(String(id).replace(/^\D+/, ""));
const fail = (message: string): Result => ({ errors: [{ message }] });
const MUTATIONS = /\b(addPullRequestReview|dismissPullRequestReview|mergePullRequest|enablePullRequestAutoMerge|disablePullRequestAutoMerge|deleteRef|closePullRequest|reopenPullRequest|convertPullRequestToDraft|markPullRequestReadyForReview|updateSubscription|updatePullRequest|updatePullRequestBranch|enqueuePullRequest|dequeuePullRequest|requestCopilotCodeReview|revertPullRequest)\(input: \$input\)/;

/** Applies an action mutation to the fixtures. undefined when `query` is not one of ours (the feed's mutations fall through). `scenario` "actionsFail" refuses them all. */
export function actionsMutation(query: string, variables: Record<string, any>, scenario: string): Result | undefined {
  const field = MUTATIONS.exec(query)?.[1];
  if (!field) return undefined;
  if (scenario === "actionsFail") return { code: 403 };
  const input = variables.input ?? {};
  const n = num(input.pullRequestId ?? input.pullRequestReviewId ?? input.refId ?? input.subscribableId ?? input.id);
  const p = prOf(n), l = live.get(n);
  if (!p || !l) return fail("Could not resolve to a node with the global id");
  const pr = () => ({ id: `PR_${n}`, state: p.node.state, isDraft: p.node.isDraft, merged: p.node.state === "MERGED" });
  switch (field) {
    case "addPullRequestReview":
      l.latestReview = { id: `PRR_${n}`, state: input.event === "APPROVE" ? "APPROVED" : "CHANGES_REQUESTED" };
      if (l.reviewDecision) l.reviewDecision = input.event === "APPROVE" ? "APPROVED" : "CHANGES_REQUESTED";
      if (l.reviewDecision === "APPROVED" && l.mergeStateStatus === "BLOCKED" && !p.node.isDraft && !specOf(n).checks.some((c) => c.__typename === "CheckRun" && c.isRequired && c.conclusion !== "SUCCESS")) l.mergeStateStatus = "CLEAN";
      return { data: { addPullRequestReview: { pullRequestReview: { id: `PRR_${n}`, state: l.latestReview.state } } } };
    case "dismissPullRequestReview":
      l.latestReview = null;
      if (l.reviewDecision) l.reviewDecision = "REVIEW_REQUIRED";
      return { data: { dismissPullRequestReview: { pullRequestReview: { id: `PRR_${n}`, state: "DISMISSED" } } } };
    case "mergePullRequest":
    case "enablePullRequestAutoMerge": {
      if (scenario === "headMoved" || input.expectedHeadOid !== curHead(n)) return fail("Head branch was modified. Review and try the merge again.");
      const s = specOf(n).settings ?? {};
      const allowed = { MERGE: s.merge ?? true, SQUASH: s.squash ?? true, REBASE: s.rebase ?? true }[input.mergeMethod as "MERGE"];
      if (!allowed) return fail(`${input.mergeMethod} merges are not allowed on this repository.`);
      if (field === "mergePullRequest") {
        if (p.node.isDraft || !["CLEAN", "HAS_HOOKS", "UNSTABLE"].includes(l.mergeStateStatus)) return fail("Pull Request is not mergeable");
        Object.assign(p.node, { state: "MERGED", mergedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        l.autoMergeRequest = null;
        if (s.deleteOnMerge) l.headRefDeleted = true; // the repository setting deletes it
        return { data: { mergePullRequest: { pullRequest: pr() } } };
      }
      if (!s.autoMerge) return fail("Auto merge is not allowed for this repository");
      l.autoMergeRequest = { enabledAt: new Date().toISOString(), mergeMethod: input.mergeMethod, enabledBy: { login: ME } };
      return { data: { enablePullRequestAutoMerge: { pullRequest: pr() } } };
    }
    case "disablePullRequestAutoMerge":
      l.autoMergeRequest = null;
      return { data: { disablePullRequestAutoMerge: { pullRequest: pr() } } };
    case "deleteRef":
      l.headRefDeleted = true;
      return { data: { deleteRef: { clientMutationId: null } } };
    case "closePullRequest":
      Object.assign(p.node, { state: "CLOSED", closedAt: new Date().toISOString() });
      return { data: { closePullRequest: { pullRequest: pr() } } };
    case "reopenPullRequest":
      Object.assign(p.node, { state: "OPEN", closedAt: null });
      return { data: { reopenPullRequest: { pullRequest: pr() } } };
    case "convertPullRequestToDraft":
      p.node.isDraft = true;
      return { data: { convertPullRequestToDraft: { pullRequest: pr() } } };
    case "markPullRequestReadyForReview":
      p.node.isDraft = false;
      return { data: { markPullRequestReadyForReview: { pullRequest: pr() } } };
    case "updateSubscription":
      l.subscription = input.state;
      return { data: { updateSubscription: { subscribable: { viewerSubscription: l.subscription } } } };
    case "updatePullRequestBranch":
      if (input.expectedHeadOid !== curHead(n)) return fail("Head branch was modified. Review and try the update again.");
      l.mergeStateStatus = "CLEAN";
      l.unknownLeft = 2; // GitHub works out mergeability again after the push
      if (input.updateMethod === "REBASE" && specOf(n).baseMoved) {
        // A rebase rewrites the head: the new sha shows up on REST a couple of polls later (the semi-linear merge waits for it).
        l.head = "5eb1" + curHead(n).slice(4);
        l.rebaseLeft = 2;
        l.behind = 0;
      }
      return { data: { updatePullRequestBranch: { pullRequest: { id: `PR_${n}`, headRefOid: headSha(n), mergeStateStatus: "UNKNOWN", viewerCanUpdateBranch: false } } } };
    case "enqueuePullRequest":
      if (!specOf(n).queue) return fail("Pull request is not eligible for the merge queue");
      l.queue = { ticks: 0 };
      return { data: { enqueuePullRequest: { mergeQueueEntry: { position: 3, state: "QUEUED", estimatedTimeToMerge: 720, pullRequest: { id: `PR_${n}`, isInMergeQueue: true } } } } };
    case "dequeuePullRequest":
      l.queue = null;
      return { data: { dequeuePullRequest: { mergeQueueEntry: null } } };
    case "revertPullRequest": {
      if (p.node.state !== "MERGED") return fail("Pull request is not merged");
      const m = nextRevert++;
      SPECS[m] = { title: input.title ?? `Revert "${p.node.title}"`, isDraft: !!input.draft, mergeStateStatus: "CLEAN", reviewDecision: null, checks: GREEN, body: input.body ?? "" };
      register(m, SPECS[m], 0);
      PRS.sort((a, b) => Date.parse(b.node.updatedAt) - Date.parse(a.node.updatedAt));
      return { data: { revertPullRequest: { pullRequest: pr(), revertPullRequest: { id: `PR_${m}`, number: m, url: `https://github.com/${PR_REPO}/pull/${m}` } } } };
    }
    case "requestCopilotCodeReview":
      if (scenario === "copilotRefused") return { data: { requestCopilotCodeReview: { success: false, failureReason: "NO_QUOTA_REMAINING", reviewRequest: null, pullRequest: { id: `PR_${n}` } } } };
      l.copilotPending = true;
      return { data: { requestCopilotCodeReview: { success: true, failureReason: null, reviewRequest: { id: "RR_1" }, pullRequest: { id: `PR_${n}` } } } };
    default: // updatePullRequest
      p.node.baseRefName = input.baseRefName;
      return { data: { updatePullRequest: { pullRequest: { id: `PR_${n}`, baseRefName: p.node.baseRefName } } } };
  }
}

// ---------- REST: the semi-linear merge's compare, poll and merge, and the branch rules (batch H) ----------

/**
 * REST answers for the fixture PRs, `rest` being the path after /repos/{owner}/{repo}. undefined when not ours.
 * Scenarios: "rebaseConflict" (GitHub reports conflicts after the rebase), "rebaseStuck" (the new head never shows up: the wait times out),
 * "mergeBlocked" (405: a required check must pass on the rebased commits).
 */
export function prActionsRest(repo: string, rest: string, init: RequestInit | undefined, sc: string): { status: number; body: unknown } | undefined {
  if (repo.toLowerCase() !== PR_REPO) return undefined;
  const method = init?.method ?? "GET";
  const rules = /^\/rules\/branches\/(.+)$/.exec(rest);
  if (rules && method === "GET") {
    const branch = rules[1].split("/").map(decodeURIComponent).join("/");
    // main requires a code owner's review through a ruleset; the reviewers section then groups Required and Optional.
    if (branch === "main") return { status: 200, body: [{ type: "pull_request", ruleset_source_type: "Repository", ruleset_source: PR_REPO, ruleset_id: 7, parameters: { require_code_owner_review: true, required_approving_review_count: 1, dismiss_stale_reviews_on_push: false, require_last_push_approval: false, required_review_thread_resolution: false } }] };
    return { status: 200, body: [] };
  }
  const cmp = /^\/compare\/([^.]+)\.\.\.([0-9a-f]{40})$/.exec(rest.split("?")[0]);
  if (cmp && method === "GET") {
    const n = [...live.keys()].find((k) => curHead(k) === cmp[2]);
    if (n === undefined) return undefined;
    const behind = live.get(n)!.behind ?? 0;
    return { status: 200, body: { status: behind ? "diverged" : "ahead", ahead_by: 1, behind_by: behind, total_commits: 1, commits: [], files: [] } };
  }
  const pull = /^\/pulls\/(\d+)(\/merge)?$/.exec(rest);
  if (!pull) return undefined;
  const n = Number(pull[1]);
  const p = prOf(n), l = live.get(n);
  if (!p || !l) return undefined;
  if (!pull[2] && method === "GET") {
    const stale = sc === "rebaseStuck" || (l.rebaseLeft ?? 0) > 0;
    if ((l.rebaseLeft ?? 0) > 0) l.rebaseLeft!--;
    const sha = stale && l.head ? headSha(n) : curHead(n);
    const conflict = sc === "rebaseConflict" && !!l.head;
    return {
      status: 200,
      body: {
        number: n, state: p.node.state === "OPEN" ? "open" : "closed", merged: p.node.state === "MERGED", head: { sha, ref: p.node.headRefName },
        mergeable: stale ? null : !conflict, mergeable_state: stale ? "unknown" : conflict ? "dirty" : l.mergeStateStatus.toLowerCase(),
      },
    };
  }
  if (pull[2] && method === "PUT") {
    const b = JSON.parse(String(init?.body ?? "{}"));
    if (b.sha !== curHead(n)) return { status: 409, body: { message: "Head branch was modified. Review and try the merge again." } };
    const s = specOf(n).settings ?? {};
    const allowed = { merge: s.merge ?? true, squash: s.squash ?? true, rebase: s.rebase ?? true }[b.merge_method as "merge"] ?? false;
    if (!allowed) return { status: 405, body: { message: `${b.merge_method} merges are not allowed on this repository.` } };
    if (sc === "mergeBlocked") return { status: 405, body: { message: "Required status check \"build\" is expected." } };
    if (p.node.isDraft || !["CLEAN", "HAS_HOOKS", "UNSTABLE"].includes(l.mergeStateStatus)) return { status: 405, body: { message: "Pull Request is not mergeable" } };
    Object.assign(p.node, { state: "MERGED", mergedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    if (s.deleteOnMerge) l.headRefDeleted = true;
    return { status: 200, body: { sha: "3e6e" + curHead(n).slice(4), merged: true, message: "Pull Request successfully merged" } };
  }
  return undefined;
}

// ---------- Azure DevOps work items ----------

/** Work item type -> its states, with the categories ADO reports. */
export const WI_STATES: Record<string, { name: string; category: string; color: string }[]> = {
  Bug: [{ name: "New", category: "Proposed", color: "b2b2b2" }, { name: "Active", category: "InProgress", color: "007acc" }, { name: "Resolved", category: "Resolved", color: "ff9d00" }, { name: "Closed", category: "Completed", color: "339933" }],
  Task: [{ name: "To Do", category: "Proposed", color: "b2b2b2" }, { name: "In Progress", category: "InProgress", color: "007acc" }, { name: "Done", category: "Completed", color: "339933" }],
  "Product Backlog Item": [{ name: "New", category: "Proposed", color: "b2b2b2" }, { name: "Committed", category: "InProgress", color: "007acc" }, { name: "Done", category: "Completed", color: "339933" }],
};
/** States set by the mock PATCH; the work items GET reads these first. */
export const WI_OVERRIDE = new Map<number, string>();

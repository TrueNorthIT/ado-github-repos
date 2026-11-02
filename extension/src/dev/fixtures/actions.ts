// __TN_MOCK__ Fixture pull requests for acting on a PR (batch 1), their GitHub actions node, and mutations that change the fixture state.
// Per-PR repository settings stand in for per-repo ones: #308 is "a repo that only allows squash", #309 "a repo that deletes branches on merge".
import { ME, PRS, PR_REPO, type FixturePr } from "./prs";
import { headSha } from "./prDetail";

const MIN = 60e3;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

type Check =
  | { __typename: "CheckRun"; name: string; status: string; conclusion: string | null; detailsUrl: string | null; isRequired: boolean; startedAt?: string; completedAt?: string; checkSuite?: { workflowRun: { workflow: { name: string } } } }
  | { __typename: "StatusContext"; context: string; state: string; targetUrl: string | null; isRequired: boolean; createdAt?: string };
const run = (name: string, conclusion: string | null, isRequired: boolean, status = conclusion ? "COMPLETED" : "IN_PROGRESS"): Check => ({
  __typename: "CheckRun", name, status, conclusion, detailsUrl: `https://github.com/${PR_REPO}/actions/runs/${1000 + name.length}`, isRequired,
});
/** A run of `name` in `workflow`, `minAgo` minutes ago: several of these make the duplicates a re-run or another event leaves behind. */
const wfRun = (name: string, workflow: string, minAgo: number, conclusion: string, isRequired = false): Check => ({
  ...(run(name, conclusion, isRequired) as Extract<Check, { __typename: "CheckRun" }>), startedAt: iso((minAgo + 1) * MIN), completedAt: iso(minAgo * MIN), checkSuite: { workflowRun: { workflow: { name: workflow } } },
});
const GREEN = [run("build", "SUCCESS", true), run("unit tests", "SUCCESS", true), run("lint", "SUCCESS", false)];

interface Spec {
  title: string;
  author?: string;
  state?: "OPEN" | "CLOSED";
  isDraft?: boolean;
  mergeStateStatus: string;
  reviewDecision: string | null;
  checks: Check[];
  body?: string;
  /** The first N fetches report mergeStateStatus UNKNOWN, as GitHub does right after a reopen. */
  unknownFetches?: number;
  settings?: { merge?: boolean; squash?: boolean; rebase?: boolean; autoMerge?: boolean; deleteOnMerge?: boolean };
}
const WI = "Relates to AB#1000 and AB#1001.";
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
  311: {
    title: "Duplicates: re-runs and other workflow events", mergeStateStatus: "CLEAN", reviewDecision: null, body: WI,
    checks: [
      wfRun("auto-merge", "Auto merge", 50, "SKIPPED"), wfRun("auto-merge", "Auto merge", 20, "SUCCESS"),
      wfRun("deploy", "CI", 60, "FAILURE", true), wfRun("deploy", "CI", 40, "CANCELLED", true), wfRun("deploy", "CI", 10, "SUCCESS", true), wfRun("deploy", "Release", 30, "SUCCESS"),
      wfRun("remove", "Cleanup", 45, "SUCCESS"), wfRun("remove", "Cleanup", 25, "SUCCESS"), wfRun("remove", "Cleanup", 5, "SUCCESS"),
    ],
  },
};

interface Live {
  mergeStateStatus: string;
  reviewDecision: string | null;
  latestReview: { id: string; state: string } | null;
  autoMergeRequest: { enabledAt: string; mergeMethod: string; enabledBy: { login: string } } | null;
  headRefDeleted: boolean;
  subscription: string;
  unknownLeft: number;
}
const live = new Map<number, Live>();
const specOf = (n: number) => SPECS[n];

// Register the fixtures as ordinary open and closed pull requests, newest first, so they head the Active list.
const template = PRS.find((p) => p.node.number === 199)!;
const authorOf = (login: string) => PRS.find((p) => p.node.author?.login === login)!.node.author;
Object.keys(SPECS).map(Number).sort((a, b) => b - a).forEach((n, i) => {
  const s = SPECS[n];
  const state = s.state ?? "OPEN";
  const pr: FixturePr = {
    reviewRequested: [],
    node: {
      ...template.node, number: n, title: s.title, url: `https://github.com/${PR_REPO}/pull/${n}`, state, isDraft: !!s.isDraft,
      createdAt: iso((i + 1) * 20 * MIN), updatedAt: iso((i + 1) * 10 * MIN), mergedAt: null, closedAt: state === "CLOSED" ? iso(5 * MIN) : null,
      baseRefName: "main", author: authorOf(s.author ?? "ann"), labels: { nodes: [] }, reviewThreads: { totalCount: 0, nodes: [] }, comments: { totalCount: 0 },
      body: s.body ?? "", headRefName: `feature/pr-${n}`, mergeable: s.mergeStateStatus === "DIRTY" ? "CONFLICTING" : "MERGEABLE",
    },
  };
  PRS.unshift(pr);
  live.set(n, { mergeStateStatus: s.mergeStateStatus, reviewDecision: s.reviewDecision, latestReview: null, autoMergeRequest: null, headRefDeleted: false, subscription: (s.author ?? "ann") === ME ? "SUBSCRIBED" : "UNSUBSCRIBED", unknownLeft: s.unknownFetches ?? 0 });
});
PRS.sort((a, b) => Date.parse(b.node.updatedAt) - Date.parse(a.node.updatedAt));

const prOf = (n: number) => PRS.find((p) => p.node.number === n);

/** The actionsDetailQuery repository node for fixture PR `n`, or null for a PR with no action fixture. */
export function actionsNode(n: number) {
  const p = prOf(n), l = live.get(n), s = specOf(n);
  if (!p || !l || !s) return null;
  const st = s.settings ?? {};
  const open = p.node.state === "OPEN";
  const mergeStateStatus = l.unknownLeft > 0 ? (l.unknownLeft--, "UNKNOWN") : l.mergeStateStatus;
  return {
    mergeCommitAllowed: st.merge ?? true, squashMergeAllowed: st.squash ?? true, rebaseMergeAllowed: st.rebase ?? true,
    autoMergeAllowed: !!st.autoMerge, deleteBranchOnMerge: !!st.deleteOnMerge, viewerPermission: "ADMIN",
    defaultBranchRef: { name: "main" },
    pullRequest: {
      id: `PR_${n}`, state: p.node.state, isDraft: p.node.isDraft, merged: p.node.state === "MERGED", mergeStateStatus, reviewDecision: l.reviewDecision,
      baseRefName: p.node.baseRefName, headRefName: p.node.headRefName, headRefOid: headSha(n), isCrossRepository: false, headRepository: { nameWithOwner: PR_REPO },
      // GitHub reports false here for every open PR; the app asks about push permission instead (lib/prActions.ts).
      headRef: l.headRefDeleted ? null : { id: `REF_${n}`, name: p.node.headRefName, branchProtectionRule: null },
      viewerDidAuthor: p.node.author?.login === ME, viewerSubscription: l.subscription,
      viewerCanUpdate: open, viewerCanClose: open, viewerCanReopen: p.node.state === "CLOSED", viewerCanDeleteHeadRef: false,
      viewerCanEnableAutoMerge: open && !!st.autoMerge && !l.autoMergeRequest, viewerCanDisableAutoMerge: open && !!l.autoMergeRequest, viewerCanMergeAsAdmin: false,
      viewerLatestReview: l.latestReview, autoMergeRequest: l.autoMergeRequest,
      statusCheckRollup: { state: "SUCCESS", contexts: { pageInfo: { hasNextPage: false }, nodes: s.checks } },
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
const MUTATIONS = /\b(addPullRequestReview|dismissPullRequestReview|mergePullRequest|enablePullRequestAutoMerge|disablePullRequestAutoMerge|deleteRef|closePullRequest|reopenPullRequest|convertPullRequestToDraft|markPullRequestReadyForReview|updateSubscription|updatePullRequest)\(input: \$input\)/;

/** Applies an action mutation to the fixtures. undefined when `query` is not one of ours (the feed's mutations fall through). `scenario` "actionsFail" refuses them all. */
export function actionsMutation(query: string, variables: Record<string, any>, scenario: string): Result | undefined {
  const field = MUTATIONS.exec(query)?.[1];
  if (!field) return undefined;
  if (scenario === "actionsFail") return { code: 403 };
  const input = variables.input ?? {};
  const n = num(input.pullRequestId ?? input.pullRequestReviewId ?? input.refId ?? input.subscribableId);
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
      if (scenario === "headMoved" || input.expectedHeadOid !== headSha(n)) return fail("Head branch was modified. Review and try the merge again.");
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
    default: // updatePullRequest
      p.node.baseRefName = input.baseRefName;
      return { data: { updatePullRequest: { pullRequest: { id: `PR_${n}`, baseRefName: p.node.baseRefName } } } };
  }
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

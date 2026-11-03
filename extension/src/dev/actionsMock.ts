// __TN_MOCK__ Mock REST answers for the Actions lists (workflows, runs, dispatch, environments) and the workflow files (/contents/.github/workflows/*).
// Only truenorthit/github-repos has workflows. Workflows: 101 CI (two schedules), 102 publish (workflow_dispatch with an input of every type), 103 legacy (disabled; enable/disable work).
// Environments staging and production with deployments (see below); scenario `noEnvironments` has none. Runs and their logs can be deleted.
// Runs 5001-5032, newest first. 5001 is in progress and finishes ~25s after the page loads (live refresh); 5002 queued; 5003 waiting.
// Scenarios: `dispatchFails` answers 422 with GitHub's message; `readOnly` is handled in mockFetch (permissions.push false).
// actions-runs: run ids 9001-9099 and job ids 90000+ are theirs (actionsRunMock.ts); WORKFLOW_YAML is exported for the job graph.
import { avatar } from "./fixtures/refs";

const REPO = "truenorthit/github-repos";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const MIN = 60e3;
const LOADED = Date.now();

export const WORKFLOW_YAML: Record<string, string> = {
  ".github/workflows/ci.yml": `name: CI
on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: "0 3 * * MON-FRI"
    - cron: "30 */6 * * SAT,SUN"

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci

  test:
    name: test
    needs: validate
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20]
    steps:
      - run: npm test

  build:
    needs: [validate, test]
    runs-on: ubuntu-latest
    steps:
      - run: npm run build

  publish:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: npm publish
`,
  ".github/workflows/publish.yml": `name: publish
on:
  push:
    tags: ["v*.*.*"]
  workflow_dispatch:
    inputs:
      version:
        description: Version to publish
        required: true
        type: string
      retries:
        description: How many times to retry the upload
        type: number
        default: 3
      channel:
        description: Release channel
        type: choice
        options:
          - stable
          - beta
          - nightly
        default: stable
      target:
        description: Environment to deploy to
        type: environment
        required: true
      dry_run:
        description: Build and package only, do not publish
        type: boolean
        default: true

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: npm run package
`,
  ".github/workflows/legacy.yml": `name: legacy
on:
  workflow_dispatch:

jobs:
  old:
    runs-on: ubuntu-latest
    steps:
      - run: echo old
`,
};

const WORKFLOWS = [
  { id: 101, name: "CI", path: ".github/workflows/ci.yml", state: "active" },
  { id: 102, name: "publish", path: ".github/workflows/publish.yml", state: "active" },
  { id: 103, name: "legacy", path: ".github/workflows/legacy.yml", state: "disabled_manually" },
].map((w) => ({ ...w, node_id: `W_${w.id}`, html_url: `https://github.com/${REPO}/blob/main/${w.path}`, created_at: new Date(LOADED - 90 * 86400e3).toISOString(), updated_at: new Date(LOADED - 30 * 86400e3).toISOString() }));

interface Spec { wf: number; status: string; conclusion: string | null; event: string; branch: string; actor: string; title: string; ago: number; secs: number }
const S = (wf: number, status: string, conclusion: string | null, event: string, branch: string, actor: string, title: string, ago: number, secs: number): Spec => ({ wf, status, conclusion, event, branch, actor, title, ago, secs });
const SPECS: Spec[] = [
  S(101, "in_progress", null, "push", "main", "ann", "Add retry handling to the sync job", 1, 0), // 5001, finishes ~25s after load
  S(101, "queued", null, "pull_request", "feature/retry", "bob-dev", "Add retry handling (#412)", 3, 0),
  S(102, "waiting", null, "workflow_dispatch", "main", "JoePittsy", "publish", 9, 0),
  S(101, "completed", "success", "push", "main", "ann", "Fix login redirect", 35, 214),
  S(101, "completed", "failure", "pull_request", "feature/oauth", "carol", "OAuth callback (#409)", 70, 142),
  S(101, "completed", "success", "pull_request", "feature/oauth", "carol", "OAuth callback (#409)", 140, 231),
  S(102, "completed", "success", "push", "v1.2.0", "JoePittsy", "Release 1.2.0", 300, 487),
  S(101, "completed", "cancelled", "pull_request", "feature/docs", "dave", "Docs: clarify setup (#401)", 420, 38),
  S(101, "completed", "success", "push", "main", "bob-dev", "Merge PR 398: tidy logging", 600, 205),
  S(101, "completed", "failure", "push", "release/2025.06", "ann", "Backport the logging fix", 900, 97),
  S(101, "completed", "success", "schedule", "main", "github-actions", "CI", 1440, 3725),
  S(102, "completed", "failure", "workflow_dispatch", "main", "JoePittsy", "publish", 1700, 66),
  S(101, "completed", "success", "push", "main", "ann", "Update dependencies", 2000, 198),
  S(101, "completed", "success", "pull_request", "feature/retry", "bob-dev", "Add retry handling (#412)", 2400, 220),
  S(102, "completed", "success", "push", "v1.1.0", "JoePittsy", "Release 1.1.0", 4000, 455),
  S(101, "completed", "skipped", "push", "main", "renovate", "Bump vitest", 4300, 3),
  S(101, "completed", "success", "push", "main", "carol", "Refactor listing", 5000, 192),
  S(101, "completed", "failure", "pull_request", "feature/ci", "dave", "Cache npm (#388)", 6000, 120),
  S(101, "completed", "success", "schedule", "main", "github-actions", "CI", 7200, 201),
  S(102, "completed", "cancelled", "workflow_dispatch", "main", "ann", "publish", 8000, 12),
  S(101, "completed", "success", "push", "main", "ann", "Initial commit", 9000, 186),
  S(101, "completed", "success", "pull_request", "feature/docs", "dave", "Docs: clarify setup (#401)", 10000, 190),
  S(103, "completed", "failure", "workflow_dispatch", "main", "ann", "legacy", 12000, 55),
  S(103, "completed", "success", "workflow_dispatch", "main", "ann", "legacy", 13000, 41),
  S(101, "completed", "success", "push", "main", "bob-dev", "Fix typo", 15000, 177),
  S(101, "completed", "success", "push", "main", "bob-dev", "Add tests", 18000, 183),
  S(101, "completed", "failure", "push", "main", "carol", "Break the build", 20000, 80),
  S(102, "completed", "success", "push", "v1.0.0", "JoePittsy", "Release 1.0.0", 24000, 430),
  S(101, "completed", "success", "push", "main", "ann", "Prepare 1.0.0", 25000, 175),
  S(103, "completed", "cancelled", "workflow_dispatch", "main", "ann", "legacy", 30000, 9),
  S(101, "completed", "success", "push", "main", "ann", "First CI", 40000, 160),
];

const BASE_SHA = "6e6ce359960cbfd8bf1eb5e99c516c1f57371550";
const sha = (i: number) => (i.toString(16).padStart(6, "0") + BASE_SHA).slice(0, 40);

interface MockRun { id: number; spec: Spec; created: number }
const baseRuns = (): MockRun[] => SPECS.map((spec, i) => ({ id: 5001 + i, spec, created: LOADED - spec.ago * MIN }));
const dispatched: MockRun[] = [];
const wfName = (id: number) => WORKFLOWS.find((w) => w.id === id)!.name;

function rawRun({ id, spec, created }: MockRun) {
  const live = id === 5001;
  const done = live && Date.now() - LOADED > 25e3; // flips to success while the page is open
  const status = done ? "completed" : spec.status;
  const conclusion = done ? "success" : spec.conclusion;
  const started = created + (spec.status === "queued" || spec.status === "waiting" ? 0 : 2e3);
  const w = WORKFLOWS.find((x) => x.id === spec.wf)!;
  return {
    id, name: wfName(spec.wf), node_id: `WFR_${id}`, head_branch: spec.branch, head_sha: sha(id), path: w.path, display_title: spec.title, run_number: 100 + (id - 5001 === 0 ? 33 : 33 - (id - 5001)),
    event: spec.event, status, conclusion, workflow_id: spec.wf,
    actor: { login: spec.actor, id: 1, avatar_url: avatar(spec.actor), type: "User" },
    run_attempt: 1, pull_requests: spec.event === "pull_request" ? [{ id: 1, number: Number(/#(\d+)/.exec(spec.title)?.[1] ?? 0) || 412 }] : [],
    created_at: new Date(created).toISOString(), run_started_at: new Date(started).toISOString(),
    updated_at: new Date(spec.status === "in_progress" && !done ? Date.now() : done ? LOADED + 25e3 : started + spec.secs * 1000).toISOString(),
    html_url: `https://github.com/${REPO}/actions/runs/${id}`,
  };
}

function matches(r: ReturnType<typeof rawRun>, q: URLSearchParams): boolean {
  const branch = q.get("branch"), status = q.get("status"), actor = q.get("actor"), event = q.get("event");
  if (branch && r.head_branch !== branch) return false;
  if (actor && r.actor.login.toLowerCase() !== actor.toLowerCase()) return false;
  if (event && r.event !== event) return false;
  if (status && r.status !== status && r.conclusion !== status) return false;
  return true;
}

// ---------- enable/disable, delete run and logs ----------
// Scenario `actionsFail` answers 403 to these too. A run still going (5001-5003) answers 409, as GitHub refuses to delete one.

/** Runs deleted in this page load (the lists and the run page leave them out). */
export const deletedRuns = new Set<number>();
/** Runs whose logs were deleted (the log view then answers 410). */
export const deletedLogs = new Set<number>();

function housekeepingRest(rest: string, init: RequestInit | undefined, sc: string): Response | undefined {
  const method = init?.method ?? "GET";
  const toggle = /^\/actions\/workflows\/(\d+)\/(enable|disable)$/.exec(rest);
  if (toggle && method === "PUT") {
    const wf = WORKFLOWS.find((w) => w.id === Number(toggle[1]));
    if (!wf) return json({ message: "Not Found" }, 404);
    if (sc === "actionsFail") return json({ message: "Resource not accessible by integration" }, 403);
    wf.state = toggle[2] === "enable" ? "active" : "disabled_manually";
    return new Response(null, { status: 204 });
  }
  const del = /^\/actions\/runs\/(\d+)(\/logs)?$/.exec(rest);
  if (del && method === "DELETE") {
    const id = Number(del[1]);
    if (deletedRuns.has(id)) return json({ message: "Not Found" }, 404);
    if (sc === "actionsFail") return json({ message: "Resource not accessible by integration" }, 403);
    if (id >= 5001 && id <= 5003 && !(id === 5001 && Date.now() - LOADED > 25e3)) return json({ message: "Cannot delete a workflow run that is in progress" }, 409);
    (del[2] ? deletedLogs : deletedRuns).add(id);
    return new Response(null, { status: 204 });
  }
  return undefined;
}

// ---------- environments and deployments ----------
// staging (a branch policy) and production (required reviewers, a wait timer, protected branches). Deployments link to runs of the lists mock
// through their status's log_url: 5003 (waiting), 5007 (Release 1.2.0), 5012 (failed publish), 5015 (1.1.0), 5028 (1.0.0); 814 is an outside
// preview deployment whose status points elsewhere, so it has no run link.

const ENVIRONMENTS = [
  { id: 1, name: "staging", protection_rules: [{ id: 11, type: "branch_policy" }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } },
  {
    id: 2, name: "production",
    protection_rules: [{ id: 21, type: "required_reviewers", reviewers: [{ type: "User", reviewer: { login: "JoePittsy" } }] }, { id: 22, type: "wait_timer", wait_timer: 5 }],
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
  },
].map((e) => ({ ...e, node_id: `EN_${e.id}`, html_url: `https://github.com/${REPO}/deployments/activity_log?environments_filter=${e.name}`, created_at: new Date(LOADED - 200 * 86400e3).toISOString(), updated_at: new Date(LOADED - 10 * 86400e3).toISOString() }));

interface MockDeployment { id: number; environment: string; ref: string; run?: number; ago: number; creator: string; status?: string; description?: string; target?: string; url?: string; task?: string }
const DEPLOYMENTS: MockDeployment[] = [
  { id: 811, environment: "staging", ref: "main", run: 5003, ago: 9, creator: "JoePittsy", status: "waiting", description: "Waiting for review" },
  { id: 814, environment: "staging", ref: "feature/preview", ago: 50, creator: "preview-bot", status: "success", description: "Preview ready", target: "https://preview.example.com/build/814", url: "https://feature-preview.example.com", task: "deploy:preview" },
  { id: 812, environment: "staging", ref: "main", run: 5012, ago: 1700, creator: "JoePittsy", status: "failure", description: "Deployment failed" },
  { id: 813, environment: "staging", ref: "v1.2.0", run: 5007, ago: 302, creator: "JoePittsy", status: "inactive", url: "https://staging.example.com" },
  { id: 801, environment: "production", ref: "v1.2.0", run: 5007, ago: 296, creator: "JoePittsy", status: "success", description: "Deployed 1.2.0", url: "https://app.example.com" },
  { id: 802, environment: "production", ref: "v1.1.0", run: 5015, ago: 3995, creator: "JoePittsy", status: "inactive" },
  { id: 803, environment: "production", ref: "v1.0.0", run: 5028, ago: 23995, creator: "ann", status: "inactive" },
  { id: 804, environment: "production", ref: "v0.9.0", ago: 30000, creator: "ann" }, // never got a status
];

const rawDeployment = (d: MockDeployment) => ({
  id: d.id, node_id: `DE_${d.id}`, sha: sha(d.id), ref: d.ref, task: d.task ?? "deploy", environment: d.environment, description: null, payload: {},
  creator: { login: d.creator, id: 1, avatar_url: avatar(d.creator), type: "User" },
  created_at: new Date(LOADED - d.ago * MIN).toISOString(), updated_at: new Date(LOADED - d.ago * MIN + 60e3).toISOString(),
  url: `https://api.github.com/repos/${REPO}/deployments/${d.id}`,
});
const rawStatus = (d: MockDeployment) => {
  const runUrl = d.run ? `https://github.com/${REPO}/actions/runs/${d.run}/job/${d.run * 100}` : "";
  return {
    id: d.id * 10, state: d.status, description: d.description ?? "", environment: d.environment,
    log_url: runUrl || d.target || "", target_url: runUrl || d.target || "", environment_url: d.url ?? "",
    creator: { login: "github-actions[bot]", id: 2, avatar_url: avatar("github-actions"), type: "Bot" },
    created_at: new Date(LOADED - d.ago * MIN + 120e3).toISOString(),
  };
};

/** Answers the Actions list endpoints, dispatch, environments and the workflow files; undefined for anything else. `rest` is the path after /repos/{owner}/{name}. */
export function actionsRest(repo: string, rest: string, u: URL, init: RequestInit | undefined, sc: string): Response | undefined {
  if (repo.toLowerCase() !== REPO) return undefined;
  const q = u.searchParams;
  if (rest === "/actions/workflows") return json({ total_count: WORKFLOWS.length, workflows: WORKFLOWS });
  const runs = /^\/actions\/(?:workflows\/(\d+)\/)?runs$/.exec(rest);
  if (runs && (init?.method ?? "GET") === "GET") {
    const wf = runs[1] ? Number(runs[1]) : undefined;
    if (wf !== undefined && !WORKFLOWS.some((w) => w.id === wf)) return json({ message: "Not Found" }, 404);
    const all = [...dispatched.filter((d) => d.created <= Date.now()), ...baseRuns()].filter((r) => !deletedRuns.has(r.id)).filter((r) => wf === undefined || r.spec.wf === wf).map(rawRun).filter((r) => matches(r, q)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const per = Number(q.get("per_page") || 30), page = Number(q.get("page") || 1);
    const more = page * per < all.length;
    return json({ total_count: all.length, workflow_runs: all.slice((page - 1) * per, page * per) }, 200, more ? { link: `<https://api.github.com/repositories/1/actions/runs?per_page=${per}&page=${page + 1}>; rel="next"` } : {});
  }
  const dispatch = /^\/actions\/workflows\/(\d+)\/dispatches$/.exec(rest);
  if (dispatch && init?.method === "POST") {
    const wf = WORKFLOWS.find((w) => w.id === Number(dispatch[1]));
    const body = JSON.parse(String(init.body ?? "{}"));
    if (!wf) return json({ message: "Not Found" }, 404);
    if (sc === "dispatchFails" || wf.state !== "active") return json({ message: "Workflow does not have 'workflow_dispatch' trigger", documentation_url: "https://docs.github.com" }, 422);
    if (wf.id === 102 && !body.inputs?.version) return json({ message: "Required input 'version' not provided" }, 422);
    const id = 5100 + dispatched.length;
    dispatched.push({ id, created: Date.now() + 2000, spec: S(wf.id, "queued", null, "workflow_dispatch", String(body.ref), "mock-user", wf.name, 0, 0) });
    return new Response(null, { status: 204 });
  }
  const housekeeping = housekeepingRest(rest, init, sc);
  if (housekeeping) return housekeeping;
  if (rest === "/environments") return sc === "noEnvironments" ? json({ total_count: 0, environments: [] }) : json({ total_count: ENVIRONMENTS.length, environments: ENVIRONMENTS });
  if (rest === "/deployments" && (init?.method ?? "GET") === "GET") {
    const env = q.get("environment");
    const all = DEPLOYMENTS.filter((d) => !env || d.environment === env).map(rawDeployment);
    const per = Number(q.get("per_page") || 30), page = Number(q.get("page") || 1);
    const more = page * per < all.length;
    return json(all.slice((page - 1) * per, page * per), 200, more ? { link: `<https://api.github.com/repositories/1/deployments?environment=${encodeURIComponent(env ?? "")}&per_page=${per}&page=${page + 1}>; rel="next"` } : {});
  }
  const statuses = /^\/deployments\/(\d+)\/statuses$/.exec(rest);
  if (statuses) {
    const d = DEPLOYMENTS.find((x) => x.id === Number(statuses[1]));
    return d ? json(d.status ? [rawStatus(d)] : []) : json({ message: "Not Found" }, 404);
  }
  const file = /^\/contents\/(\.github\/workflows\/[^/]+)$/.exec(rest);
  if (file && WORKFLOW_YAML[decodeURIComponent(file[1])]) return new Response(WORKFLOW_YAML[decodeURIComponent(file[1])], { headers: { "Content-Type": "application/octet-stream" } });
  return undefined;
}

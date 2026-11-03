// __TN_MOCK__ Mock REST answers for the Actions run page and log view: run detail, jobs, logs, artifacts, annotations, pending deployments, re-run, cancel, review.
// Runs 9001-9099 are scenarios (job ids are runId*100 + index, + 50 per extra attempt):
//   9001 CI, failed, attempt 2 of 2 (attempt 1 exists), matrix + needs chain, artifacts (one expired), annotations, re-run works.
//   9002 CI, in progress: its jobs finish a few seconds apart, the run completes after ~45s (live refresh).
//   9003 publish, waiting for review: environments staging and production are approvable, "audit" is not.
//   9004 CI, succeeded, with a ~20k-line log in "build".
//   9005 CI, succeeded, whose workflow file is missing at that commit (the graph falls back to the flat list).
// Runs 5001-5032 (the lists mock) get jobs from the same templates, following their status.
// Scenarios: `actionsFail` answers 403 to re-run/cancel; `reviewFails` answers 422 to a review; `readOnly` is handled in mockFetch.
import { avatar } from "./fixtures/refs";
import { actionsRest } from "./actionsMock";

const REPO = "truenorthit/github-repos";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const SHA = "6e6ce359960cbfd8bf1eb5e99c516c1f57371550";
const iso = (ms: number) => new Date(ms).toISOString();
const sec = (ms: number) => iso(Math.floor(ms / 1000) * 1000).replace(/\.\d+Z$/, "Z");

// ---------- job templates ----------

interface JobDef { name: string; start: number; end: number; fail?: boolean }
const CI: JobDef[] = [
  { name: "validate", start: 0, end: 8 },
  { name: "test (18)", start: 8, end: 20 },
  { name: "test (20)", start: 8, end: 26, fail: true },
  { name: "build", start: 26, end: 40 },
  { name: "publish", start: 40, end: 50 },
];
const PUBLISH: JobDef[] = [{ name: "publish", start: 0, end: 30 }];
const STEPS = ["Set up job", "Run actions/checkout@v4", "Run npm ci", "Run npm test", "Post Run actions/checkout", "Complete job"];

interface Sim {
  id: number; kind: "ci" | "publish"; title: string; event: string; branch: string; wf: number; path: string;
  /** When the run started (ms). */
  t0: number;
  attempt: number;
  /** How the run ends once it has finished: success, failure (test (20) fails, the rest are skipped), cancelled. null = in progress. */
  final: "success" | "failure" | "cancelled" | null;
  /** Progress follows the clock from t0 (live) instead of being all done. */
  live: boolean;
  waitingFor?: boolean;
  /** Elapsed seconds never go past this while the list mock says the run is still going. */
  cap?: number;
  large?: boolean;
}
const NOW0 = Date.now();
const sims = new Map<number, Sim>();
const seed = (s: Sim) => (sims.set(s.id, s), s);
seed({ id: 9001, kind: "ci", title: "Add retry handling to the sync job", event: "push", branch: "main", wf: 101, path: ".github/workflows/ci.yml", t0: NOW0 - 3 * 60e3, attempt: 2, final: "failure", live: false });
seed({ id: 9002, kind: "ci", title: "Cache npm between jobs", event: "pull_request", branch: "feature/cache", wf: 101, path: ".github/workflows/ci.yml", t0: NOW0 - 16e3, attempt: 1, final: "success", live: true });
seed({ id: 9003, kind: "publish", title: "publish", event: "workflow_dispatch", branch: "main", wf: 102, path: ".github/workflows/publish.yml", t0: NOW0 - 5 * 60e3, attempt: 1, final: "success", live: false, waitingFor: true });
seed({ id: 9004, kind: "ci", title: "Verbose test output", event: "push", branch: "main", wf: 101, path: ".github/workflows/ci.yml", t0: NOW0 - 30 * 60e3, attempt: 1, final: "success", live: false, large: true });
seed({ id: 9005, kind: "ci", title: "Rename the workflow file", event: "push", branch: "release/old", wf: 101, path: ".github/workflows/gone.yml", t0: NOW0 - 60 * 60e3, attempt: 1, final: "success", live: false });

const defsOf = (s: Sim) => (s.kind === "ci" ? CI : PUBLISH);
const jobId = (run: number, idx: number, attempt: number) => run * 100 + idx + (attempt - 1) * 50;

function elapsed(s: Sim, now: number) {
  const e = (now - s.t0) / 1000;
  return s.cap ? Math.min(e, s.cap) : e;
}

/** A job's state at `now`. */
function jobState(s: Sim, d: JobDef, e: number): { status: string; conclusion: string | null; start?: number; end?: number } {
  const t = (x: number) => s.t0 + x * 1000;
  if (s.waitingFor) return { status: "waiting", conclusion: null };
  if (s.live) {
    if (e < d.start) return { status: "queued", conclusion: null };
    if (e < d.end) return { status: "in_progress", conclusion: null, start: t(d.start) };
    return { status: "completed", conclusion: "success", start: t(d.start), end: t(d.end) };
  }
  if (s.final === "failure") {
    if (d.fail) return { status: "completed", conclusion: "failure", start: t(d.start), end: t(d.end) };
    if (d.start >= 26) return { status: "completed", conclusion: "skipped", start: t(d.start), end: t(d.start) };
    return { status: "completed", conclusion: "success", start: t(d.start), end: t(d.end) };
  }
  if (s.final === "cancelled") return d.start >= 8 ? { status: "completed", conclusion: "cancelled", start: t(d.start), end: t(d.start + 3) } : { status: "completed", conclusion: "success", start: t(d.start), end: t(d.end) };
  return { status: "completed", conclusion: "success", start: t(d.start), end: t(d.end) };
}

const runnerOf = (i: number) => `GitHub Actions ${i + 1}`;

function rawJobs(s: Sim, attempt: number, now: number) {
  const e = elapsed(s, now);
  return defsOf(s).map((d, i) => {
    const st = jobState(s, d, e);
    const dur = Math.max(1, d.end - d.start);
    const steps = STEPS.map((name, n) => {
      const from = d.start + (dur * n) / STEPS.length;
      const to = d.start + (dur * (n + 1)) / STEPS.length;
      let status = "completed", conclusion: string | null = "success";
      if (st.status === "queued" || st.status === "waiting") (status = st.status === "waiting" ? "waiting" : "queued"), (conclusion = null);
      else if (st.status === "in_progress") { if (e < from) (status = "queued"), (conclusion = null); else if (e < to) (status = "in_progress"), (conclusion = null); }
      else if (st.conclusion === "skipped") conclusion = "skipped";
      else if (st.conclusion === "failure" && name === "Run npm test") conclusion = "failure";
      else if (st.conclusion === "failure" && n > 3 && name !== "Post Run actions/checkout" && name !== "Complete job") conclusion = "skipped";
      const started = status === "queued" || status === "waiting" || st.conclusion === "skipped" ? null : sec(s.t0 + from * 1000);
      const completed = status === "completed" && started ? sec(s.t0 + to * 1000) : null;
      return { name, status, conclusion, number: n + 1, started_at: started, completed_at: completed };
    });
    const id = jobId(s.id, i, attempt);
    return {
      id, run_id: s.id, run_attempt: attempt, name: d.name, status: st.status, conclusion: st.conclusion, workflow_name: s.kind === "ci" ? "CI" : "publish",
      started_at: st.start ? sec(st.start) : sec(s.t0), completed_at: st.end ? sec(st.end) : null, steps: st.status === "queued" || st.status === "waiting" ? [] : steps,
      html_url: `https://github.com/${REPO}/actions/runs/${s.id}/job/${id}`, runner_name: st.start ? runnerOf(i) : null, labels: ["ubuntu-latest"],
    };
  });
}

function runState(s: Sim, now: number): { status: string; conclusion: string | null } {
  if (s.waitingFor) return { status: "waiting", conclusion: null };
  if (s.live) {
    const e = elapsed(s, now);
    const last = Math.max(...defsOf(s).map((d) => d.end));
    if (s.cap || e < last) return e < 0 ? { status: "queued", conclusion: null } : { status: "in_progress", conclusion: null };
    return { status: "completed", conclusion: "success" };
  }
  return { status: "completed", conclusion: s.final };
}

function rawRun(s: Sim, attempt: number, now: number) {
  const { status, conclusion } = runState(s, now);
  const last = Math.max(...defsOf(s).map((d) => d.end));
  return {
    id: s.id, name: s.kind === "ci" ? "CI" : "publish", node_id: `WFR_${s.id}`, head_branch: s.branch, head_sha: SHA, path: s.path, display_title: s.title, run_number: 40 + (s.id % 100),
    event: s.event, status: attempt < s.attempt ? "completed" : status, conclusion: attempt < s.attempt ? "failure" : conclusion, workflow_id: s.wf,
    actor: { login: "ann", id: 1, avatar_url: avatar("ann"), type: "User" }, run_attempt: attempt,
    pull_requests: s.event === "pull_request" ? [{ id: 1, number: 412 }] : [],
    created_at: sec(s.t0 - 4000), run_started_at: sec(s.t0), updated_at: iso(status === "completed" || attempt < s.attempt ? s.t0 + last * 1000 : now),
    html_url: `https://github.com/${REPO}/actions/runs/${s.id}`,
  };
}

// ---------- logs ----------

const ESC = "\u001b";
const ts = (ms: number) => new Date(ms).toISOString().replace(/Z$/, "0000Z");

/** The text of GET .../jobs/{id}/logs: a BOM, then "<timestamp> <text>" lines whose times fall inside each step's window. */
function logFor(s: Sim, idx: number, attempt: number): string {
  const d = defsOf(s)[idx];
  const st = jobState(s, d, 1e9);
  const dur = Math.max(1, d.end - d.start);
  const out: string[] = [];
  const failed = st.conclusion === "failure";
  STEPS.forEach((name, n) => {
    const from = s.t0 + (d.start + (dur * n) / STEPS.length) * 1000;
    const span = (dur / STEPS.length) * 1000;
    let k = 0;
    const L = (text: string) => out.push(`${ts(from + Math.min(span - 1, (k++) * 7))} ${text}`);
    if (name === "Set up job") {
      L("##[group]Current runner version: '2.329.0'");
      L("Operating System");
      L("  Ubuntu 24.04.3 LTS");
      L("##[endgroup]");
      L(`Runner: ${runnerOf(idx)}`);
    } else if (name === "Run actions/checkout@v4") {
      L("##[group]Run actions/checkout@v4");
      L("with:");
      L("  fetch-depth: 1");
      L("##[endgroup]");
      L("Syncing repository: truenorthit/github-repos");
      L(`##[command]/usr/bin/git log -1 --format=%H`);
      L(SHA);
    } else if (name === "Run npm ci") {
      L("##[group]Run npm ci");
      L(`${ESC}[36;1mnpm ci${ESC}[0m`);
      L("shell: /usr/bin/bash -e {0}");
      L("##[endgroup]");
      L("added 312 packages in 4s");
      L(`##[warning]Node.js 20 actions are deprecated. Actions will be forced to run with Node.js 24.`);
      L(`${ESC}[33mnpm warn${ESC}[0m deprecated inflight@1.0.6: This module is not supported`);
    } else if (name === "Run npm test") {
      L("##[group]Run npm test");
      L(`${ESC}[36;1mnpm test${ESC}[0m`);
      L("##[endgroup]");
      if (s.large && d.name === "build") {
        for (let i = 1; i <= 20000; i++) {
          if (i % 100 === 1) L(`##[group]Suite ${Math.ceil(i / 100)}`);
          out.push(`${ts(from + Math.min(span - 1, i * 0.4))} ${ESC}[32m✓${ESC}[0m test case ${i} passed in ${(i * 7) % 90} ms`);
          if (i % 100 === 0) L("##[endgroup]");
          if (i % 4000 === 0) L(`##[warning]Slow test case ${i}`);
        }
      } else if (d.name.startsWith("test")) {
        L(`${ESC}[32m PASS ${ESC}[0m src/lib/retry.test.ts`);
        L(`${ESC}[32m PASS ${ESC}[0m src/lib/sync.test.ts`);
        if (failed) {
          L(`${ESC}[41;97m FAIL ${ESC}[0m src/lib/queue.test.ts`);
          L(`${ESC}[31;1m  ● queue › retries three times${ESC}[0m`);
          L(`    ${ESC}[32mExpected: 3${ESC}[0m`);
          L(`    ${ESC}[31mReceived: 2${ESC}[0m`);
          L("##[error]Process completed with exit code 1.");
        } else L("Tests: 14 passed, 14 total");
      } else {
        L("Tests: 14 passed, 14 total");
      }
    } else if (name === "Run npm run build" || (d.name === "build" && name === "Post Run actions/checkout")) {
      L("Post job cleanup.");
    } else if (name === "Post Run actions/checkout") {
      L("##[group]Run actions/checkout@v4 (post)");
      L("Cleaning up orphan processes");
      L("##[endgroup]");
    } else {
      L("Cleaning up orphan processes");
    }
  });
  return "﻿" + out.join("\r\n") + "\r\n";
}

// ---------- the other endpoints ----------

const ARTIFACTS: Record<number, { id: number; name: string; size_in_bytes: number; expired: boolean; expires_at: string }[]> = {
  9001: [
    { id: 7001, name: "coverage-report", size_in_bytes: 2907697, expired: false, expires_at: iso(NOW0 + 20 * 86400e3) },
    { id: 7002, name: "build-output", size_in_bytes: 15728640, expired: false, expires_at: iso(NOW0 + 20 * 86400e3) },
    { id: 7003, name: "old-logs", size_in_bytes: 512, expired: true, expires_at: iso(NOW0 - 2 * 86400e3) },
  ],
  9004: [{ id: 7004, name: "dist", size_in_bytes: 1229, expired: false, expires_at: iso(NOW0 + 5 * 86400e3) }],
};

const ann = (path: string, line: number, level: string, message: string, title?: string) => ({ path, start_line: line, end_line: line, annotation_level: level, title: title ?? null, message });
function annotationsFor(run: number, idx: number): unknown[] {
  if (run === 9001 && idx === 2) return [ann("src/lib/queue.ts", 42, "failure", "Expected 3 retries, got 2", "queue.test.ts"), ann(".github", 1, "failure", "Process completed with exit code 1."), ann(".github", 1, "warning", "Node.js 20 actions are deprecated."), ann("src/lib/sync.ts", 17, "notice", "Retry budget is 3 by default.")];
  if (run === 9001 && idx === 0) return [ann(".github", 1, "warning", "Node.js 20 actions are deprecated.")];
  return [];
}

const pendingFor = (run: number) => (run === 9003 || run === 5003 ? [
  { environment: { id: 11, name: "staging" }, wait_timer: 0, current_user_can_approve: true },
  { environment: { id: 12, name: "production" }, wait_timer: 0, current_user_can_approve: true },
  { environment: { id: 13, name: "audit" }, wait_timer: 0, current_user_can_approve: false },
] : []);

/** A sim for a run of the lists mock (5001-5032), built from its raw JSON. */
async function listSim(id: number, sc: string): Promise<Sim | undefined> {
  if (sims.has(id)) return sims.get(id);
  const res = actionsRest(REPO, "/actions/runs", new URL("https://api.github.com/x?per_page=100"), undefined, sc);
  const raw = ((await res?.json())?.workflow_runs ?? []).find((r: any) => r.id === id);
  if (!raw) return undefined;
  return raw; // the caller re-derives the state from this on every request
}

function simFromRaw(raw: any, seen: Map<number, number>): Sim {
  const done = raw.status === "completed";
  const first = seen.get(raw.id) ?? (seen.set(raw.id, Date.now()), Date.now());
  const kind = raw.workflow_id === 101 ? "ci" : "publish";
  const final = done ? (raw.conclusion === "failure" ? "failure" : raw.conclusion === "cancelled" ? "cancelled" : "success") : null;
  return {
    id: raw.id, kind, title: raw.display_title, event: raw.event, branch: raw.head_branch, wf: raw.workflow_id, path: raw.path, attempt: 1, final: final === "cancelled" || final === "failure" || final === "success" ? final : null,
    t0: raw.status === "queued" || raw.status === "waiting" ? Date.now() + 1e6 : done ? Date.parse(raw.created_at) : first - 5000,
    live: raw.status === "in_progress", waitingFor: raw.status === "waiting", cap: raw.status === "in_progress" ? 44 : undefined,
  };
}
const seen = new Map<number, number>();

/** Handles every run-scoped path; undefined for anything else. `u` is the full URL (api.github.com). */
export async function actionsRunRest(u: URL, init: RequestInit | undefined, sc: string): Promise<Response | undefined> {
  const m = /^\/repos\/([^/]+\/[^/]+)\/(actions\/runs\/(\d+)(?:\/attempts\/(\d+))?(\/jobs|\/artifacts|\/pending_deployments|\/rerun|\/rerun-failed-jobs|\/cancel)?|actions\/jobs\/(\d+)\/(logs|rerun)|actions\/artifacts\/(\d+)\/zip|check-runs\/(\d+)\/annotations)$/.exec(u.pathname);
  if (!m || m[1].toLowerCase() !== REPO) return undefined;
  const method = init?.method ?? "GET";
  const now = Date.now();
  const sim = async (runId: number) => {
    const s = sims.get(runId);
    if (s) return s;
    const raw = await listSim(runId, sc);
    return raw ? simFromRaw(raw as unknown, seen) : undefined;
  };

  if (m[8]) return new Response(new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 0, 0, 0, 1, 2, 3]), { headers: { "Content-Type": "application/zip" } });
  if (m[9]) {
    const id = Number(m[9]);
    return json(annotationsFor(Math.floor(id / 100), id % 50));
  }
  if (m[6]) {
    const id = Number(m[6]);
    const run = Math.floor(id / 100);
    const s = await sim(run);
    if (!s) return json({ message: "Not Found" }, 404);
    const idx = id % 50;
    if (m[7] === "rerun") {
      if (sc === "actionsFail") return json({ message: "Resource not accessible by integration" }, 403);
      Object.assign(s, { t0: now, attempt: s.attempt + 1, live: true, final: "success", cap: undefined, waitingFor: false });
      sims.set(s.id, s);
      return new Response(null, { status: 201 });
    }
    if (rawJobs(s, s.attempt, now)[idx]?.status !== "completed") return json({ message: "Logs are not available" }, 404);
    return new Response(logFor(s, idx, s.attempt), { headers: { "Content-Type": "text/plain" } });
  }

  const runId = Number(m[3]);
  const s = await sim(runId);
  if (!s) return json({ message: "Not Found" }, 404);
  const attempt = m[4] ? Number(m[4]) : s.attempt;
  if (attempt < 1 || attempt > s.attempt) return json({ message: "Not Found" }, 404);
  switch (m[5]) {
    case "/jobs": {
      const jobs = rawJobs(s, attempt, now);
      return json({ total_count: jobs.length, jobs });
    }
    case "/artifacts": {
      const a = ARTIFACTS[runId] ?? (runId === 5004 ? ARTIFACTS[9004] : []);
      return json({ total_count: a.length, artifacts: a });
    }
    case "/pending_deployments": {
      if (method === "POST") {
        if (sc === "reviewFails") return json({ message: "Required reviewers must approve before the deployment can proceed" }, 422);
        const body = JSON.parse(String(init?.body ?? "{}"));
        Object.assign(s, { waitingFor: false, t0: now, live: true, cap: undefined, final: body.state === "approved" ? "success" : "cancelled" });
        if (body.state === "rejected") Object.assign(s, { live: false });
        sims.set(s.id, s);
        return json([]);
      }
      return json(s.waitingFor ? pendingFor(runId) : []);
    }
    case "/rerun":
    case "/rerun-failed-jobs": {
      if (sc === "actionsFail") return json({ message: "Resource not accessible by integration" }, 403);
      Object.assign(s, { t0: now, attempt: s.attempt + 1, live: true, final: "success", cap: undefined, waitingFor: false });
      sims.set(s.id, s);
      return new Response(null, { status: 201 });
    }
    case "/cancel": {
      if (sc === "actionsFail") return json({ message: "Resource not accessible by integration" }, 403);
      Object.assign(s, { live: false, final: "cancelled", cap: undefined, waitingFor: false, t0: s.t0 });
      sims.set(s.id, s);
      return json({}, 202);
    }
    default:
      return method === "GET" ? json(rawRun(s, attempt, now)) : undefined;
  }
}

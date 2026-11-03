import { describe, it, expect } from "vitest";
import {
  runState,
  formatDuration,
  elapsedMs,
  toWorkflow,
  toRun,
  toJob,
  toArtifact,
  toAnnotation,
  toPendingDeployment,
  nextPage,
  listWorkflowsRequest,
  listRunsRequest,
  getRunRequest,
  listJobsRequest,
  jobLogsPath,
  listArtifactsRequest,
  artifactZipPath,
  annotationsRequest,
  rerunRequest,
  cancelRequest,
  dispatchRequest,
  pendingDeploymentsRequest,
  reviewDeploymentsRequest,
  parseWorkflowJobs,
  parseDispatchInputs,
  validateInputs,
  inputsBody,
  worstState,
  jobGraph,
  type RunState,
  type Job,
  type WorkflowJobDef,
  type DispatchInput,
} from "./workflows";
import type { RestRequest } from "./restRequest";

// Module under test: src/lib/workflows.ts (frozen contract; every body throws "not implemented" until the developers fill them in).
// Requirement IDs: ACT-* is the Actions area (ACT-1 workflows list, ACT-2 runs list, ACT-3 run page and job graph, ACT-4 dispatch form, ACT-5 re-run,
// cancel and deployment review, ACT-6 artifacts and annotations). The contract's doc comments are the specification; each describe block quotes the
// sentence it proves. REST fixtures use GitHub's real field names (sampled read-only from TrueNorthIT/ado-github-repos on 2026-11-03).

const REPO = "TrueNorthIT/ado-github-repos";
const BASE = `/repos/${REPO}`;

/** Splits a request path into its path and a decoded query map, so tests do not depend on parameter order or '+' versus '%20'. */
function split(req: RestRequest): { path: string; params: Record<string, string> } {
  const [path, query = ""] = req.path.split("?");
  const params: Record<string, string> = {};
  new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
  return { path, params };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// runState, formatDuration, elapsedMs
// ---------------------------------------------------------------------------------------------------------------------------------

describe("ACT-2: runState maps GitHub's status and conclusion onto ADO's vocabulary", () => {
  // Given a run or job status/conclusion pair, `runState` (src/lib/workflows.ts) returns the state that drives the icon and colour.
  const pairs: [string, string | null, RunState][] = [
    ["queued", null, "queued"],
    ["requested", null, "queued"],
    ["pending", null, "queued"],
    ["waiting", null, "waiting"],
    ["in_progress", null, "inProgress"],
    ["completed", "success", "succeeded"],
    ["completed", "failure", "failed"],
    ["completed", "timed_out", "failed"],
    ["completed", "startup_failure", "failed"],
    ["completed", "cancelled", "cancelled"],
    ["completed", "skipped", "skipped"],
    ["completed", "neutral", "neutral"],
    ["completed", "stale", "neutral"],
    ["completed", "action_required", "neutral"],
    ["completed", null, "neutral"],
  ];
  for (const [status, conclusion, expected] of pairs) {
    it(`status ${status} with conclusion ${conclusion} is ${expected}`, () => {
      expect(runState(status, conclusion), `Expected ${status}/${conclusion} to map to ${expected}`).toBe(expected);
    });
  }

  it("treats null and undefined status and conclusion as neutral", () => {
    expect(runState(null, null), "Expected null/null to be neutral").toBe("neutral");
    expect(runState(undefined, undefined), "Expected undefined/undefined to be neutral").toBe("neutral");
  });

  it("treats an unknown status or an unknown conclusion as neutral", () => {
    expect(runState("teleporting", null), "Expected an unknown status to be neutral").toBe("neutral");
    expect(runState("completed", "exploded"), "Expected an unknown conclusion to be neutral").toBe("neutral");
  });
});

describe('ACT-2: formatDuration gives an ADO-style duration ("0s", "45s", "2m 14s", "1h 3m")', () => {
  // Arrange: milliseconds. Assert: the text in the doc comment's examples, plus the boundaries those examples imply.
  it('formats zero as "0s"', () => {
    expect(formatDuration(0), "Expected 0 ms to read 0s").toBe("0s");
  });

  it('formats under a minute in seconds ("45s", "59s")', () => {
    expect(formatDuration(45_000), "Expected 45 seconds to read 45s").toBe("45s");
    expect(formatDuration(59_000), "Expected 59 seconds to read 59s").toBe("59s");
  });

  it('formats minutes with seconds ("2m 14s")', () => {
    expect(formatDuration((2 * 60 + 14) * 1000), "Expected 2 minutes 14 seconds to read 2m 14s").toBe("2m 14s");
  });

  it('keeps the seconds on an exact minute ("1m 0s"): the minutes-and-seconds form applies up to an hour', () => {
    expect(formatDuration(60_000), "Expected exactly 60 seconds to read 1m 0s").toBe("1m 0s");
  });

  it('formats an hour and over as hours and minutes with the seconds dropped ("1h 3m")', () => {
    expect(formatDuration((3600 + 3 * 60 + 25) * 1000), "Expected 1h 3m 25s to read 1h 3m").toBe("1h 3m");
  });

  it('formats exactly an hour as "1h 0m" and the last second before it as "59m 59s"', () => {
    expect(formatDuration(3_599_000), "Expected 59m 59s just under an hour").toBe("59m 59s");
    expect(formatDuration(3_600_000), "Expected exactly one hour to read 1h 0m").toBe("1h 0m");
  });

  it("does not wrap hours into days", () => {
    expect(formatDuration((26 * 3600 + 5 * 60) * 1000), "Expected 26 hours 5 minutes to read 26h 5m").toBe("26h 5m");
  });

  it('formats a negative or NaN duration as "0s"', () => {
    expect(formatDuration(-5000), "Expected a negative duration to read 0s").toBe("0s");
    expect(formatDuration(Number.NaN), "Expected NaN to read 0s").toBe("0s");
  });
});

describe("ACT-3: elapsedMs measures start to end, or start to now for a running job", () => {
  const now = new Date("2026-11-03T10:30:00Z");

  it("returns the milliseconds between start and end", () => {
    expect(elapsedMs("2026-11-03T10:16:54Z", "2026-11-03T10:24:18Z", now), "Expected 7m 24s between start and end").toBe((7 * 60 + 24) * 1000);
  });

  it("measures from start to now when end is absent (null or undefined)", () => {
    expect(elapsedMs("2026-11-03T10:29:00Z", null, now), "Expected 60s from start to now when end is null").toBe(60_000);
    expect(elapsedMs("2026-11-03T10:29:00Z", undefined, now), "Expected 60s from start to now when end is undefined").toBe(60_000);
  });

  it("ignores now when an end is given", () => {
    expect(elapsedMs("2026-11-03T10:00:00Z", "2026-11-03T10:00:05Z", now), "Expected end to win over now").toBe(5000);
  });

  it("is undefined when start is absent", () => {
    expect(elapsedMs(null, "2026-11-03T10:24:18Z", now), "Expected undefined for a null start").toBeUndefined();
    expect(elapsedMs(undefined, null, now), "Expected undefined for an undefined start").toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// mappers
// ---------------------------------------------------------------------------------------------------------------------------------

const rawWorkflow = (over: Record<string, unknown> = {}) => ({
  id: 404735568,
  node_id: "W_kwDOVgSQoc4YfJhQ",
  name: "publish",
  path: ".github/workflows/publish.yml",
  state: "active",
  created_at: "2026-10-20T09:00:00.000Z",
  updated_at: "2026-10-20T09:00:00.000Z",
  url: `https://api.github.com/repos/${REPO}/actions/workflows/404735568`,
  html_url: `https://github.com/${REPO}/blob/main/.github/workflows/publish.yml`,
  badge_url: `https://github.com/${REPO}/workflows/publish/badge.svg`,
  ...over,
});

describe("ACT-1: toWorkflow maps GET /actions/workflows items", () => {
  // Given a workflow from the REST list, `toWorkflow` returns id, name, path, state, disabled and htmlUrl.
  it("maps id, name, path, state and htmlUrl", () => {
    expect(toWorkflow(rawWorkflow()), "Expected every field mapped from the REST names (html_url -> htmlUrl)").toEqual({
      id: 404735568,
      name: "publish",
      path: ".github/workflows/publish.yml",
      state: "active",
      disabled: false,
      htmlUrl: `https://github.com/${REPO}/blob/main/.github/workflows/publish.yml`,
    });
  });

  it("is disabled when the state starts with 'disabled' (manually, from inactivity or fork)", () => {
    for (const state of ["disabled_manually", "disabled_inactivity", "disabled_fork"]) {
      expect(toWorkflow(rawWorkflow({ state })).disabled, `Expected state ${state} to be disabled`).toBe(true);
    }
  });

  it("is not disabled when active or deleted", () => {
    expect(toWorkflow(rawWorkflow({ state: "active" })).disabled, "Expected active not to be disabled").toBe(false);
    expect(toWorkflow(rawWorkflow({ state: "deleted" })).disabled, "Expected deleted not to be disabled (it does not start with 'disabled')").toBe(false);
  });

  it("keeps the raw state text alongside the flag", () => {
    expect(toWorkflow(rawWorkflow({ state: "disabled_inactivity" })).state, "Expected the state string to be kept verbatim").toBe("disabled_inactivity");
  });
});

const rawRun = (over: Record<string, unknown> = {}) => ({
  id: 41617937185,
  name: "publish",
  node_id: "WFR_kwLOVgSQoc8AAAAJ",
  head_branch: "v0.35.0",
  head_sha: "6e6ce359960cbfd8bf1eb5e99c516c1f57371550",
  path: ".github/workflows/publish.yml",
  display_title: "Release 0.35.0",
  run_number: 48,
  event: "push",
  status: "completed",
  conclusion: "success",
  workflow_id: 404735568,
  actor: { login: "JoePittsy", id: 16508508, avatar_url: "https://avatars.githubusercontent.com/u/16508508?v=4", type: "User" },
  run_attempt: 1,
  pull_requests: [],
  created_at: "2026-11-03T10:16:51Z",
  updated_at: "2026-11-03T10:24:19Z",
  run_started_at: "2026-11-03T10:16:51Z",
  html_url: `https://github.com/${REPO}/actions/runs/41617937185`,
  ...over,
});

describe("ACT-2: toRun maps GET /actions/runs items", () => {
  // Given a workflow run from the REST list, `toRun` returns the WorkflowRun model field by field.
  it("maps every field from a completed successful push run", () => {
    const run = toRun(rawRun());
    expect(run.id, "Expected id").toBe(41617937185);
    expect(run.workflowId, "Expected workflow_id -> workflowId").toBe(404735568);
    expect(run.name, "Expected name to be the workflow's name").toBe("publish");
    expect(run.title, "Expected display_title -> title").toBe("Release 0.35.0");
    expect(run.runNumber, "Expected run_number -> runNumber").toBe(48);
    expect(run.attempt, "Expected run_attempt -> attempt").toBe(1);
    expect(run.event, "Expected event").toBe("push");
    expect(run.status, "Expected status kept verbatim").toBe("completed");
    expect(run.conclusion, "Expected conclusion kept verbatim").toBe("success");
    expect(run.branch, "Expected head_branch -> branch").toBe("v0.35.0");
    expect(run.headSha, "Expected head_sha -> headSha").toBe("6e6ce359960cbfd8bf1eb5e99c516c1f57371550");
    expect(run.htmlUrl, "Expected html_url -> htmlUrl").toBe(`https://github.com/${REPO}/actions/runs/41617937185`);
    expect(run.path, "Expected path").toBe(".github/workflows/publish.yml");
    expect(run.prNumbers, "Expected no pull requests").toEqual([]);
  });

  it("derives state from status and conclusion", () => {
    expect(toRun(rawRun()).state, "Expected completed/success to be succeeded").toBe("succeeded");
    expect(toRun(rawRun({ status: "completed", conclusion: "failure" })).state, "Expected completed/failure to be failed").toBe("failed");
    expect(toRun(rawRun({ status: "in_progress", conclusion: null })).state, "Expected in_progress to be inProgress").toBe("inProgress");
    expect(toRun(rawRun({ status: "queued", conclusion: null })).state, "Expected queued to be queued").toBe("queued");
  });

  it("maps the timestamps to Dates", () => {
    const run = toRun(rawRun());
    expect(run.createdAt, "Expected created_at as a Date").toEqual(new Date("2026-11-03T10:16:51Z"));
    expect(run.startedAt, "Expected run_started_at as a Date").toEqual(new Date("2026-11-03T10:16:51Z"));
    expect(run.updatedAt, "Expected updated_at as a Date").toEqual(new Date("2026-11-03T10:24:19Z"));
  });

  it("maps the actor's login and avatar", () => {
    const run = toRun(rawRun());
    expect(run.actor?.login, "Expected actor.login").toBe("JoePittsy");
    expect(run.actor?.avatarUrl, "Expected actor.avatar_url -> avatarUrl").toBe("https://avatars.githubusercontent.com/u/16508508?v=4");
  });

  it("leaves actor undefined when the run has none", () => {
    expect(toRun(rawRun({ actor: null })).actor, "Expected no actor for a null actor").toBeUndefined();
    const { actor: _omitted, ...withoutActor } = rawRun();
    expect(toRun(withoutActor).actor, "Expected no actor when the field is missing").toBeUndefined();
  });

  it("leaves startedAt undefined when run_started_at is missing or null", () => {
    expect(toRun(rawRun({ run_started_at: null })).startedAt, "Expected no startedAt for a null run_started_at").toBeUndefined();
    const { run_started_at: _omitted, ...without } = rawRun();
    expect(toRun(without).startedAt, "Expected no startedAt when run_started_at is missing").toBeUndefined();
  });

  it("keeps a null conclusion as null for a run that is still going", () => {
    expect(toRun(rawRun({ status: "in_progress", conclusion: null })).conclusion, "Expected conclusion null").toBeNull();
  });

  it("keeps a null head_branch as null (a run on a deleted or fork ref)", () => {
    expect(toRun(rawRun({ head_branch: null })).branch, "Expected branch null").toBeNull();
  });

  it("trims an '@ref' suffix from path", () => {
    expect(toRun(rawRun({ path: ".github/workflows/ci.yml@refs/heads/main" })).path, "Expected '@refs/heads/main' trimmed").toBe(".github/workflows/ci.yml");
    expect(toRun(rawRun({ path: ".github/workflows/ci.yml@refs/pull/12/merge" })).path, "Expected '@refs/pull/12/merge' trimmed").toBe(".github/workflows/ci.yml");
  });

  it("leaves a path without a suffix alone", () => {
    expect(toRun(rawRun({ path: ".github/workflows/ci.yml" })).path, "Expected a plain path unchanged").toBe(".github/workflows/ci.yml");
  });

  it("maps pull_requests[].number to prNumbers, in order", () => {
    const run = toRun(rawRun({ event: "pull_request", pull_requests: [{ id: 1, number: 12, head: { ref: "feature/a" } }, { id: 2, number: 15 }] }));
    expect(run.prNumbers, "Expected [12, 15]").toEqual([12, 15]);
  });

  it("gives an empty prNumbers when pull_requests is missing", () => {
    const { pull_requests: _omitted, ...without } = rawRun();
    expect(toRun(without).prNumbers, "Expected [] when pull_requests is missing").toEqual([]);
  });
});

const rawJob = (over: Record<string, unknown> = {}) => ({
  id: 125855973951,
  run_id: 41617937185,
  run_attempt: 1,
  workflow_name: "publish",
  head_branch: "v0.35.0",
  head_sha: "6e6ce359960cbfd8bf1eb5e99c516c1f57371550",
  status: "completed",
  conclusion: "success",
  created_at: "2026-11-03T10:16:51Z",
  started_at: "2026-11-03T10:16:54Z",
  completed_at: "2026-11-03T10:24:18Z",
  name: "publish",
  steps: [
    { name: "Set up job", status: "completed", conclusion: "success", number: 1, started_at: "2026-11-03T10:16:55Z", completed_at: "2026-11-03T10:16:56Z" },
    { name: "Run npm test", status: "completed", conclusion: "failure", number: 6, started_at: "2026-11-03T10:17:06Z", completed_at: "2026-11-03T10:17:15Z" },
    { name: "Complete job", status: "completed", conclusion: "skipped", number: 25, started_at: null, completed_at: null },
  ],
  html_url: `https://github.com/${REPO}/actions/runs/41617937185/job/125855973951`,
  runner_id: 1000000372,
  runner_name: "GitHub Actions 1000000372",
  runner_group_name: "GitHub Actions",
  labels: ["ubuntu-latest"],
  ...over,
});

describe("ACT-3: toJob maps GET /actions/runs/{id}/jobs items", () => {
  // Given a job from the REST list, `toJob` returns the Job model, including its steps.
  it("maps the job's fields", () => {
    const job = toJob(rawJob());
    expect(job.id, "Expected id").toBe(125855973951);
    expect(job.runId, "Expected run_id -> runId").toBe(41617937185);
    expect(job.attempt, "Expected run_attempt -> attempt").toBe(1);
    expect(job.name, "Expected name").toBe("publish");
    expect(job.status, "Expected status").toBe("completed");
    expect(job.conclusion, "Expected conclusion").toBe("success");
    expect(job.state, "Expected completed/success to be succeeded").toBe("succeeded");
    expect(job.htmlUrl, "Expected html_url -> htmlUrl").toBe(`https://github.com/${REPO}/actions/runs/41617937185/job/125855973951`);
    expect(job.runnerName, "Expected runner_name -> runnerName").toBe("GitHub Actions 1000000372");
    expect(job.labels, "Expected labels").toEqual(["ubuntu-latest"]);
    expect(job.startedAt, "Expected started_at as a Date").toEqual(new Date("2026-11-03T10:16:54Z"));
    expect(job.completedAt, "Expected completed_at as a Date").toEqual(new Date("2026-11-03T10:24:18Z"));
  });

  it("maps each step's number, name, status, conclusion, state and times, in order", () => {
    const { steps } = toJob(rawJob());
    expect(steps.map((s) => s.number), "Expected step numbers 1, 6, 25 in order").toEqual([1, 6, 25]);
    expect(steps[0], "Expected the first step mapped field by field").toEqual({
      number: 1,
      name: "Set up job",
      status: "completed",
      conclusion: "success",
      state: "succeeded",
      startedAt: new Date("2026-11-03T10:16:55Z"),
      completedAt: new Date("2026-11-03T10:16:56Z"),
    });
    expect(steps[1].state, "Expected completed/failure to be failed").toBe("failed");
    expect(steps[2].state, "Expected completed/skipped to be skipped").toBe("skipped");
  });

  it("leaves a step's startedAt and completedAt undefined when GitHub sends null", () => {
    const step = toJob(rawJob()).steps[2];
    expect(step.startedAt, "Expected no startedAt for a null started_at").toBeUndefined();
    expect(step.completedAt, "Expected no completedAt for a null completed_at").toBeUndefined();
  });

  it("maps a queued job: no start, no runner, null conclusion", () => {
    const job = toJob(rawJob({ status: "queued", conclusion: null, started_at: null, completed_at: null, runner_id: null, runner_name: null, runner_group_name: null, steps: [] }));
    expect(job.state, "Expected queued state").toBe("queued");
    expect(job.conclusion, "Expected null conclusion").toBeNull();
    expect(job.startedAt, "Expected no startedAt").toBeUndefined();
    expect(job.completedAt, "Expected no completedAt").toBeUndefined();
    expect(job.runnerName, "Expected no runnerName for a null runner_name").toBeUndefined();
    expect(job.steps, "Expected no steps").toEqual([]);
  });

  it("gives empty steps and labels when GitHub omits them", () => {
    const { steps: _s, labels: _l, ...bare } = rawJob();
    const job = toJob(bare);
    expect(job.steps, "Expected [] when steps is missing").toEqual([]);
    expect(job.labels, "Expected [] when labels is missing").toEqual([]);
  });
});

describe("ACT-6: toArtifact maps GET /actions/runs/{id}/artifacts items", () => {
  // Given an artifact from the REST list, `toArtifact` returns id, name, sizeInBytes, expired and expiresAt.
  const raw = {
    id: 7124509911,
    node_id: "MDg6QXJ0aWZhY3Q3MTI0NTA5OTEx",
    name: "vsix",
    size_in_bytes: 4_718_592,
    url: `https://api.github.com/repos/${REPO}/actions/artifacts/7124509911`,
    archive_download_url: `https://api.github.com/repos/${REPO}/actions/artifacts/7124509911/zip`,
    expired: false,
    created_at: "2026-11-03T10:17:27Z",
    expires_at: "2027-02-01T10:17:27Z",
  };

  it("maps id, name, size_in_bytes, expired and expires_at", () => {
    expect(toArtifact(raw), "Expected each field mapped").toEqual({
      id: 7124509911,
      name: "vsix",
      sizeInBytes: 4_718_592,
      expired: false,
      expiresAt: new Date("2027-02-01T10:17:27Z"),
    });
  });

  it("maps an expired artifact", () => {
    expect(toArtifact({ ...raw, expired: true }).expired, "Expected expired true").toBe(true);
  });

  it("leaves expiresAt undefined when expires_at is null or missing", () => {
    expect(toArtifact({ ...raw, expires_at: null }).expiresAt, "Expected no expiresAt for null").toBeUndefined();
    const { expires_at: _omitted, ...without } = raw;
    expect(toArtifact(without).expiresAt, "Expected no expiresAt when missing").toBeUndefined();
  });
});

describe("ACT-6: toAnnotation maps GET /check-runs/{id}/annotations items", () => {
  // Given an annotation from the REST list, `toAnnotation` returns path, startLine, endLine, level, title and message.
  const raw = {
    path: ".github",
    start_line: 12,
    end_line: 14,
    start_column: null,
    end_column: null,
    annotation_level: "failure",
    title: "Test failed",
    message: "Process completed with exit code 1.",
    raw_details: null,
    blob_href: `https://github.com/${REPO}/blob/6e6ce35/.github`,
  };

  it("maps path, lines, level, title and message", () => {
    expect(toAnnotation(raw), "Expected every field mapped (annotation_level -> level)").toEqual({
      path: ".github",
      startLine: 12,
      endLine: 14,
      level: "failure",
      title: "Test failed",
      message: "Process completed with exit code 1.",
    });
  });

  it("passes warning and notice levels through", () => {
    expect(toAnnotation({ ...raw, annotation_level: "warning" }).level, "Expected warning").toBe("warning");
    expect(toAnnotation({ ...raw, annotation_level: "notice" }).level, "Expected notice").toBe("notice");
  });

  it("leaves title undefined when GitHub sends null or omits it", () => {
    expect(toAnnotation({ ...raw, title: null }).title, "Expected no title for null").toBeUndefined();
    const { title: _omitted, ...without } = raw;
    expect(toAnnotation(without).title, "Expected no title when missing").toBeUndefined();
  });
});

describe("ACT-5: toPendingDeployment maps GET /runs/{id}/pending_deployments items", () => {
  // Given a pending deployment, `toPendingDeployment` returns environmentId, environmentName, canApprove and waitTimer.
  const raw = {
    environment: { id: 161088068, node_id: "MDExOkVudmlyb25tZW50MTYxMDg4MDY4", name: "production", url: "https://api.github.com/repos/o/r/environments/production", html_url: "https://github.com/o/r/deployments/activity_log?environments_filter=production" },
    wait_timer: 30,
    wait_timer_started_at: "2026-11-03T10:17:00Z",
    current_user_can_approve: true,
    reviewers: [{ type: "User", reviewer: { login: "JoePittsy", id: 16508508 } }],
  };

  it("maps environment id and name, the approval flag and the wait timer", () => {
    expect(toPendingDeployment(raw), "Expected environment.id/name, current_user_can_approve and wait_timer mapped").toEqual({
      environmentId: 161088068,
      environmentName: "production",
      canApprove: true,
      waitTimer: 30,
    });
  });

  it("maps a viewer who cannot approve", () => {
    expect(toPendingDeployment({ ...raw, current_user_can_approve: false }).canApprove, "Expected canApprove false").toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// nextPage
// ---------------------------------------------------------------------------------------------------------------------------------

describe("ACT-1: nextPage reads the page number of the rel=\"next\" URL in a Link header", () => {
  const url = (page: number, extra = "per_page=2") => `https://api.github.com/repositories/1443139745/actions/runs?${extra}&page=${page}`;

  it("returns the next page from a real-shaped header with next and last", () => {
    const link = `<${url(2)}>; rel="next", <${url(52)}>; rel="last"`;
    expect(nextPage(link), "Expected 2 (not the last page's 52)").toBe(2);
  });

  it("returns the next page when prev and first come before it", () => {
    const link = `<${url(2)}>; rel="prev", <${url(4)}>; rel="next", <${url(52)}>; rel="last", <${url(1)}>; rel="first"`;
    expect(nextPage(link), "Expected 4, the page of rel=next").toBe(4);
  });

  it("reads page, not per_page, when per_page comes first", () => {
    expect(nextPage(`<https://api.github.com/x/actions/runs?per_page=100&page=3>; rel="next"`), "Expected 3, not 100").toBe(3);
  });

  it("reads page when it comes before other parameters", () => {
    expect(nextPage(`<https://api.github.com/x/actions/runs?page=7&per_page=100&branch=main>; rel="next"`), "Expected 7").toBe(7);
  });

  it("is undefined for a null header", () => {
    expect(nextPage(null), "Expected undefined for a null Link").toBeUndefined();
  });

  it("is undefined for an empty header", () => {
    expect(nextPage(""), "Expected undefined for an empty Link").toBeUndefined();
  });

  it("is undefined on the last page, where there is only prev and first", () => {
    const link = `<${url(51)}>; rel="prev", <${url(1)}>; rel="first"`;
    expect(nextPage(link), "Expected undefined when there is no rel=next").toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// request builders
// ---------------------------------------------------------------------------------------------------------------------------------

describe("ACT-1: listWorkflowsRequest is GET /repos/{repo}/actions/workflows?per_page=100&page=N", () => {
  it("defaults to page 1", () => {
    expect(listWorkflowsRequest(REPO), "Expected a GET of the first page of 100").toEqual({ method: "GET", path: `${BASE}/actions/workflows?per_page=100&page=1` });
  });

  it("asks for the page given", () => {
    expect(listWorkflowsRequest(REPO, 3).path, "Expected page=3").toBe(`${BASE}/actions/workflows?per_page=100&page=3`);
  });
});

describe("ACT-2: listRunsRequest is GET /actions/runs or /actions/workflows/{id}/runs with per_page, page and the filters", () => {
  it("lists every run of the repository when no workflow is given, 25 a page from page 1", () => {
    const req = listRunsRequest(REPO, {});
    const { path, params } = split(req);
    expect(req.method, "Expected GET").toBe("GET");
    expect(path, "Expected the repository-wide runs path").toBe(`${BASE}/actions/runs`);
    expect(params, "Expected only per_page=25 and page=1").toEqual({ per_page: "25", page: "1" });
  });

  it("lists one workflow's runs when workflowId is given", () => {
    const { path } = split(listRunsRequest(REPO, { workflowId: 404735568 }));
    expect(path, "Expected /actions/workflows/{id}/runs").toBe(`${BASE}/actions/workflows/404735568/runs`);
  });

  it("asks for the page and page size given", () => {
    const { params } = split(listRunsRequest(REPO, { page: 4, perPage: 50 }));
    expect(params, "Expected page=4 and per_page=50").toEqual({ per_page: "50", page: "4" });
  });

  it("sends each filter as a query parameter", () => {
    const { params } = split(listRunsRequest(REPO, { branch: "main", status: "in_progress", actor: "JoePittsy", event: "push" }));
    expect(params, "Expected branch, status, actor and event alongside the paging").toEqual({ per_page: "25", page: "1", branch: "main", status: "in_progress", actor: "JoePittsy", event: "push" });
  });

  it("URL-encodes a branch with a slash and a space (feature/a b)", () => {
    const req = listRunsRequest(REPO, { branch: "feature/a b" });
    expect(split(req).params.branch, "Expected the branch to decode back to 'feature/a b'").toBe("feature/a b");
    expect(req.path, "Expected the slash encoded as %2F").toContain("feature%2Fa");
    expect(req.path, "Expected no raw space in the path").not.toContain(" ");
    expect(req.path, "Expected no raw slash in the branch value").not.toContain("branch=feature/");
  });

  it("URL-encodes an actor and an event with reserved characters", () => {
    const req = listRunsRequest(REPO, { actor: "a&b=c", event: "x#y" });
    expect(split(req).params, "Expected '&', '=' and '#' not to break the query").toMatchObject({ actor: "a&b=c", event: "x#y" });
  });

  it("leaves blank filters out (empty and whitespace-only)", () => {
    const { params } = split(listRunsRequest(REPO, { branch: "", status: "  ", actor: undefined, event: "" }));
    expect(params, "Expected only the paging parameters").toEqual({ per_page: "25", page: "1" });
  });

  it("applies the filters to a workflow's runs too", () => {
    const { path, params } = split(listRunsRequest(REPO, { workflowId: 12, branch: "main" }));
    expect(path, "Expected the workflow runs path").toBe(`${BASE}/actions/workflows/12/runs`);
    expect(params.branch, "Expected the branch filter").toBe("main");
  });
});

describe("ACT-3: getRunRequest is GET /actions/runs/{id}, or .../attempts/{attempt}", () => {
  it("gets the latest attempt when none is given", () => {
    expect(getRunRequest(REPO, 41617937185), "Expected the plain run path").toEqual({ method: "GET", path: `${BASE}/actions/runs/41617937185` });
  });

  it("gets a given attempt", () => {
    expect(getRunRequest(REPO, 41617937185, 2), "Expected the attempts path").toEqual({ method: "GET", path: `${BASE}/actions/runs/41617937185/attempts/2` });
  });
});

describe("ACT-3: listJobsRequest lists a run's jobs 100 a page", () => {
  it("lists the latest attempt's jobs with filter=latest when no attempt is given", () => {
    expect(listJobsRequest(REPO, 41617937185), "Expected /jobs?filter=latest&per_page=100&page=1").toEqual({
      method: "GET",
      path: `${BASE}/actions/runs/41617937185/jobs?filter=latest&per_page=100&page=1`,
    });
  });

  it("lists a given attempt's jobs under /attempts/{attempt}/jobs without the filter", () => {
    expect(listJobsRequest(REPO, 41617937185, 2), "Expected /attempts/2/jobs?per_page=100&page=1").toEqual({
      method: "GET",
      path: `${BASE}/actions/runs/41617937185/attempts/2/jobs?per_page=100&page=1`,
    });
  });

  it("asks for the page given, with or without an attempt", () => {
    expect(listJobsRequest(REPO, 9, undefined, 3).path, "Expected page=3 on the latest path").toBe(`${BASE}/actions/runs/9/jobs?filter=latest&per_page=100&page=3`);
    expect(listJobsRequest(REPO, 9, 1, 3).path, "Expected page=3 on the attempt path").toBe(`${BASE}/actions/runs/9/attempts/1/jobs?per_page=100&page=3`);
  });
});

describe("ACT-3: jobLogsPath is /repos/{repo}/actions/jobs/{id}/logs", () => {
  it("builds the log path for a job", () => {
    expect(jobLogsPath(REPO, 125855973951), "Expected the job logs path").toBe(`${BASE}/actions/jobs/125855973951/logs`);
  });
});

describe("ACT-6: artifact and annotation requests", () => {
  it("listArtifactsRequest is GET /actions/runs/{id}/artifacts?per_page=100", () => {
    expect(listArtifactsRequest(REPO, 41617937185), "Expected the artifacts list for the run").toEqual({ method: "GET", path: `${BASE}/actions/runs/41617937185/artifacts?per_page=100` });
  });

  it("artifactZipPath is /actions/artifacts/{id}/zip", () => {
    expect(artifactZipPath(REPO, 7124509911), "Expected the artifact zip path").toBe(`${BASE}/actions/artifacts/7124509911/zip`);
  });

  it("annotationsRequest is GET /check-runs/{jobId}/annotations?per_page=100 (a job's id is its check-run id)", () => {
    expect(annotationsRequest(REPO, 125855973951), "Expected the check-run annotations path").toEqual({ method: "GET", path: `${BASE}/check-runs/125855973951/annotations?per_page=100` });
  });
});

describe("ACT-5: rerunRequest, cancelRequest", () => {
  it("re-runs a whole run with POST .../rerun and no body", () => {
    const req = rerunRequest(REPO, { runId: 41617937185 });
    expect(req.method, "Expected POST").toBe("POST");
    expect(req.path, "Expected the run rerun path").toBe(`${BASE}/actions/runs/41617937185/rerun`);
    expect(req.body, "Expected no body").toBeUndefined();
  });

  it("re-runs a whole run when failedOnly is false", () => {
    expect(rerunRequest(REPO, { runId: 5, failedOnly: false }).path, "Expected /rerun for failedOnly: false").toBe(`${BASE}/actions/runs/5/rerun`);
  });

  it("re-runs only the failed jobs with POST .../rerun-failed-jobs and no body", () => {
    const req = rerunRequest(REPO, { runId: 41617937185, failedOnly: true });
    expect(req.method, "Expected POST").toBe("POST");
    expect(req.path, "Expected the rerun-failed-jobs path").toBe(`${BASE}/actions/runs/41617937185/rerun-failed-jobs`);
    expect(req.body, "Expected no body").toBeUndefined();
  });

  it("re-runs one job with POST /actions/jobs/{jobId}/rerun and no body", () => {
    const req = rerunRequest(REPO, { jobId: 125855973951 });
    expect(req.method, "Expected POST").toBe("POST");
    expect(req.path, "Expected the job rerun path").toBe(`${BASE}/actions/jobs/125855973951/rerun`);
    expect(req.body, "Expected no body").toBeUndefined();
  });

  it("cancels a run with POST .../cancel", () => {
    const req = cancelRequest(REPO, 41617937185);
    expect(req.method, "Expected POST").toBe("POST");
    expect(req.path, "Expected the cancel path").toBe(`${BASE}/actions/runs/41617937185/cancel`);
    expect(req.body, "Expected no body").toBeUndefined();
  });
});

describe("ACT-4: dispatchRequest is POST .../workflows/{id}/dispatches with { ref, inputs }", () => {
  it("sends the ref and the inputs", () => {
    const req = dispatchRequest(REPO, 404735568, "main", { dry_run: "false", environment: "staging" });
    expect(req.method, "Expected POST").toBe("POST");
    expect(req.path, "Expected the dispatches path").toBe(`${BASE}/actions/workflows/404735568/dispatches`);
    expect(req.body, "Expected { ref, inputs }").toEqual({ ref: "main", inputs: { dry_run: "false", environment: "staging" } });
  });

  it("omits inputs altogether when there are none", () => {
    const req = dispatchRequest(REPO, 404735568, "refs/heads/release/1.0", {});
    expect(req.body, "Expected only { ref }").toStrictEqual({ ref: "refs/heads/release/1.0" });
    expect(req.body, "Expected no 'inputs' key at all").not.toHaveProperty("inputs");
  });

  it("sends the ref verbatim, slashes included", () => {
    expect(dispatchRequest(REPO, 1, "feature/a b", {}).body?.ref, "Expected the branch name unmodified").toBe("feature/a b");
  });
});

describe("ACT-5: pending deployments", () => {
  it("pendingDeploymentsRequest is GET .../runs/{id}/pending_deployments", () => {
    expect(pendingDeploymentsRequest(REPO, 41617937185), "Expected a GET of the pending deployments").toEqual({ method: "GET", path: `${BASE}/actions/runs/41617937185/pending_deployments` });
  });

  it("reviewDeploymentsRequest approves with { environment_ids, state, comment }", () => {
    const req = reviewDeploymentsRequest(REPO, 41617937185, [161088068, 161088069], "approved", "Looks good");
    expect(req.method, "Expected POST").toBe("POST");
    expect(req.path, "Expected the pending_deployments path").toBe(`${BASE}/actions/runs/41617937185/pending_deployments`);
    expect(req.body, "Expected exactly environment_ids, state and comment").toEqual({ environment_ids: [161088068, 161088069], state: "approved", comment: "Looks good" });
  });

  it("reviewDeploymentsRequest rejects with state 'rejected'", () => {
    expect(reviewDeploymentsRequest(REPO, 7, [1], "rejected", "Not today").body, "Expected state rejected").toEqual({ environment_ids: [1], state: "rejected", comment: "Not today" });
  });

  it("reviewDeploymentsRequest sends the comment even when it is empty", () => {
    expect(reviewDeploymentsRequest(REPO, 7, [1], "approved", "").body, "Expected comment '' present").toEqual({ environment_ids: [1], state: "approved", comment: "" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// workflow YAML
// ---------------------------------------------------------------------------------------------------------------------------------

const CI_YAML = `# A realistic multi-job workflow
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci

  test:
    name: Test (Node \${{ matrix.node }})
    needs: validate
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [18, 20]
    steps:
      - run: npm test

  build:
    name: Build the app
    needs: [validate, test]
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
    steps:
      - run: npm run build

  publish:
    needs:
      - build
    runs-on: ubuntu-latest
    steps:
      - run: npm publish
`;

describe("ACT-3: parseWorkflowJobs reads jobs and their needs from a workflow file", () => {
  // Given workflow YAML, `parseWorkflowJobs` returns one WorkflowJobDef per key under `jobs:`, in file order.
  it("returns a def per job, in file order", () => {
    expect(parseWorkflowJobs(CI_YAML).map((j) => j.id), "Expected the YAML keys in file order").toEqual(["validate", "test", "build", "publish"]);
  });

  it("gives an empty needs for a job that needs nothing", () => {
    expect(parseWorkflowJobs(CI_YAML)[0].needs, "Expected [] for 'validate'").toEqual([]);
  });

  it("reads needs written as a single string", () => {
    expect(parseWorkflowJobs(CI_YAML)[1].needs, "Expected ['validate'] from `needs: validate`").toEqual(["validate"]);
  });

  it("reads needs written as a flow list", () => {
    expect(parseWorkflowJobs(CI_YAML)[2].needs, "Expected both needs from `needs: [validate, test]`").toEqual(["validate", "test"]);
  });

  it("reads needs written as a block list", () => {
    expect(parseWorkflowJobs(CI_YAML)[3].needs, "Expected ['build'] from a block list").toEqual(["build"]);
  });

  it("reads a job's name verbatim, expressions included, and leaves it undefined when unset", () => {
    const defs = parseWorkflowJobs(CI_YAML);
    expect(defs[0].name, "Expected no name for 'validate'").toBeUndefined();
    expect(defs[1].name, "Expected the ${{ }} expression kept verbatim").toBe("Test (Node ${{ matrix.node }})");
    expect(defs[2].name, "Expected a plain name").toBe("Build the app");
  });

  it("flags a job with strategy.matrix", () => {
    expect(parseWorkflowJobs(CI_YAML)[1].matrix, "Expected matrix true for 'test'").toBe(true);
  });

  it("does not flag a job without a matrix, nor one whose strategy has no matrix", () => {
    const defs = parseWorkflowJobs(CI_YAML);
    expect(defs[0].matrix, "Expected matrix false when there is no strategy").toBe(false);
    expect(defs[2].matrix, "Expected matrix false for a strategy of only fail-fast").toBe(false);
  });

  it("reads the real publish workflow of this repository", () => {
    const yaml = `name: publish\non:\n  push:\n    tags: ["v*.*.*"]\n  workflow_dispatch:\n    inputs:\n      dry_run:\n        type: boolean\n        default: true\npermissions: {}\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: extension\n    steps:\n      - run: npm test\n`;
    expect(parseWorkflowJobs(yaml), "Expected the single 'publish' job").toEqual([{ id: "publish", name: undefined, needs: [], matrix: false }]);
  });

  it("throws on invalid YAML", () => {
    expect(() => parseWorkflowJobs(CI_YAML), "Expected valid YAML to parse without throwing").not.toThrow();
    expect(() => parseWorkflowJobs("jobs:\n  build:\n    runs-on: [ubuntu\n    steps: ["), "Expected a parse error to be thrown so the caller shows the flat list").toThrow();
  });

  it("throws when jobs is missing", () => {
    expect(() => parseWorkflowJobs(CI_YAML), "Expected valid YAML to parse without throwing").not.toThrow();
    expect(() => parseWorkflowJobs("name: CI\non: push\n"), "Expected a throw when there is no `jobs:`").toThrow();
  });
});

describe("ACT-4: parseDispatchInputs reads workflow_dispatch inputs", () => {
  // Given workflow YAML, `parseDispatchInputs` returns the inputs in file order, [] when the trigger has none, null when there is no trigger.
  it("is null when the workflow has no workflow_dispatch trigger (string form)", () => {
    expect(parseDispatchInputs("on: push\njobs:\n  a:\n    runs-on: x\n"), "Expected null for `on: push`").toBeNull();
  });

  it("is null when the workflow has no workflow_dispatch trigger (list form)", () => {
    expect(parseDispatchInputs("on: [push, pull_request]\njobs: {}\n"), "Expected null for a list without workflow_dispatch").toBeNull();
  });

  it("is null when the workflow has no workflow_dispatch trigger (map form)", () => {
    expect(parseDispatchInputs("on:\n  push:\n    branches: [main]\n  pull_request:\njobs: {}\n"), "Expected null for a map without workflow_dispatch").toBeNull();
  });

  it("is null when the workflow has no `on` at all", () => {
    expect(parseDispatchInputs("name: x\njobs: {}\n"), "Expected null when nothing triggers the workflow").toBeNull();
  });

  it("is [] for `on: workflow_dispatch` (string form)", () => {
    expect(parseDispatchInputs("on: workflow_dispatch\njobs: {}\n"), "Expected [] for the string form").toEqual([]);
  });

  it("is [] for `on: [push, workflow_dispatch]` (list form)", () => {
    expect(parseDispatchInputs("on: [push, workflow_dispatch]\njobs: {}\n"), "Expected [] for the list form").toEqual([]);
  });

  it("is [] for a map with an empty workflow_dispatch (`workflow_dispatch:` with no value)", () => {
    expect(parseDispatchInputs("on:\n  push:\n  workflow_dispatch:\njobs: {}\n"), "Expected [] for a null value").toEqual([]);
  });

  it("is [] for a map whose workflow_dispatch has no inputs", () => {
    expect(parseDispatchInputs("on:\n  workflow_dispatch: {}\njobs: {}\n"), "Expected [] for {}").toEqual([]);
  });

  it("reads this repository's real publish workflow: a boolean dry_run defaulting to true", () => {
    // The shape of .github/workflows/publish.yml, where `on:` must not be read as the boolean key `true`.
    const yaml = `name: publish

on:
  push:
    tags: ["v*.*.*"]
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Build and package only, don't publish"
        type: boolean
        default: true

permissions: {}
jobs:
  publish:
    runs-on: ubuntu-latest
`;
    expect(parseDispatchInputs(yaml), "Expected the single dry_run input").toEqual([
      { key: "dry_run", description: "Build and package only, don't publish", required: false, type: "boolean", default: "true" },
    ]);
  });

  it("finds workflow_dispatch when `on` is a quoted key", () => {
    expect(parseDispatchInputs(`"on":\n  workflow_dispatch:\n    inputs:\n      who:\n        type: string\njobs: {}\n`)?.map((i) => i.key), "Expected the input under a quoted \"on\"").toEqual(["who"]);
  });

  const withInputs = (inputs: string) => `on:\n  workflow_dispatch:\n    inputs:\n${inputs}\njobs: {}\n`;

  it("reads a string input with a description, required and a default", () => {
    const yaml = withInputs(`      version:\n        description: Version to publish\n        required: true\n        type: string\n        default: "1.0.0"`);
    expect(parseDispatchInputs(yaml), "Expected every attribute of the string input").toEqual([
      { key: "version", description: "Version to publish", required: true, type: "string", default: "1.0.0" },
    ]);
  });

  it("reads a choice input with its options and default", () => {
    const yaml = withInputs(`      environment:\n        type: choice\n        options:\n          - staging\n          - production\n        default: staging`);
    expect(parseDispatchInputs(yaml), "Expected options as strings in order").toEqual([
      { key: "environment", required: false, type: "choice", default: "staging", options: ["staging", "production"] },
    ]);
  });

  it("reads a boolean input, with a true default as \"true\" and a false default as \"false\"", () => {
    const yaml = withInputs(`      verbose:\n        type: boolean\n        default: true\n      dry:\n        type: boolean\n        default: false`);
    const [verbose, dry] = parseDispatchInputs(yaml)!;
    expect(verbose.default, "Expected boolean default true to be the string \"true\"").toBe("true");
    expect(dry.default, "Expected boolean default false to be the string \"false\"").toBe("false");
  });

  it("reads an environment input", () => {
    const yaml = withInputs(`      target:\n        type: environment\n        required: true`);
    expect(parseDispatchInputs(yaml), "Expected type environment").toEqual([{ key: "target", required: true, type: "environment" }]);
  });

  it("reads a number input, with a numeric default as text", () => {
    const yaml = withInputs(`      retries:\n        type: number\n        default: 3`);
    expect(parseDispatchInputs(yaml), "Expected type number and default \"3\"").toEqual([{ key: "retries", required: false, type: "number", default: "3" }]);
  });

  it("treats a missing type as \"string\"", () => {
    const yaml = withInputs(`      note:\n        description: Free text`);
    expect(parseDispatchInputs(yaml)?.[0].type, "Expected string when type is not given").toBe("string");
  });

  it("treats a missing required as false and a missing default as undefined", () => {
    const [input] = parseDispatchInputs(withInputs(`      note:\n        type: string`))!;
    expect(input.required, "Expected required false").toBe(false);
    expect(input.default, "Expected no default").toBeUndefined();
  });

  it("reads an input written with no attributes at all (`flag:` with null) as an optional string", () => {
    expect(parseDispatchInputs(withInputs(`      flag:`)), "Expected a bare key to be an optional string input").toEqual([{ key: "flag", required: false, type: "string" }]);
  });

  it("gives options only to choice inputs", () => {
    const inputs = parseDispatchInputs(withInputs(`      a:\n        type: string\n      b:\n        type: choice\n        options: [x, y]`))!;
    expect(inputs[0].options, "Expected no options on a string input").toBeUndefined();
    expect(inputs[1].options, "Expected options on a choice input").toEqual(["x", "y"]);
  });

  it("keeps the file order of the inputs, not alphabetical order", () => {
    const yaml = withInputs(`      zeta:\n        type: string\n      alpha:\n        type: string\n      mid:\n        type: string`);
    expect(parseDispatchInputs(yaml)?.map((i) => i.key), "Expected zeta, alpha, mid").toEqual(["zeta", "alpha", "mid"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// dispatch form: validateInputs and inputsBody
// ---------------------------------------------------------------------------------------------------------------------------------

const input = (key: string, over: Partial<DispatchInput> = {}): DispatchInput => ({ key, required: false, type: "string", ...over });

describe("ACT-4: validateInputs returns an error per invalid input key", () => {
  // Given the inputs and the form values, `validateInputs` returns { key: message } for each problem and {} when all is well.
  it("is {} when every value is valid", () => {
    const inputs = [input("version", { required: true }), input("env", { type: "choice", options: ["staging", "production"] }), input("retries", { type: "number" })];
    expect(validateInputs(inputs, { version: "1.2.3", env: "staging", retries: "3" }), "Expected no errors").toEqual({});
  });

  it("says \"Required\" for a required input with a blank value", () => {
    expect(validateInputs([input("version", { required: true })], { version: "" }), "Expected Required for ''").toEqual({ version: "Required" });
  });

  it("says \"Required\" for a required input with no value at all", () => {
    expect(validateInputs([input("version", { required: true })], {}), "Expected Required when the key is absent").toEqual({ version: "Required" });
  });

  it("accepts a required boolean set to \"false\" (false is a value, not blank)", () => {
    expect(validateInputs([input("dry", { required: true, type: "boolean" })], { dry: "false" }), "Expected no error for \"false\"").toEqual({});
  });

  it("says \"Pick one of the options\" when a choice is not among its options", () => {
    const inputs = [input("env", { type: "choice", options: ["staging", "production"] })];
    expect(validateInputs(inputs, { env: "prod" }), "Expected 'prod' to be rejected").toEqual({ env: "Pick one of the options" });
  });

  it("accepts each option of a choice", () => {
    const inputs = [input("env", { type: "choice", options: ["staging", "production"] })];
    expect(validateInputs(inputs, { env: "production" }), "Expected an option to be accepted").toEqual({});
  });

  it("says \"Required\" rather than \"Pick one\" for a required choice left blank", () => {
    expect(validateInputs([input("env", { required: true, type: "choice", options: ["a", "b"] })], { env: "" }), "Expected Required for a blank required choice").toEqual({ env: "Required" });
  });

  it("says \"Enter a number\" when a number input is not numeric", () => {
    expect(validateInputs([input("retries", { type: "number" })], { retries: "three" }), "Expected 'three' to be rejected").toEqual({ retries: "Enter a number" });
    expect(validateInputs([input("retries", { type: "number" })], { retries: "12abc" }), "Expected '12abc' to be rejected").toEqual({ retries: "Enter a number" });
  });

  it("accepts integers, negatives and decimals as numbers", () => {
    for (const v of ["0", "3", "-2", "1.5"]) {
      expect(validateInputs([input("n", { type: "number" })], { n: v }), `Expected '${v}' to be a number`).toEqual({});
    }
  });

  it("says \"Required\" rather than \"Enter a number\" for a required number left blank", () => {
    expect(validateInputs([input("n", { required: true, type: "number" })], { n: "" }), "Expected Required for a blank required number").toEqual({ n: "Required" });
  });

  it("reports every invalid input, each under its own key", () => {
    const inputs = [input("a", { required: true }), input("b", { type: "number" }), input("c", { type: "choice", options: ["x"] }), input("d")];
    expect(validateInputs(inputs, { a: "", b: "nope", c: "y", d: "fine" }), "Expected a, b and c to be reported and d not").toEqual({ a: "Required", b: "Enter a number", c: "Pick one of the options" });
  });

  it("does not report an optional input left blank", () => {
    const inputs = [input("note"), input("n", { type: "number" }), input("env", { type: "choice", options: ["a", "b"] })];
    expect(validateInputs(inputs, { note: "", n: "", env: "" }), "Expected optional blanks to be fine").toEqual({});
  });
});

describe("ACT-4: inputsBody builds the `inputs` for dispatchRequest", () => {
  // Given the inputs and the form values, `inputsBody` returns every input that has a value, defaults applied for untouched ones.
  it("includes each input's value", () => {
    const inputs = [input("version"), input("env", { type: "choice", options: ["staging", "production"] })];
    expect(inputsBody(inputs, { version: "1.2.3", env: "production" }), "Expected both values").toEqual({ version: "1.2.3", env: "production" });
  });

  it("applies the default for an input the user did not touch", () => {
    const inputs = [input("env", { type: "choice", options: ["staging", "production"], default: "staging" })];
    expect(inputsBody(inputs, {}), "Expected the default to be sent").toEqual({ env: "staging" });
  });

  it("lets a value override the default", () => {
    expect(inputsBody([input("env", { default: "staging" })], { env: "production" }), "Expected the value, not the default").toEqual({ env: "production" });
  });

  it("leaves out an input with neither a value nor a default", () => {
    expect(inputsBody([input("note"), input("version")], { version: "2.0.0" }), "Expected only version").toEqual({ version: "2.0.0" });
    expect(inputsBody([input("note")], { note: "" }), "Expected a blank value with no default to be left out").toEqual({});
  });

  it("sends booleans as \"true\" and \"false\"", () => {
    const inputs = [input("a", { type: "boolean" }), input("b", { type: "boolean" })];
    expect(inputsBody(inputs, { a: "true", b: "false" }), "Expected the strings true and false").toEqual({ a: "true", b: "false" });
  });

  it("sends a boolean the user turned off even when its default is true", () => {
    expect(inputsBody([input("dry_run", { type: "boolean", default: "true" })], { dry_run: "false" }), "Expected \"false\" to beat the default \"true\"").toEqual({ dry_run: "false" });
  });

  it("applies a boolean's default when untouched", () => {
    expect(inputsBody([input("dry_run", { type: "boolean", default: "true" })], {}), "Expected the default \"true\"").toEqual({ dry_run: "true" });
  });

  it("ignores values for keys that are not inputs of the workflow", () => {
    expect(inputsBody([input("version")], { version: "1", stray: "x" }), "Expected stray to be left out").toEqual({ version: "1" });
  });

  it("is {} when there are no inputs", () => {
    expect(inputsBody([], {}), "Expected an empty body").toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// worstState
// ---------------------------------------------------------------------------------------------------------------------------------

describe("ACT-3: worstState picks the worst of several states", () => {
  // Order: failed > cancelled > inProgress > waiting > queued > succeeded > neutral > skipped.
  const order: RunState[] = ["failed", "cancelled", "inProgress", "waiting", "queued", "succeeded", "neutral", "skipped"];

  it("is neutral for no states", () => {
    expect(worstState([]), "Expected neutral for []").toBe("neutral");
  });

  it("returns the only state of a one-item list", () => {
    for (const s of order) expect(worstState([s]), `Expected ${s} alone to be ${s}`).toBe(s);
  });

  it("returns that state when all are the same", () => {
    expect(worstState(["succeeded", "succeeded", "succeeded"]), "Expected succeeded").toBe("succeeded");
  });

  it("ranks every pair by the documented order, whichever way round they are given", () => {
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        expect(worstState([order[i], order[j]]), `Expected ${order[i]} to be worse than ${order[j]}`).toBe(order[i]);
        expect(worstState([order[j], order[i]]), `Expected ${order[i]} to be worse than ${order[j]} (reversed)`).toBe(order[i]);
      }
    }
  });

  it("returns failed from a mixed list", () => {
    expect(worstState(["succeeded", "skipped", "failed", "inProgress"]), "Expected failed").toBe("failed");
  });

  it("returns skipped only when everything is skipped (a skipped job does not hide a succeeded one)", () => {
    expect(worstState(["skipped", "succeeded"]), "Expected succeeded over skipped").toBe("succeeded");
    expect(worstState(["skipped", "skipped"]), "Expected skipped when all are skipped").toBe("skipped");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// jobGraph
// ---------------------------------------------------------------------------------------------------------------------------------

let nextId = 1000;
const job = (name: string, state: RunState = "succeeded", over: Partial<Job> = {}): Job => ({
  id: nextId++,
  runId: 41617937185,
  attempt: 1,
  name,
  status: "completed",
  conclusion: state === "succeeded" ? "success" : null,
  state,
  steps: [],
  htmlUrl: `https://github.com/${REPO}/actions/runs/41617937185/job/${nextId}`,
  labels: ["ubuntu-latest"],
  ...over,
});
const def = (id: string, needs: string[] = [], over: Partial<WorkflowJobDef> = {}): WorkflowJobDef => ({ id, needs, matrix: false, ...over });
/** The group keys of each column, for compact assertions. */
const keys = (cols: ReturnType<typeof jobGraph>) => cols.map((col) => col.map((g) => g.key));

describe("ACT-3: jobGraph arranges the run's jobs into columns by their needs", () => {
  // Given the API's jobs and the workflow's job definitions, `jobGraph` returns columns of groups, left to right.
  it("puts a linear chain (validate -> version -> publish) in three columns", () => {
    const jobs = [job("validate"), job("version"), job("publish")];
    const defs = [def("validate"), def("version", ["validate"]), def("publish", ["version"])];
    expect(keys(jobGraph(jobs, defs)), "Expected one group per column, left to right").toEqual([["validate"], ["version"], ["publish"]]);
  });

  it("records each group's needs as the keys of the groups it needs", () => {
    const jobs = [job("validate"), job("version"), job("publish")];
    const defs = [def("validate"), def("version", ["validate"]), def("publish", ["version"])];
    const cols = jobGraph(jobs, defs);
    expect(cols[0][0].needs, "Expected no needs for the first group").toEqual([]);
    expect(cols[1][0].needs, "Expected 'version' to need 'validate'").toEqual(["validate"]);
    expect(cols[2][0].needs, "Expected 'publish' to need 'version'").toEqual(["version"]);
  });

  it("gives a plain job a group of one job, titled with its name and in its own state", () => {
    const j = job("validate", "failed");
    const [[group]] = jobGraph([j], [def("validate")]);
    expect(group.key, "Expected the YAML job id as the key").toBe("validate");
    expect(group.title, "Expected the job name as the title").toBe("validate");
    expect(group.jobs, "Expected the one job").toEqual([j]);
    expect(group.state, "Expected the job's own state").toBe("failed");
  });

  it("handles a fan-out and fan-in diamond: build -> (lint, test) -> deploy", () => {
    const jobs = [job("build"), job("lint"), job("test"), job("deploy")];
    const defs = [def("build"), def("lint", ["build"]), def("test", ["build"]), def("deploy", ["lint", "test"])];
    const cols = jobGraph(jobs, defs);
    expect(keys(cols), "Expected build, then lint and test side by side, then deploy").toEqual([["build"], ["lint", "test"], ["deploy"]]);
    expect([...cols[2][0].needs].sort(), "Expected deploy to need lint and test").toEqual(["lint", "test"]);
  });

  it("puts a group one column right of the furthest group it needs", () => {
    // deploy needs build (column 0) and test (column 1), so it sits in column 2, not column 1.
    const jobs = [job("build"), job("test"), job("deploy")];
    const defs = [def("build"), def("test", ["build"]), def("deploy", ["build", "test"])];
    expect(keys(jobGraph(jobs, defs)), "Expected deploy in column 2").toEqual([["build"], ["test"], ["deploy"]]);
  });

  it("groups matrix jobs under one card titled without the suffix, in API order, with the worst state", () => {
    const jobs = [job("build"), job("test (18)", "succeeded"), job("test (20)", "failed"), job("deploy", "skipped")];
    const defs = [def("build"), def("test", ["build"], { matrix: true }), def("deploy", ["test"])];
    const cols = jobGraph(jobs, defs);
    expect(keys(cols), "Expected the two matrix jobs in one 'test' group in column 1").toEqual([["build"], ["test"], ["deploy"]]);
    const test = cols[1][0];
    expect(test.title, "Expected the card title without its matrix suffix").toBe("test");
    expect(test.jobs.map((j) => j.name), "Expected both matrix jobs, in API order").toEqual(["test (18)", "test (20)"]);
    expect(test.state, "Expected the worst state (failed) of the matrix jobs").toBe("failed");
    expect(cols[2][0].needs, "Expected deploy to need the 'test' group").toEqual(["test"]);
  });

  it("strips a multi-value matrix suffix (\"test (18, ubuntu)\" -> \"test\")", () => {
    const jobs = [job("test (18, ubuntu)"), job("test (20, windows)")];
    const [[group]] = jobGraph(jobs, [def("test", [], { matrix: true })]);
    expect(group.title, "Expected the whole ' (18, ubuntu)' suffix removed").toBe("test");
    expect(group.jobs, "Expected both jobs grouped").toHaveLength(2);
  });

  it("takes the worst state across a matrix group (inProgress beats succeeded)", () => {
    const jobs = [job("test (1)", "succeeded"), job("test (2)", "inProgress")];
    const [[group]] = jobGraph(jobs, [def("test", [], { matrix: true })]);
    expect(group.state, "Expected inProgress").toBe("inProgress");
  });

  it("puts a job that is not in the workflow YAML in column 0 with no needs, keyed by its display name", () => {
    const jobs = [job("validate"), job("Deploy / ship"), job("publish")];
    const defs = [def("validate"), def("publish", ["validate"])];
    const cols = jobGraph(jobs, defs);
    expect(keys(cols), "Expected the unmatched job beside validate in column 0").toEqual([["validate", "Deploy / ship"], ["publish"]]);
    expect(cols[0][1].needs, "Expected no needs for the unmatched job").toEqual([]);
    expect(cols[0][1].title, "Expected its display name as the title").toBe("Deploy / ship");
  });

  it("puts every job in column 0 when the YAML is unavailable (defs null)", () => {
    const jobs = [job("validate"), job("version"), job("publish")];
    const cols = jobGraph(jobs, null);
    expect(cols, "Expected exactly one column").toHaveLength(1);
    expect(cols[0].map((g) => g.title), "Expected every job, in API order").toEqual(["validate", "version", "publish"]);
    expect(cols[0].every((g) => g.needs.length === 0), "Expected no needs without defs").toBe(true);
  });

  it("is [] when there are no jobs", () => {
    expect(jobGraph([], [def("validate")]), "Expected no columns for no jobs with defs").toEqual([]);
    expect(jobGraph([], null), "Expected no columns for no jobs without defs").toEqual([]);
  });

  it("orders groups within a column by the order the API returned their first job", () => {
    const jobs = [job("b"), job("a")];
    const defs = [def("a"), def("b")];
    expect(keys(jobGraph(jobs, defs)), "Expected b before a, as the API returned them (not the YAML order)").toEqual([["b", "a"]]);
  });

  it("orders a matrix group by its first job in the API list", () => {
    const jobs = [job("lint"), job("test (1)"), job("docs"), job("test (2)")];
    const defs = [def("lint"), def("test", [], { matrix: true }), def("docs")];
    expect(keys(jobGraph(jobs, defs)), "Expected lint, test (first seen second), docs").toEqual([["lint", "test", "docs"]]);
  });

  it("matches a YAML job that has a `name:` by that name, keying the group by the YAML id", () => {
    const jobs = [job("Build the app"), job("deploy")];
    const defs = [def("build-app", [], { name: "Build the app" }), def("deploy", ["build-app"])];
    const cols = jobGraph(jobs, defs);
    expect(keys(cols), "Expected the named job keyed 'build-app' with deploy one column right").toEqual([["build-app"], ["deploy"]]);
    expect(cols[0][0].title, "Expected the card titled with the job's name").toBe("Build the app");
    expect(cols[1][0].needs, "Expected deploy to need the group keyed 'build-app'").toEqual(["build-app"]);
  });

  it("matches a named matrix YAML job by name ignoring the suffix", () => {
    const jobs = [job("Run tests (a)"), job("Run tests (b)")];
    const defs = [def("tests", [], { name: "Run tests", matrix: true })];
    const [[group]] = jobGraph(jobs, defs);
    expect(group.key, "Expected the YAML id as the key").toBe("tests");
    expect(group.jobs, "Expected both matrix jobs").toHaveLength(2);
  });
});

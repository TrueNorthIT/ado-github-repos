import { describe, expect, it } from "vitest";
import {
  deploymentState,
  deploymentStateText,
  latestStatusRequest,
  listDeploymentsRequest,
  listEnvironmentsRequest,
  runIdOfStatus,
  toDeployment,
  toDeploymentStatus,
  toEnvironment,
} from "./environments";
import { deleteRunRequest, parseScheduleCrons, setWorkflowEnabledRequest } from "./workflows";

describe("toEnvironment", () => {
  it("summarises the protection rules", () => {
    const e = toEnvironment({
      id: 7,
      name: "production",
      html_url: "https://github.com/o/r/deployments/activity_log?environments_filter=production",
      protection_rules: [{ type: "required_reviewers", reviewers: [] }, { type: "wait_timer", wait_timer: 90 }, { type: "branch_policy" }],
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    });
    expect(e).toEqual({ id: 7, name: "production", htmlUrl: expect.stringContaining("production"), protections: ["Required reviewers", "Wait timer 90m", "Protected branches"] });
  });

  it("writes whole hours and days for the wait timer, and drops a zero timer", () => {
    expect(toEnvironment({ protection_rules: [{ type: "wait_timer", wait_timer: 120 }] }).protections).toEqual(["Wait timer 2h"]);
    expect(toEnvironment({ protection_rules: [{ type: "wait_timer", wait_timer: 2880 }] }).protections).toEqual(["Wait timer 2d"]);
    expect(toEnvironment({ protection_rules: [{ type: "wait_timer", wait_timer: 0 }] }).protections).toEqual([]);
  });

  it("names custom branch policies, and copes with missing fields", () => {
    expect(toEnvironment({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }).protections).toEqual(["Selected branches"]);
    expect(toEnvironment({ id: 1, name: "x", deployment_branch_policy: null })).toEqual({ id: 1, name: "x", htmlUrl: "", protections: [] });
    expect(toEnvironment(null).protections).toEqual([]);
  });
});

describe("toDeployment and toDeploymentStatus", () => {
  it("maps a deployment with its latest status", () => {
    const st = toDeploymentStatus({ state: "SUCCESS", description: "Deployed", log_url: "https://github.com/o/r/actions/runs/5/job/6", target_url: "", environment_url: "https://app.example", created_at: "2026-11-01T10:00:00Z" });
    expect(st).toEqual({ state: "success", description: "Deployed", logUrl: "https://github.com/o/r/actions/runs/5/job/6", targetUrl: null, environmentUrl: "https://app.example", createdAt: new Date("2026-11-01T10:00:00Z") });
    const d = toDeployment({ id: 3, sha: "abc", ref: "main", task: "deploy", environment: "production", description: null, creator: { login: "ann", avatar_url: "a.png" }, created_at: "2026-11-01T09:59:00Z" }, st);
    expect(d).toEqual({ id: 3, sha: "abc", ref: "main", task: "deploy", environment: "production", description: "", creator: { name: "ann", login: "ann", avatarUrl: "a.png" }, createdAt: new Date("2026-11-01T09:59:00Z"), status: st });
  });

  it("defaults the task and leaves out an absent creator", () => {
    const d = toDeployment({ id: 1, created_at: "2026-11-01T00:00:00Z" });
    expect(d.task).toBe("deploy");
    expect(d.creator).toBeUndefined();
    expect(d.status).toBeUndefined();
  });
});

describe("deploymentState", () => {
  it.each([
    ["success", "succeeded"],
    ["SUCCESS", "succeeded"],
    ["failure", "failed"],
    ["error", "failed"],
    ["in_progress", "inProgress"],
    ["queued", "queued"],
    ["pending", "queued"],
    ["waiting", "waiting"],
    ["inactive", "neutral"],
    ["something_new", "neutral"],
    ["", "neutral"],
    [undefined, "neutral"],
  ] as const)("%s -> %s", (raw, want) => {
    expect(deploymentState(raw)).toBe(want);
  });

  it("has readable text", () => {
    expect(deploymentStateText("in_progress")).toBe("In progress");
    expect(deploymentStateText("success")).toBe("Success");
    expect(deploymentStateText("inactive")).toBe("Inactive");
    expect(deploymentStateText(undefined)).toBe("No status");
  });
});

describe("runIdOfStatus", () => {
  const repo = "TrueNorthIT/gh-repos-sandbox";
  it("reads the run id from the log URL, with or without a job", () => {
    expect(runIdOfStatus({ logUrl: "https://github.com/TrueNorthIT/gh-repos-sandbox/actions/runs/123/job/456", targetUrl: null }, repo)).toBe(123);
    expect(runIdOfStatus({ logUrl: "https://github.com/truenorthit/GH-REPOS-SANDBOX/actions/runs/9", targetUrl: null }, repo)).toBe(9);
  });

  it("falls back to the target URL", () => {
    expect(runIdOfStatus({ logUrl: "https://ci.example/build/1", targetUrl: "https://github.com/TrueNorthIT/gh-repos-sandbox/actions/runs/77?check_suite_focus=true" }, repo)).toBe(77);
  });

  it("ignores other repositories, other hosts and non-run URLs", () => {
    expect(runIdOfStatus({ logUrl: "https://github.com/other/repo/actions/runs/1", targetUrl: null }, repo)).toBeUndefined();
    expect(runIdOfStatus({ logUrl: "https://evil.example/TrueNorthIT/gh-repos-sandbox/actions/runs/1", targetUrl: null }, repo)).toBeUndefined();
    expect(runIdOfStatus({ logUrl: "https://github.com/TrueNorthIT/gh-repos-sandbox/actions/runs/abc", targetUrl: null }, repo)).toBeUndefined();
    expect(runIdOfStatus({ logUrl: "https://github.com/TrueNorthIT/gh-repos-sandbox/actions/runs/12abc", targetUrl: null }, repo)).toBeUndefined();
    expect(runIdOfStatus({ logUrl: "not a url", targetUrl: null }, repo)).toBeUndefined();
    expect(runIdOfStatus(undefined, repo)).toBeUndefined();
  });
});

describe("environment requests", () => {
  it("builds the REST paths", () => {
    expect(listEnvironmentsRequest("o/r")).toEqual({ method: "GET", path: "/repos/o/r/environments?per_page=100" });
    expect(listDeploymentsRequest("o/r", "staging & qa")).toEqual({ method: "GET", path: "/repos/o/r/deployments?environment=staging%20%26%20qa&per_page=30&page=1" });
    expect(listDeploymentsRequest("o/r", "prod", { page: 3, perPage: 10 }).path).toBe("/repos/o/r/deployments?environment=prod&per_page=10&page=3");
    expect(latestStatusRequest("o/r", 42)).toEqual({ method: "GET", path: "/repos/o/r/deployments/42/statuses?per_page=1" });
  });
});

describe("workflow housekeeping requests", () => {
  it("enables and disables a workflow with PUT", () => {
    expect(setWorkflowEnabledRequest("o/r", 5, true)).toEqual({ method: "PUT", path: "/repos/o/r/actions/workflows/5/enable" });
    expect(setWorkflowEnabledRequest("o/r", 5, false)).toEqual({ method: "PUT", path: "/repos/o/r/actions/workflows/5/disable" });
  });

  it("deletes a run, or only its logs", () => {
    expect(deleteRunRequest("o/r", 9)).toEqual({ method: "DELETE", path: "/repos/o/r/actions/runs/9" });
    expect(deleteRunRequest("o/r", 9, true)).toEqual({ method: "DELETE", path: "/repos/o/r/actions/runs/9/logs" });
  });
});

describe("parseScheduleCrons", () => {
  it("reads every cron in file order", () => {
    expect(parseScheduleCrons(`on:\n  push:\n  schedule:\n    - cron: "0 3 * * MON-FRI"\n    - cron: ' */30 9-17 * * 6 '\njobs: {}\n`)).toEqual(["0 3 * * MON-FRI", "*/30 9-17 * * 6"]);
  });

  it("is empty without a schedule, or when `on` is a string or a list", () => {
    expect(parseScheduleCrons("on: push\n")).toEqual([]);
    expect(parseScheduleCrons("on: [push, schedule]\n")).toEqual([]);
    expect(parseScheduleCrons("on:\n  workflow_dispatch:\n")).toEqual([]);
    expect(parseScheduleCrons("name: x\n")).toEqual([]);
  });

  it("drops entries without a cron string", () => {
    expect(parseScheduleCrons("on:\n  schedule:\n    - cron: ''\n    - foo: bar\n    - cron: 5\n    - cron: '0 0 * * *'\n")).toEqual(["0 0 * * *"]);
  });

  it("throws on invalid YAML", () => {
    expect(() => parseScheduleCrons("on: [unclosed\n")).toThrow();
  });
});

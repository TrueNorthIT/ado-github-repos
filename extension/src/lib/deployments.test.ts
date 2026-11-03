import { describe, it, expect } from "vitest";
import { deploymentsQuery, deploymentTone, latestDeployments, type DeploymentNode } from "./deployments";
import { expectNotInQuery, expectPrQuery, norm, NASTY } from "./ciTestHelpers";

// Module under test: src/lib/deployments.ts (deploymentsQuery, deploymentTone, latestDeployments).
// Requirement CI-5: "Deployments and previews": the latest deployment per environment for the PR; each gives { environment, state (SUCCESS / FAILURE /
// IN_PROGRESS / QUEUED / INACTIVE / ERROR / PENDING -> ADO-like success/failure/pending/neutral), url (environmentUrl or logUrl), updatedAt, creator },
// newest per environment only; inactive deployments are hidden unless nothing else exists.
//
// Source decision (live): PullRequest.timelineItems(itemTypes: [DEPLOYED_EVENT]) beats Repository.deployments(first: 20): the latter is repo-wide (on a busy
// repository the PR's deployment is outside the newest 20) and Deployment.ref is null for Vercel deployments, so a ref filter finds nothing.
// Decisions fixed by these tests:
//  - tone: SUCCESS and ACTIVE -> success; FAILURE, ERROR -> failure; PENDING, QUEUED, IN_PROGRESS, WAITING -> pending; INACTIVE, ABANDONED, DESTROYED, unknown, null -> neutral.
//  - a row's tone comes from latestStatus.state, else the deployment's own state. url is environmentUrl, else logUrl; the key is absent when both are null or blank.
//  - newest = greatest createdAt, a tie going to the later node; rows come back newest first.
//  - inactive deployments (INACTIVE, ABANDONED, DESTROYED) are dropped BEFORE picking the newest per environment; if every deployment is inactive the newest
//    inactive one per environment is returned instead.
//  - a null environment is shown as "Unknown environment".

const dep = (environment: string | null, over: Partial<DeploymentNode> = {}): DeploymentNode => ({
  environment,
  state: "ACTIVE",
  commitOid: "c0ffee",
  createdAt: "2026-11-02T10:00:00Z",
  updatedAt: "2026-11-02T10:05:00Z",
  creator: { login: "octocat" },
  latestStatus: { state: "SUCCESS", environmentUrl: "https://preview.example.test/1", logUrl: "https://logs.example.test/1", updatedAt: "2026-11-02T10:06:00Z", creator: { login: "deploy-bot" } },
  ...over,
});
const status = (state: string, over: Partial<NonNullable<DeploymentNode["latestStatus"]>> = {}): DeploymentNode["latestStatus"] => ({
  state,
  environmentUrl: null,
  logUrl: null,
  updatedAt: "2026-11-02T10:06:00Z",
  ...over,
});

describe("CI-5: deploymentsQuery reads the deployments from the pull request's timeline", () => {
  it("takes { owner, name, number } as variables on repository.pullRequest", () => {
    const req = deploymentsQuery({ owner: "octo", name: "repo", number: 4 });
    expectPrQuery(req);
    expect(req.variables, "Expected variables { owner, name, number } and nothing else").toEqual({ owner: "octo", name: "repo", number: 4 });
  });

  it("asks the timeline for DEPLOYED_EVENT items with the last 50, not Repository.deployments", () => {
    const q = norm(deploymentsQuery({ owner: "o", name: "r", number: 1 }).query);
    expect(q, "Expected timelineItems(last: 50, itemTypes: [DEPLOYED_EVENT])").toMatch(/timelineItems\(\s*last:\s*50,\s*itemTypes:\s*\[\s*DEPLOYED_EVENT\s*\]\s*\)/);
    expect(q, "Expected ... on DeployedEvent { deployment { ... } }").toMatch(/\.\.\.\s*on DeployedEvent\s*\{[^]*\bdeployment\s*\{/);
    expect(q, "Expected the repo-wide Repository.deployments connection not to be used").not.toMatch(/\bdeployments\s*\(/);
  });

  it("selects the deployment fields and the latest status the rows need", () => {
    const q = norm(deploymentsQuery({ owner: "o", name: "r", number: 1 }).query);
    for (const f of ["environment", "state", "commitOid", "createdAt", "updatedAt", "creator", "latestStatus", "environmentUrl", "logUrl"]) {
      expect(q, `Expected the selection to include ${f}`).toMatch(new RegExp(`\\b${f}\\b`));
    }
    expect(q, "Expected latestStatus { state ... }").toMatch(/latestStatus\s*\{[^}]*\bstate\b/);
  });

  it.each(NASTY)("keeps %j out of the query text", (v) => {
    const req = deploymentsQuery({ owner: v, name: v, number: 1 });
    expectNotInQuery(req, [v]);
    expect(req.variables, "Expected the awkward owner and name to travel in variables").toMatchObject({ owner: v, name: v });
  });
});

describe("CI-5: deploymentTone maps GitHub's states to ADO-like tones", () => {
  it.each([
    ["SUCCESS", "success"],
    ["ACTIVE", "success"],
    ["FAILURE", "failure"],
    ["ERROR", "failure"],
    ["PENDING", "pending"],
    ["QUEUED", "pending"],
    ["IN_PROGRESS", "pending"],
    ["WAITING", "pending"],
    ["INACTIVE", "neutral"],
    ["ABANDONED", "neutral"],
    ["DESTROYED", "neutral"],
    ["SOMETHING_NEW", "neutral"],
  ])("maps %s to %s", (raw, tone) => {
    expect(deploymentTone(raw), `Expected ${raw} to read as ${tone}`).toBe(tone);
  });

  it.each([null, undefined])("maps %s to neutral", (raw) => {
    expect(deploymentTone(raw), "Expected a missing state to read as neutral").toBe("neutral");
  });
});

describe("CI-5: latestDeployments gives the newest deployment per environment", () => {
  // Given two Preview deployments, only the newer one is returned; Production is returned separately.
  it("returns one row per environment, the newest by createdAt", () => {
    const rows = latestDeployments([
      dep("Preview", { createdAt: "2026-11-02T09:00:00Z", commitOid: "old" }),
      dep("Production", { createdAt: "2026-11-02T08:00:00Z", commitOid: "prod" }),
      dep("Preview", { createdAt: "2026-11-02T11:00:00Z", commitOid: "new" }),
    ]);
    expect(rows.map((r) => [r.environment, r.commitOid]), "Expected Preview's newest (new) and Production, newest first").toEqual([
      ["Preview", "new"],
      ["Production", "prod"],
    ]);
  });

  it("is not fooled by input order: an older deployment listed last does not win", () => {
    const rows = latestDeployments([dep("Preview", { createdAt: "2026-11-02T11:00:00Z", commitOid: "new" }), dep("Preview", { createdAt: "2026-11-02T09:00:00Z", commitOid: "old" })]);
    expect(rows.map((r) => r.commitOid), "Expected the greatest createdAt to win regardless of position").toEqual(["new"]);
  });

  it("lets the later node win a createdAt tie", () => {
    const rows = latestDeployments([dep("Preview", { commitOid: "first" }), dep("Preview", { commitOid: "second" })]);
    expect(rows.map((r) => r.commitOid), "Expected the later node to win a tie").toEqual(["second"]);
  });

  it("returns nothing for no deployments", () => {
    expect(latestDeployments([]), "Expected an empty list").toEqual([]);
  });

  it("shows a deployment without an environment as 'Unknown environment'", () => {
    expect(latestDeployments([dep(null)])[0].environment, "Expected a null environment to get a readable name").toBe("Unknown environment");
  });
});

describe("CI-5: each row carries tone, url, updatedAt and creator", () => {
  it("gives { environment, tone, url, updatedAt, creator, commitOid } from the deployment and its latest status", () => {
    expect(latestDeployments([dep("Preview")]), "Expected a success row with the preview URL, the status time and the deployment creator").toEqual([
      { environment: "Preview", tone: "success", url: "https://preview.example.test/1", updatedAt: "2026-11-02T10:06:00Z", creator: "octocat", commitOid: "c0ffee" },
    ]);
  });

  it("takes the tone from latestStatus.state in preference to Deployment.state", () => {
    const row = latestDeployments([dep("Preview", { state: "ACTIVE", latestStatus: status("FAILURE") })])[0];
    expect(row.tone, "Expected the status (FAILURE) to beat the deployment's ACTIVE").toBe("failure");
  });

  it("falls back to Deployment.state when there is no latest status", () => {
    const row = latestDeployments([dep("Preview", { state: "QUEUED", latestStatus: null })])[0];
    expect(row.tone, "Expected QUEUED to read as pending").toBe("pending");
    expect(row.updatedAt, "Expected the deployment's own updatedAt when there is no status").toBe("2026-11-02T10:05:00Z");
  });

  it("uses the log URL when there is no environment URL", () => {
    const row = latestDeployments([dep("Preview", { latestStatus: status("SUCCESS", { environmentUrl: null, logUrl: "https://logs.example.test/9" }) })])[0];
    expect(row.url, "Expected logUrl as the fallback link").toBe("https://logs.example.test/9");
  });

  it.each([null, ""])("omits the url key when both URLs are %j", (blank) => {
    const row = latestDeployments([dep("Preview", { latestStatus: status("SUCCESS", { environmentUrl: blank, logUrl: blank }) })])[0];
    expect(row, "Expected no url key when GitHub sent no link").not.toHaveProperty("url");
  });

  it("omits the creator key when the deployment has no creator", () => {
    expect(latestDeployments([dep("Preview", { creator: null })])[0], "Expected no creator key").not.toHaveProperty("creator");
  });
});

describe("CI-5: inactive deployments are hidden unless nothing else exists", () => {
  // Given an inactive Preview and a successful Production, only Production is shown.
  it("hides an inactive deployment while another deployment exists", () => {
    const rows = latestDeployments([dep("Preview", { state: "INACTIVE", latestStatus: status("INACTIVE") }), dep("Production")]);
    expect(rows.map((r) => r.environment), "Expected the inactive Preview to be hidden").toEqual(["Production"]);
  });

  it("drops inactive deployments before choosing the newest, so an older live deployment of the environment shows", () => {
    const rows = latestDeployments([
      dep("Preview", { createdAt: "2026-11-02T09:00:00Z", commitOid: "live" }),
      dep("Preview", { createdAt: "2026-11-02T11:00:00Z", commitOid: "superseded", state: "INACTIVE", latestStatus: status("INACTIVE") }),
    ]);
    expect(rows.map((r) => r.commitOid), "Expected the older, still-live deployment rather than the newer inactive one").toEqual(["live"]);
  });

  it.each(["INACTIVE", "ABANDONED", "DESTROYED"])("treats %s as inactive", (state) => {
    const rows = latestDeployments([dep("Preview", { state, latestStatus: null }), dep("Production")]);
    expect(rows.map((r) => r.environment), `Expected a ${state} deployment to be hidden`).toEqual(["Production"]);
  });

  it("shows the newest inactive deployment per environment when every deployment is inactive", () => {
    const rows = latestDeployments([
      dep("Preview", { createdAt: "2026-11-02T09:00:00Z", commitOid: "older", state: "INACTIVE", latestStatus: status("INACTIVE") }),
      dep("Preview", { createdAt: "2026-11-02T11:00:00Z", commitOid: "newer", state: "INACTIVE", latestStatus: status("INACTIVE") }),
    ]);
    expect(rows.map((r) => [r.environment, r.commitOid, r.tone]), "Expected the newest inactive Preview, as neutral, when nothing else exists").toEqual([["Preview", "newer", "neutral"]]);
  });
});

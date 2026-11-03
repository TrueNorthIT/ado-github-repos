// __TN_MOCK__ Fixtures for batch 1b (CI and merging): check annotations, deployments and commit signatures of fixture PR #312.
import { PR_REPO } from "./prs";
import { commitOid } from "./prDetail";

export const CI_PR = 312;
const MIN = 60e3;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const run = (id: number, job: number) => `https://github.com/${PR_REPO}/actions/runs/${id}/job/${job}`;

const at = (path: string | null, line: number | null, annotationLevel: string | null, title: string, message: string, rawDetails: string | null = null) => ({
  path,
  location: line === null ? null : { start: { line }, end: { line } },
  annotationLevel,
  title,
  message,
  rawDetails,
});

/** The annotationsQuery contexts. Three checks put four annotations on one line of greet.ts, one outside the PR (".github") and one with no line. */
export function annotationContexts(n: number) {
  if (n !== CI_PR) return { statusCheckRollup: { contexts: { nodes: [] } } };
  return {
    statusCheckRollup: {
      contexts: {
        nodes: [
          { __typename: "StatusContext" },
          {
            __typename: "CheckRun", databaseId: 1, name: "lint", detailsUrl: run(9001, 1),
            annotations: {
              totalCount: 4,
              nodes: [
                at("src/util/greet.ts", 12, "WARNING", "prefer-template", "Unexpected string concatenation; use a template literal.", "Rule: prefer-template\nSee: https://eslint.example.test/rules/prefer-template"),
                at("src/retry.ts", 7, "WARNING", "no-await-in-loop", "Unexpected await inside a loop."),
                at(".github", 1, "NOTICE", "Workflow note", "This one belongs to a workflow file, not to the pull request's files."),
                at("src/retry.ts", null, "NOTICE", "File level", "An annotation with no line is counted but not drawn."),
              ],
            },
          },
          {
            __typename: "CheckRun", databaseId: 2, name: "unit tests", detailsUrl: run(9001, 2),
            annotations: {
              totalCount: 2,
              nodes: [
                at("src/util/greet.ts", 12, "FAILURE", "greet() returns the wrong greeting", "Expected \"Hello, Ann!\" but received \"Hello, Ann\".", "AssertionError: expected 'Hello, Ann' to be 'Hello, Ann!'\n    at greet.test.ts:21:30\n    at runTest (vitest/dist/runner.js:412:9)"),
                at("package.json", 6, null, "Lockfile out of date", "package.json changed but the lockfile was not updated."),
              ],
            },
          },
          { __typename: "CheckRun", databaseId: 3, name: "build", detailsUrl: run(9001, 3), annotations: { totalCount: 0, nodes: [] } },
          {
            __typename: "CheckRun", databaseId: 4, name: "code quality", detailsUrl: `https://checks.example.test/${PR_REPO}/312`,
            annotations: { totalCount: 1, nodes: [at("src/retry.ts", 7, "NOTICE", "Cognitive complexity 12", "Consider splitting this function.")] },
          },
        ],
      },
    },
  };
}

const dep = (environment: string, createdMinAgo: number, state: string, status: { state: string; environmentUrl: string | null; logUrl: string | null } | null, commit = "4ead000000000000000000000000000000000312") => ({
  __typename: "DeployedEvent",
  deployment: {
    environment, state, commitOid: commit, createdAt: iso(createdMinAgo * MIN), updatedAt: iso((createdMinAgo - 1) * MIN), creator: { login: "deploy-bot" },
    latestStatus: status && { ...status, updatedAt: iso((createdMinAgo - 2) * MIN), creator: { login: "deploy-bot" } },
  },
});

/** The timelineItems of deploymentsQuery: an older and a newer Preview, a Production still going out, and a superseded Staging. */
export const deploymentNodes = (n: number) =>
  n !== CI_PR ? [] : [
    dep("Preview", 180, "ACTIVE", { state: "SUCCESS", environmentUrl: "https://preview-312-a1.example.test", logUrl: null }),
    dep("Staging", 150, "INACTIVE", { state: "INACTIVE", environmentUrl: null, logUrl: null }),
    dep("Production", 40, "IN_PROGRESS", { state: "IN_PROGRESS", environmentUrl: null, logUrl: `https://github.com/${PR_REPO}/actions/runs/9002` }),
    dep("Preview", 30, "ACTIVE", { state: "SUCCESS", environmentUrl: "https://preview-312-b2.example.test", logUrl: null }),
  ];

/** commitSignaturesQuery nodes for the PR's three commits: verified, unverified (email), unsigned. */
export const signatureNodes = (n: number) =>
  n !== CI_PR ? [] : [
    { commit: { oid: commitOid(n, 1), signature: { isValid: true, state: "VALID", wasSignedByGitHub: false, signer: { login: "ann" } } } },
    { commit: { oid: commitOid(n, 2), signature: { isValid: false, state: "UNVERIFIED_EMAIL", wasSignedByGitHub: false, signer: null } } },
    { commit: { oid: commitOid(n, 3), signature: null } },
  ];

// __TN_MOCK__ Batch 5 fixtures: the New pull request page's comparison, templates and the create mutation.
// Branches (all in truenorthit/github-repos; every one lists in the branch picker):
//   feature/add-login                      clean: 3 commits ahead of main
//   users/dev/1002-handle-empty-repos      one commit, and the branch name carries work item 1002
//   feature/no-changes                     identical to main ("There are no changes to merge")
//   feature/pr-199                         already has an open pull request into main ("View the existing pull request")
//   feature/missing                        does not exist (a head ref that is not found)
// Scenarios: template (one .github/pull_request_template.md), templates (three in .github/PULL_REQUEST_TEMPLATE/), noAutoMerge (repository has auto-merge off),
//   createPartial (the create works, adding reviewers fails: partial failure), createFails (the create itself is refused).
import { PRS, PR_REPO, ME, avatar, type FixturePr } from "./prs";
import { baseSha, headSha } from "./prDetail";
import { NEWPR_BRANCHES, repoOf } from "./repos";

type Result = { data: unknown; errors?: { type?: string; message: string }[] };

const COMMITS: Record<string, { subject: string; body: string }[]> = {
  "feature/add-login": [
    { subject: "Add the login form", body: "" },
    { subject: "Validate credentials before submitting", body: "" },
    { subject: "Add tests for the login form", body: "" },
  ],
  "users/dev/1002-handle-empty-repos": [{ subject: "Handle empty repositories", body: "Shows a friendly message for repositories with no commits\ninstead of failing to load the tree." }],
  "feature/pr-199": [{ subject: "Fix login redirect loop", body: "" }, { subject: "Add a regression test", body: "" }],
};

const TEMPLATES: Record<string, string> = {
  ".github/pull_request_template.md": "## Summary\n\nWhat does this change and why?\n\n## Testing\n\n- [ ] Tests added or updated\n- [ ] Tried it in the browser\n",
  ".github/PULL_REQUEST_TEMPLATE/bug_fix.md": "## Bug fix\n\n**What was wrong**\n\n**How it is fixed**\n",
  ".github/PULL_REQUEST_TEMPLATE/feature.md": "## Feature\n\n**What it adds**\n\n**Screenshots**\n",
  ".github/PULL_REQUEST_TEMPLATE/chore.md": "## Chore\n\nHousekeeping with no behaviour change.\n",
};

const entries = (...names: [string, "blob" | "tree"][]) => ({ entries: names.map(([name, type]) => ({ name, type })) });

/** Template listing: which folders hold what, per scenario. */
function listing(sc: string) {
  const root = entries(["README.md", "blob"], [".github", "tree"], ["docs", "tree"], ["src", "tree"]);
  const github = sc === "template" ? entries(["workflows", "tree"], ["pull_request_template.md", "blob"]) : entries(["workflows", "tree"]);
  const folder = sc === "templates" ? entries(["bug_fix.md", "blob"], ["feature.md", "blob"], ["chore.md", "blob"], ["config.yml", "blob"]) : null;
  return { data: { repository: { d0: root, d1: github, d2: entries(["guide.md", "blob"]), d3: null, d4: folder, d5: null } } };
}

let created = 400; // the other fixtures use numbers up to 312
const labelsOf = () => ({ nodes: [] as { name: string; color: string }[] });

/** GraphQL of the New pull request page. undefined when `query` is not one of ours. */
export function newPrGraphql(query: string, v: Record<string, any>, sc: string): Result | undefined {
  if (/^\s*mutation\b/.test(query)) {
    if (sc === "createPartial" && query.includes("requestReviews(")) return { data: null, errors: [{ message: "Could not resolve to a User with the login 'ghost-reviewer'." }] };
    if (!query.includes("createPullRequest(")) return undefined;
    if (sc === "createFails") return { data: null, errors: [{ message: `A pull request already exists for ${v.input.headRefName}.` }] };
    const i = v.input;
    const n = ++created;
    const pr: FixturePr = {
      reviewRequested: [],
      node: {
        number: n, title: i.title, url: `https://github.com/${PR_REPO}/pull/${n}`, state: "OPEN", isDraft: !!i.draft,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mergedAt: null, closedAt: null,
        baseRefName: i.baseRefName, headRefName: i.headRefName,
        author: { login: ME, name: "Mock User", avatarUrl: avatar(ME) }, labels: labelsOf(),
        reviewThreads: { totalCount: 0, nodes: [] }, comments: { totalCount: 0 }, body: i.body, mergeable: "MERGEABLE",
      },
    };
    PRS.unshift(pr);
    return { data: { createPullRequest: { pullRequest: { id: `PR_${n}`, number: n, url: pr.node.url, headRefOid: headSha(n) } } } };
  }
  if (query.includes("compare(headRef:")) {
    const repo = repoOf(`${v.owner}/${v.name}`);
    if (!repo || repo.missing) return { data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }] };
    const known = (b: string) => repo.branches.includes(b) || NEWPR_BRANCHES.includes(b) || PRS.some((p) => p.node.headRefName === b);
    const baseOk = known(v.base), headOk = known(v.head);
    const commits = COMMITS[v.head] ?? (v.head === "feature/no-changes" || v.head === v.base ? [] : [{ subject: `Update ${v.head}`, body: "" }]);
    const behind = v.base === "feature/add-login" && v.head === "main" ? 3 : 0;
    const ahead = v.head === "main" && v.base !== "main" ? 0 : commits.length;
    const existing = PRS.find((p) => p.node.state === "OPEN" && p.node.headRefName === v.head && p.node.baseRefName === v.base);
    const compare = baseOk && headOk ? {
      aheadBy: ahead, behindBy: behind, status: ahead && behind ? "DIVERGED" : ahead ? "AHEAD" : behind ? "BEHIND" : "IDENTICAL",
      commits: { totalCount: ahead, nodes: (ahead ? commits : []).map((c, k) => ({ oid: `${(k + 1).toString(16).padStart(7, "0")}${baseSha(0).slice(7)}`, messageHeadline: c.subject, messageBody: c.body })) },
    } : null;
    return {
      data: {
        repository: {
          id: "R_mock", defaultBranchRef: { name: "main" }, autoMergeAllowed: sc !== "noAutoMerge",
          baseRef: baseOk ? { compare } : null,
          headRef: headOk ? { id: `REF_${v.head}`, target: { oid: headSha(200) } } : null,
          pullRequests: { nodes: existing ? [{ number: existing.node.number, title: existing.node.title, url: existing.node.url, isDraft: existing.node.isDraft, isCrossRepository: false }] : [] },
        },
      },
      ...(baseOk && !headOk ? { errors: [{ type: "NOT_FOUND", message: `Could not resolve head ref '${v.head}'` }] } : {}),
    };
  }
  if (query.includes("d0: object(expression: $d0)")) return listing(sc);
  if (query.includes("t0: object(expression: $e0)")) {
    const repository: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      const m = /^e(\d+)$/.exec(k);
      if (!m) continue;
      const text = TEMPLATES[v[k].slice(v[k].indexOf(":") + 1)];
      repository[`t${m[1]}`] = text === undefined ? null : { text, byteSize: text.length, isTruncated: false };
    }
    return { data: { repository } };
  }
  return undefined;
}

export const MERGE_BASE = baseSha(200);

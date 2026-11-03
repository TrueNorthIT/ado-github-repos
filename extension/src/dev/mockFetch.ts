// __TN_MOCK__ Replaces window.fetch for the Azure DevOps and GitHub endpoints the app calls; anything else goes to the real fetch.
import { PNG_BASE64 } from "./fixtures/content";
import { CONNECTIONS, HTML, TEXT, repoOf, treeFor } from "./fixtures/repos";
import { ME, PRS, PR_REPO, type FixturePr } from "./fixtures/prs";
import { contentAt, detailNode, restFiles } from "./fixtures/prDetail";
import { feedData, feedMutation } from "./fixtures/feed";
import { commentsGraphql, overlayFeed } from "./fixtures/comments";
import { WI_OVERRIDE, WI_STATES, actionsMutation, actionsNode, branchNames, mergeMessages, rerunRun } from "./fixtures/actions";
import { WI_CATALOG, editGraphql, removeRequestedReviewers, wiqlResult } from "./fixtures/edit";
import { annotationContexts, deploymentNodes, signatureNodes } from "./fixtures/ci";
import { refsContent, refsGraphql, refsRest } from "./refsMock";
import { fakeTokens, scenario } from "./mockSdk";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const status = (code: number, headers: Record<string, string> = {}) => new Response("{}", { status: code, headers });
const pngBytes = () => Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));
const BRANCH_PAGE = 100;

// Plausible commits for GraphQL history lookups: a spread of ages, authors and message lengths, picked by path.
const AUTHORS = [
  { name: "Ann Author", user: { name: "Ann Display", login: "ann" } },
  { name: "bob", user: { name: null, login: "bob-dev" } },
  { name: "Carol Commit", user: null },
];
const MESSAGES = ["Update dependencies", "Fix login redirect", "Merged PR 412: Add retry handling to the sync job and tidy up the logging so failures include the correlation id", "Initial commit", "Docs: clarify setup", "Refactor listing"];
const AGES_MIN = [12, 48, 135, 60 * 26, 60 * 24 * 9, 60 * 24 * 75, 60 * 24 * 400, 60 * 24 * 1000];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function mockHistory(path: string) {
  const h = hash(path);
  const oid = (h.toString(16).padStart(8, "0") + "0123456789abcdef0123456789abcdef01234567").slice(0, 40);
  return { nodes: [{ oid, messageHeadline: MESSAGES[h % MESSAGES.length], committedDate: new Date(Date.now() - AGES_MIN[h % AGES_MIN.length] * 60e3).toISOString(), author: AUTHORS[h % AUTHORS.length] }] };
}

const icon = (c: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="2" fill="#${c}"/></svg>`)}`;
const WI_TYPES = [["Bug", "CC293D"], ["Task", "F2CB1D"], ["Product Backlog Item", "009CCC"]].map(([name, color]) => ({ name, color, icon: { url: icon(color) } }));

function graphql(init: RequestInit | undefined, sc: string): Response {
  if (sc === "rateLimit" || sc === "commitsFail") return status(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 900) });
  const { query, variables } = JSON.parse(String(init?.body ?? "{}"));
  const cm = commentsGraphql(query, variables, sc); // batch 3: comment metadata, new threads, pending reviews, suggestions, reactions
  if (cm) return "code" in cm ? status(cm.code as number) : json(cm);
  const refs = refsGraphql(query, variables, sc); // commits, branches, tags and their writes (before the PR mutations: both have a deleteRef)
  if (refs) return refs;
  const edit = editGraphql(query, variables, sc); // batch 2: the edit query, picker searches and edit writes (before the PR mutations: updatePullRequest is in both)
  if (edit) return "code" in edit ? status(edit.code) : json(edit);
  if (/^\s*mutation\b/.test(query)) {
    const act = actionsMutation(query, variables, sc);
    if (act) return "code" in act ? status(act.code) : json(act);
    if (sc === "feedPostFails") return status(403); // the sign-in can't post: shows the optimistic rollback
    const data = feedMutation(query, variables);
    return data ? json({ data }) : json({ data: null, errors: [{ message: "Unknown mutation" }] });
  }
  // Batch 1b: annotations, deployments and commit signatures of a pull request (their queries also ask about pullRequest( and timelineItems(, so they go first).
  if (query.includes("annotations(first: 50)") || query.includes("DEPLOYED_EVENT") || query.includes("commits(first: 100, after")) {
    const mine = `${variables.owner}/${variables.name}`.toLowerCase() === PR_REPO;
    const pullRequest = !mine ? null : query.includes("annotations(first: 50)") ? annotationContexts(variables.number)
      : query.includes("DEPLOYED_EVENT") ? { timelineItems: { nodes: deploymentNodes(variables.number) } }
      : { commits: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: signatureNodes(variables.number) } };
    return json({ data: { repository: { pullRequest } } });
  }
  // Acting on a PR: the actions detail query, the merge message suggestions and the branch list (all ask about pullRequest( or refs(, so they go before the generic routes).
  if (query.includes("mergeStateStatus")) {
    const node = `${variables.owner}/${variables.name}`.toLowerCase() === PR_REPO ? actionsNode(variables.number) : null;
    return json(node ? { data: { repository: node } } : { data: { repository: { pullRequest: null } }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a PullRequest" }] });
  }
  if (query.includes("viewerMergeHeadlineText")) return json({ data: { repository: { pullRequest: mergeMessages(variables.number) } } });
  if (query.includes('refPrefix: "refs/heads/"')) return json({ data: { repository: { refs: { nodes: branchNames().map((name) => ({ name })) } } } });
  if (query.includes("timelineItems(")) return repoOf(`${variables.owner}/${variables.name}`) && `${variables.owner}/${variables.name}`.toLowerCase() === PR_REPO && PRS.some((p) => p.node.number === variables.number) ? json({ data: overlayFeed(feedData(variables.number), variables.number, sc) }) : json({ data: { repository: { pullRequest: null } } });
  if (/search\(|pullRequests\(|pullRequest\(/.test(query)) return prGraphql(variables, query.includes("bodyHTML")); // the page's detail query asks for bodyHTML; the list's single-PR lookup does not
  if (!repoOf(`${variables?.owner}/${variables?.name}`)) return json({ data: { repository: null }, errors: [{ message: "Could not resolve to a Repository" }] });
  const object: Record<string, unknown> = {};
  for (const k of Object.keys(variables)) if (/^p\d+$/.test(k)) object["e" + k.slice(1)] = mockHistory(variables[k]);
  return json({ data: { repository: { object } } });
}

// ---------- pull requests: pullRequests, search and pullRequest, with base64 offset cursors ----------
const PAGE = 25;
const STATE_OF: Record<string, string> = { open: "OPEN", merged: "MERGED", closed: "CLOSED" };
const page = (list: FixturePr[], after: string | null) => {
  const start = after ? Number(atob(after).split(":")[1]) || 0 : 0;
  const end = Math.min(start + PAGE, list.length);
  return { nodes: list.slice(start, end).map((p) => p.node), pageInfo: { hasNextPage: end < list.length, endCursor: btoa(`c:${end}`) } };
};
const byUpdated = (a: FixturePr, b: FixturePr) => Date.parse(b.node.updatedAt) - Date.parse(a.node.updatedAt);

function prGraphql(v: Record<string, any>, full: boolean): Response {
  if (v.q !== undefined) {
    const t = String(v.q).split(/\s+/).filter(Boolean);
    const inRepo = t.includes(`repo:${PR_REPO}`);
    const states = t.filter((x) => x.startsWith("is:") && STATE_OF[x.slice(3)]).map((x) => STATE_OF[x.slice(3)]);
    const terms = t.filter((x) => !x.includes(":")).map((x) => x.toLowerCase());
    const list = !inRepo ? [] : PRS.filter((p) => {
      const n = p.node;
      return (!states.length || states.includes(n.state))
        && (!t.includes("is:unmerged") || n.state !== "MERGED")
        && (!t.includes("author:@me") || n.author?.login === ME)
        && (!t.includes("review-requested:@me") || p.reviewRequested.includes(ME))
        && terms.every((w) => n.title.toLowerCase().includes(w));
    }).sort(byUpdated);
    return json({ data: { search: page(list, v.after ?? null) } });
  }
  if (!repoOf(`${v.owner}/${v.name}`)) return json({ data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }] });
  const mine = `${v.owner}/${v.name}`.toLowerCase() === PR_REPO;
  if (v.number !== undefined) {
    const hit = mine ? PRS.find((p) => p.node.number === v.number) : undefined;
    return json({ data: { repository: { pullRequest: hit ? (full ? detailNode(hit) : hit.node) : null } } });
  }
  const list = mine ? PRS.filter((p) => (v.states ?? []).includes(p.node.state)).sort(byUpdated) : [];
  return json({ data: { repository: { pullRequests: page(list, v.after ?? null) } } });
}

function github(u: URL, accept: string, sc: string, init?: RequestInit): Response {
  if (sc === "rateLimit") return status(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 900) });
  const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(u.pathname);
  const repo = m && repoOf(`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`);
  if (!m || !repo || repo.missing) return status(404);
  const rest = m[3] ?? "";
  if (!rest) return json({ default_branch: "main", private: repo.private, description: repo.description, language: repo.language, pushed_at: new Date(Date.now() - 3 * 86400e3).toISOString() });
  if (rest === "/branches") {
    const page = Number(u.searchParams.get("page") || 1);
    const names = repo.branches.slice((page - 1) * BRANCH_PAGE, page * BRANCH_PAGE);
    const more = page * BRANCH_PAGE < repo.branches.length;
    return json(names.map((name) => ({ name })), 200, more ? { link: `<https://api.github.com${u.pathname}?per_page=100&page=${page + 1}>; rel="next"` } : {});
  }
  const t = /^\/git\/trees\/(.+)$/.exec(rest);
  if (t) return json(treeFor(repo, decodeURIComponent(t[1]), u.searchParams.get("recursive") === "1"));
  const refsAnswer = refsRest(repo.fullName, rest, u, init, sc);
  if (refsAnswer) return refsAnswer;
  const reviewers = /^\/pulls\/(\d+)\/requested_reviewers$/.exec(rest);
  if (reviewers && init?.method === "DELETE") return status(removeRequestedReviewers(Number(reviewers[1]), JSON.parse(String(init.body ?? "null")), sc));
  const files = /^\/pulls\/(\d+)\/files$/.exec(rest);
  if (files) return repo.fullName.toLowerCase() === PR_REPO && PRS.some((p) => p.node.number === Number(files[1])) ? json(restFiles(Number(files[1]))) : status(404);
  const rerun = /^\/actions\/runs\/(\d+)\/(rerun|rerun-failed-jobs)$/.exec(rest);
  if (rerun && init?.method === "POST") return sc === "actionsFail" || !rerunRun(Number(rerun[1]), rerun[2] === "rerun") ? status(403) : status(201);
  const c = /^\/contents\/(.+)$/.exec(rest);
  if (c) {
    const text = contentAt(u.searchParams.get("ref") ?? "", c[1].split("/").map(decodeURIComponent).join("/"));
    if (text !== undefined) return new Response(text, { headers: { "Content-Type": "application/octet-stream" } });
    const history = refsContent(repo.fullName, u.searchParams.get("ref") ?? "", c[1].split("/").map(decodeURIComponent).join("/"));
    if (history !== undefined) return new Response(history, { headers: { "Content-Type": "application/octet-stream" } });
    if (sc === "noAccess") return status(403);
    const path = c[1].split("/").map(decodeURIComponent).join("/");
    if (!(path in repo.files)) return status(404);
    if (accept.includes("vnd.github.html")) return HTML[path] ? new Response(HTML[path], { headers: { "Content-Type": "text/html" } }) : status(404);
    if (path.endsWith(".png")) return new Response(pngBytes(), { headers: { "Content-Type": "application/octet-stream" } });
    return new Response(TEXT[path] ?? "PK\u0003\u0004 mock binary", { headers: { "Content-Type": "application/octet-stream" } });
  }
  return status(404);
}

async function handle(u: URL, init: RequestInit | undefined, sc: string): Promise<Response | undefined> {
  const accept = new Headers(init?.headers).get("Accept") ?? "";
  if (u.hostname === "api.github.com" && u.pathname === "/graphql") return graphql(init, sc);
  if (u.hostname === "api.github.com") return github(u, accept, sc, init);
  if (u.hostname === "dev.azure.com" && /\/_apis\/wit\/workitemtypes$/.test(u.pathname)) return json({ value: WI_TYPES });
  const wiStates = /\/_apis\/wit\/workitemtypes\/([^/]+)\/states$/.exec(u.pathname);
  if (u.hostname === "dev.azure.com" && wiStates) return json({ count: 0, value: WI_STATES[decodeURIComponent(wiStates[1])] ?? [] });
  const wiPatch = /\/_apis\/wit\/workitems\/(\d+)$/.exec(u.pathname);
  if (u.hostname === "dev.azure.com" && wiPatch && init?.method === "PATCH") {
    if (sc === "workItemsReadOnly") return status(403); // the extension lacks vso.work_write: shows the partial-failure message
    WI_OVERRIDE.set(Number(wiPatch[1]), JSON.parse(String(init.body))[0].value);
    return json({ id: Number(wiPatch[1]) });
  }
  if (u.hostname === "dev.azure.com" && /\/_apis\/wit\/wiql$/.test(u.pathname) && init?.method === "POST") return json(wiqlResult(JSON.parse(String(init.body)).query));
  if (u.hostname === "dev.azure.com" && /\/_apis\/wit\/workitems$/.test(u.pathname)) {
    if (sc === "workItemsDenied") return status(403);
    const ids = (u.searchParams.get("ids") ?? "").split(",").map(Number);
    return json({ count: ids.length, value: ids.map((id) => (id >= 1000 && id < 1100 ? { id, fields: { "System.Title": WI_CATALOG[id] ?? `Work item ${id}`, "System.State": WI_OVERRIDE.get(id) ?? (id === 1000 ? "Active" : id === 1001 ? "In Progress" : id % 2 ? "Committed" : "Done"), "System.WorkItemType": id === 1000 ? "Bug" : id === 1001 ? "Task" : "Product Backlog Item" } } : null)) });
  }
  if (u.pathname === "/api/auth/refresh") return json(fakeTokens());
  const conn = /\/_apis\/githubconnections(?:\/([^/]+)\/repos)?$/.exec(u.pathname);
  if (u.hostname === "dev.azure.com" && conn) {
    if (sc === "forbidden") return status(403);
    if (conn[1]) return json({ value: (CONNECTIONS.find((c) => c.id === conn[1])?.repos ?? []).map((r) => ({ gitHubRepositoryUrl: `https://github.com/${r}` })) });
    return json({ value: sc === "noConnections" ? [] : CONNECTIONS.map(({ id, isConnectionValid }) => ({ id, isConnectionValid })) });
  }
  return undefined;
}

export function installMockFetch() {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const sc = scenario();
    const res = await handle(u, init ?? (input instanceof Request ? { headers: input.headers } : undefined), sc);
    if (!res) return real(input, init);
    await sleep(sc === "slow" ? 2000 : 150 + Math.random() * 150);
    return res;
  };
}


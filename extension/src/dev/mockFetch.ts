// __TN_MOCK__ Replaces window.fetch for the Azure DevOps and GitHub endpoints the app calls; anything else goes to the real fetch.
import { PNG_BASE64 } from "./fixtures/content";
import { CONNECTIONS, HTML, TEXT, repoOf, treeFor } from "./fixtures/repos";
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

function graphql(init: RequestInit | undefined, sc: string): Response {
  if (sc === "rateLimit" || sc === "commitsFail") return status(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 900) });
  const { variables } = JSON.parse(String(init?.body ?? "{}"));
  if (!repoOf(`${variables?.owner}/${variables?.name}`)) return json({ data: { repository: null }, errors: [{ message: "Could not resolve to a Repository" }] });
  const object: Record<string, unknown> = {};
  for (const k of Object.keys(variables)) if (/^p\d+$/.test(k)) object["e" + k.slice(1)] = mockHistory(variables[k]);
  return json({ data: { repository: { object } } });
}

function github(u: URL, accept: string, sc: string): Response {
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
  const c = /^\/contents\/(.+)$/.exec(rest);
  if (c) {
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
  if (u.hostname === "api.github.com") return github(u, accept, sc);
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


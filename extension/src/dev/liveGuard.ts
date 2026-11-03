// __TN_LIVE__ Live-mode repo guard: a pure decision function. Live mode talks to real GitHub with a token that may be broader
// than the sandbox, so every api.github.com request is checked before it leaves the page. Default deny.
export const SANDBOX = "TrueNorthIT/gh-repos-sandbox";
const ORG = "TrueNorthIT";
const lc = (s: string) => s.toLowerCase();
const SANDBOX_LC = lc(SANDBOX);

/** What the guard knows about the page: the sandbox's numeric id, and node ids that came back in sandbox responses. */
export interface GuardCtx { sandboxId?: number; seenIds: Set<string> }
export interface GuardReq { method: string; url: URL; body?: string }
export type Decision = { ok: true } | { ok: false; reason: string };

const ok: Decision = { ok: true };
const no = (reason: string): Decision => ({ ok: false, reason });

// GitHub node ids: PR_kwDO…, R_kgDO…, PRRT_kwDO…; and the legacy base64 form (MDExOlB1…). Cursors are not matched.
const NODE_ID = /^[A-Za-z]{1,8}_k[wg][A-Za-z0-9_-]{6,}$|^MD[A-Za-z0-9+/=]{10,}$/;
const NODE_ID_G = /"([A-Za-z]{1,8}_k[wg][A-Za-z0-9_-]{6,}|MD[A-Za-z0-9+/=]{10,})"/g;
export const learnIds = (text: string, ctx: GuardCtx) => { for (const m of text.matchAll(NODE_ID_G)) ctx.seenIds.add(m[1]); };

const sameRepo = (owner: string, name: string) => lc(`${owner}/${name}`) === SANDBOX_LC;

/** repo: qualifiers of a search string: there must be at least one and every one must be the sandbox. */
function searchOk(q: string): Decision {
  const repos = [...q.matchAll(/(?:^|\s)-?repo:"?([^\s"]+)"?/gi)].map((m) => m[1]);
  if (!repos.length) return no("search without a repo: qualifier could reach other repositories");
  const bad = repos.find((r) => lc(r) !== SANDBOX_LC);
  return bad ? no(`search names repository ${bad}`) : ok;
}

function restDecision(r: GuardReq, ctx: GuardCtx): Decision {
  const p = r.url.pathname, get = r.method === "GET" || r.method === "HEAD";
  const repo = /^\/repos\/([^/]+)\/([^/]+)(\/|$)/.exec(p);
  if (repo) {
    const [o, n] = [decodeURIComponent(repo[1]), decodeURIComponent(repo[2])];
    return sameRepo(o, n) ? ok : no(`repository ${o}/${n}`);
  }
  const byId = /^\/repositories\/(\d+)(\/|$)/.exec(p);
  if (byId) return ctx.sandboxId !== undefined && Number(byId[1]) === ctx.sandboxId ? ok : no(`repository id ${byId[1]} is not the sandbox`);
  if (p === "/markdown" && r.method === "POST") { // `context` makes GFM resolve #123 links against a repo
    let c: unknown;
    try { c = JSON.parse(r.body || "{}").context; } catch { return no("unreadable /markdown body"); }
    return c === undefined || (typeof c === "string" && lc(c) === SANDBOX_LC) ? ok : no(`markdown context ${String(c)}`);
  }
  if (!get) return no(`${r.method} ${p}: only reads are allowed outside the sandbox repository`);
  if (p === "/user" || p === "/rate_limit") return ok;
  const org = /^\/orgs\/([^/]+)\/(members|teams)(\/|$)/.exec(p);
  if (org) return lc(decodeURIComponent(org[1])) === lc(ORG) ? ok : no(`organisation ${org[1]}`);
  if (/^\/search\/(issues|commits|code)$/.test(p)) return searchOk(r.url.searchParams.get("q") ?? "");
  return no(`${p} is not on the live-mode allow list`);
}

const PAIR = (args: string, key: string) => new RegExp(`\\b${key}\\s*:\\s*(\\$\\w+|"[^"]*")`).exec(args)?.[1];
const resolve = (tok: string | undefined, vars: Record<string, unknown>): unknown => (tok === undefined ? undefined : tok.startsWith("$") ? vars[tok.slice(1)] : tok.slice(1, -1));

function graphqlDecision(body: string, ctx: GuardCtx): Decision {
  let query: string, vars: Record<string, unknown>;
  try { const j = JSON.parse(body); query = String(j.query ?? ""); vars = j.variables ?? {}; } catch { return no("unreadable graphql body"); }
  if (/\brepositoryOwner\s*\(|\brepositories\s*[({]|\buser\s*\(|\bviewer\s*\{[^}]*\b(pullRequests|issues|organizations|contributionsCollection)\b/.test(query)) return no("query reaches beyond one repository");
  for (const m of query.matchAll(/\brepository\s*\(([^)]*)\)/g)) {
    const o = resolve(PAIR(m[1], "owner"), vars), n = resolve(PAIR(m[1], "name"), vars);
    if (typeof o !== "string" || typeof n !== "string" || !sameRepo(o, n)) return no(`repository(${String(o)}/${String(n)})`);
  }
  for (const m of query.matchAll(/\borganization\s*\(([^)]*)\)/g)) {
    const o = resolve(PAIR(m[1], "login"), vars);
    if (typeof o !== "string" || lc(o) !== lc(ORG)) return no(`organization(${String(o)})`);
  }
  for (const m of query.matchAll(/\bsearch\s*\(([^)]*)\)/g)) {
    const q = resolve(PAIR(m[1], "query"), vars);
    if (typeof q !== "string") return no("search query is not readable");
    const d = searchOk(q);
    if (!d.ok) return d;
  }
  // node(id:) / nodes(ids:) lookups, and any node-id-shaped value in variables or literals, must have been seen in a sandbox response.
  const ids: string[] = [];
  for (const m of query.matchAll(/\bnodes?\s*\(([^)]*)\)/g)) {
    const v = resolve(PAIR(m[1], "ids") ?? PAIR(m[1], "id"), vars);
    ids.push(...(Array.isArray(v) ? v : [v]).map(String));
  }
  const walk = (v: unknown) => { if (typeof v === "string") { if (NODE_ID.test(v)) ids.push(v); } else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(vars);
  for (const m of query.matchAll(/"([^"]*)"/g)) if (NODE_ID.test(m[1])) ids.push(m[1]);
  const unseen = ids.find((i) => !ctx.seenIds.has(i));
  return unseen ? no(`node id ${unseen} has not come back from a sandbox response`) : ok;
}

export function decide(r: GuardReq, ctx: GuardCtx): Decision {
  if (r.url.hostname !== "api.github.com") return ok; // blob hosts: no repository addressing, and the token is not sent there
  return r.url.pathname === "/graphql" && r.method === "POST" ? graphqlDecision(r.body ?? "", ctx) : restDecision(r, ctx);
}

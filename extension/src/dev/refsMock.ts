// __TN_MOCK__ Mock GitHub answers for the Repos pages (batch R1): commit lists and detail, pushes, compare, branches, tags and their writes.
// Scenario `refsFail` makes every write answer 403 (the app shows "Your GitHub sign-in isn't allowed to do this...").
import { ME } from "./fixtures/prs";
import { repoOf } from "./fixtures/repos";
import {
  activities, ancestors, branchNode, commitNode, contentAt, filesOf, historyOf, newId, PEOPLE, refsOf, resolve, tagNode, avatar,
  type FCommit, type RepoRefs,
} from "./fixtures/refs";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const status = (code: number) => new Response("{}", { status: code });
const PAGE = 50;
const REPO_ID = (fullName: string) => `REPO_${fullName.toLowerCase()}`;
const known = (v: Record<string, any>) => (repoOf(`${v?.owner}/${v?.name}`) ? refsOf(`${v.owner}/${v.name}`) : undefined);
const repoByName = (n: string) => refsOf(n);

export function refsGraphql(query: string, v: Record<string, any>, sc: string): Response | undefined {
  if (/^\s*query\s*\{\s*viewer\s*\{\s*login/.test(query)) return json({ data: { viewer: { login: ME } } });

  if (/^\s*mutation\b/.test(query)) {
    const create = /\bcreateRef\(input: \$input\)/.test(query);
    const del = /\bdeleteRef\(input: \$input\)/.test(query) && String(v.input?.refId).startsWith("REF_");
    if (!create && !del) return undefined;
    if (sc === "refsFail") return status(403);
    if (create) {
      const { repositoryId, name, oid } = v.input;
      const rr = repoByName(String(repositoryId).replace(/^REPO_/, ""));
      if (!rr.bySha.has(oid) && !rr.pendingTagObjects.has(oid)) return json({ data: null, errors: [{ message: "Object does not exist" }] });
      if (name.startsWith("refs/heads/")) {
        const n = name.slice(11);
        if (rr.branches.some((b) => b.name === n)) return json({ data: null, errors: [{ message: "A ref with that name already exists." }] });
        rr.branches.push({ name: n, tip: oid, protected: false, pr: null });
        return json({ data: { createRef: { ref: { id: `REF_heads_${n}`, name: n } } } });
      }
      const n = name.slice(10);
      if (rr.tags.some((t) => t.name === n)) return json({ data: null, errors: [{ message: "A ref with that name already exists." }] });
      const obj = rr.pendingTagObjects.get(oid);
      const commit = obj?.commit ?? oid;
      rr.tags.push({ name: n, commit, at: obj ? Date.now() : rr.bySha.get(commit)!.at, ...(obj ? { message: obj.message, tagger: PEOPLE[3] } : {}) });
      rr.pendingTagObjects.delete(oid);
      return json({ data: { createRef: { ref: { id: `REF_tags_${n}`, name: n } } } });
    }
    const id = String(v.input.refId);
    for (const key of ["heads", "tags"] as const) {
      if (!id.startsWith(`REF_${key}_`)) continue;
      const n = id.slice(`REF_${key}_`.length);
      for (const fn of ["truenorthit/github-repos", "truenorthit/customer-portal", "truenorthit/no-description", "truenorthit/monorepo"]) {
        const rr = repoByName(fn);
        const list: { name: string }[] = key === "heads" ? rr.branches : rr.tags;
        const i = list.findIndex((x) => x.name === n);
        if (i >= 0) { list.splice(i, 1); return json({ data: { deleteRef: { clientMutationId: null } } }); }
      }
    }
    return json({ data: null, errors: [{ message: "Could not resolve to a Ref" }] });
  }

  if (query.includes("history(first: 50")) {
    const rr = known(v);
    if (!rr) return json({ data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }] });
    const tip = resolve(rr, String(v.ref));
    if (!tip) return json({ data: { repository: { ref: null } } });
    const all = historyOf(rr, tip);
    const start = v.after ? Number(atob(v.after).split(":")[1]) || 0 : 0;
    const end = Math.min(start + PAGE, all.length);
    return json({ data: { repository: { ref: { target: { history: { pageInfo: { hasNextPage: end < all.length, endCursor: btoa(`c:${end}`) }, nodes: all.slice(start, end).map(commitNode) } } } } } });
  }
  if (query.includes("object(expression: $sha)")) {
    const rr = known(v);
    if (!rr) return json({ data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }] });
    const c = rr.commits.find((x) => x.sha.startsWith(String(v.sha).toLowerCase()));
    return json({ data: { repository: { object: c ? commitNode(c) : null } } });
  }
  if (query.includes("GitObjectID")) {
    const rr = known(v);
    const repository: Record<string, unknown> = {};
    for (const k of Object.keys(v)) if (/^o\d+$/.test(k)) repository["c" + k.slice(1)] = rr?.bySha.get(v[k]) ? commitNode(rr.bySha.get(v[k])!) : null;
    return json({ data: { repository } });
  }
  if (query.includes("defaultBranchRef") && !query.includes("mergeStateStatus")) {
    const rr = known(v);
    if (!rr) return json({ data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }] });
    const nodes = [...rr.branches].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((b) => branchNode(rr, b));
    return json({ data: { repository: { id: REPO_ID(`${v.owner}/${v.name}`), defaultBranchRef: { name: "main" }, refs: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } });
  }
  if (query.includes('refPrefix: "refs/tags/"')) {
    const rr = known(v);
    if (!rr) return json({ data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }] });
    const nodes = [...rr.tags].sort((a, b) => b.at - a.at).map((t) => tagNode(rr, t));
    return json({ data: { repository: { id: REPO_ID(`${v.owner}/${v.name}`), refs: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } });
  }
  return undefined;
}

const restCommit = (c: FCommit) => ({
  sha: c.sha,
  commit: { message: c.message, author: { name: c.author.name, date: new Date(c.at).toISOString() }, committer: { date: new Date(c.at + 60e3).toISOString() } },
  author: c.author.login ? { login: c.author.login, avatar_url: avatar(c.author.login) } : null,
  parents: c.parents.map((sha) => ({ sha })),
});

/** REST routes under /repos/{o}/{r}; `rest` starts with "/". undefined when this module has no answer. */
export function refsRest(fullName: string, rest: string, u: URL, init: RequestInit | undefined, sc: string): Response | undefined {
  const rr: RepoRefs = refsOf(fullName);
  if (rest === "/activity") {
    const ref = (u.searchParams.get("ref") ?? "").replace(/^refs\/heads\//, "");
    // Pages of 8 (not per_page) so "Load more" shows with these short fixture histories; the cursor is the offset, as an opaque string.
    const actor = u.searchParams.get("actor");
    const all = activities(rr, ref).filter((a) => !actor || a.actor?.login === actor);
    const from = Number(u.searchParams.get("after")?.replace(/^cur/, "") || 0);
    const more = all.length > from + 8;
    const link = more ? `<https://api.github.com${u.pathname}?ref=${encodeURIComponent(u.searchParams.get("ref") ?? "")}&per_page=30&after=cur${from + 8}>; rel="next"` : undefined;
    return json(all.slice(from, from + 8), 200, link ? { link } : {});
  }
  const cmp = /^\/compare\/(.+)\.\.\.(.+)$/.exec(rest);
  if (cmp) {
    const base = resolve(rr, decodeURIComponent(cmp[1]));
    const head = resolve(rr, decodeURIComponent(cmp[2]));
    if (!base || !head) return status(404);
    const a = ancestors(rr, head);
    const b = ancestors(rr, base);
    const commits = historyOf(rr, head).filter((c) => !b.has(c.sha)).reverse(); // oldest first, as GitHub
    const page = Number(u.searchParams.get("page") || 1);
    return json({
      ahead_by: commits.length,
      behind_by: [...b].filter((s) => !a.has(s)).length,
      commits: commits.slice(0, Number(u.searchParams.get("per_page") || 250)).map(restCommit),
      files: page === 1 ? filesOf(rr, commits) : [],
    });
  }
  const one = /^\/commits\/([0-9a-f]{4,40})$/.exec(rest);
  if (one) {
    const c = rr.commits.find((x) => x.sha.startsWith(one[1]));
    return c ? json({ ...restCommit(c), files: Number(u.searchParams.get("page") || 1) === 1 ? filesOf(rr, [c]) : [] }) : status(404);
  }
  if (rest === "/git/tags" && init?.method === "POST") {
    if (sc === "refsFail") return status(403);
    const body = JSON.parse(String(init.body));
    const sha = `7a9${String(newId()).replace(/\D/g, "").padStart(37, "0")}`;
    rr.pendingTagObjects.set(sha, { commit: body.object, message: body.message });
    return json({ sha, tag: body.tag }, 201);
  }
  return undefined;
}

/** File contents at a commit sha of the history fixtures. */
export function refsContent(fullName: string, ref: string, path: string): string | undefined {
  return contentAt(refsOf(fullName), ref, path);
}

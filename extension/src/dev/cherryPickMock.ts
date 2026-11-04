// __TN_MOCK__ Cherry-pick and Revert (batch I): the REST Git data reads and writes and the merges call lib/cherryPick.ts runPick makes,
// over the history fixtures (fixtures/refs.ts), plus GET /pulls/{n} for a merged pull request of the PR fixtures.
// Scenarios: "cherryPickConflict" (POST /merges answers 409), "readOnly" (no push permission: the menu items are disabled), "refsFail" (writes 403).
// Only requests this module recognises are answered: trees it handed out, commits it made and tmp/ branches; the rest falls through to
// writesMock (Delete folder) and the other mocks.
import { repoOf } from "./fixtures/repos";
import { PRS, PR_REPO } from "./fixtures/prs";
import { refsOf, resolve, type FCommit, type RepoRefs } from "./fixtures/refs";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const TREE = "7c9";
const treeOf = (sha: string) => TREE + sha.slice(3);
let counter = 0;
const newSha = () => `c4e${String(++counter).padStart(5, "0")}${Date.now().toString(16)}`.padEnd(40, "0").slice(0, 40);

interface Made { sha: string; tree: string; parents: string[]; message: string; author?: { name: string; email: string; date?: string } }
const made = new Map<string, Made>();
const temps = new Map<string, string>();

function gitCommit(rr: RepoRefs, sha: string) {
  const m = made.get(sha);
  if (m) return { sha, tree: { sha: m.tree }, parents: m.parents.map((s) => ({ sha: s })), message: m.message, author: m.author ?? { name: "Mock User", email: "me@example.com", date: new Date().toISOString() } };
  const c = rr.bySha.get(sha);
  if (!c) return undefined;
  return { sha, tree: { sha: treeOf(sha) }, parents: c.parents.map((s) => ({ sha: s })), message: c.message, author: { name: c.author.name, email: `${c.author.login ?? "someone"}@example.com`, date: new Date(c.at).toISOString() } };
}

/** The pull request fixture's merge commit: a stable commit of the history fixtures with a single parent (a squash). */
const mergeCommitOf = (rr: RepoRefs, n: number) => {
  const singles = rr.commits.filter((c) => c.parents.length === 1);
  return singles[n % singles.length];
};

export function cherryPickRest(full: string, rest: string, init: RequestInit | undefined, sc: string): Response | undefined {
  const method = init?.method ?? "GET";
  const body = () => JSON.parse(String(init?.body ?? "{}"));
  const rr = refsOf(full);
  const deny = () => json({ message: "Resource not accessible by integration" }, 403);

  const pull = /^\/pulls\/(\d+)$/.exec(rest);
  if (pull && method === "GET" && full.toLowerCase() === PR_REPO) {
    const p = PRS.find((x) => x.node.number === Number(pull[1]));
    if (!p || p.node.state !== "MERGED") return undefined;
    return json({ number: p.node.number, title: p.node.title, state: "closed", merged: true, merge_commit_sha: mergeCommitOf(rr, p.node.number).sha, base: { ref: p.node.baseRefName ?? "main" }, head: { ref: p.node.headRefName }, commits: 1 });
  }

  const ref = /^\/git\/ref\/heads\/(.+)$/.exec(rest);
  if (ref && method === "GET") {
    const name = ref[1].split("/").map(decodeURIComponent).join("/");
    // The file browser's generic branches aren't in the history fixtures; resolve() gives them a stable commit.
    const tip = rr.branches.find((x) => x.name === name)?.tip ?? (repoOf(full)?.branches.includes(name) ? resolve(rr, name) : undefined);
    return tip ? json({ ref: `refs/heads/${name}`, object: { sha: tip, type: "commit" } }) : json({ message: "Not Found" }, 404);
  }

  const one = /^\/git\/commits\/([0-9a-z]{40})$/.exec(rest);
  if (one && method === "GET") {
    const c = gitCommit(rr, one[1]);
    return c ? json(c) : undefined;
  }

  if (rest === "/git/commits" && method === "POST") {
    const b = body();
    if (!String(b.tree).startsWith(TREE)) return undefined;
    if (sc === "refsFail") return deny();
    const sha = newSha();
    made.set(sha, { sha, tree: b.tree, parents: b.parents, message: b.message, author: b.author });
    return json({ sha, tree: { sha: b.tree }, parents: (b.parents as string[]).map((s) => ({ sha: s })), message: b.message }, 201);
  }

  if (rest === "/git/refs" && method === "POST") {
    const { ref: full_ref, sha } = body();
    if (!made.has(sha)) return undefined;
    const name = String(full_ref).replace(/^refs\/heads\//, "");
    if (temps.has(name) || rr.branches.some((x) => x.name === name)) return json({ message: "Reference already exists" }, 422);
    if (name.startsWith("tmp/")) temps.set(name, sha);
    else {
      // The topic branch: its commit joins the history fixtures so the Commits and Branches pages can show it.
      const m = made.get(sha)!;
      const parent = rr.bySha.get(m.parents[0]);
      const c: FCommit = { idx: rr.commits.length, sha, title: m.message.split("\n")[0], message: m.message, author: parent?.author ?? { name: "Mock User", login: null }, at: Date.now(), parents: m.parents, pr: null, status: null };
      rr.commits.push(c);
      rr.bySha.set(sha, c);
      rr.branches.push({ name, tip: sha, protected: false, pr: null } as RepoRefs["branches"][number]);
      repoOf(full)?.branches.push(name);
    }
    return json({ ref: full_ref, object: { sha, type: "commit" } }, 201);
  }

  if (rest === "/merges" && method === "POST") {
    const { base, head } = body();
    const tip = temps.get(base);
    if (!tip) return undefined;
    if (sc === "cherryPickConflict") return json({ message: "Merge conflict" }, 409);
    const sha = newSha();
    const tree = `${TREE}${sha.slice(3, 20)}${"e".repeat(20)}`;
    made.set(sha, { sha, tree, parents: [tip, head], message: "Temporary merge" });
    temps.set(base, sha);
    return json({ sha, commit: { tree: { sha: tree }, message: "Temporary merge" }, parents: [{ sha: tip }, { sha: head }] }, 201);
  }

  const del = /^\/git\/refs\/heads\/(tmp\/.+)$/.exec(rest);
  if (del && method === "DELETE") {
    const name = del[1].split("/").map(decodeURIComponent).join("/");
    return temps.delete(name) ? new Response(null, { status: 204 }) : json({ message: "Reference does not exist" }, 422);
  }
  return undefined;
}

// __TN_MOCK__ Forks of the mock repository (batch H): the list, the cross-repository compares, the forks' own branches, creating a fork and
// the viewer's organisations. Scenarios: "forkDenied" (the GitHub App may not create the repository), "noForks".
import { PR_REPO, ME } from "./fixtures/prs";

const DAY = 86400e3;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const avatar = (c: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="16" fill="#${c}"/></svg>`)}`;

interface MockFork { owner: string; name: string; type: "User" | "Organization"; daysAgo: number; ahead: number; behind: number; private?: boolean; branches: string[]; color: string }
const FORKS: MockFork[] = [
  { owner: "contributor", name: "github-repos", type: "User", daysAgo: 2, ahead: 3, behind: 1, branches: ["main", "fix/typo-in-readme", "feature/dark-mode"], color: "8764b8" },
  { owner: "acme-labs", name: "github-repos", type: "Organization", daysAgo: 40, ahead: 0, behind: 27, branches: ["main", "acme/customisations"], color: "038387" },
  { owner: "sam-dev", name: "gh-repos-experiment", type: "User", daysAgo: 400, ahead: 12, behind: 140, private: true, branches: ["main"], color: "ca5010" },
];
const made: MockFork[] = [];
const all = () => [...made, ...FORKS];

const restRepo = (f: MockFork) => ({
  id: 7000 + all().indexOf(f), node_id: `R_fork_${f.owner}`, name: f.name, full_name: `${f.owner}/${f.name}`, private: !!f.private, fork: true,
  owner: { login: f.owner, type: f.type, avatar_url: avatar(f.color) }, html_url: `https://github.com/${f.owner}/${f.name}`,
  default_branch: "main", pushed_at: new Date(Date.now() - f.daysAgo * DAY).toISOString(), parent: { full_name: PR_REPO },
});

/** Commits of a fork's branch ahead of the parent, oldest first, in REST compare's shape. */
const commits = (f: MockFork, branch: string) =>
  Array.from({ length: branch === "main" ? f.ahead : 2 }, (_, i) => ({
    sha: (f.owner.length.toString(16) + i.toString(16)).padEnd(4, "f") + "f0" + String(i).padStart(34, "0"),
    commit: { message: i === 0 ? `${branch === "main" ? "Tidy" : "Start"} ${branch.split("/").pop()!.replace(/-/g, " ")}\n\nFrom the ${f.owner} fork.` : `Follow-up ${i}` },
  }));

/** Answers for fork requests, or undefined to fall through to the other mocks. */
export function forksRest(u: URL, init: RequestInit | undefined, sc: string): Response | undefined {
  const method = init?.method ?? "GET";
  if (u.pathname === "/user/orgs") return json([{ login: "truenorthit" }, { login: "acme-labs" }]);
  const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(u.pathname);
  if (!m) return undefined;
  const full = `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`;
  const rest = m[3] ?? "";
  if (full.toLowerCase() === PR_REPO) {
    if (rest === "/forks" && method === "GET") return json(sc === "noForks" ? [] : all().map(restRepo));
    if (rest === "/forks" && method === "POST") {
      if (sc === "forkDenied") return json({ message: "Resource not accessible by integration" }, 403);
      const body = JSON.parse(String(init?.body ?? "{}"));
      const f: MockFork = { owner: body.organization ?? ME, name: "github-repos", type: body.organization ? "Organization" : "User", daysAgo: 0, ahead: 0, behind: 0, branches: ["main"], color: "0078d4" };
      if (!all().some((x) => x.owner === f.owner)) made.unshift(f);
      return json(restRepo(f), 202);
    }
    const cmp = /^\/compare\/([^.]+)\.\.\.([^:]+):(.+)$/.exec(rest);
    if (cmp && method === "GET") {
      const f = all().find((x) => x.owner === decodeURIComponent(cmp[2]));
      const branch = cmp[3].split("/").map(decodeURIComponent).join("/");
      if (!f || !f.branches.includes(branch)) return json({ message: "Not Found" }, 404);
      const list = commits(f, branch);
      const ahead = list.length, behind = branch === "main" ? f.behind : 1;
      return json({ status: ahead && behind ? "diverged" : ahead ? "ahead" : behind ? "behind" : "identical", ahead_by: ahead, behind_by: behind, total_commits: ahead, commits: u.searchParams.get("per_page") === "1" ? list.slice(-1) : list, files: [] });
    }
    if (rest === "/pulls" && u.searchParams.has("head")) return json([]);
    return undefined;
  }
  const f = all().find((x) => `${x.owner}/${x.name}`.toLowerCase() === full.toLowerCase());
  if (!f) return undefined;
  if (!rest) return json(restRepo(f));
  if (rest === "/branches") return json(f.branches.map((name) => ({ name })));
  return json({ message: "Not Found" }, 404);
}

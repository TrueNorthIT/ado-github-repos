// __TN_MOCK__ REST answers the dashboard widgets need and nothing else asks for: GET /user and the open pull request list
// (GET /repos/{repo}/pulls?state=open), built from the PR fixtures. Workflow runs come from actionsMock.ts.
import { ME, PRS, PR_REPO, avatar } from "./fixtures/prs";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const user = (login: string) => ({ login, id: 1, avatar_url: avatar(login), type: "User" });

export function widgetRest(u: URL, init: RequestInit | undefined, sc: string): Response | undefined {
  if ((init?.method ?? "GET") !== "GET") return undefined;
  if (u.pathname === "/user") return json(user(ME));
  const m = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/.exec(u.pathname);
  if (!m || u.searchParams.get("state") !== "open") return undefined;
  if (`${m[1]}/${m[2]}`.toLowerCase() !== PR_REPO) return json([]);
  if (sc === "noAccess") return json({ message: "Not Found" }, 404);
  const per = Number(u.searchParams.get("per_page") || 30);
  const open = PRS.filter((p) => p.node.state === "OPEN").sort((a, b) => Date.parse(b.node.createdAt) - Date.parse(a.node.createdAt));
  return json(
    open.slice(0, per).map((p, i) => ({
      number: p.node.number,
      title: p.node.title,
      draft: p.node.isDraft,
      user: p.node.author ? user(p.node.author.login) : null,
      created_at: p.node.createdAt,
      base: { ref: p.node.baseRefName },
      requested_reviewers: p.reviewRequested.map(user),
      assignees: i === 4 ? [user(ME)] : [],
    })),
    200,
    open.length > per ? { link: `<https://api.github.com${u.pathname}?state=open&per_page=${per}&page=2>; rel="next"` } : {}
  );
}

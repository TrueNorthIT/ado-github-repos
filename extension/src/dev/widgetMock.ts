// __TN_MOCK__ REST answers the dashboard widgets need and nothing else asks for: GET /user and the open pull request list
// (GET /repos/{repo}/pulls?state=open), built from the PR fixtures. Workflow runs come from actionsMock.ts.
import { ME, PRS, PR_REPO, avatar } from "./fixtures/prs";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const user = (login: string) => ({ login, id: 1, avatar_url: avatar(login), type: "User" });

export function widgetRest(u: URL, init: RequestInit | undefined, sc: string): Response | undefined {
  if ((init?.method ?? "GET") !== "GET") return undefined;
  if (u.pathname === "/user") return json(user(ME));
  if (u.pathname === "/search/issues") return mySearch(u.searchParams.get("q") ?? ""); // the My work flyout's GitHub tab
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

/** GET /search/issues for the My work tab: the fixture's open pull requests by the mock user, or awaiting their review. */
function mySearch(q: string): Response {
  const mine = /\bauthor:@me\b/.test(q), review = /\breview-requested:@me\b/.test(q);
  const hits = PRS.filter((p) => p.node.state === "OPEN" && ((mine && p.node.author?.login === ME) || (review && p.reviewRequested.includes(ME))));
  // Two more: one in customer-portal, which two projects connect (the tab asks which), and one in a repository no project connects (left out).
  const extra = [
    ...(review ? [{ repo: "truenorthit/customer-portal", number: 41, title: "Show the account balance on the dashboard", author: "carol", draft: false }] : []),
    ...(mine ? [{ repo: "someone-else/unconnected", number: 7, title: "This repository is not connected to any project", author: ME, draft: false }] : []),
  ].map((x) => ({
    number: x.number, title: x.title, html_url: `https://github.com/${x.repo}/pull/${x.number}`, repository_url: `https://api.github.com/repos/${x.repo}`,
    pull_request: {}, draft: x.draft, user: user(x.author), created_at: new Date(Date.now() - 9 * 3600e3).toISOString(), updated_at: new Date(Date.now() - 4 * 3600e3).toISOString(),
  }));
  return json({
    total_count: hits.length + extra.length,
    incomplete_results: false,
    items: [...extra, ...hits.map((p) => ({
      number: p.node.number,
      title: p.node.title,
      html_url: p.node.url,
      repository_url: `https://api.github.com/repos/${PR_REPO}`,
      pull_request: { html_url: p.node.url },
      draft: p.node.isDraft,
      user: p.node.author ? user(p.node.author.login) : null,
      created_at: p.node.createdAt,
      updated_at: p.node.updatedAt,
    }))],
  });
}

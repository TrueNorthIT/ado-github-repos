// __TN_MOCK__ Hover cards: GET /users/{login}, GET /orgs/{org}/members/{login}, and GET /repos/{repo}/pulls/{n} with its /reviews for the
// PR fixtures. A merged PR's GET /pulls/{n} is cherryPickMock's (it needs the merge commit), which spreads restPull() in.
// ?scenario=hoverFails makes the profile and pull request lookups fail, for the cards' quiet error line.
import { PRS, PR_REPO, avatar, type FixturePr } from "./fixtures/prs";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const PROFILES: Record<string, { name?: string; bio?: string; company?: string; location?: string }> = {
  ann: { name: "Ann Author", bio: "Builds the sync pipeline. Tea, then code.", company: "@truenorthit", location: "Leeds, UK" },
  "bob-dev": { location: "Remote" },
  carol: { name: "Carol Commit", company: "TrueNorth IT", location: "Manchester, UK" },
  "mock-user": { name: "Mock User", bio: "The signed-in mock user.", company: "@truenorthit" },
  dave: { name: "Dave Developer", bio: "Front end and accessibility.", location: "Bristol, UK" },
};
/** Members of the fixture repos' org; anyone else is an outside collaborator. */
const MEMBERS = new Set(["ann", "carol", "mock-user", "dave"]);

const user = (login: string) => ({ login, id: 1, avatar_url: avatar(login), html_url: `https://github.com/${login}`, type: login.endsWith("[bot]") ? "Bot" : "User" });

/** A REST pull request for a fixture PR (the fields the hover card reads). */
export function restPull(p: FixturePr) {
  const n = p.node;
  return {
    number: n.number,
    title: n.title,
    html_url: n.url,
    state: n.state === "OPEN" ? "open" : "closed",
    draft: n.isDraft,
    merged: n.state === "MERGED",
    merged_at: n.mergedAt ?? null,
    user: n.author ? user(n.author.login) : null,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
    head: { ref: n.headRefName, label: `truenorthit:${n.headRefName}`, repo: { full_name: PR_REPO } },
    base: { ref: n.baseRefName ?? "main", label: `truenorthit:${n.baseRefName ?? "main"}`, repo: { full_name: PR_REPO } },
    requested_reviewers: p.reviewRequested.map(user),
    requested_teams: [],
  };
}

/** A spread of review outcomes picked by number: approvals, a change request, a comment. */
function reviews(n: number) {
  const r = (login: string, state: string) => ({ user: user(login), state });
  const out = [];
  if (n % 2 === 0) out.push(r("carol", "APPROVED"));
  if (n % 3 === 0) out.push(r("dave", "COMMENTED"), r("dave", "APPROVED"));
  if (n % 5 === 1) out.push(r("ann", "CHANGES_REQUESTED"));
  if (n % 7 === 2) out.push(r("bob-dev", "COMMENTED"));
  return out;
}

export function hoverRest(u: URL, init: RequestInit | undefined, sc: string): Response | undefined {
  if ((init?.method ?? "GET") !== "GET") return undefined;
  const fail = sc === "hoverFails";
  const who = /^\/users\/([^/]+)$/.exec(u.pathname);
  if (who) {
    if (fail) return json({ message: "Server Error" }, 500);
    const login = decodeURIComponent(who[1]);
    const p = PROFILES[login.toLowerCase()] ?? {};
    return json({ ...user(login), name: p.name ?? null, bio: p.bio ?? null, company: p.company ?? null, location: p.location ?? null });
  }
  const member = /^\/orgs\/([^/]+)\/members\/([^/]+)$/.exec(u.pathname);
  if (member) return new Response(null, { status: MEMBERS.has(decodeURIComponent(member[2]).toLowerCase()) ? 204 : 404 });
  const pull = /^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)(\/reviews)?$/.exec(u.pathname);
  if (pull && decodeURIComponent(pull[1]).toLowerCase() === PR_REPO) {
    const p = PRS.find((x) => x.node.number === Number(pull[2]));
    if (!p) return undefined;
    if (fail) return json({ message: "Server Error" }, 500);
    if (pull[3]) return json(reviews(p.node.number));
    return p.node.state === "MERGED" ? undefined : json(restPull(p));
  }
  return undefined;
}

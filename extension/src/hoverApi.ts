// Hover cards' GitHub lookups, all REST (so they work in cloud live mode) and cached for the session. A failure is dropped from the
// cache, so the next hover tries again.
import { rest, restJson } from "./githubBrowse";
import { toPullCard, toUserCard, type PullCard, type UserCard } from "./lib/hoverCard";

function cached<T>(m: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = m.get(key);
  if (!p) {
    p = load();
    p.catch(() => m.delete(key));
    m.set(key, p);
  }
  return p;
}

const users = new Map<string, Promise<UserCard>>();
/** GET /users/{login}: name, bio, company, location. */
export const getUserCard = (login: string): Promise<UserCard> =>
  cached(users, login.toLowerCase(), async () => toUserCard(login, (await restJson({ method: "GET", path: `/users/${encodeURIComponent(login)}` })).body));

const members = new Map<string, Promise<boolean>>();
/** GET /orgs/{org}/members/{login}: 204 for a member. The role (admin or member) needs /orgs/{org}/memberships, which asks for more
 *  than the app has, so the card only says "Member of". A user-owned repo (no org) and any refusal answer false. */
export const isOrgMember = (org: string, login: string): Promise<boolean> =>
  cached(members, `${org}/${login}`.toLowerCase(), () => rest({ method: "GET", path: `/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(login)}` }).then(() => true, () => false));

const pulls = new Map<string, Promise<PullCard>>();
/** GET /repos/{o}/{r}/pulls/{n} and its reviews (first 100, enough for the counts). */
export const getPullCard = (repo: string, number: number): Promise<PullCard> =>
  cached(pulls, `${repo}#${number}`.toLowerCase(), async () => {
    const [p, r] = await Promise.all([
      restJson({ method: "GET", path: `/repos/${repo}/pulls/${number}` }),
      restJson({ method: "GET", path: `/repos/${repo}/pulls/${number}/reviews?per_page=100` }).then((x) => x.body, () => []),
    ]);
    return toPullCard(p.body, r);
  });

// Pushes page logic: activity URL, rows, grouping by local date, titles and expansion (C-4).
// Live finding (cli/cli, 2026-11-02): GET /repos/{o}/{r}/activity takes ONE activity_type. `push,force_push` is not a value;
// GitHub ignores it and returns everything. Pushes made by merging a PR arrive as `pr_merge`, and a new branch as `branch_creation`.
// So pushesPath sends no activity_type and isPushActivity filters the page instead.
import type { GraphQlRequest } from "./prQuery";
import type { Person } from "./commitsQuery";

/** `before` of a branch creation. */
export const ZERO_SHA = "0000000000000000000000000000000000000000";

/** One entry of the REST activity list. */
export interface RestActivity {
  before: string;
  after: string;
  /** "push" | "force_push" | "pr_merge" | "merge_queue_merge" | "branch_creation" | "branch_deletion". */
  activity_type: string;
  timestamp: string;
  actor: { login: string; avatar_url: string } | null;
}

export interface PushRow {
  before: string;
  after: string;
  /** First 8 characters of `after`. */
  shortAfter: string;
  /** null actor becomes the ghost (name and login "ghost", ghost avatar). */
  actor: Person;
  date: Date;
  /** activity_type is force_push. A flag for the UI: the title is not changed. */
  forced: boolean;
  /** before is ZERO_SHA: the push created the branch. */
  created: boolean;
}

export interface PushGroup {
  /** The formatted day, e.g. "02/11/2026". */
  day: string;
  /** `${day} (${n} updates)`. */
  header: string;
  /** Newest first. */
  pushes: PushRow[];
}

/** Commit facts a push title needs, looked up from the push's `after` oid. */
export interface PushHead {
  sha: string;
  headline: string;
  /** The associated MERGED PR whose merge commit is `sha`, else null. */
  pullRequest: { number: number; title: string } | null;
  /** The commit's check rollup. Absent (not null) when the commit has no checks. */
  status?: CheckStatus;
}

export type PushExpansion = { kind: "compare"; path: string } | { kind: "single"; sha: string };

import { GHOST_AVATAR, mapCheckState, type CheckStatus } from "./commitsQuery";
import { comparePath } from "./commitDetail";
import { isPushPeriod } from "./pushesHash";

const pad = (n: number) => String(n).padStart(2, "0");

/** `dd/MM/yyyy` in the machine's local time zone. */
export function formatLocalDay(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** `after` is the cursor from the previous page's Link rel="next"; `actor` filters server-side by login (live: GitHub honours it, exact login);
 *  `period` is the activity API's `time_period` (day, week, month, quarter, year), anything else is left out. */
export function pushesPath(repo: string, branch: string, perPage = 30, opts: { after?: string; actor?: string; period?: string } = {}): string {
  const actor = opts.actor?.trim();
  const period = isPushPeriod(opts.period) ? `&time_period=${opts.period}` : "";
  return `/repos/${repo}/activity?ref=${encodeURIComponent("refs/heads/" + branch)}&per_page=${perPage}${opts.after ? `&after=${encodeURIComponent(opts.after)}` : ""}${actor ? `&actor=${encodeURIComponent(actor)}` : ""}${period}`;
}

/** The `after` cursor of a Link header's rel="next" entry, or undefined on the last page. */
export function nextActivityCursor(link: string | null | undefined): string | undefined {
  const next = /<([^>]+)>\s*;\s*rel="next"/.exec(link ?? "");
  const after = next && new URL(next[1]).searchParams.get("after");
  return after || undefined;
}

export function isPushActivity(activityType: string): boolean {
  return activityType !== "branch_deletion";
}

export function mapActivity(a: RestActivity): PushRow {
  return {
    before: a.before,
    after: a.after,
    shortAfter: a.after.slice(0, 8),
    actor: a.actor ? { name: a.actor.login, login: a.actor.login, avatarUrl: a.actor.avatar_url } : { name: "ghost", login: "ghost", avatarUrl: GHOST_AVATAR },
    date: new Date(a.timestamp),
    forced: a.activity_type === "force_push",
    created: a.before === ZERO_SHA,
  };
}

export function groupPushesByDate(pushes: PushRow[], formatDay: (d: Date) => string = formatLocalDay): PushGroup[] {
  const sorted = [...pushes].sort((x, y) => y.date.getTime() - x.date.getTime());
  const groups = new Map<string, PushRow[]>();
  for (const p of sorted) {
    const day = formatDay(p.date);
    (groups.get(day) ?? groups.set(day, []).get(day)!).push(p);
  }
  return [...groups].map(([day, list]) => ({ day, header: `${day} (${list.length} updates)`, pushes: list }));
}

export function pushHeadsQuery(p: { owner: string; name: string; shas: string[] }): GraphQlRequest & { aliases: Record<string, string> } {
  const variables: Record<string, unknown> = { owner: p.owner, name: p.name };
  const aliases: Record<string, string> = {};
  p.shas.forEach((sha, i) => ((variables["o" + i] = sha), (aliases["c" + i] = sha)));
  const decl = p.shas.map((_, i) => `,$o${i}: GitObjectID!`).join("");
  const fields = p.shas
    .map((_, i) => `c${i}: object(oid: $o${i}) { ... on Commit { oid messageHeadline statusCheckRollup { state } associatedPullRequests(first: 5) { nodes { number title state mergeCommit { oid } } } } }`)
    .join(" ");
  return { query: `query($owner: String!, $name: String!${decl}) { repository(owner: $owner, name: $name) { ${fields} } }`, variables, aliases };
}

export function mapPushHeads(body: any, aliases: Record<string, string>): Record<string, PushHead> {
  const repo = body?.data?.repository ?? {};
  const out: Record<string, PushHead> = {};
  for (const [alias, oid] of Object.entries(aliases)) {
    const n = repo[alias];
    if (!n) continue;
    const pr = (n.associatedPullRequests?.nodes ?? []).find((x: any) => x.state === "MERGED" && x.mergeCommit?.oid === oid);
    const status = mapCheckState(n.statusCheckRollup?.state);
    out[oid] = { sha: oid, headline: n.messageHeadline, pullRequest: pr ? { number: pr.number, title: pr.title } : null, ...(status && { status }) };
  }
  return out;
}

export function pushTitle(push: PushRow, head: PushHead): string {
  return head.pullRequest ? `Pull Request ${head.pullRequest.number}: ${head.pullRequest.title}` : `Updated to ${push.shortAfter}: ${head.headline}`;
}

export function pushExpansion(repo: string, push: PushRow): PushExpansion {
  return push.created ? { kind: "single", sha: push.after } : { kind: "compare", path: comparePath(repo, push.before, push.after) };
}

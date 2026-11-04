// Hover cards (people, pull requests, work items): the open/close timing as a pure state machine, and the mapping of each
// REST answer onto what a card shows. The React side is src/HoverCard.tsx.
import type { PrStatus } from "./prModel";

// ---------- timing ----------

/** How long the pointer (or keyboard focus) rests on an anchor before its card opens, as GitHub's and ADO's persona cards. */
export const OPEN_DELAY = 500;
/** Grace period after leaving the anchor, so the pointer can cross the gap onto the card. */
export const CLOSE_DELAY = 300;

export type HoverPhase = "idle" | "opening" | "open" | "closing";
export type HoverEvent = "anchorEnter" | "anchorLeave" | "cardEnter" | "cardLeave" | "focus" | "blur" | "timer" | "escape" | "dismiss";
/** `timer`: start a timer of that many ms (replacing any running one), "clear" it, or "keep" whatever is running. */
export interface HoverStep { phase: HoverPhase; timer: number | "clear" | "keep" }

const enter = (e: HoverEvent) => e === "anchorEnter" || e === "cardEnter" || e === "focus";
const leave = (e: HoverEvent) => e === "anchorLeave" || e === "cardLeave" || e === "blur";

/** One transition. The card is mounted while the phase is "open" or "closing". */
export function hoverStep(phase: HoverPhase, ev: HoverEvent): HoverStep {
  if (ev === "escape" || ev === "dismiss") return { phase: "idle", timer: "clear" };
  switch (phase) {
    case "idle":
      return ev === "anchorEnter" || ev === "focus" ? { phase: "opening", timer: OPEN_DELAY } : { phase, timer: "keep" };
    case "opening":
      if (ev === "timer") return { phase: "open", timer: "clear" };
      if (leave(ev)) return { phase: "idle", timer: "clear" };
      return { phase, timer: "keep" };
    case "open":
      return leave(ev) ? { phase: "closing", timer: CLOSE_DELAY } : { phase, timer: "keep" };
    case "closing":
      if (ev === "timer") return { phase: "idle", timer: "clear" };
      if (enter(ev)) return { phase: "open", timer: "clear" };
      return { phase, timer: "keep" };
  }
}

export const isShown = (p: HoverPhase) => p === "open" || p === "closing";

// ---------- people (GET /users/{login}) ----------

export interface UserCard {
  login: string;
  name?: string;
  avatarUrl?: string;
  bio?: string;
  company?: string;
  location?: string;
  htmlUrl: string;
  /** "Bot" for app accounts, "Organization" for orgs; people are "User". */
  type?: string;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function toUserCard(login: string, u: Record<string, unknown> | null | undefined): UserCard {
  return {
    login: str(u?.login) ?? login,
    name: str(u?.name),
    avatarUrl: str(u?.avatar_url),
    bio: str(u?.bio),
    company: str(u?.company),
    location: str(u?.location),
    htmlUrl: str(u?.html_url) ?? `https://github.com/${encodeURIComponent(login)}`,
    type: str(u?.type),
  };
}

/** GitHub logins are alphanumerics and single hyphens (bots end in "[bot]"); anything else gets no card and no request. */
export const isLogin = (s: string | null | undefined): s is string => !!s && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/.test(s) && s !== "ghost";

// ---------- pull requests (GET /repos/{o}/{r}/pulls/{n} and its /reviews) ----------

export interface PullCard {
  number: number;
  title: string;
  status: PrStatus;
  author?: { login: string; avatarUrl?: string };
  source: string;
  target: string;
  created?: string;
  updated?: string;
  htmlUrl?: string;
  reviews: ReviewCounts;
}

export interface ReviewCounts { approved: number; changes: number; commented: number; waiting: number }

// ADO's words and colours, as the PR page's status pill (PrPage.tsx STATUS).
export const PR_STATUS_PILL: Record<PrStatus, { text: string; color?: { red: number; green: number; blue: number } }> = {
  active: { text: "Active", color: { red: 0, green: 120, blue: 212 } },
  draft: { text: "Draft" },
  completed: { text: "Completed", color: { red: 16, green: 124, blue: 16 } },
  abandoned: { text: "Abandoned", color: { red: 96, green: 94, blue: 92 } },
};

export function restPrStatus(p: { state?: unknown; draft?: unknown; merged?: unknown; merged_at?: unknown }): PrStatus {
  if (p.merged === true || (typeof p.merged_at === "string" && p.merged_at)) return "completed";
  if (p.state === "closed") return "abandoned";
  return p.draft === true ? "draft" : "active";
}

type RawReview = { user?: { login?: string } | null; state?: string } | null;

/** Each reviewer's latest deciding review (a later comment doesn't undo an approval, as on GitHub), plus reviews still requested. */
export function reviewCounts(reviews: RawReview[] | null | undefined, requested: number): ReviewCounts {
  const latest = new Map<string, string>();
  const commented = new Set<string>();
  for (const r of reviews ?? []) {
    const who = r?.user?.login;
    if (!who || !r?.state) continue;
    if (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED") latest.set(who, r.state);
    else if (r.state === "DISMISSED") latest.delete(who);
    else if (r.state === "COMMENTED") commented.add(who);
  }
  const v = [...latest.values()];
  return {
    approved: v.filter((s) => s === "APPROVED").length,
    changes: v.filter((s) => s === "CHANGES_REQUESTED").length,
    commented: [...commented].filter((w) => !latest.has(w)).length,
    waiting: requested,
  };
}

export function toPullCard(p: Record<string, any>, reviews: RawReview[] | null | undefined): PullCard {
  const requested = (Array.isArray(p.requested_reviewers) ? p.requested_reviewers.length : 0) + (Array.isArray(p.requested_teams) ? p.requested_teams.length : 0);
  return {
    number: Number(p.number),
    title: str(p.title) ?? `#${p.number}`,
    status: restPrStatus(p),
    author: str(p.user?.login) ? { login: p.user.login, avatarUrl: str(p.user.avatar_url) } : undefined,
    // A fork's branch reads "owner:branch", as on GitHub.
    source: (p.head?.repo && p.base?.repo && p.head.repo.full_name !== p.base.repo.full_name ? str(p.head.label) : undefined) ?? str(p.head?.ref) ?? "",
    target: str(p.base?.ref) ?? "",
    created: str(p.created_at),
    updated: str(p.updated_at),
    htmlUrl: str(p.html_url),
    reviews: reviewCounts(reviews, requested),
  };
}

/** "2 approved · 1 waiting": the non-zero counts, or undefined when there are none. */
export function reviewSummary(r: ReviewCounts): string | undefined {
  const parts = [
    r.approved && `${r.approved} approved`,
    r.changes && `${r.changes} requested changes`,
    r.commented && `${r.commented} commented`,
    r.waiting && `${r.waiting} waiting`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

// ---------- work items (ADO GET _apis/wit/workitems/{id}) ----------

export interface WorkItemCard {
  id: number;
  title?: string;
  type?: string;
  state?: string;
  assignedTo?: { name: string; imageUrl?: string };
  area?: string;
  iteration?: string;
}

export const WORK_ITEM_CARD_FIELDS = ["System.Title", "System.WorkItemType", "System.State", "System.AssignedTo", "System.AreaPath", "System.IterationPath"];

export const workItemCardUrl = (org: string, id: number) =>
  `https://dev.azure.com/${encodeURIComponent(org)}/_apis/wit/workitems?ids=${id}&fields=${WORK_ITEM_CARD_FIELDS.join(",")}&errorPolicy=omit&api-version=7.1`;

/** The batch answer's one item, or null when ADO left it out (missing, or no access). AssignedTo is an identity ref object. */
export function toWorkItemCard(id: number, body: { value?: ({ id: number; fields?: Record<string, unknown> } | null)[] } | null | undefined): WorkItemCard | null {
  const w = (body?.value ?? []).find((x) => x?.id === id);
  if (!w) return null;
  const f = w.fields ?? {};
  const who = f["System.AssignedTo"] as { displayName?: unknown; imageUrl?: unknown; _links?: { avatar?: { href?: unknown } } } | string | undefined;
  const assignedTo = typeof who === "string" ? (str(who) ? { name: who.replace(/\s*<[^>]*>$/, "") } : undefined)
    : who && str(who.displayName) ? { name: str(who.displayName)!, imageUrl: str(who._links?.avatar?.href) ?? str(who.imageUrl) } : undefined;
  return { id, title: str(f["System.Title"]), type: str(f["System.WorkItemType"]), state: str(f["System.State"]), assignedTo, area: str(f["System.AreaPath"]), iteration: str(f["System.IterationPath"]) };
}

// ---------- pull request links in rendered markdown ----------

/** The number of a link to a pull request in `repo` (https://github.com/{repo}/pull/{n}, any tab or anchor after it), else null.
 *  Links to other repos get no card: the live guard and the app's installation only cover the page's repo. */
export function prLinkNumber(href: string, repo: string): number | null {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#]|$)/i.exec(href);
  return m && m[1].toLowerCase() === repo.toLowerCase() ? Number(m[2]) : null;
}

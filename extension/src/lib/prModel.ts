// Maps GitHub GraphQL pull request nodes to view models (PR-2, PR-4, PR-5, PR-6, PR-9).
import { shortSha } from "./commits";
import { relativeTime } from "./tokens";
import { findWorkItemIds } from "./workItems";

export interface GhActor {
  login: string;
  avatarUrl?: string;
  /** Display name (User only). */
  name?: string | null;
}

export interface PrListNode {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string | null;
  closedAt?: string | null;
  baseRefName: string;
  /** null when the account was deleted (GitHub shows "ghost"). */
  author?: GhActor | null;
  labels?: { nodes?: { name: string; color: string }[] } | null;
  /** nodes must cover every thread for `resolved` to be exact (the query asks for the first 100). */
  reviewThreads?: { totalCount: number; nodes?: { isResolved: boolean }[] } | null;
  comments?: { totalCount: number } | null;
}

export interface PrDetailNode extends PrListNode {
  body?: string | null;
  /** GitHub-rendered HTML of `body`; untrusted, goes through prepareMarkdownHtml. */
  bodyHTML?: string | null;
  headRefOid?: string;
  baseRefOid?: string;
  headRefName: string;
  /** MERGEABLE | CONFLICTING | UNKNOWN. */
  mergeable?: string | null;
  /** Rollup for the head commit (the detail query must alias it to this top-level field). */
  statusCheckRollup?: { state: string } | null;
  reviewRequests?: { nodes?: { requestedReviewer?: { login?: string; avatarUrl?: string } | null }[] } | null;
  reviews?: {
    nodes?: { author?: GhActor | null; state: string; submittedAt?: string | null }[];
  } | null;
  commits?: {
    nodes?: {
      commit: {
        oid: string;
        /** Full message; the title is its first line. */
        message: string;
        authoredDate: string;
        author?: { name?: string | null; avatarUrl?: string | null; user?: { login?: string | null } | null } | null;
      };
    }[];
  } | null;
}

export type PrStatus = "active" | "draft" | "completed" | "abandoned";
export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING";
export type ChecksSummary = "SUCCESS" | "FAILURE" | "PENDING" | "NONE";
export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export interface PrLabel {
  name: string;
  /** Hex without "#", as GitHub returns it. */
  color: string;
}

export interface PrListRow {
  number: number;
  title: string;
  url: string;
  authorLogin: string;
  authorName?: string;
  avatarUrl: string;
  baseRef: string;
  labels: PrLabel[];
  isDraft: boolean;
  status: PrStatus;
  comments: {
    total: number;
    resolved: number;
    /** resolved < total, i.e. some thread is unresolved. Always false in the no-threads fallback. */
    active: boolean;
    /** true when total/resolved count review threads; false when total is the plain comment count. */
    threaded: boolean;
  };
  dateVerb: "Created" | "Updated" | "Completed" | "Abandoned";
  date: Date;
  /** The PR's own updatedAt (ISO), for "updated since you viewed" (VW-9). */
  updatedAt: string;
  /** `${dateVerb} ${relativeTime(date, now)}` using tokens.ts relativeTime, e.g. "Created 3 hours ago". */
  dateText: string;
}

export interface PrReviewer {
  login: string;
  avatarUrl?: string;
  state: ReviewState;
}

export interface PrCommit {
  sha: string;
  /** First 8 characters (commits.ts shortSha). */
  shortSha: string;
  /** First line of the message. */
  title: string;
  /** Git author name, else the linked login, else "". */
  author: string;
  date: Date;
}

export interface PrDetail {
  number: number;
  title: string;
  url: string;
  status: PrStatus;
  isDraft: boolean;
  authorLogin: string;
  authorName?: string;
  avatarUrl: string;
  baseRef: string;
  headRef: string;
  /** "" when the PR has no description. */
  body: string;
  labels: PrLabel[];
  /** `${resolved}/${total}` review threads, "0/0" when there are none. */
  commentsResolved: string;
  checks: ChecksSummary;
  mergeable: Mergeable;
  reviewers: PrReviewer[];
  commits: PrCommit[];
  /** findWorkItemIds over title, body and every commit message. */
  workItemIds: number[];
  /** The same over title and commit messages only: these stay linked whatever the description says. */
  workItemIdsOutsideBody: number[];
}

const GHOST = "https://github.com/ghost.png";
const MERGEABLE: Mergeable[] = ["MERGEABLE", "CONFLICTING", "UNKNOWN"];
const CHECKS: Record<string, ChecksSummary> = { SUCCESS: "SUCCESS", FAILURE: "FAILURE", ERROR: "FAILURE", PENDING: "PENDING", EXPECTED: "PENDING" };

const statusOf = (n: PrListNode): PrStatus => (n.state === "MERGED" ? "completed" : n.state === "CLOSED" ? "abandoned" : n.isDraft ? "draft" : "active");
const labelsOf = (n: PrListNode): PrLabel[] => (n.labels?.nodes ?? []).map(({ name, color }) => ({ name, color }));

function threadsOf(n: PrListNode) {
  const total = n.reviewThreads?.totalCount ?? 0;
  const resolved = (n.reviewThreads?.nodes ?? []).filter((t) => t.isResolved).length;
  return { total, resolved };
}

/** `now` is epoch milliseconds, as in tokens.ts relativeTime. */
export function toListRow(node: PrListNode, now: number): PrListRow {
  const status = statusOf(node);
  let dateVerb: PrListRow["dateVerb"];
  let iso: string;
  if (status === "completed") [dateVerb, iso] = ["Completed", node.mergedAt ?? node.updatedAt];
  else if (status === "abandoned") [dateVerb, iso] = ["Abandoned", node.closedAt ?? node.updatedAt];
  else if (Date.parse(node.updatedAt) - Date.parse(node.createdAt) <= 60000) [dateVerb, iso] = ["Created", node.createdAt];
  else [dateVerb, iso] = ["Updated", node.updatedAt];
  const { total, resolved } = threadsOf(node);
  const threaded = total > 0;
  const date = new Date(iso);
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    authorLogin: node.author?.login ?? "ghost",
    authorName: node.author?.name || undefined,
    avatarUrl: node.author ? node.author.avatarUrl ?? "" : GHOST,
    baseRef: node.baseRefName,
    labels: labelsOf(node),
    isDraft: node.isDraft,
    status,
    comments: threaded
      ? { total, resolved, active: resolved < total, threaded }
      : { total: node.comments?.totalCount ?? 0, resolved: 0, active: false, threaded },
    dateVerb,
    date,
    updatedAt: node.updatedAt,
    dateText: `${dateVerb} ${relativeTime(iso, now)}`,
  };
}

function reviewersOf(n: PrDetailNode): PrReviewer[] {
  const out = new Map<string, PrReviewer>();
  const author = n.author?.login;
  // Per reviewer: latest decisive (approved / changes requested) review wins; otherwise a plain comment; dismissed reviews do not count.
  const reviews = (n.reviews?.nodes ?? [])
    .filter((r) => r.author && r.author.login !== author && r.submittedAt && r.state !== "DISMISSED" && r.state !== "PENDING")
    .sort((a, b) => Date.parse(a.submittedAt!) - Date.parse(b.submittedAt!));
  for (const r of reviews) {
    const login = r.author!.login;
    const prev = out.get(login);
    const decisive = r.state === "APPROVED" || r.state === "CHANGES_REQUESTED";
    if (prev && !decisive && prev.state !== "COMMENTED") continue;
    out.set(login, { login, avatarUrl: r.author!.avatarUrl, state: r.state as ReviewState });
  }
  // Dismissed-only reviewers are still waiting on a fresh review.
  for (const r of n.reviews?.nodes ?? [])
    if (r.author && r.author.login !== author && r.state === "DISMISSED" && !out.has(r.author.login)) out.set(r.author.login, { login: r.author.login, avatarUrl: r.author.avatarUrl, state: "PENDING" });
  // A (re-)requested review resets the reviewer to pending.
  for (const q of n.reviewRequests?.nodes ?? []) {
    const who = q.requestedReviewer;
    if (who?.login) out.set(who.login, { login: who.login, avatarUrl: who.avatarUrl, state: "PENDING" });
  }
  return [...out.values()];
}

export function toDetail(node: PrDetailNode): PrDetail {
  const row = toListRow(node, 0);
  const commits: PrCommit[] = (node.commits?.nodes ?? []).map(({ commit: c }) => ({
    sha: c.oid,
    shortSha: shortSha(c.oid),
    title: c.message.split(/\r?\n/)[0],
    author: c.author?.name || c.author?.user?.login || "",
    date: new Date(c.authoredDate),
  }));
  const { total, resolved } = threadsOf(node);
  return {
    number: row.number,
    title: row.title,
    url: row.url,
    status: row.status,
    isDraft: row.isDraft,
    authorLogin: row.authorLogin,
    authorName: row.authorName,
    avatarUrl: row.avatarUrl,
    baseRef: row.baseRef,
    headRef: node.headRefName,
    body: node.body ?? "",
    labels: row.labels,
    commentsResolved: `${resolved}/${total}`,
    checks: CHECKS[node.statusCheckRollup?.state ?? ""] ?? "NONE",
    mergeable: MERGEABLE.includes(node.mergeable as Mergeable) ? (node.mergeable as Mergeable) : "UNKNOWN",
    reviewers: reviewersOf(node),
    commits,
    workItemIds: findWorkItemIds(node.title, node.body, ...(node.commits?.nodes ?? []).map((c) => c.commit.message)),
    workItemIdsOutsideBody: findWorkItemIds(node.title, ...(node.commits?.nodes ?? []).map((c) => c.commit.message)),
  };
}

/** What the PR page needs beyond PrDetail. */
export interface PrPageData extends PrDetail {
  bodyHtml: string;
  baseSha: string;
  headSha: string;
  /** Parallel to `commits`: the git author's avatar, "" when GitHub has none. */
  commitAvatars: string[];
}

export function toPrPage(node: PrDetailNode): PrPageData {
  return {
    ...toDetail(node),
    bodyHtml: node.bodyHTML ?? "",
    baseSha: node.baseRefOid ?? "",
    headSha: node.headRefOid ?? "",
    commitAvatars: (node.commits?.nodes ?? []).map((c) => c.commit.author?.avatarUrl ?? ""),
  };
}

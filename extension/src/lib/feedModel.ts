// Maps GitHub PR timeline items and review threads to the activity feed (AF-1, AF-3, AF-4, AF-5).
import type { GhActor, PrListNode } from "./prModel";

/** A timeline node as returned by feedQuery; `__typename` is the GraphQL type name. Unknown types are ignored; null nodes are tolerated. */
export interface TimelineNode {
  __typename: string;
  [field: string]: any;
}

export interface ReviewThreadCommentNode {
  id: string;
  databaseId?: number | null;
  author?: GhActor | null;
  bodyHTML: string;
  body: string;
  createdAt: string;
  url: string;
  replyTo?: { id: string } | null;
  /** The diff hunk the comment sits on: how a suggestion's original lines are recovered. */
  diffHunk?: string;
}

export interface ReviewThreadNode {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  diffSide: "LEFT" | "RIGHT";
  /** FILE for a whole-file comment (no line or side). Absent means LINE. */
  subjectType?: "LINE" | "FILE";
  comments: { nodes: (ReviewThreadCommentNode | null)[] };
}

/** The parts of the PR the feed needs for its "created" event. */
export type FeedPr = Pick<PrListNode, "author" | "createdAt">;

/** One comment, either a top-level PR comment or a message inside a thread. `author` is the login ("ghost" for a deleted account). */
export interface FeedComment {
  id: string;
  author: string;
  avatarUrl: string;
  /** GitHub-rendered HTML; untrusted, goes through prepareMarkdownHtml. */
  html: string;
  date: Date;
  url: string;
  /** Review-thread comments only: the diff hunk it was written on. */
  diffHunk?: string;
}

export interface CommentItem extends FeedComment {
  kind: "comment";
}

export interface ThreadItem {
  kind: "thread";
  id: string;
  status: "active" | "resolved";
  outdated: boolean;
  path: string;
  /** End line of the thread (GitHub's `line`); null when the thread no longer maps onto the current diff. */
  line: number | null;
  startLine: number | null;
  side: "LEFT" | "RIGHT";
  /** Only set for a whole-file thread, which has no line and is not outdated. */
  subjectType?: "FILE";
  /** First comment then replies, chronological. */
  comments: FeedComment[];
  /** Date of the first comment; this is what orders the thread in the feed. */
  date: Date;
  /** Date of the last comment. */
  lastActivity: Date;
}

export type EventType =
  | "created"
  | "pushed"
  | "review_approved"
  | "review_changes_requested"
  | "review_commented"
  | "review_requested"
  | "labelled"
  | "unlabelled"
  | "ready_for_review"
  | "converted_to_draft"
  | "merged"
  | "closed"
  | "reopened"
  | "force_pushed";

export interface FeedEventCommit {
  sha: string;
  /** First line of the message. */
  title: string;
  date: Date;
}

export interface EventItem {
  kind: "event";
  id: string;
  type: EventType;
  /** Login; "ghost" for a deleted account. For "pushed" the commit author. */
  actor: string;
  avatarUrl: string;
  /** For "pushed" the date of the last commit in the group. */
  date: Date;
  /** pushed: number of commits in the group. */
  count?: number;
  /** pushed: the grouped commits, chronological. */
  commits?: FeedEventCommit[];
  /** review_*: rendered review body; absent when the review has no body. */
  html?: string;
  /** review_requested: reviewer login, or team name. */
  reviewer?: string;
  /** labelled / unlabelled. */
  label?: { name: string; color: string };
  /** force_pushed: full commit ids before and after. */
  before?: string | null;
  after?: string | null;
}

export type FeedItem = CommentItem | ThreadItem | EventItem;
export type FeedFilter = "all" | "comments" | "events";
export interface FeedCounts {
  all: number;
  comments: number;
  events: number;
}

const GHOST = "https://github.com/ghost.png";
const who = (a?: GhActor | null) => ({ login: a?.login ?? "ghost", avatarUrl: a?.avatarUrl || GHOST });
const ms = (d: Date) => d.getTime();
const PUSH_WINDOW_MS = 10 * 60 * 1000;

const toComment = (n: ReviewThreadCommentNode | IssueNode): FeedComment => {
  const a = who(n.author);
  return { id: n.id, author: a.login, avatarUrl: a.avatarUrl, html: n.bodyHTML, date: new Date(n.createdAt), url: n.url, ...("diffHunk" in n && n.diffHunk ? { diffHunk: n.diffHunk } : {}) };
};
type IssueNode = Omit<ReviewThreadCommentNode, "replyTo" | "databaseId" | "body" | "diffHunk"> & { body?: string };

const REVIEW_TYPE: Record<string, EventType> = { APPROVED: "review_approved", CHANGES_REQUESTED: "review_changes_requested", COMMENTED: "review_commented", DISMISSED: "review_commented" };
const SIMPLE: Record<string, EventType> = { ReadyForReviewEvent: "ready_for_review", ConvertToDraftEvent: "converted_to_draft", MergedEvent: "merged", ClosedEvent: "closed", ReopenedEvent: "reopened" };

function commitActor(c: any): { login: string; avatarUrl: string } {
  const a = c?.author;
  return { login: a?.user?.login ?? a?.name ?? "ghost", avatarUrl: a?.avatarUrl || GHOST };
}

function toEvent(n: TimelineNode): EventItem | null {
  const base = (type: EventType, date: string) => ({ kind: "event" as const, id: n.id, type, ...(({ login, avatarUrl }) => ({ actor: login, avatarUrl }))(who(n.actor)), date: new Date(date) });
  if (SIMPLE[n.__typename]) return base(SIMPLE[n.__typename], n.createdAt);
  switch (n.__typename) {
    case "PullRequestReview": {
      const type = REVIEW_TYPE[n.state];
      if (!type) return null; // PENDING: not submitted yet
      const a = who(n.author);
      const e: EventItem = { kind: "event", id: n.id, type, actor: a.login, avatarUrl: a.avatarUrl, date: new Date(n.submittedAt ?? n.createdAt) };
      if (n.bodyHTML?.trim() && n.body?.trim()) e.html = n.bodyHTML;
      return e;
    }
    case "ReviewRequestedEvent": {
      const r = n.requestedReviewer;
      return { ...base("review_requested", n.createdAt), reviewer: r?.login ?? r?.name };
    }
    case "LabeledEvent":
      return { ...base("labelled", n.createdAt), label: n.label };
    case "UnlabeledEvent":
      return { ...base("unlabelled", n.createdAt), label: n.label };
    case "HeadRefForcePushedEvent":
      return { ...base("force_pushed", n.createdAt), before: n.beforeCommit?.oid ?? null, after: n.afterCommit?.oid ?? null };
  }
  return null;
}

const nodeDate = (n: TimelineNode): number =>
  Date.parse(n.__typename === "PullRequestCommit" ? n.commit?.committedDate : n.__typename === "PullRequestReview" ? n.submittedAt ?? n.createdAt : n.createdAt);

/** Newest first. `created` always last. `now` is unused: relative times are rendered by the UI. */
export function toFeed(timeline: (TimelineNode | null)[], threads: (ReviewThreadNode | null)[], pr: FeedPr, _now?: number): FeedItem[] {
  const nodes = timeline.filter((n): n is TimelineNode => !!n).filter((n) => !isNaN(nodeDate(n)));
  nodes.sort((a, b) => nodeDate(a) - nodeDate(b));
  const items: FeedItem[] = [];
  let group: TimelineNode[] = [];
  const flush = () => {
    if (!group.length) return;
    const commits = group.map((g) => ({ sha: g.commit.oid as string, title: String(g.commit.messageHeadline ?? g.commit.message ?? "").split(String.fromCharCode(10))[0], date: new Date(g.commit.committedDate) }));
    const a = commitActor(group[0].commit);
    items.push({ kind: "event", id: group[0].id, type: "pushed", actor: a.login, avatarUrl: a.avatarUrl, date: commits[commits.length - 1].date, count: commits.length, commits });
    group = [];
  };
  for (const n of nodes) {
    if (n.__typename === "PullRequestCommit") {
      const last = group[group.length - 1];
      if (last && (commitActor(last.commit).login !== commitActor(n.commit).login || nodeDate(n) - nodeDate(last) > PUSH_WINDOW_MS)) flush();
      group.push(n);
      continue;
    }
    flush();
    if (n.__typename === "IssueComment") items.push({ kind: "comment", ...toComment(n as unknown as IssueNode) });
    else {
      const e = toEvent(n);
      if (e) items.push(e);
    }
  }
  flush();
  for (const t of threads) {
    if (!t) continue;
    const comments = t.comments.nodes.filter((c): c is ReviewThreadCommentNode => !!c).map(toComment).sort((a, b) => ms(a.date) - ms(b.date));
    if (!comments.length) continue;
    items.push({
      kind: "thread", id: t.id, status: t.isResolved ? "resolved" : "active", outdated: t.isOutdated || (t.line == null && t.subjectType !== "FILE"), ...(t.subjectType === "FILE" ? { subjectType: "FILE" as const } : {}),
      path: t.path, line: t.line, startLine: t.startLine, side: t.diffSide, comments, date: comments[0].date, lastActivity: comments[comments.length - 1].date,
    });
  }
  items.sort((a, b) => ms(b.date) - ms(a.date));
  const a = who(pr.author);
  items.push({ kind: "event", id: "created", type: "created", actor: a.login, avatarUrl: a.avatarUrl, date: new Date(pr.createdAt) });
  return items;
}

export function filterFeed(items: FeedItem[], filter: FeedFilter): FeedItem[] {
  return filter === "all" ? items : items.filter((i) => (i.kind === "event") === (filter === "events"));
}

/** `comments` counts comment and thread items (a thread is one, however many replies); `events` is everything else. */
export function counts(items: FeedItem[]): FeedCounts {
  const events = items.filter((i) => i.kind === "event").length;
  return { all: items.length, comments: items.length - events, events };
}

import { describe, it, expect } from "vitest";
import { toFeed, filterFeed, counts, FeedItem, EventItem, ThreadItem, CommentItem, TimelineNode, ReviewThreadNode, FeedPr } from "./feedModel";

// Module under test: src/lib/feedModel.ts (toFeed, filterFeed, counts).
// Inputs are GitHub GraphQL nodes as fetched by feedQuery (src/lib/feedQuery.ts): `timelineItems.nodes` and `reviewThreads.nodes`.
// Output is the feed view model: FeedItem = comment | thread | event, newest first.
// Decisions fixed by these tests, where the requirements were open:
//  - dates are `Date` objects (as PrCommit.date in prModel.ts); `actor` / `author` are logins; a null account becomes "ghost"
//    with avatar https://github.com/ghost.png (as prModel.ts does).
//  - event types: created, pushed, review_approved, review_changes_requested, review_commented, review_requested, labelled,
//    unlabelled, ready_for_review, converted_to_draft, merged, closed, reopened, force_pushed.
//  - a thread is `outdated` when GitHub says isOutdated OR its `line` is null.
//  - a pushed group is a chain: each commit is within 10 minutes (inclusive) of the previous one, by the same author, with no
//    other timeline item between them. The group's date is its last commit; its commits are chronological.
//  - the timeline input is sorted by date by toFeed itself; input order is not trusted.
//  - a pushed event's id is the id of the first commit node in its group.
//  - review state PENDING (unsubmitted) is not covered by a test.
// Every fixture uses invented people (ann, bob, cat) and example.com style URLs.

const GHOST = "https://github.com/ghost.png";
const NOW = Date.parse("2026-06-02T00:00:00Z");
const T0 = "2026-06-01T09:00:00Z";
const at = (hhmm: string, day = "2026-06-01") => `${day}T${hhmm}:00Z`;
const av = (login: string) => `https://avatars.example/${login}.png`;
const user = (login: string) => ({ login, avatarUrl: av(login) });

const pr: FeedPr = { author: user("ann"), createdAt: T0 };

const issueComment = (id: string, login: string | null, when: string, html = `<p>${id}</p>`): TimelineNode => ({
  __typename: "IssueComment",
  id,
  databaseId: 1,
  author: login ? user(login) : null,
  bodyHTML: html,
  body: id,
  createdAt: when,
  url: `https://github.com/acme/web/pull/42#issuecomment-${id}`,
});
const review = (id: string, login: string | null, state: string, when: string, body = "", extra: Partial<TimelineNode> = {}): TimelineNode => ({
  __typename: "PullRequestReview",
  id,
  author: login ? user(login) : null,
  state,
  body,
  bodyHTML: body ? `<p>${body}</p>` : "",
  submittedAt: when,
  createdAt: when,
  url: `https://github.com/acme/web/pull/42#pullrequestreview-${id}`,
  ...extra,
});
const commit = (oid: string, login: string | null, when: string, message = `Change ${oid}`): TimelineNode => ({
  __typename: "PullRequestCommit",
  id: `PRC_${oid}`,
  commit: { oid, message, messageHeadline: message.split("\n")[0], committedDate: when, authoredDate: when, author: { name: login ?? "Unknown", avatarUrl: login ? av(login) : null, user: login ? { login } : null } },
});
const event = (typename: string, id: string, login: string | null, when: string, extra: Record<string, unknown> = {}): TimelineNode => ({
  __typename: typename,
  id,
  actor: login ? user(login) : null,
  createdAt: when,
  ...extra,
});
const tComment = (id: string, login: string | null, when: string, html = `<p>${id}</p>`) => ({
  id,
  databaseId: 10,
  author: login ? user(login) : null,
  bodyHTML: html,
  body: id,
  createdAt: when,
  url: `https://github.com/acme/web/pull/42#discussion_r${id}`,
  replyTo: null,
});
const thread = (id: string, comments: ReturnType<typeof tComment>[], over: Partial<ReviewThreadNode> = {}): ReviewThreadNode => ({
  id,
  isResolved: false,
  isOutdated: false,
  path: "src/app.ts",
  line: 12,
  originalLine: 12,
  startLine: null,
  diffSide: "RIGHT",
  comments: { nodes: comments },
  ...over,
});

const feed = (timeline: (TimelineNode | null)[] = [], threads: (ReviewThreadNode | null)[] = [], p: FeedPr = pr) => toFeed(timeline, threads, p, NOW);
const events = (items: FeedItem[]) => items.filter((i): i is EventItem => i.kind === "event");
const only = <T extends FeedItem>(items: FeedItem[], kind: T["kind"]) => items.filter((i): i is T => i.kind === kind);
const ids = (items: FeedItem[]) => items.map((i) => i.id);

describe("AF-1: the feed is a timeline, newest first", () => {
  // Given comments, a review, a push and a thread, toFeed orders them by date, newest first.
  it("orders comments, threads and events newest first", () => {
    const items = feed(
      [issueComment("c1", "bob", at("10:00")), review("r1", "cat", "APPROVED", at("12:00")), commit("aaa11111", "ann", at("11:00"))],
      [thread("t1", [tComment("tc1", "bob", at("10:30"))])],
    );
    expect(items.map((i) => i.id).slice(0, 4), "Expected review (12:00), push (11:00), thread (10:30), comment (10:00)").toEqual(["r1", "PRC_aaa11111", "t1", "c1"]);
  });

  it("sorts by date even when the timeline arrives out of order", () => {
    const items = feed([issueComment("late", "bob", at("12:00")), issueComment("early", "bob", at("10:00")), issueComment("mid", "bob", at("11:00"))]);
    expect(ids(items).slice(0, 3), "Expected newest first regardless of input order").toEqual(["late", "mid", "early"]);
  });

  // AF-5 "created": from the PR itself, always the oldest item.
  it("ends with a created event from the pull request's author and createdAt", () => {
    const items = feed([issueComment("c1", "bob", at("10:00"))]);
    const last = items[items.length - 1];
    expect(last, "Expected the oldest item to be the created event").toMatchObject({ kind: "event", type: "created", actor: "ann", avatarUrl: av("ann") });
    expect((last as EventItem).date.toISOString(), "Expected created to carry the pull request's createdAt").toBe(new Date(T0).toISOString());
  });

  it("is only the created event for a pull request with no activity", () => {
    const items = feed();
    expect(items, "Expected exactly one item").toHaveLength(1);
    expect(items[0], "Expected a created event").toMatchObject({ kind: "event", type: "created" });
  });

  it("keeps created last even when another item is dated earlier than the pull request", () => {
    const items = feed([issueComment("skew", "bob", at("08:59"))]);
    expect(items[items.length - 1], "Expected created to stay the oldest item").toMatchObject({ kind: "event", type: "created" });
  });

  it("names a deleted pull request author ghost on the created event", () => {
    const items = feed([], [], { author: null, createdAt: T0 });
    expect(items[0], "Expected the ghost account for a null author").toMatchObject({ type: "created", actor: "ghost", avatarUrl: GHOST });
  });
});

describe("AF-3: top-level PR comments (issue comments) are single-comment items", () => {
  // Given an IssueComment node, toFeed returns { kind: "comment", id, author, avatarUrl, html, date, url } and nothing resolvable.
  it("maps an issue comment to a comment item", () => {
    const [item] = feed([issueComment("IC_1", "bob", at("10:00"), "<p>Looks <b>good</b></p>")]);
    expect(item, "Expected a comment item").toMatchObject({
      kind: "comment",
      id: "IC_1",
      author: "bob",
      avatarUrl: av("bob"),
      html: "<p>Looks <b>good</b></p>",
      url: "https://github.com/acme/web/pull/42#issuecomment-IC_1",
    });
    expect((item as CommentItem).date.toISOString(), "Expected the comment's createdAt as its date").toBe(new Date(at("10:00")).toISOString());
  });

  it("shows a deleted commenter as ghost", () => {
    const [item] = feed([issueComment("IC_2", null, at("10:00"))]);
    expect(item, "Expected ghost for a null author").toMatchObject({ kind: "comment", author: "ghost", avatarUrl: GHOST });
  });
});

describe("AF-3 / AF-4: review threads carry their replies and a status", () => {
  const first = tComment("tc1", "bob", at("10:00"), "<p>Rename this</p>");
  const reply = tComment("tc2", "ann", at("10:05"), "<p>Done</p>");
  const reply2 = tComment("tc3", "bob", at("10:20"), "<p>Thanks</p>");

  // Given a review thread, toFeed returns one thread item with the first comment then the replies in chronological order.
  it("maps a thread to one item holding every comment in chronological order", () => {
    const items = feed([], [thread("PRRT_1", [reply2, first, reply])]);
    const threads = only<ThreadItem>(items, "thread");
    expect(threads, "Expected exactly one thread item").toHaveLength(1);
    const t = threads[0];
    expect(t.comments.map((c) => c.id), "Expected the first comment then replies, chronologically, whatever the input order").toEqual(["tc1", "tc2", "tc3"]);
    expect(t.comments[0], "Expected the first comment's author, avatar, html and url").toMatchObject({ author: "bob", avatarUrl: av("bob"), html: "<p>Rename this</p>", url: "https://github.com/acme/web/pull/42#discussion_rtc1" });
  });

  it("maps path, line, start line and side of the thread", () => {
    const [t] = only<ThreadItem>(feed([], [thread("PRRT_1", [first], { path: "src/lib/x.ts", line: 20, startLine: 18, diffSide: "LEFT" })]), "thread");
    expect(t, "Expected path, line (the end line), startLine and side (LEFT = base)").toMatchObject({ id: "PRRT_1", path: "src/lib/x.ts", line: 20, startLine: 18, side: "LEFT" });
  });

  it("dates a thread by its first comment and records the last comment as lastActivity", () => {
    const [t] = only<ThreadItem>(feed([], [thread("PRRT_1", [first, reply, reply2])]), "thread");
    expect(t.date.toISOString(), "Expected thread.date to be the first comment's date").toBe(new Date(at("10:00")).toISOString());
    expect(t.lastActivity.toISOString(), "Expected lastActivity to be the last reply's date").toBe(new Date(at("10:20")).toISOString());
  });

  // A late reply does not move the thread: the feed is ordered by the FIRST comment.
  it("places a thread by its first comment, not by its latest reply", () => {
    const items = feed([issueComment("c-mid", "cat", at("10:10"))], [thread("PRRT_1", [first, reply2])]);
    expect(ids(items).slice(0, 2), "Expected the comment (10:10) above the thread whose first comment is 10:00, despite its 10:20 reply").toEqual(["c-mid", "PRRT_1"]);
  });

  // AF-4
  it.each([
    [false, "active"],
    [true, "resolved"],
  ] as const)("isResolved %s gives status %s", (isResolved, status) => {
    const [t] = only<ThreadItem>(feed([], [thread("PRRT_1", [first], { isResolved })]), "thread");
    expect(t.status, `Expected isResolved=${isResolved} to be shown as ${status}`).toBe(status);
  });

  // AF-6: outdated threads are flagged and still listed.
  it("flags a thread GitHub marks outdated, and still lists it", () => {
    const items = feed([], [thread("PRRT_1", [first], { isOutdated: true })]);
    expect(only<ThreadItem>(items, "thread")[0], "Expected the outdated thread to stay in the feed, flagged").toMatchObject({ id: "PRRT_1", outdated: true });
  });

  it("flags a thread with a null line as outdated, and still lists it", () => {
    const items = feed([], [thread("PRRT_1", [first], { line: null })]);
    expect(only<ThreadItem>(items, "thread")[0], "Expected a thread with no line in the current diff to be flagged outdated").toMatchObject({ id: "PRRT_1", outdated: true, line: null });
  });

  it("does not flag a current thread as outdated", () => {
    const [t] = only<ThreadItem>(feed([], [thread("PRRT_1", [first])]), "thread");
    expect(t.outdated, "Expected a thread with a line and isOutdated=false to be current").toBe(false);
  });

  it("shows a deleted reviewer's thread comment as ghost and skips null comment nodes", () => {
    const [t] = only<ThreadItem>(feed([], [thread("PRRT_1", [tComment("g1", null, at("10:00"))])]), "thread");
    expect(t.comments[0], "Expected ghost for a null author").toMatchObject({ author: "ghost", avatarUrl: GHOST });
    const items = feed([], [thread("PRRT_2", [first]), null], pr);
    expect(only<ThreadItem>(items, "thread"), "Expected a null thread node to be ignored").toHaveLength(1);
  });
});

describe("AF-5: reviews become verdict events and do not duplicate their code comments", () => {
  // Given a PullRequestReview whose code comments are also in reviewThreads, the comments appear once, in the thread.
  it("lists a review's code comments only in their thread", () => {
    const code = tComment("rc1", "cat", at("11:00"), "<p>Nit</p>");
    const items = feed(
      [review("r1", "cat", "COMMENTED", at("11:00"), "", { comments: { nodes: [{ id: "rc1" }] } })],
      [thread("PRRT_1", [code])],
    );
    expect(only<CommentItem>(items, "comment"), "Expected no top-level comment item created from the review's code comment").toHaveLength(0);
    const threads = only<ThreadItem>(items, "thread");
    expect(threads, "Expected one thread").toHaveLength(1);
    expect(threads[0].comments.map((c) => c.id), "Expected the code comment once, inside its thread").toEqual(["rc1"]);
    expect(events(items).map((e) => e.type), "Expected the review itself as one verdict event").toContain("review_commented");
  });

  it.each([
    ["APPROVED", "review_approved"],
    ["CHANGES_REQUESTED", "review_changes_requested"],
    ["COMMENTED", "review_commented"],
  ] as const)("a %s review is a %s event by its author, dated at submission", (state, type) => {
    const [e] = events(feed([review("r1", "bob", state, at("12:00"))]).filter((i) => i.id === "r1"));
    expect(e, `Expected a ${type} event for review r1`).toMatchObject({ kind: "event", type, actor: "bob", avatarUrl: av("bob") });
    expect(e.date.toISOString(), "Expected the review's submittedAt as the event date").toBe(new Date(at("12:00")).toISOString());
  });

  it("shows the review body on the event when it has one", () => {
    const [e] = events(feed([review("r1", "bob", "CHANGES_REQUESTED", at("12:00"), "Please add tests")]).filter((i) => i.id === "r1"));
    expect(e.html, "Expected the review's rendered body on the event").toBe("<p>Please add tests</p>");
  });

  it.each(["", "   \n"])("has no body on the event when the review body is %j", (body) => {
    const node = review("r1", "bob", "APPROVED", at("12:00"), "");
    node.body = body;
    node.bodyHTML = body;
    const [e] = events(feed([node]).filter((i) => i.id === "r1"));
    expect(e.html, "Expected no html for an empty or whitespace-only review body").toBeUndefined();
  });

  it("shows a deleted reviewer as ghost", () => {
    const [e] = events(feed([review("r1", null, "APPROVED", at("12:00"))]).filter((i) => i.id === "r1"));
    expect(e, "Expected ghost for a null review author").toMatchObject({ actor: "ghost", avatarUrl: GHOST });
  });
});

describe("AF-5: consecutive commits by one pusher become one 'pushed N commits' event", () => {
  const pushed = (items: FeedItem[]) => events(items).filter((e) => e.type === "pushed");

  it("groups consecutive commits by the same author within 10 minutes", () => {
    const items = feed([commit("aaa11111", "ann", at("10:00"), "First\n\nbody"), commit("bbb22222", "ann", at("10:04"), "Second"), commit("ccc33333", "ann", at("10:08"), "Third")]);
    const p = pushed(items);
    expect(p, "Expected one pushed event for three quick commits").toHaveLength(1);
    expect(p[0], "Expected the commit count, the author and the last commit's time").toMatchObject({ count: 3, actor: "ann", avatarUrl: av("ann") });
    expect(p[0].date.toISOString(), "Expected the group dated at its last commit").toBe(new Date(at("10:08")).toISOString());
    expect(p[0].commits, "Expected the commits, chronological, with sha, first-line title and date").toEqual([
      { sha: "aaa11111", title: "First", date: new Date(at("10:00")) },
      { sha: "bbb22222", title: "Second", date: new Date(at("10:04")) },
      { sha: "ccc33333", title: "Third", date: new Date(at("10:08")) },
    ]);
  });

  it("groups a single commit as a pushed event of count 1", () => {
    const p = pushed(feed([commit("aaa11111", "ann", at("10:00"))]));
    expect(p, "Expected one pushed event").toHaveLength(1);
    expect(p[0].count, "Expected count 1").toBe(1);
  });

  // Boundary: exactly 10 minutes apart still groups; 10 minutes 1 second does not.
  it("groups commits exactly 10 minutes apart", () => {
    const p = pushed(feed([commit("aaa11111", "ann", "2026-06-01T10:00:00Z"), commit("bbb22222", "ann", "2026-06-01T10:10:00Z")]));
    expect(p.map((e) => e.count), "Expected one group of 2 at the 10 minute boundary").toEqual([2]);
  });

  it("splits commits more than 10 minutes apart", () => {
    const p = pushed(feed([commit("aaa11111", "ann", "2026-06-01T10:00:00Z"), commit("bbb22222", "ann", "2026-06-01T10:10:01Z")]));
    expect(p.map((e) => e.count), "Expected two pushed events of 1 each").toEqual([1, 1]);
  });

  // The window is measured between neighbours, so a steady stream stays one push.
  it("chains commits each within 10 minutes of the previous one", () => {
    const p = pushed(feed([commit("a1", "ann", at("10:00")), commit("a2", "ann", at("10:08")), commit("a3", "ann", at("10:16")), commit("a4", "ann", at("10:24"))]));
    expect(p.map((e) => e.count), "Expected a single group of 4 chained by 8 minute gaps").toEqual([4]);
  });

  it("splits when the author changes", () => {
    const p = pushed(feed([commit("a1", "ann", at("10:00")), commit("b1", "bob", at("10:01")), commit("a2", "ann", at("10:02"))]));
    expect(p.map((e) => [e.actor, e.count]), "Expected three pushes: ann, bob, ann (newest first)").toEqual([["ann", 1], ["bob", 1], ["ann", 1]]);
  });

  it("splits when another timeline item sits between the commits", () => {
    const p = pushed(feed([commit("a1", "ann", at("10:00")), issueComment("c1", "bob", at("10:02")), commit("a2", "ann", at("10:04"))]));
    expect(p.map((e) => e.count), "Expected consecutive means no other item between: two pushes of 1").toEqual([1, 1]);
  });

  it("groups commits that arrive out of order", () => {
    const p = pushed(feed([commit("a2", "ann", at("10:04")), commit("a1", "ann", at("10:00"))]));
    expect(p.map((e) => e.count), "Expected one group of 2").toEqual([2]);
    expect(p[0].commits!.map((c) => c.sha), "Expected the commits chronological").toEqual(["a1", "a2"]);
  });

  it("uses the git author name when the commit email is not linked to an account, and ghost when there is neither", () => {
    const unlinked = commit("u1", null, at("10:00"));
    unlinked.commit.author.name = "Dee Developer";
    const [a] = pushed(feed([unlinked]));
    expect(a.actor, "Expected the git author's name for an unlinked commit").toBe("Dee Developer");
    const anonymous = commit("u2", null, at("10:00"));
    anonymous.commit.author = null;
    const [b] = pushed(feed([anonymous]));
    expect(b.actor, "Expected ghost when the commit has no author at all").toBe("ghost");
  });
});

describe("AF-5: the other events", () => {
  // Given a simple lifecycle event, toFeed returns an event of the matching type, with its actor and date.
  it.each([
    ["ReadyForReviewEvent", "ready_for_review"],
    ["ConvertToDraftEvent", "converted_to_draft"],
    ["MergedEvent", "merged"],
    ["ClosedEvent", "closed"],
    ["ReopenedEvent", "reopened"],
  ] as const)("%s is a %s event", (typename, type) => {
    const [e] = events(feed([event(typename, "E1", "bob", at("13:00"))]).filter((i) => i.id === "E1"));
    expect(e, `Expected a ${type} event by bob`).toMatchObject({ kind: "event", type, actor: "bob", avatarUrl: av("bob") });
    expect(e.date.toISOString(), "Expected the event's createdAt").toBe(new Date(at("13:00")).toISOString());
  });

  it("shows a lifecycle event by a deleted account as ghost", () => {
    const [e] = events(feed([event("ClosedEvent", "E1", null, at("13:00"))]).filter((i) => i.id === "E1"));
    expect(e, "Expected ghost for a null actor").toMatchObject({ actor: "ghost", avatarUrl: GHOST });
  });

  it("maps a review request to the requested user", () => {
    const e = events(feed([event("ReviewRequestedEvent", "E1", "ann", at("10:00"), { requestedReviewer: { __typename: "User", login: "cat" } })])).find((x) => x.id === "E1")!;
    expect(e, "Expected a review_requested event by ann naming cat").toMatchObject({ type: "review_requested", actor: "ann", reviewer: "cat" });
  });

  it("maps a review request to the requested team's name", () => {
    const e = events(feed([event("ReviewRequestedEvent", "E1", "ann", at("10:00"), { requestedReviewer: { __typename: "Team", name: "Platform" } })])).find((x) => x.id === "E1")!;
    expect(e, "Expected the team's name as the reviewer").toMatchObject({ type: "review_requested", reviewer: "Platform" });
  });

  it("names the Copilot bot as Copilot on its review, keeping its avatar", () => {
    const n = review("r1", "copilot-pull-request-reviewer", "COMMENTED", at("12:00"), "Looks fine");
    const [e] = events(feed([n]).filter((i) => i.id === "r1"));
    expect(e, "Expected the display name as actor and the bot avatar").toMatchObject({ type: "review_commented", actor: "Copilot", avatarUrl: av("copilot-pull-request-reviewer"), html: "<p>Looks fine</p>" });
  });

  it("maps a review request to a Bot via its display name", () => {
    const e = events(feed([event("ReviewRequestedEvent", "E1", "ann", at("10:00"), { requestedReviewer: { __typename: "Bot", login: "copilot-pull-request-reviewer" } })])).find((x) => x.id === "E1")!;
    expect(e).toMatchObject({ type: "review_requested", reviewer: "Copilot" });
  });

  it.each([
    ["LabeledEvent", "labelled"],
    ["UnlabeledEvent", "unlabelled"],
  ] as const)("%s is a %s event carrying the label", (typename, type) => {
    const e = events(feed([event(typename, "E1", "bob", at("10:00"), { label: { name: "bug", color: "d73a4a" } })])).find((x) => x.id === "E1")!;
    expect(e, `Expected a ${type} event with the label`).toMatchObject({ type, actor: "bob", label: { name: "bug", color: "d73a4a" } });
  });

  it("maps a force push to the commits before and after", () => {
    const e = events(feed([event("HeadRefForcePushedEvent", "E1", "ann", at("10:00"), { beforeCommit: { oid: "1111111111" }, afterCommit: { oid: "2222222222" } })])).find((x) => x.id === "E1")!;
    expect(e, "Expected a force_pushed event with before and after commit ids").toMatchObject({ type: "force_pushed", actor: "ann", before: "1111111111", after: "2222222222" });
  });
});

describe("AF-5: unexpected input does not break the feed", () => {
  it("ignores timeline types it does not know", () => {
    const items = feed([{ __typename: "CrossReferencedEvent", id: "X1", createdAt: at("10:00") }, { __typename: "SomethingNewFromGitHub", id: "X2" }, issueComment("c1", "bob", at("10:30"))]);
    expect(items, "Expected only the comment and the created event").toHaveLength(2);
    expect(items[0].id, "Expected the comment first").toBe("c1");
    expect(items[1], "Expected the created event last").toMatchObject({ type: "created" });
  });

  it("ignores null timeline nodes", () => {
    const items = feed([null, issueComment("c1", "bob", at("10:30")), null]);
    expect(ids(items)[0], "Expected the comment to survive null neighbours").toBe("c1");
    expect(items, "Expected the comment plus created").toHaveLength(2);
  });
});

// filterFeed and counts take feed items directly, so they are specified without toFeed.
describe("AF-1: filter and counts", () => {
  const d = new Date(at("10:00"));
  const c: CommentItem = { kind: "comment", id: "c", author: "bob", avatarUrl: "", html: "", date: d, url: "" };
  const t: ThreadItem = { kind: "thread", id: "t", status: "active", outdated: false, path: "a.ts", line: 1, startLine: null, side: "RIGHT", comments: [], date: d, lastActivity: d };
  const t3: ThreadItem = { ...t, id: "t3", comments: [1, 2, 3].map((n) => ({ id: `k${n}`, author: "bob", avatarUrl: "", html: "", date: d, url: "" })) };
  const e1: EventItem = { kind: "event", id: "e1", type: "merged", actor: "ann", avatarUrl: "", date: d };
  const e2: EventItem = { kind: "event", id: "e2", type: "pushed", actor: "ann", avatarUrl: "", date: d, count: 2, commits: [] };
  const all: FeedItem[] = [e1, c, t3, e2, t];

  it("everything returns every item in order", () => {
    expect(ids(filterFeed(all, "all")), "Expected the full feed, order preserved").toEqual(["e1", "c", "t3", "e2", "t"]);
  });

  it("comments only returns comment and thread items in order", () => {
    expect(ids(filterFeed(all, "comments")), "Expected comments and threads only").toEqual(["c", "t3", "t"]);
  });

  it("events only returns everything else in order", () => {
    expect(ids(filterFeed(all, "events")), "Expected events only").toEqual(["e1", "e2"]);
  });

  it("counts everything, comments (comments and threads) and events", () => {
    expect(counts(all), "Expected all 5, comments 3 (a thread counts once, however many replies), events 2").toEqual({ all: 5, comments: 3, events: 2 });
  });

  it("counts an empty feed as zeros", () => {
    expect(counts([]), "Expected zero counts for an empty feed").toEqual({ all: 0, comments: 0, events: 0 });
  });

  it("filtered lengths match the counts", () => {
    expect([filterFeed(all, "comments").length, filterFeed(all, "events").length], "Expected each filter to show as many items as its count").toEqual([counts(all).comments, counts(all).events]);
  });
});

describe("threads carry where they were written, and Copilot's findings", () => {
  const BOT = "copilot-pull-request-reviewer";
  const overview = (id: number, title: string, sev: string) => `- <picture><img alt="${sev} severity"></picture> [${title}](https://github.com/acme/web/pull/42#discussion_r${id}) · New`;

  it("keeps originalLine, originalStartLine and the start side", () => {
    const [t] = only<ThreadItem>(feed([], [thread("t", [tComment("a", "ann", at("10:00"))], { line: null, isOutdated: true, originalLine: 30, originalStartLine: 28, startDiffSide: "LEFT" } as Partial<ReviewThreadNode>)]), "thread");
    expect([t.originalLine, t.originalStartLine, t.startSide, t.outdated]).toEqual([30, 28, "LEFT", true]);
  });

  it("gives a Copilot comment the title and severity its review lists for its databaseId", () => {
    const c = { ...tComment("cc", BOT, at("10:00")), databaseId: 77 };
    const items = feed([review("r", BOT, "COMMENTED", at("09:59"), [overview(76, "Other", "High"), overview(77, "Quote the variable", "Medium")].join("\n"))], [thread("t", [c])]);
    expect(only<ThreadItem>(items, "thread")[0].comments[0].copilot).toEqual({ title: "Quote the variable", severity: "Medium" });
  });

  it("marks a Copilot comment the overview does not list, and leaves other people's comments alone", () => {
    const c = { ...tComment("cc", BOT, at("10:00")), databaseId: 99 };
    const p = { ...tComment("pp", "ann", at("10:01")), databaseId: 77 };
    const items = feed([review("r", BOT, "COMMENTED", at("09:59"), overview(77, "Quote", "High"))], [thread("t", [c, p])]);
    const [first, second] = only<ThreadItem>(items, "thread")[0].comments;
    expect(first.copilot).toEqual({});
    expect(second.copilot).toBeUndefined();
  });

  it("ignores an overview written by someone other than Copilot", () => {
    const c = { ...tComment("cc", BOT, at("10:00")), databaseId: 77 };
    const items = feed([review("r", "mallory", "COMMENTED", at("09:59"), overview(77, "Fake", "High"))], [thread("t", [c])]);
    expect(only<ThreadItem>(items, "thread")[0].comments[0].copilot).toEqual({});
  });
});

describe("pushed events keep who pushed, for the hover card", () => {
  it("keeps a linked login, or the git name and email when the commit's email is on no GitHub account", () => {
    const git: TimelineNode = { ...commit("bbb22222", null, at("10:00")), commit: { ...commit("bbb22222", null, at("10:00")).commit, author: { name: "Bogdan", email: "b@example.com", avatarUrl: null, user: null } } };
    const [p] = events(feed([git])).filter((e) => e.type === "pushed");
    expect(p.person).toEqual({ login: null, name: "Bogdan", email: "b@example.com" });
    const [q] = events(feed([commit("aaa11111", "ann", at("10:00"))])).filter((e) => e.type === "pushed");
    expect(q.person).toEqual({ login: "ann", name: "ann" });
  });
});

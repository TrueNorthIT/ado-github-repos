import { describe, it, expect } from "vitest";
import { toListRow, toDetail, PrListNode, PrDetailNode } from "./prModel";

// Module under test: src/lib/prModel.ts (toListRow, toDetail). Input shapes are GitHub GraphQL PullRequest nodes
// (see the PrListNode / PrDetailNode interfaces in prModel.ts); outputs are view models for the Pull requests page.
// Decisions fixed by these tests are called out in the comment above the test that fixes them.

const T0 = "2026-06-01T09:00:00Z";
const NOW = Date.parse("2026-06-01T12:00:00Z");

const list = (over: Partial<PrListNode> = {}): PrListNode => ({
  number: 42,
  title: "Add login page",
  url: "https://github.com/acme/web/pull/42",
  state: "OPEN",
  isDraft: false,
  createdAt: T0,
  updatedAt: T0,
  mergedAt: null,
  closedAt: null,
  baseRefName: "main",
  author: { login: "ann", name: "Ann Author", avatarUrl: "https://avatars.example/ann.png" },
  labels: { nodes: [] },
  reviewThreads: { totalCount: 0, nodes: [] },
  comments: { totalCount: 0 },
  ...over,
});
const threads = (...resolved: boolean[]) => ({ totalCount: resolved.length, nodes: resolved.map((isResolved) => ({ isResolved })) });
const detail = (over: Partial<PrDetailNode> = {}): PrDetailNode => ({ ...list(), headRefName: "feature/login", body: "", mergeable: "MERGEABLE", ...over });

describe("PR-2: list row basics", () => {
  // Given a GraphQL node, toListRow returns number, title, url, author, avatar, base branch and label pills.
  it("maps identity, author, base branch and labels", () => {
    const row = toListRow(list({ labels: { nodes: [{ name: "bug", color: "d73a4a" }, { name: "ui", color: "0075ca" }] } }), NOW);
    expect(row, "Expected the node's fields on the row").toMatchObject({
      number: 42,
      title: "Add login page",
      url: "https://github.com/acme/web/pull/42",
      authorLogin: "ann",
      authorName: "Ann Author",
      avatarUrl: "https://avatars.example/ann.png",
      baseRef: "main",
      isDraft: false,
    });
    expect(row.labels, "Expected label pills as {name, color}, colour passed through without '#'").toEqual([
      { name: "bug", color: "d73a4a" },
      { name: "ui", color: "0075ca" },
    ]);
  });

  it("gives an empty labels list when the node has none", () => {
    expect(toListRow(list({ labels: null }), NOW).labels, "Expected [] for null labels").toEqual([]);
    expect(toListRow(list({ labels: undefined }), NOW).labels, "Expected [] for missing labels").toEqual([]);
  });

  it("leaves authorName undefined when GitHub gives no display name", () => {
    const row = toListRow(list({ author: { login: "bot", name: null, avatarUrl: "https://avatars.example/bot.png" } }), NOW);
    expect(row.authorName, "Expected no authorName for a null name").toBeUndefined();
    expect(row.authorLogin, "Expected the login to remain").toBe("bot");
  });

  // Decision: a deleted account (author: null) shows as GitHub's "ghost" with a usable avatar URL; it must not throw.
  it("shows a deleted author as ghost", () => {
    const row = toListRow(list({ author: null }), NOW);
    expect(row.authorLogin, "Expected the login 'ghost' for a null author").toBe("ghost");
    expect(row.authorName, "Expected no display name for ghost").toBeUndefined();
    expect(row.avatarUrl, "Expected an https avatar URL for ghost").toMatch(/^https:\/\//);
  });
});

describe("PR-4: status from state and draft flag", () => {
  // Given state/isDraft, status is: OPEN -> active|draft, MERGED -> completed, CLOSED (not merged) -> abandoned.
  it.each([
    ["open, not draft", { state: "OPEN" as const, isDraft: false }, "active"],
    ["open, draft", { state: "OPEN" as const, isDraft: true }, "draft"],
    ["merged", { state: "MERGED" as const, isDraft: false, mergedAt: "2026-06-01T10:00:00Z" }, "completed"],
    ["closed without merging", { state: "CLOSED" as const, isDraft: false, closedAt: "2026-06-01T10:00:00Z" }, "abandoned"],
    ["closed draft", { state: "CLOSED" as const, isDraft: true, closedAt: "2026-06-01T10:00:00Z" }, "abandoned"],
  ])("%s gives status %s", (_label, over, status) => {
    expect(toListRow(list(over), NOW).status, `Expected status ${status}`).toBe(status);
  });

  it("flags drafts with isDraft", () => {
    expect(toListRow(list({ isDraft: true }), NOW).isDraft, "Expected isDraft true for a draft").toBe(true);
  });
});

describe("PR-2: date verb and date", () => {
  const at = (iso: string, plusSeconds: number) => new Date(Date.parse(iso) + plusSeconds * 1000).toISOString();

  // Decision: "approximately equal" is inclusive: updatedAt - createdAt <= 60s still says "Created".
  it.each([0, 1, 60])("an open PR updated %is after creation says Created, with the created date", (secs) => {
    const row = toListRow(list({ updatedAt: at(T0, secs) }), NOW);
    expect(row.dateVerb, `Expected "Created" when updated ${secs}s after creation`).toBe("Created");
    expect(row.date.getTime(), "Expected the created date").toBe(Date.parse(T0));
  });

  it("an open PR updated 61s after creation says Updated, with the updated date", () => {
    const updatedAt = at(T0, 61);
    const row = toListRow(list({ updatedAt }), NOW);
    expect(row.dateVerb, "Expected \"Updated\" just past the 60s window").toBe("Updated");
    expect(row.date.toISOString(), "Expected the updated date").toBe(updatedAt);
  });

  it("a draft PR follows the same Created/Updated rule", () => {
    const row = toListRow(list({ isDraft: true, updatedAt: at(T0, 3600) }), NOW);
    expect(row.dateVerb, "Expected Updated for a draft changed an hour later").toBe("Updated");
  });

  it("a merged PR says Completed with the merge date, even if updatedAt is close to createdAt", () => {
    const row = toListRow(list({ state: "MERGED", mergedAt: "2026-06-01T10:30:00Z", updatedAt: T0 }), NOW);
    expect(row.dateVerb, "Expected Completed for a merged PR").toBe("Completed");
    expect(row.date.toISOString(), "Expected mergedAt as the date").toBe("2026-06-01T10:30:00.000Z");
  });

  it("a closed, unmerged PR says Abandoned with the closed date", () => {
    const row = toListRow(list({ state: "CLOSED", closedAt: "2026-06-01T11:15:00Z", updatedAt: "2026-06-01T11:20:00Z" }), NOW);
    expect(row.dateVerb, "Expected Abandoned for a closed, unmerged PR").toBe("Abandoned");
    expect(row.date.toISOString(), "Expected closedAt as the date (not updatedAt)").toBe("2026-06-01T11:15:00.000Z");
  });

  // Decision: the text reuses tokens.ts relativeTime, so it reads "Created 3 hours ago" rather than "3h".
  it("builds the status/date text from the verb and the relative time", () => {
    const row = toListRow(list(), NOW);
    expect(row.dateText, "Expected 'Created 3 hours ago' for a PR created 3 hours before now").toBe("Created 3 hours ago");
  });

  it("builds the text for a completed PR from the merge date", () => {
    const row = toListRow(list({ state: "MERGED", mergedAt: "2026-05-31T12:00:00Z" }), NOW);
    expect(row.dateText, "Expected 'Completed 1 day ago'").toBe("Completed 1 day ago");
  });
});

describe("PR-2: the comment indicator", () => {
  // total = reviewThreads.totalCount, resolved = threads with isResolved, active = resolved < total.
  it("counts resolved over total review threads and flags unresolved ones as active", () => {
    const row = toListRow(list({ reviewThreads: threads(true, true, false), comments: { totalCount: 9 } }), NOW);
    expect(row.comments, "Expected 2 of 3 threads resolved and active").toEqual({ total: 3, resolved: 2, active: true, threaded: true });
  });

  it("is not active when every thread is resolved", () => {
    const row = toListRow(list({ reviewThreads: threads(true, true) }), NOW);
    expect(row.comments, "Expected 2/2 resolved and not active").toEqual({ total: 2, resolved: 2, active: false, threaded: true });
  });

  it("is active when no thread is resolved", () => {
    const row = toListRow(list({ reviewThreads: threads(false, false, false, false) }), NOW);
    expect(row.comments, "Expected 0/4 and active").toEqual({ total: 4, resolved: 0, active: true, threaded: true });
  });

  // Decision: when threads exist the plain comment count is not added to the total.
  it("does not add plain comments to the thread total", () => {
    const row = toListRow(list({ reviewThreads: threads(false), comments: { totalCount: 7 } }), NOW);
    expect(row.comments.total, "Expected total to be the thread count (1), not threads plus comments").toBe(1);
  });

  it("falls back to the plain comment count, never active, when there are no threads", () => {
    const row = toListRow(list({ reviewThreads: { totalCount: 0, nodes: [] }, comments: { totalCount: 5 } }), NOW);
    expect(row.comments, "Expected the plain total 5, resolved 0, active false, threaded false").toEqual({ total: 5, resolved: 0, active: false, threaded: false });
  });

  it("treats missing threads and comments as zero", () => {
    const row = toListRow(list({ reviewThreads: null, comments: null }), NOW);
    expect(row.comments, "Expected all zero and not active").toEqual({ total: 0, resolved: 0, active: false, threaded: false });
  });
});

describe("PR-5: detail header", () => {
  it("maps title, number, author, base and head branches, and description", () => {
    const d = toDetail(detail({ body: "Adds the login page." }));
    expect(d, "Expected the header fields").toMatchObject({
      number: 42,
      title: "Add login page",
      url: "https://github.com/acme/web/pull/42",
      authorLogin: "ann",
      authorName: "Ann Author",
      baseRef: "main",
      headRef: "feature/login",
      body: "Adds the login page.",
    });
  });

  it("gives an empty description for a null body", () => {
    expect(toDetail(detail({ body: null })).body, "Expected '' for a null body").toBe("");
  });

  it("shows a deleted author as ghost", () => {
    expect(toDetail(detail({ author: null })).authorLogin, "Expected 'ghost' for a null author").toBe("ghost");
  });

  it.each([
    ["Active", { state: "OPEN" as const, isDraft: false }, "active"],
    ["Draft", { state: "OPEN" as const, isDraft: true }, "draft"],
    ["Completed", { state: "MERGED" as const, mergedAt: T0 }, "completed"],
    ["Abandoned", { state: "CLOSED" as const, closedAt: T0 }, "abandoned"],
  ])("status badge %s comes from the state", (_label, over, status) => {
    expect(toDetail(detail(over)).status, `Expected status ${status}`).toBe(status);
  });

  it("carries the labels", () => {
    const d = toDetail(detail({ labels: { nodes: [{ name: "bug", color: "d73a4a" }] } }));
    expect(d.labels, "Expected the label pills in the overview").toEqual([{ name: "bug", color: "d73a4a" }]);
  });

  // "x/y comments resolved": resolved review threads over total review threads; plain comments are not counted.
  it("reports comments resolved as resolved/total threads", () => {
    const d = toDetail(detail({ reviewThreads: threads(true, false, true), comments: { totalCount: 9 } }));
    expect(d.commentsResolved, "Expected '2/3'").toBe("2/3");
  });

  it("reports 0/0 when there are no threads", () => {
    expect(toDetail(detail({ reviewThreads: null })).commentsResolved, "Expected '0/0' with no threads").toBe("0/0");
  });
});

describe("PR-6: checks summary", () => {
  it.each([
    ["SUCCESS", "SUCCESS"], ["FAILURE", "FAILURE"], ["ERROR", "FAILURE"], ["PENDING", "PENDING"], ["EXPECTED", "PENDING"],
  ])("rollup state %s summarises as %s", (state, summary) => {
    expect(toDetail(detail({ statusCheckRollup: { state } })).checks, `Expected ${state} to summarise as ${summary}`).toBe(summary);
  });

  it("summarises no rollup as NONE", () => {
    expect(toDetail(detail({ statusCheckRollup: null })).checks, "Expected NONE for a null rollup").toBe("NONE");
    expect(toDetail(detail({ statusCheckRollup: undefined })).checks, "Expected NONE for a missing rollup").toBe("NONE");
  });

  it("summarises an unrecognised rollup state as NONE", () => {
    expect(toDetail(detail({ statusCheckRollup: { state: "SOMETHING_NEW" } })).checks, "Expected NONE for an unknown state").toBe("NONE");
  });
});

describe("PR-6: mergeability", () => {
  it.each(["MERGEABLE", "CONFLICTING", "UNKNOWN"])("passes %s through", (m) => {
    expect(toDetail(detail({ mergeable: m })).mergeable, `Expected ${m}`).toBe(m);
  });

  it("falls back to UNKNOWN for a missing or unrecognised value", () => {
    expect(toDetail(detail({ mergeable: null })).mergeable, "Expected UNKNOWN for null").toBe("UNKNOWN");
    expect(toDetail(detail({ mergeable: "WEIRD" })).mergeable, "Expected UNKNOWN for an unrecognised value").toBe("UNKNOWN");
  });
});

describe("PR-6: reviewers and their latest review state", () => {
  const who = (login: string) => ({ login, avatarUrl: `https://avatars.example/${login}.png` });
  const review = (login: string, state: string, submittedAt: string | null) => ({ author: who(login), state, submittedAt });
  const requested = (...logins: string[]) => ({ nodes: logins.map((l) => ({ requestedReviewer: who(l) })) });
  const stateOf = (d: ReturnType<typeof toDetail>, login: string) => d.reviewers.find((r) => r.login === login)?.state;

  it("shows a requested reviewer who has not reviewed as PENDING", () => {
    const d = toDetail(detail({ reviewRequests: requested("bob"), reviews: { nodes: [] } }));
    expect(stateOf(d, "bob"), "Expected PENDING for requested-but-not-reviewed").toBe("PENDING");
    expect(d.reviewers[0].avatarUrl, "Expected the avatar to be carried").toBe("https://avatars.example/bob.png");
  });

  it.each(["APPROVED", "CHANGES_REQUESTED", "COMMENTED"])("shows a single %s review as that state", (state) => {
    const d = toDetail(detail({ reviews: { nodes: [review("bob", state, "2026-06-01T10:00:00Z")] } }));
    expect(stateOf(d, "bob"), `Expected ${state}`).toBe(state);
  });

  it("lets a later approval override an earlier change request", () => {
    const d = toDetail(detail({ reviews: { nodes: [review("bob", "CHANGES_REQUESTED", "2026-06-01T10:00:00Z"), review("bob", "APPROVED", "2026-06-01T11:00:00Z")] } }));
    expect(stateOf(d, "bob"), "Expected the later APPROVED to win").toBe("APPROVED");
  });

  it("lets a later change request override an earlier approval", () => {
    const d = toDetail(detail({ reviews: { nodes: [review("bob", "APPROVED", "2026-06-01T10:00:00Z"), review("bob", "CHANGES_REQUESTED", "2026-06-01T11:00:00Z")] } }));
    expect(stateOf(d, "bob"), "Expected the later CHANGES_REQUESTED to win").toBe("CHANGES_REQUESTED");
  });

  // Decision: "later overrides earlier" is decided by submittedAt, not array position.
  it("orders reviews by submittedAt, not by their position in the list", () => {
    const d = toDetail(detail({ reviews: { nodes: [review("bob", "APPROVED", "2026-06-01T11:00:00Z"), review("bob", "CHANGES_REQUESTED", "2026-06-01T10:00:00Z")] } }));
    expect(stateOf(d, "bob"), "Expected the review submitted last (APPROVED at 11:00) to win").toBe("APPROVED");
  });

  // Decision (matches GitHub): a later plain COMMENTED review does not undo an approval or a change request.
  it("keeps an approval when a later review is only a comment", () => {
    const d = toDetail(detail({ reviews: { nodes: [review("bob", "APPROVED", "2026-06-01T10:00:00Z"), review("bob", "COMMENTED", "2026-06-01T11:00:00Z")] } }));
    expect(stateOf(d, "bob"), "Expected APPROVED to survive a later COMMENTED review").toBe("APPROVED");
  });

  it("keeps a change request when a later review is only a comment", () => {
    const d = toDetail(detail({ reviews: { nodes: [review("bob", "CHANGES_REQUESTED", "2026-06-01T10:00:00Z"), review("bob", "COMMENTED", "2026-06-01T11:00:00Z")] } }));
    expect(stateOf(d, "bob"), "Expected CHANGES_REQUESTED to survive a later COMMENTED review").toBe("CHANGES_REQUESTED");
  });

  // Decision: a DISMISSED review is treated as if it had not been made, so the reviewer falls back to their previous state.
  it("falls back to the earlier approval when the later review was dismissed", () => {
    const d = toDetail(detail({ reviews: { nodes: [review("bob", "APPROVED", "2026-06-01T10:00:00Z"), review("bob", "DISMISSED", "2026-06-01T11:00:00Z")] } }));
    expect(stateOf(d, "bob"), "Expected APPROVED after the later review was dismissed").toBe("APPROVED");
  });

  it("shows PENDING when a reviewer's only review was dismissed", () => {
    const d = toDetail(detail({ reviews: { nodes: [review("bob", "DISMISSED", "2026-06-01T10:00:00Z")] } }));
    expect(stateOf(d, "bob"), "Expected PENDING (awaiting a fresh review) after the only review was dismissed").toBe("PENDING");
  });

  // Decision (matches GitHub): re-requesting a review resets that reviewer to PENDING.
  it("shows PENDING when a reviewer who already approved has been asked to review again", () => {
    const d = toDetail(detail({ reviewRequests: requested("bob"), reviews: { nodes: [review("bob", "APPROVED", "2026-06-01T10:00:00Z")] } }));
    expect(stateOf(d, "bob"), "Expected PENDING for a re-requested reviewer").toBe("PENDING");
  });

  it("lists each reviewer once, with their own state", () => {
    const d = toDetail(detail({
      reviewRequests: requested("cat"),
      reviews: { nodes: [review("bob", "APPROVED", "2026-06-01T10:00:00Z"), review("dan", "CHANGES_REQUESTED", "2026-06-01T10:30:00Z"), review("bob", "APPROVED", "2026-06-01T11:00:00Z")] },
    }));
    expect(d.reviewers.map((r) => r.login).sort(), "Expected bob, cat and dan once each").toEqual(["bob", "cat", "dan"]);
    expect([stateOf(d, "bob"), stateOf(d, "cat"), stateOf(d, "dan")], "Expected APPROVED, PENDING, CHANGES_REQUESTED").toEqual(["APPROVED", "PENDING", "CHANGES_REQUESTED"]);
  });

  // Decision: the PR author is not a reviewer, even if they left COMMENTED reviews replying to threads.
  it("does not list the PR author as a reviewer", () => {
    const d = toDetail(detail({ reviews: { nodes: [review("ann", "COMMENTED", "2026-06-01T10:00:00Z")] } }));
    expect(d.reviewers, "Expected no reviewers when only the author commented").toEqual([]);
  });

  it("ignores unsubmitted draft reviews and reviews by deleted accounts", () => {
    const d = toDetail(detail({
      reviews: { nodes: [
        review("bob", "APPROVED", "2026-06-01T10:00:00Z"),
        review("bob", "PENDING", null),
        { author: null, state: "APPROVED", submittedAt: "2026-06-01T10:00:00Z" },
      ] },
    }));
    expect(d.reviewers.map((r) => [r.login, r.state]), "Expected only bob, still APPROVED").toEqual([["bob", "APPROVED"]]);
  });

  it("gives no reviewers when nobody is requested or has reviewed", () => {
    expect(toDetail(detail({ reviewRequests: null, reviews: null })).reviewers, "Expected []").toEqual([]);
  });
});

describe("PR-9: commits", () => {
  const commit = (over: Record<string, unknown> = {}) => ({
    commit: {
      oid: "0123456789abcdef0123456789abcdef01234567",
      message: "Fix the thing\n\nLonger explanation.",
      authoredDate: "2026-06-01T09:30:00Z",
      author: { name: "Ann Author", user: { login: "ann" } },
      ...over,
    },
  });

  it("lists title (first line), 8-character SHA, author and date", () => {
    const d = toDetail(detail({ commits: { nodes: [commit()] } }));
    expect(d.commits, "Expected one commit row").toHaveLength(1);
    expect(d.commits[0], "Expected first-line title, 8-char SHA, author name and date").toMatchObject({
      sha: "0123456789abcdef0123456789abcdef01234567",
      shortSha: "01234567",
      title: "Fix the thing",
      author: "Ann Author",
    });
    expect(d.commits[0].date.toISOString(), "Expected the authored date").toBe("2026-06-01T09:30:00.000Z");
  });

  it("takes the first line of a Windows (CRLF) message", () => {
    const d = toDetail(detail({ commits: { nodes: [commit({ message: "Title line\r\n\r\nBody" })] } }));
    expect(d.commits[0].title, "Expected no trailing carriage return").toBe("Title line");
  });

  it("falls back to the GitHub login when the git author has no name", () => {
    const d = toDetail(detail({ commits: { nodes: [commit({ author: { name: null, user: { login: "ann" } } })] } }));
    expect(d.commits[0].author, "Expected the login as author").toBe("ann");
  });

  it("keeps the commits in the order GitHub returns them", () => {
    const d = toDetail(detail({ commits: { nodes: [commit({ oid: "a".repeat(40) }), commit({ oid: "b".repeat(40) })] } }));
    expect(d.commits.map((c) => c.shortSha), "Expected oldest-first, as returned").toEqual(["aaaaaaaa", "bbbbbbbb"]);
  });

  it("gives an empty list when there are no commits", () => {
    expect(toDetail(detail({ commits: null })).commits, "Expected []").toEqual([]);
  });
});

describe("PR-7: linked work items on the detail", () => {
  // workItemIds = findWorkItemIds(title, body, ...every commit message), unique, first-seen order.
  it("collects AB# ids from the title, body and commit messages", () => {
    const d = toDetail(detail({
      title: "Add login AB#10",
      body: "Closes AB#11 and AB#10",
      commits: { nodes: [{ commit: { oid: "a".repeat(40), message: "wip\n\nRefs AB#12", authoredDate: T0 } }] },
    }));
    expect(d.workItemIds, "Expected [10, 11, 12] from title, body then commits").toEqual([10, 11, 12]);
  });

  it("is empty when nothing mentions a work item", () => {
    expect(toDetail(detail({ title: "Plain", body: null })).workItemIds, "Expected []").toEqual([]);
  });
});

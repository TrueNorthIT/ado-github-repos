import { describe, it, expect } from "vitest";
import {
  PENDING_LABEL,
  startReviewMutation,
  submitReviewMutation,
  discardReviewMutation,
  pendingReplyMutation,
  pendingReviewQuery,
  toPendingReview,
  canSubmitReview,
  toFeedForViewer,
  countPendingComments,
  type PendingAwareThread,
  type PendingFeedComment,
  type PendingThreadItem,
  type SubmitEvent,
} from "./pendingReview";
import type { TimelineNode } from "./feedModel";
import { expectMutation, expectNotInQuery, norm, NASTY } from "./ciTestHelpers";
import { expectQueryOperation, expectSelection } from "./editTestHelpers";

// Module under test: src/lib/pendingReview.ts (stubs until the developer implements them). Requirement CM-3: "Pending reviews".
// Schema facts are in the header of src/lib/pendingReview.ts. Decisions fixed by these tests:
//  - "Start a review" is addPullRequestReview with input { pullRequestId } and NO event.
//  - submit accepts COMMENT, APPROVE and REQUEST_CHANGES only; the body is left out when undefined.
//  - a pending comment is shown only to its author and carries pending: true; the model filters this itself because GitHub's schema does not promise it.
//  - Submit needs a body or a pending comment for COMMENT and REQUEST_CHANGES (a decision from GitHub's UI behaviour; the API call itself was not exercised, it needs a write).

const PR = { author: { login: "ada", avatarUrl: "" }, createdAt: "2026-01-01T00:00:00Z" };

describe("CM-3: startReviewMutation creates a PENDING review", () => {
  it("is a variables-only mutation taking $input: AddPullRequestReviewInput!", () => {
    const req = startReviewMutation("PR_1");
    expectMutation(req, "AddPullRequestReviewInput", "addPullRequestReview");
    expect(Object.keys(req.variables), "Expected the only variable to be input").toEqual(["input"]);
  });

  it("sends only the pull request id, with no event, so the review stays pending", () => {
    expect(startReviewMutation("PR_1").variables.input, "Expected input { pullRequestId } exactly: an `event` would submit the review").toEqual({ pullRequestId: "PR_1" });
  });

  it("selects the new review's id and state", () => {
    expectSelection(startReviewMutation("PR_1"), /pullRequestReview/, ["id", "state"], "the pullRequestReview payload");
  });

  it("keeps the id out of the query text", () => {
    NASTY.forEach((v) => expectNotInQuery(startReviewMutation(v), [v]));
  });

  it("rejects a blank pull request id", () => {
    expect(() => startReviewMutation(" "), "Expected a blank id to be rejected").toThrow(/pullRequestId is required/);
  });
});

describe("CM-3: submitReviewMutation submits the pending review", () => {
  it("is a variables-only mutation taking $input: SubmitPullRequestReviewInput!", () => {
    const req = submitReviewMutation({ reviewId: "PRR_1", event: "COMMENT" });
    expectMutation(req, "SubmitPullRequestReviewInput", "submitPullRequestReview");
    expect(Object.keys(req.variables), "Expected the only variable to be input").toEqual(["input"]);
  });

  it.each<SubmitEvent>(["COMMENT", "APPROVE", "REQUEST_CHANGES"])("sends the %s event with the review id and body", (event) => {
    expect(submitReviewMutation({ reviewId: "PRR_1", event, body: "Nice work\n" }).variables.input, `Expected { pullRequestReviewId, event: ${event}, body } with the body untouched`).toEqual({
      pullRequestReviewId: "PRR_1", event, body: "Nice work\n",
    });
  });

  it("leaves the body out when none is given", () => {
    expect(submitReviewMutation({ reviewId: "PRR_1", event: "APPROVE" }).variables.input, "Expected no body key for an approval without a message").toEqual({ pullRequestReviewId: "PRR_1", event: "APPROVE" });
  });

  it("allows an empty body string (inline comments only)", () => {
    expect((submitReviewMutation({ reviewId: "PRR_1", event: "COMMENT", body: "" }).variables.input as { body: string }).body, "Expected '' to be sent, not rejected").toBe("");
  });

  it("selects the review's id and state", () => {
    expectSelection(submitReviewMutation({ reviewId: "PRR_1", event: "COMMENT" }), /pullRequestReview/, ["id", "state"], "the pullRequestReview payload");
  });

  it("keeps the body and id out of the query text", () => {
    NASTY.forEach((v) => expectNotInQuery(submitReviewMutation({ reviewId: v, event: "COMMENT", body: v }), [v]));
  });

  it("rejects DISMISS, which is not a way to submit a review", () => {
    expect(() => submitReviewMutation({ reviewId: "PRR_1", event: "DISMISS" as unknown as SubmitEvent }), "Expected DISMISS to be rejected").toThrow(/event must be COMMENT, APPROVE or REQUEST_CHANGES/);
  });

  it("rejects a blank review id", () => {
    expect(() => submitReviewMutation({ reviewId: "", event: "COMMENT" }), "Expected a blank review id to be rejected").toThrow(/reviewId is required/);
  });
});

describe("CM-3: discardReviewMutation deletes the pending review", () => {
  it("is a variables-only mutation taking $input: DeletePullRequestReviewInput!", () => {
    const req = discardReviewMutation("PRR_1");
    expectMutation(req, "DeletePullRequestReviewInput", "deletePullRequestReview");
    expect(req.variables, "Expected { input: { pullRequestReviewId } }").toEqual({ input: { pullRequestReviewId: "PRR_1" } });
  });

  it("rejects a blank review id", () => {
    expect(() => discardReviewMutation(""), "Expected a blank review id to be rejected").toThrow(/reviewId is required/);
  });
});

describe("CM-3: pendingReplyMutation adds a reply to the pending review", () => {
  it("is a variables-only mutation taking $input: AddPullRequestReviewThreadReplyInput!", () => {
    const req = pendingReplyMutation("PRT_1", "PRR_1", "Agreed\n");
    expectMutation(req, "AddPullRequestReviewThreadReplyInput", "addPullRequestReviewThreadReply");
  });

  it("sends the thread id, the pending review id and the body as written", () => {
    expect(pendingReplyMutation("PRT_1", "PRR_1", "Agreed\n").variables.input, "Expected pullRequestReviewThreadId, pullRequestReviewId and body").toEqual({
      pullRequestReviewThreadId: "PRT_1", pullRequestReviewId: "PRR_1", body: "Agreed\n",
    });
  });

  it("selects the comment fields the feed reconciles from, including its state", () => {
    const words = norm(pendingReplyMutation("PRT_1", "PRR_1", "x").query).split(/[^A-Za-z0-9_]+/);
    for (const f of ["id", "url", "bodyHTML", "createdAt", "author", "state"]) expect(words, `Expected the reply payload to select ${f}`).toContain(f);
  });

  it("rejects a blank body and blank ids", () => {
    expect(() => pendingReplyMutation("PRT_1", "PRR_1", " "), "Expected a blank body to be rejected").toThrow(/body is required/);
    expect(() => pendingReplyMutation("", "PRR_1", "x"), "Expected a blank thread id to be rejected").toThrow(/threadId is required/);
    expect(() => pendingReplyMutation("PRT_1", "", "x"), "Expected a blank review id to be rejected").toThrow(/reviewId is required/);
  });
});

describe("CM-3: pendingReviewQuery finds the viewer's pending review", () => {
  const p = { owner: "octo", name: "widgets", number: 7 };

  it("is a variables-only query with a null author when none is given", () => {
    const req = pendingReviewQuery(p);
    expectQueryOperation(req);
    expect(req.variables, "Expected { owner, name, number, author: null }").toEqual({ ...p, author: null });
  });

  it("passes the author login as a variable", () => {
    expect(pendingReviewQuery({ ...p, author: "ada" }).variables.author, "Expected the author login in variables.author").toBe("ada");
  });

  it("filters reviews by the PENDING state and the author variable", () => {
    const q = norm(pendingReviewQuery(p).query);
    expect(q, "Expected $author: String (nullable)").toMatch(/\$author:\s*String(?!!)/);
    expect(q, "Expected reviews(states: [PENDING], author: $author ...)").toMatch(/reviews\([^)]*states:\s*\[?\s*PENDING\s*\]?[^)]*\)/);
    expect(q, "Expected the author argument to use the variable").toMatch(/reviews\([^)]*author:\s*\$author/);
  });

  it("selects what is needed to recognise and count the review", () => {
    const words = norm(pendingReviewQuery(p).query).split(/[^A-Za-z0-9_]+/);
    for (const f of ["viewer", "login", "pullRequest", "id", "state", "body", "viewerDidAuthor", "totalCount"]) expect(words, `Expected the query to select ${f}`).toContain(f);
  });

  it("keeps caller values out of the query text", () => {
    NASTY.forEach((v) => expectNotInQuery(pendingReviewQuery({ owner: v, name: v, number: 1, author: v }), [v]));
  });
});

describe("CM-3: toPendingReview picks the viewer's own pending review and counts its comments", () => {
  const wrap = (nodes: unknown[]) => ({ repository: { pullRequest: { reviews: { nodes } } } }) as Parameters<typeof toPendingReview>[0];
  const node = (over: Record<string, unknown> = {}) => ({ id: "PRR_1", state: "PENDING", body: "wip", viewerDidAuthor: true, author: { login: "Ada" }, comments: { totalCount: 3 }, ...over });

  it("returns the id, comment count and body of the viewer's pending review", () => {
    expect(toPendingReview(wrap([node()]), "ada"), "Expected the pending review with 3 comments").toEqual({ id: "PRR_1", commentCount: 3, body: "wip" });
  });

  it("recognises the author by login ignoring case when viewerDidAuthor is absent", () => {
    expect(toPendingReview(wrap([node({ viewerDidAuthor: undefined })]), "ADA")?.id, "Expected a case-insensitive login match").toBe("PRR_1");
  });

  it("ignores a pending review written by someone else", () => {
    expect(toPendingReview(wrap([node({ viewerDidAuthor: false, author: { login: "grace" } })]), "ada"), "Expected another user's pending review to be ignored (only its author may see it)").toBeNull();
  });

  it("ignores reviews that are not pending", () => {
    expect(toPendingReview(wrap([node({ state: "APPROVED" })]), "ada"), "Expected a submitted review not to count as pending").toBeNull();
  });

  it("skips null nodes and finds the pending one after them", () => {
    expect(toPendingReview(wrap([null, node({ state: "COMMENTED", id: "PRR_0" }), node()]), "ada")?.id, "Expected PRR_1").toBe("PRR_1");
  });

  it("counts a missing comments connection as 0 and a missing body as an empty string", () => {
    expect(toPendingReview(wrap([node({ comments: null, body: null })]), "ada"), "Expected zero comments and an empty body").toEqual({ id: "PRR_1", commentCount: 0, body: "" });
  });

  it("returns null for an empty list and for missing data", () => {
    expect(toPendingReview(wrap([]), "ada"), "Expected null for no reviews").toBeNull();
    expect(toPendingReview(null, "ada"), "Expected null for null data").toBeNull();
    expect(toPendingReview({ repository: null }, "ada"), "Expected null for a missing repository").toBeNull();
  });
});

describe("CM-3: canSubmitReview enables Submit only when there is something to submit", () => {
  it("always allows an approval", () => {
    expect(canSubmitReview({ event: "APPROVE", body: "", pendingCount: 0 }), "Expected APPROVE with nothing else to be allowed").toBe(true);
  });

  it.each<SubmitEvent>(["COMMENT", "REQUEST_CHANGES"])("allows %s with a body", (event) => {
    expect(canSubmitReview({ event, body: "Please rename", pendingCount: 0 }), `Expected ${event} with a body to be allowed`).toBe(true);
  });

  it.each<SubmitEvent>(["COMMENT", "REQUEST_CHANGES"])("allows %s with pending comments and no body", (event) => {
    expect(canSubmitReview({ event, body: "", pendingCount: 2 }), `Expected ${event} with 2 pending comments to be allowed`).toBe(true);
  });

  it.each<SubmitEvent>(["COMMENT", "REQUEST_CHANGES"])("refuses %s with a blank body and no pending comments", (event) => {
    expect(canSubmitReview({ event, body: "  \n", pendingCount: 0 }), `Expected ${event} with nothing to say to be refused`).toBe(false);
  });
});

describe("CM-3: toFeedForViewer shows pending comments as Pending, and only to their author", () => {
  const comment = (id: string, login: string | null, iso: string, state: "PENDING" | "SUBMITTED" | undefined = undefined) => ({
    id, databaseId: null, author: login ? { login, avatarUrl: "" } : null, bodyHTML: `<p>${id}</p>`, body: id, createdAt: iso, url: `https://example.test/${id}`, replyTo: null, ...(state ? { state } : {}),
  });
  const thread = (id: string, comments: ReturnType<typeof comment>[]): PendingAwareThread => ({
    id, isResolved: false, isOutdated: false, path: "a.ts", line: 3, originalLine: 3, startLine: null, diffSide: "RIGHT", comments: { nodes: comments },
  });
  const threadsOf = (items: ReturnType<typeof toFeedForViewer>) => items.filter((i): i is PendingThreadItem => i.kind === "thread");
  const flat = (t: PendingThreadItem): PendingFeedComment[] => t.comments;

  it("flags the viewer's own pending comment", () => {
    const items = toFeedForViewer([], [thread("t1", [comment("c1", "ada", "2026-01-02T00:00:00Z", "PENDING")])], PR, "ada");
    expect(flat(threadsOf(items)[0])[0].pending, "Expected the viewer's pending comment to be marked pending: true").toBe(true);
    expect(PENDING_LABEL, "Expected the label the UI shows on a pending comment to read Pending").toBe("Pending");
  });

  it("matches the viewer's login ignoring case", () => {
    const items = toFeedForViewer([], [thread("t1", [comment("c1", "Ada", "2026-01-02T00:00:00Z", "PENDING")])], PR, "aDa");
    expect(threadsOf(items), "Expected the pending comment to stay visible to the same user in a different letter case").toHaveLength(1);
  });

  it("does not flag submitted comments", () => {
    const items = toFeedForViewer([], [thread("t1", [comment("c1", "grace", "2026-01-02T00:00:00Z", "SUBMITTED"), comment("c2", "grace", "2026-01-02T01:00:00Z")])], PR, "ada");
    expect(flat(threadsOf(items)[0]).map((c) => !!c.pending), "Expected no comment of this thread to be flagged").toEqual([false, false]);
  });

  it("drops another user's pending comment but keeps the rest of the thread", () => {
    const items = toFeedForViewer([], [thread("t1", [comment("c1", "grace", "2026-01-02T00:00:00Z", "SUBMITTED"), comment("c2", "grace", "2026-01-02T01:00:00Z", "PENDING")])], PR, "ada");
    expect(flat(threadsOf(items)[0]).map((c) => c.id), "Expected grace's pending reply to be hidden from ada").toEqual(["c1"]);
  });

  it("drops a thread whose only comment is someone else's pending comment", () => {
    const items = toFeedForViewer([], [thread("t1", [comment("c1", "grace", "2026-01-02T00:00:00Z", "PENDING")])], PR, "ada");
    expect(threadsOf(items), "Expected the thread to vanish for a non-author").toHaveLength(0);
  });

  it("hides every pending comment when the viewer is unknown", () => {
    const items = toFeedForViewer([], [thread("t1", [comment("c1", "ada", "2026-01-02T00:00:00Z", "PENDING")])], PR, null);
    expect(threadsOf(items), "Expected no pending comment to be shown without a signed-in viewer").toHaveLength(0);
  });

  it("hides a pending comment whose author was deleted", () => {
    const items = toFeedForViewer([], [thread("t1", [comment("c1", null, "2026-01-02T00:00:00Z", "PENDING")])], PR, "ghost");
    expect(threadsOf(items), "Expected a deleted author never to match the viewer, even one called ghost").toHaveLength(0);
  });

  it("flags only the viewer's pending reply inside a thread started by someone else", () => {
    const items = toFeedForViewer([], [thread("t1", [comment("c1", "grace", "2026-01-02T00:00:00Z", "SUBMITTED"), comment("c2", "ada", "2026-01-02T01:00:00Z", "PENDING")])], PR, "ada");
    expect(flat(threadsOf(items)[0]).map((c) => !!c.pending), "Expected [false, true]: the first comment is submitted, the reply is pending").toEqual([false, true]);
  });

  it("still orders and describes threads the way toFeed does", () => {
    const items = toFeedForViewer([], [thread("t1", [comment("c1", "ada", "2026-01-02T00:00:00Z", "PENDING")])], PR, "ada");
    const t = threadsOf(items)[0];
    expect({ id: t.id, status: t.status, path: t.path, line: t.line, side: t.side, author: t.comments[0].author }, "Expected the usual thread fields from toFeed").toEqual({ id: "t1", status: "active", path: "a.ts", line: 3, side: "RIGHT", author: "ada" });
    expect(items[items.length - 1].kind === "event" && (items[items.length - 1] as { type: string }).type, "Expected the created event last, as toFeed does").toBe("created");
  });

  it("shows no review event for the viewer's PENDING review in the timeline", () => {
    const pending: TimelineNode = { __typename: "PullRequestReview", id: "PRR_1", author: { login: "ada", avatarUrl: "" }, state: "PENDING", body: "wip", bodyHTML: "<p>wip</p>", submittedAt: null, createdAt: "2026-01-02T00:00:00Z", url: "u" };
    const items = toFeedForViewer([pending], [], PR, "ada");
    expect(items.filter((i) => i.kind === "event" && i.type !== "created"), "Expected an unsubmitted review not to appear as an event").toEqual([]);
  });
});

describe("CM-3: countPendingComments counts the flagged comments in the feed", () => {
  it("counts pending comments across threads", () => {
    const mk = (id: string, flags: boolean[]): PendingThreadItem => ({
      kind: "thread", id, status: "active", outdated: false, path: "a.ts", line: 1, startLine: null, side: "RIGHT", date: new Date(0), lastActivity: new Date(0),
      comments: flags.map((pending, i) => ({ id: `${id}-${i}`, author: "ada", avatarUrl: "", html: "", date: new Date(0), url: "", pending })),
    });
    expect(countPendingComments([mk("a", [true, false, true]), mk("b", [false]), mk("c", [true])]), "Expected 3 flagged comments").toBe(3);
  });

  it("is 0 for an empty feed", () => {
    expect(countPendingComments([]), "Expected 0 for no items").toBe(0);
  });
});

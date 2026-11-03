// Live finding (0.27.0): "Add single comment" left a Pending comment, because addPullRequestReviewThread always lands in a
// pending review. A single comment is now its own review: start, add the thread, submit as COMMENT (discarded on failure).
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let failOn: string | null = null;
const thread = { id: "T1", isResolved: false, isOutdated: false, path: "a.ts", line: 1, originalLine: 1, startLine: null, diffSide: "RIGHT", subjectType: "LINE",
  comments: { nodes: [{ id: "C1", databaseId: 1, author: { login: "me", avatarUrl: "" }, bodyHTML: "<p>x</p>", body: "x", createdAt: "2026-01-01T00:00:00Z", url: "", replyTo: null, state: "PENDING", diffHunk: "" }] } };

vi.mock("./githubBrowse", async () => { const { toFeedForViewer } = await import("./lib/pendingReview"); return {
  GhError: class GhError extends Error {},
  getFeed: async () => { throw new Error("not used"); },
  graphql: async () => ({}),
  invalidatePr: () => {},
  postComment: async () => ({}),
  postPendingReply: async () => ({}),
  postReply: async () => ({}),
  setThreadResolved: async () => ({}),
  toThreadItem: (node: any, viewer: string) => toFeedForViewer([], [node], { author: null, createdAt: new Date().toISOString() }, viewer).find((i: any) => i.kind === "thread"),
  invalidatePrPage: () => {},
  loadCommentMeta: async () => ({}),
  mutate: async (req: { query: string }) => {
    const op = /\{\s*(\w+)\(/.exec(req.query)![1];
    calls.push(op);
    if (op === failOn) throw new Error("boom");
    if (op === "addPullRequestReview") return { addPullRequestReview: { pullRequestReview: { id: "R1" } } };
    if (op === "addPullRequestReviewThread") return { addPullRequestReviewThread: { thread } };
    return { [op]: { pullRequestReview: { id: "R1", state: "COMMENTED" } } };
  },
}; });
import { FeedStore } from "./feedStore";

const store = () => Object.assign(new FeedStore("o/r", 1), { prId: "PR1", viewer: { login: "me" }, status: "ready" as const });
const target = { path: "a.ts", subjectType: "LINE" as const, line: 1, side: "RIGHT" as const };

describe("FeedStore.newThread", () => {
  beforeEach(() => { calls.length = 0; failOn = null; });
  it("posts a single comment as a review submitted at once, not left pending", async () => {
    const s = store();
    expect(await s.newThread("k", target, "x", "single")).toBe(true);
    expect(calls).toEqual(["addPullRequestReview", "addPullRequestReviewThread", "submitPullRequestReview"]);
    expect(s.pending).toBeNull();
    const t = s.items.find((i) => i.kind === "thread") as any;
    expect(t.comments.some((c: any) => c.pending)).toBe(false);
  });
  it("discards the review it started when adding the thread fails", async () => {
    failOn = "addPullRequestReviewThread";
    expect(await store().newThread("k", target, "x", "single")).toBe(false);
    expect(calls).toEqual(["addPullRequestReview", "addPullRequestReviewThread", "deletePullRequestReview"]);
  });
  it("keeps review-mode comments pending, in one review", async () => {
    const s = store();
    await s.newThread("k", target, "x", "review");
    await s.newThread("k", target, "x", "review");
    expect(calls).toEqual(["addPullRequestReview", "addPullRequestReviewThread", "addPullRequestReviewThread"]);
    expect(s.pending?.id).toBe("R1");
  });
});

// __TN_MOCK__ Activity feed fixtures for two pull requests, shaped like the GraphQL nodes feedQuery returns, plus the mutations that edit them.
// State is module-level, so replies, resolves and comments persist until the page is reloaded.
import { ME, PR_REPO, PRS } from "./prs";

export const authorOf = (n: number) => PRS.find((p) => p.node.number === n)!.node.author;
const avatarOf = (login: string) => (PRS.map((p) => p.node.author).find((a) => a?.login === login)?.avatarUrl as string | undefined) ?? "";
export const who = (login: string) => ({ login, avatarUrl: avatarOf(login) });

const HOUR = 3600e3;
export const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
export const url = (n: number, frag: string) => `https://github.com/${PR_REPO}/pull/${n}#${frag}`;

export type Node = Record<string, any>;
let serial = 1000;
export const nextSerial = () => ++serial;

const issueComment = (pr: number, id: string, login: string, hours: number, html: string): Node => ({
  __typename: "IssueComment", id, databaseId: ++serial, author: who(login), bodyHTML: html, body: html.replace(/<[^>]+>/g, ""), createdAt: ago(hours), url: url(pr, `issuecomment-${id}`),
});
const review = (pr: number, id: string, login: string, state: string, hours: number, html = ""): Node => ({
  __typename: "PullRequestReview", id, author: who(login), state, body: html.replace(/<[^>]+>/g, ""), bodyHTML: html, submittedAt: ago(hours), createdAt: ago(hours), url: url(pr, `pullrequestreview-${id}`),
});
const commit = (pr: number, oid: string, login: string, hours: number, message: string): Node => ({
  __typename: "PullRequestCommit", id: `PRC_${pr}_${oid}`,
  commit: { oid, message, messageHeadline: message.split("\n")[0], committedDate: ago(hours), authoredDate: ago(hours), author: { name: login, avatarUrl: avatarOf(login), user: { login } } },
});
const event = (type: string, id: string, login: string, hours: number, extra: Node = {}): Node => ({ __typename: type, id, actor: who(login), createdAt: ago(hours), ...extra });
const tComment = (pr: number, id: string, login: string, hours: number, html: string, replyTo: string | null = null): Node => ({
  id, databaseId: ++serial, author: who(login), bodyHTML: html, body: html.replace(/<[^>]+>/g, ""), createdAt: ago(hours), url: url(pr, `discussion_r${id}`), replyTo: replyTo ? { id: replyTo } : null,
});
const sha = (n: number) => (0xabc00000 + n * 4096).toString(16).padEnd(40, "0");

export interface FixtureFeed {
  prId: string;
  timeline: Node[];
  threads: Node[];
}

// ---------- #200: comments, three review threads (one resolved, one outdated, one with three replies), a review of each verdict ----------
const T1 = [
  tComment(200, "RC_1", "carol", 26, "<p>Should this keep the old greeting for anonymous users? <code>name</code> can be empty here.</p>"),
  tComment(200, "RC_2", ME, 24, "<p>Good catch. I will add a fallback.</p>", "RC_1"),
  tComment(200, "RC_3", "carol", 23, "<p>Thanks. Something like this would do:</p><pre><code>const who = name || &quot;there&quot;;</code></pre>", "RC_1"),
  tComment(200, "RC_4", ME, 22, "<p>Done in the next push.</p>", "RC_1"),
];
const FEED_200: FixtureFeed = {
  prId: "PR_node_200",
  timeline: [
    commit(200, sha(1), "ann", 30, "Add retry helper\n\nBacks off exponentially."),
    commit(200, sha(2), "ann", 29.95, "Add tests for retry"),
    commit(200, sha(3), "ann", 29.9, "Tidy retry typings"),
    issueComment(200, "IC_1", "dave", 28, "<p>Thanks for picking this up. Does the backoff cap anywhere?</p>"),
    event("LabeledEvent", "EV_L1", "ann", 27.5, { label: { name: "enhancement", color: "a2eeef" } }),
    event("ReviewRequestedEvent", "EV_R1", "ann", 27, { requestedReviewer: { __typename: "User", login: "carol" } }),
    review(200, "RV_1", "carol", "COMMENTED", 26, "<p>A few questions inline, nothing blocking yet.</p>"),
    commit(200, sha(4), ME, 22, "Use a template string in greet (AB#1001)"),
    review(200, "RV_2", "dave", "CHANGES_REQUESTED", 20, "<p>Please add a test for the empty name case before this merges.</p>"),
    issueComment(200, "IC_2", ME, 19, "<p>Added. Could you take another look?</p><ul><li>empty name</li><li>whitespace name</li></ul>"),
    commit(200, sha(5), "bob-dev", 5, "Remove old notes"),
    event("UnlabeledEvent", "EV_L2", "ann", 4, { label: { name: "wontfix", color: "ffffff" } }),
    review(200, "RV_3", "carol", "APPROVED", 3),
    { ...review(200, "RV_C", "copilot-pull-request-reviewer", "COMMENTED", 3.5, `<p>Copilot reviewed 3 out of 3 changed files in this pull request and generated 2 comments.</p>
<details><summary>Pull request overview</summary>
<p>This PR adds a retry helper and wires it into <code>greet</code>.</p>
<ul><li>Adds a placeholder document describing the helper</li><li>Adds <code>retry()</code> with exponential backoff
<ul><li>capped at 30 seconds</li></ul></li><li>Updates the tests</li></ul>
<ol><li>First step</li><li>Second step</li></ol>
<table><thead><tr><th>File</th><th>Description</th></tr></thead><tbody><tr><td>src/util/retry.ts</td><td>New retry helper with backoff.</td></tr><tr><td>src/util/greet.ts</td><td>Uses a template string.</td></tr></tbody></table>
<pre><code>const wait = Math.min(2 ** n * 100, 30000);
await sleep(wait);</code></pre>
</details>
<h3>Suggestions</h3>
<p>Consider a jitter. <sub>Review effort 2/5</sub></p>
<hr>
<p><sub>Tip: <a href="https://example.com">Customize your pull request review experience</a></sub></p>`), author: { login: "copilot-pull-request-reviewer", avatarUrl: "https://avatars.githubusercontent.com/in/946600?v=4" } },
    event("ReviewRequestedEvent", "EV_R4", "ann", 3.6, { requestedReviewer: { __typename: "Bot", login: "copilot-pull-request-reviewer", avatarUrl: "" } }),
    event("HeadRefForcePushedEvent", "EV_F1", "ann", 2, { beforeCommit: { oid: sha(5) }, afterCommit: { oid: sha(6) } }),
    issueComment(200, "IC_3", "bob-dev", 1, '<p>Looks good to me now. See the <a href="https://example.com/guide">guide</a>.</p>'),
  ],
  threads: [
    { id: "PRRT_1", isResolved: false, isOutdated: false, path: "src/util/greet.ts", line: 12, originalLine: 12, startLine: null, diffSide: "RIGHT", comments: { nodes: T1 } },
    {
      id: "PRRT_2", isResolved: true, isOutdated: false, path: "src/util/greet.ts", line: 68, originalLine: 68, startLine: null, diffSide: "LEFT",
      comments: { nodes: [tComment(200, "RC_5", "dave", 21, "<p>Why drop the string concatenation here?</p>"), tComment(200, "RC_6", "ann", 20.5, "<p>The template string is clearer and is what the rest of the file uses.</p>", "RC_5")] },
    },
    {
      id: "PRRT_3", isResolved: false, isOutdated: true, path: "src/util/greet.ts", line: null, originalLine: 40, startLine: null, diffSide: "RIGHT",
      // Outdated: GitHub keeps the hunk as it was when the comment was written, numbered by originalLine (40), which no longer maps onto the diff.
      comments: { nodes: [{ ...tComment(200, "RC_7", "carol", 25, "<p>This helper has since moved, but is it still needed at all?</p>"), diffHunk: ["@@ -36,2 +36,5 @@ export function greet(name: string) {", " }", " ", "+// Formats a name for display.", "+export const display = (n: string) => n.trim();","+export const helper = () => display(\"x\");"].join("\n") }] },
    },
    // CM-6: a thread on a range of lines (13-15 of the renamed names.ts), shown with the range marked and "Lines 13–15".
    {
      id: "PRRT_4", isResolved: false, isOutdated: false, path: "src/lib/names.ts", line: 15, originalLine: 15, startLine: 13, diffSide: "RIGHT",
      comments: { nodes: [tComment(200, "RC_8", "dave", 19, "<p>These three exports belong together: could they move into one <code>names</code> object?</p>")] },
    },
  ],
};

// ---------- #170 (merged): separate and grouped pushes, labels, review requested, ready for review, merged ----------
const FEED_170: FixtureFeed = {
  prId: "PR_node_170",
  timeline: [
    commit(170, sha(11), "ann", 80, "Start the refactor"),
    event("ConvertToDraftEvent", "EV_D1", "ann", 79),
    commit(170, sha(12), "ann", 70, "Split the listing component"),
    commit(170, sha(13), "ann", 69.95, "Move helpers"),
    event("LabeledEvent", "EV_L3", "ann", 60, { label: { name: "dependencies", color: "0366d6" } }),
    event("LabeledEvent", "EV_L4", "ann", 59.9, { label: { name: "good first issue", color: "7057ff" } }),
    event("ReadyForReviewEvent", "EV_RR1", "ann", 50),
    event("ReviewRequestedEvent", "EV_R2", "ann", 49.9, { requestedReviewer: { __typename: "User", login: "bob-dev" } }),
    event("ReviewRequestedEvent", "EV_R3", "ann", 49.8, { requestedReviewer: { __typename: "Team", name: "Platform" } }),
    issueComment(170, "IC_4", "bob-dev", 40, "<p>Nice clean-up.</p>"),
    review(170, "RV_4", "bob-dev", "APPROVED", 38, "<p>Approved. One nit: the file name could be shorter.</p>"),
    commit(170, sha(14), "ann", 20, "Shorten the file name"),
    event("MergedEvent", "EV_M1", "bob-dev", 18),
  ],
  threads: [],
};

export const feeds: Record<number, FixtureFeed> = { 200: FEED_200, 170: FEED_170 };
const EMPTY: FixtureFeed = { prId: "PR_node_empty", timeline: [], threads: [] };

/** The feedQuery response for a fixture PR; PRs without a fixture have an empty timeline. */
export function feedData(n: number) {
  const f = feeds[n] ?? { ...EMPTY, prId: `PR_node_${n}` };
  const pr = PRS.find((p) => p.node.number === n)!;
  return {
    viewer: who(ME),
    repository: {
      pullRequest: {
        id: f.prId, createdAt: ago(n === 170 ? 90 : 32), author: pr.node.author ?? authorOf(n),
        timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: f.timeline },
        reviewThreads: { nodes: f.threads },
      },
    },
  };
}

/** [resolved, total] review threads, for the PR page header. */
export const threadTotals = (n: number): [number, number] | undefined => {
  const t = feeds[n]?.threads;
  return t && [t.filter((x) => x.isResolved).length, t.length];
};

const findPr = (id: string) => Object.entries(feeds).find(([, f]) => f.prId === id);
const findThread = (id: string) => Object.entries(feeds).flatMap(([n, f]) => f.threads.map((t) => [Number(n), t] as const)).find(([, t]) => t.id === id);

/** Applies a feed mutation to the fixture state and returns its response data, or undefined when it is not one of ours. */
export function feedMutation(query: string, v: Record<string, any>): Record<string, unknown> | undefined {
  const input = v.input ?? {};
  const html = (body: string) => `<p>${String(body).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`;
  if (query.includes("addComment(")) {
    const hit = findPr(input.subjectId);
    if (!hit) return { addComment: null };
    const node = issueComment(Number(hit[0]), `IC_new_${++serial}`, ME, 0, html(input.body));
    hit[1].timeline.push(node);
    return { addComment: { commentEdge: { node } } };
  }
  if (query.includes("addPullRequestReviewThreadReply(")) {
    const hit = findThread(input.pullRequestReviewThreadId);
    if (!hit) return { addPullRequestReviewThreadReply: null };
    const node = tComment(hit[0], `RC_new_${++serial}`, ME, 0, html(input.body), hit[1].comments.nodes[0].id);
    hit[1].comments.nodes.push(node);
    return { addPullRequestReviewThreadReply: { comment: node } };
  }
  const resolve = query.includes("resolveReviewThread(") && !query.includes("unresolveReviewThread(");
  if (resolve || query.includes("unresolveReviewThread(")) {
    const hit = findThread(input.threadId);
    if (!hit) return { [resolve ? "resolveReviewThread" : "unresolveReviewThread"]: null };
    hit[1].isResolved = resolve;
    return { [resolve ? "resolveReviewThread" : "unresolveReviewThread"]: { thread: { id: hit[1].id, isResolved: resolve } } };
  }
  return undefined;
}

import { describe, it, expect } from "vitest";
import { feedQuery, addCommentMutation, replyMutation, resolveMutation, unresolveMutation } from "./feedQuery";

// Module under test: src/lib/feedQuery.ts (feedQuery, addCommentMutation, replyMutation, resolveMutation, unresolveMutation).
// Shared rule, as in prQuery.ts and commits.ts: caller-supplied values (owner, name, number, cursor, comment text, ids)
// travel in `variables`; the query text is constant and never contains them.
// Conventions fixed by these tests:
//  - feedQuery variables are { owner, name, number, after }; an absent cursor is sent as null.
//  - every mutation takes one `$input` variable holding the GitHub input object, e.g. { input: { subjectId, body } }.
//  - a mutation builder THROWS (an Error whose message mentions "body") for an empty or whitespace-only body, before any request exists.
//    A non-empty body is sent exactly as supplied (no trimming), so markdown and trailing newlines survive.
// GitHub names used (GitHub public GraphQL reference, docs.github.com/en/graphql/reference/pulls and /issues):
//  PullRequestTimelineItemsItemType, AddCommentInput, AddPullRequestReviewThreadReplyInput, ResolveReviewThreadInput, UnresolveReviewThreadInput.

const base = { owner: "acme", name: "web", number: 42 };
const norm = (s: string) => s.replace(/\s+/g, " ");
const NASTY = ['we"ird', "back\\slash", "ünï cødé 日本", "sp ace #hash", "q{uery}", "$var"];

/** Text of the `{ ... }` block that starts at the first `{` at or after `from`. */
function block(q: string, from: number): string {
  const start = q.indexOf("{", from);
  let depth = 0;
  for (let i = start; i < q.length; i++) {
    if (q[i] === "{") depth++;
    if (q[i] === "}" && --depth === 0) return q.slice(start, i + 1);
  }
  return q.slice(start);
}

describe("AF-1: feedQuery fetches the timeline and review threads in one request", () => {
  // Given owner, name and number, feedQuery sends them as variables, with a null cursor on the first page.
  it("sends owner, name, number and a null after cursor as variables", () => {
    const req = feedQuery(base);
    expect(req.variables, "Expected variables { owner, name, number, after: null } for the first page").toEqual({ owner: "acme", name: "web", number: 42, after: null });
  });

  it("sends the supplied cursor in the after variable", () => {
    const req = feedQuery({ ...base, after: "Y3Vyc29yOjEwMA" });
    expect(req.variables.after, "Expected the timeline cursor to be passed as variables.after").toBe("Y3Vyc29yOjEwMA");
  });

  it("declares the variables with GitHub types and uses them", () => {
    const q = norm(feedQuery(base).query);
    expect(q, "Expected $owner: String!").toMatch(/\$owner:\s*String!/);
    expect(q, "Expected $name: String!").toMatch(/\$name:\s*String!/);
    expect(q, "Expected $number: Int!").toMatch(/\$number:\s*Int!/);
    expect(q, "Expected $after: String (nullable, first page has none)").toMatch(/\$after:\s*String(?!!)/);
    expect(q, "Expected repository(owner: $owner, name: $name)").toMatch(/repository\(owner:\s*\$owner,\s*name:\s*\$name\)/);
    expect(q, "Expected pullRequest(number: $number)").toMatch(/pullRequest\(number:\s*\$number\)/);
  });

  it.each(NASTY)("never puts caller text in the query string: %s", (nasty) => {
    const a = feedQuery({ owner: nasty, name: nasty, number: 7, after: nasty });
    const b = feedQuery(base);
    expect(a.query, "Expected the query text to be identical whatever the caller supplies").toBe(b.query);
    expect(a.variables, "Expected the caller's text to travel in variables").toMatchObject({ owner: nasty, name: nasty, after: nasty });
  });

  // One operation only, so one HTTP request returns everything.
  it("is a single query operation", () => {
    const q = norm(feedQuery(base).query);
    expect(q, "Expected the text to start with a query operation").toMatch(/^\s*query\b/);
    expect(q.match(/\b(query|mutation|subscription)\b\s*[\w]*\s*\(/g), "Expected exactly one operation").toHaveLength(1);
  });

  // AF-2 / AF-3 need the PR node id: addComment's subjectId is the pull request's node id.
  it("asks for the pull request node id (the subjectId for addComment)", () => {
    const q = feedQuery(base).query;
    const pr = block(q, q.search(/pullRequest\(number:/));
    const direct = pr.slice(0, pr.indexOf("timelineItems("));
    expect(direct, "Expected `id` selected on pullRequest itself, before timelineItems").toMatch(/\bid\b/);
  });
});

describe("AF-5: the timeline asks for every event type the feed shows", () => {
  const ITEM_TYPES = [
    "ISSUE_COMMENT",
    "PULL_REQUEST_REVIEW",
    "PULL_REQUEST_COMMIT",
    "REVIEW_REQUESTED_EVENT",
    "LABELED_EVENT",
    "UNLABELED_EVENT",
    "READY_FOR_REVIEW_EVENT",
    "CONVERT_TO_DRAFT_EVENT",
    "MERGED_EVENT",
    "CLOSED_EVENT",
    "REOPENED_EVENT",
    "HEAD_REF_FORCE_PUSHED_EVENT",
  ];
  const FRAGMENTS = [
    "IssueComment",
    "PullRequestReview",
    "PullRequestCommit",
    "ReviewRequestedEvent",
    "LabeledEvent",
    "UnlabeledEvent",
    "ReadyForReviewEvent",
    "ConvertToDraftEvent",
    "MergedEvent",
    "ClosedEvent",
    "ReopenedEvent",
    "HeadRefForcePushedEvent",
  ];

  // timelineItems(first: 100, after: $after, itemTypes: [...]) with the cursor from $after.
  it("pages timelineItems 100 at a time from $after, with pageInfo", () => {
    const q = norm(feedQuery(base).query);
    expect(q, "Expected timelineItems(first: 100, after: $after, itemTypes: [...])").toMatch(/timelineItems\(first:\s*100,\s*after:\s*\$after,\s*itemTypes:\s*\[/);
    const items = block(q, q.indexOf("timelineItems("));
    expect(items, "Expected pageInfo { hasNextPage endCursor } so the caller can fetch the next page").toMatch(/pageInfo\s*\{[^}]*hasNextPage[^}]*endCursor[^}]*\}/);
  });

  it.each(ITEM_TYPES)("itemTypes includes %s", (type) => {
    const q = norm(feedQuery(base).query);
    const list = /itemTypes:\s*\[([^\]]*)\]/.exec(q)?.[1] ?? "";
    const present = list.split(",").map((s) => s.trim());
    expect(present, `Expected itemTypes (PullRequestTimelineItemsItemType) to include ${type}, got [${present.join(", ")}]`).toContain(type);
  });

  // The model switches on __typename and reads each type's fields through an inline fragment.
  it("requests __typename on timeline nodes", () => {
    const q = norm(feedQuery(base).query);
    const items = block(q, q.indexOf("timelineItems("));
    expect(items, "Expected __typename on the timeline nodes so toFeed can tell the types apart").toMatch(/__typename/);
  });

  it.each(FRAGMENTS)("selects the fields of %s through an inline fragment", (typeName) => {
    const q = norm(feedQuery(base).query);
    expect(q, `Expected \`... on ${typeName}\` in the timeline selection`).toMatch(new RegExp(`\\.\\.\\.\\s*on\\s+${typeName}\\b`));
  });
});

describe("AF-3 / AF-6: review threads and their comments", () => {
  const thread = () => {
    const q = norm(feedQuery(base).query);
    expect(q, "Expected reviewThreads(first: 100)").toMatch(/reviewThreads\(first:\s*100\)/);
    return block(q, q.indexOf("reviewThreads("));
  };

  it.each(["id", "isResolved", "isOutdated", "path", "line", "originalLine", "diffSide", "startLine"])("review threads select %s", (field) => {
    const t = thread();
    const outside = t.replace(/comments\(first:\s*100\)\s*\{[\s\S]*$/, "");
    expect(outside, `Expected reviewThreads nodes to select ${field}`).toMatch(new RegExp(`\\b${field}\\b`));
  });

  it("asks for the first 100 comments of each thread", () => {
    const t = thread();
    expect(t, "Expected comments(first: 100) inside reviewThreads").toMatch(/comments\(first:\s*100\)/);
  });

  it.each(["id", "databaseId", "bodyHTML", "body", "createdAt", "url"])("thread comments select %s", (field) => {
    const t = thread();
    const comments = block(t, t.indexOf("comments("));
    expect(comments, `Expected thread comments to select ${field}`).toMatch(new RegExp(`\\b${field}\\b`));
  });

  it("thread comments select author { login avatarUrl } and replyTo { id }", () => {
    const t = thread();
    const comments = block(t, t.indexOf("comments("));
    expect(comments, "Expected author { login avatarUrl }").toMatch(/author\s*\{[^}]*\blogin\b[^}]*\bavatarUrl\b[^}]*\}/);
    expect(comments, "Expected replyTo { id }").toMatch(/replyTo\s*\{\s*id\s*\}/);
  });
});

describe("AF-2: addCommentMutation posts a top-level PR comment", () => {
  // Given the PR node id and a body, addComment's input is { subjectId, body }.
  it("calls addComment with $input = { subjectId, body }", () => {
    const req = addCommentMutation("PR_node_1", "Looks good to me");
    const q = norm(req.query);
    expect(q, "Expected a mutation operation taking $input: AddCommentInput!").toMatch(/^\s*mutation\b[^{]*\$input:\s*AddCommentInput!/);
    expect(q, "Expected addComment(input: $input)").toMatch(/addComment\(input:\s*\$input\)/);
    expect(req.variables, "Expected variables { input: { subjectId, body } }").toEqual({ input: { subjectId: "PR_node_1", body: "Looks good to me" } });
  });

  it.each(NASTY)("keeps comment text out of the query string: %s", (nasty) => {
    const req = addCommentMutation("PR_node_1", nasty);
    expect(req.query, "Expected the query text to be independent of the body").toBe(addCommentMutation("PR_node_1", "plain").query);
    expect((req.variables.input as { body: string }).body, "Expected the body to travel unchanged in variables").toBe(nasty);
  });

  it("sends a multi-line markdown body exactly as supplied", () => {
    const body = "First line\n\n- item\n\n```ts\nconst a = 1;\n```\n";
    const req = addCommentMutation("PR_node_1", body);
    expect((req.variables.input as { body: string }).body, "Expected no trimming or rewriting of the body").toBe(body);
  });

  // Validation is a positive behaviour: nothing is built for a blank comment.
  it.each(["", " ", "   \n\t  "])("rejects the blank body %j with an error mentioning the body", (blank) => {
    addCommentMutation("PR_node_1", "ok"); // a non-blank body must still build
    expect(() => addCommentMutation("PR_node_1", blank), "Expected a blank body to be rejected before a request is built").toThrow(/body/i);
  });
});

describe("AF-3: replyMutation replies to a review thread", () => {
  it("calls addPullRequestReviewThreadReply with $input = { pullRequestReviewThreadId, body }", () => {
    const req = replyMutation("PRRT_1", "Fixed in the next push");
    const q = norm(req.query);
    expect(q, "Expected a mutation taking $input: AddPullRequestReviewThreadReplyInput!").toMatch(/^\s*mutation\b[^{]*\$input:\s*AddPullRequestReviewThreadReplyInput!/);
    expect(q, "Expected addPullRequestReviewThreadReply(input: $input)").toMatch(/addPullRequestReviewThreadReply\(input:\s*\$input\)/);
    expect(req.variables, "Expected variables { input: { pullRequestReviewThreadId, body } }").toEqual({ input: { pullRequestReviewThreadId: "PRRT_1", body: "Fixed in the next push" } });
  });

  it.each(NASTY)("keeps reply text out of the query string: %s", (nasty) => {
    const req = replyMutation("PRRT_1", nasty);
    expect(req.query, "Expected the query text to be independent of the body").toBe(replyMutation("PRRT_1", "plain").query);
    expect((req.variables.input as { body: string }).body, "Expected the body to travel unchanged in variables").toBe(nasty);
  });

  it.each(["", " ", "\n\n"])("rejects the blank body %j with an error mentioning the body", (blank) => {
    replyMutation("PRRT_1", "ok"); // a non-blank body must still build
    expect(() => replyMutation("PRRT_1", blank), "Expected a blank reply to be rejected before a request is built").toThrow(/body/i);
  });
});

describe("AF-3 / AF-4: resolve and unresolve a review thread", () => {
  it("resolveMutation calls resolveReviewThread with $input = { threadId }", () => {
    const req = resolveMutation("PRRT_1");
    const q = norm(req.query);
    expect(q, "Expected a mutation taking $input: ResolveReviewThreadInput!").toMatch(/^\s*mutation\b[^{]*\$input:\s*ResolveReviewThreadInput!/);
    expect(q, "Expected resolveReviewThread(input: $input)").toMatch(/resolveReviewThread\(input:\s*\$input\)/);
    expect(req.variables, "Expected variables { input: { threadId } }").toEqual({ input: { threadId: "PRRT_1" } });
  });

  it("unresolveMutation calls unresolveReviewThread with $input = { threadId }", () => {
    const req = unresolveMutation("PRRT_1");
    const q = norm(req.query);
    expect(q, "Expected a mutation taking $input: UnresolveReviewThreadInput!").toMatch(/^\s*mutation\b[^{]*\$input:\s*UnresolveReviewThreadInput!/);
    expect(q, "Expected unresolveReviewThread(input: $input)").toMatch(/unresolveReviewThread\(input:\s*\$input\)/);
    expect(req.variables, "Expected variables { input: { threadId } }").toEqual({ input: { threadId: "PRRT_1" } });
  });

  it.each([["resolve", resolveMutation], ["unresolve", unresolveMutation]] as const)("%s keeps the thread id out of the query string", (_n, build) => {
    const a = build('PRRT_"x"');
    expect(a.query, "Expected the query text to be independent of the thread id").toBe(build("PRRT_2").query);
    expect(a.query, "Expected no thread id in the query text").not.toContain("PRRT_");
  });
});

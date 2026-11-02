import { describe, it, expect } from "vitest";
import {
  actionsDetailQuery,
  reviewMutation,
  dismissReviewMutation,
  mergePullRequestMutation,
  enableAutoMergeMutation,
  disableAutoMergeMutation,
  deleteRefMutation,
  closePullRequestMutation,
  reopenPullRequestMutation,
  convertToDraftMutation,
  markReadyForReviewMutation,
} from "./actionsQuery";

// Module under test: src/lib/actionsQuery.ts.
// Shared rule, as in feedQuery.ts: caller-supplied values (ids, bodies, commit text, oids) travel in `variables`;
// the query text is constant. Every mutation takes one `$input` variable holding GitHub's input object.
// Conventions fixed by these tests:
//  - a builder THROWS (an Error whose message mentions the offending field, e.g. "body") before any request exists.
//  - optional input fields that are blank are OMITTED from `input` (the key is absent), never sent as "" or null.
//  - non-blank text is sent exactly as supplied (no trimming).
// GitHub names used (verified by introspection of the public schema, and docs.github.com/en/graphql/reference/mutations):
//  addPullRequestReview(AddPullRequestReviewInput { pullRequestId!, commitOID, body, event: PullRequestReviewEvent }),
//  dismissPullRequestReview(DismissPullRequestReviewInput { pullRequestReviewId!, message! }),
//  mergePullRequest(MergePullRequestInput { pullRequestId!, commitHeadline, commitBody, expectedHeadOid, mergeMethod, authorEmail }),
//  enablePullRequestAutoMerge(EnablePullRequestAutoMergeInput, same fields), disablePullRequestAutoMerge(DisablePullRequestAutoMergeInput { pullRequestId! }),
//  deleteRef(DeleteRefInput { refId! }), closePullRequest(ClosePullRequestInput), reopenPullRequest(ReopenPullRequestInput),
//  convertPullRequestToDraft(ConvertPullRequestToDraftInput), markPullRequestReadyForReview(MarkPullRequestReadyForReviewInput) (each { pullRequestId! }).

const norm = (s: string) => s.replace(/\s+/g, " ");
const NASTY = ['we"ird', "back\\slash", "ünï cødé 日本", "sp ace #hash", "q{uery}", "$var"];
const input = (r: { variables: Record<string, unknown> }) => r.variables.input as Record<string, unknown>;

/** Asserts `req` is `mutation X($input: TYPE!) { field(input: $input) ... }` and returns nothing. */
function expectMutation(req: { query: string }, inputType: string, field: string) {
  const q = norm(req.query);
  expect(q, `Expected a mutation operation taking $input: ${inputType}!`).toMatch(new RegExp(`^\\s*mutation\\b[^{]*\\$input:\\s*${inputType}!`));
  expect(q, `Expected ${field}(input: $input)`).toMatch(new RegExp(`\\b${field}\\(input:\\s*\\$input\\)`));
  expect(q.match(/\bmutation\b/g), "Expected exactly one operation").toHaveLength(1);
}

describe("A-1: reviewMutation submits an APPROVE or REQUEST_CHANGES review", () => {
  // Given a PR node id and the event, addPullRequestReview's input is { pullRequestId, event, ... }.
  it("calls addPullRequestReview with $input: AddPullRequestReviewInput!", () => {
    expectMutation(reviewMutation({ pullRequestId: "PR_1", event: "APPROVE" }), "AddPullRequestReviewInput", "addPullRequestReview");
  });

  it("approves with { pullRequestId, event: APPROVE } and no body key when none is given", () => {
    const req = reviewMutation({ pullRequestId: "PR_1", event: "APPROVE" });
    expect(req.variables, "Expected variables { input: { pullRequestId, event: 'APPROVE' } } with no body or commitOID keys").toEqual({ input: { pullRequestId: "PR_1", event: "APPROVE" } });
  });

  it.each(["", "  \n"])("omits a blank approve body %j from the input rather than rejecting it", (blank) => {
    const req = reviewMutation({ pullRequestId: "PR_1", event: "APPROVE", body: blank });
    expect(input(req), "Expected the blank approve body to be omitted").not.toHaveProperty("body");
    expect(input(req).event, "Expected the event to be APPROVE").toBe("APPROVE");
  });

  it("sends an approve body (the suggestions) exactly as supplied", () => {
    const body = "Rename `x`.\n\n- tidy the loop\n";
    expect(input(reviewMutation({ pullRequestId: "PR_1", event: "APPROVE", body })).body, "Expected the body to travel unchanged").toBe(body);
  });

  it("requests changes with { pullRequestId, event: REQUEST_CHANGES, body }", () => {
    const req = reviewMutation({ pullRequestId: "PR_1", event: "REQUEST_CHANGES", body: "Please add tests" });
    expect(req.variables, "Expected variables { input: { pullRequestId, event: 'REQUEST_CHANGES', body } }").toEqual({ input: { pullRequestId: "PR_1", event: "REQUEST_CHANGES", body: "Please add tests" } });
  });

  // GitHub rejects REQUEST_CHANGES without a body, so no request is built.
  it.each(["", " ", "\n\t "])("rejects REQUEST_CHANGES with the blank body %j, naming the body", (blank) => {
    reviewMutation({ pullRequestId: "PR_1", event: "REQUEST_CHANGES", body: "ok" }); // a non-blank body must still build
    expect(() => reviewMutation({ pullRequestId: "PR_1", event: "REQUEST_CHANGES", body: blank }), "Expected a blank request-changes body to be rejected").toThrow(/body/i);
  });

  it("rejects REQUEST_CHANGES with no body at all", () => {
    expect(() => reviewMutation({ pullRequestId: "PR_1", event: "REQUEST_CHANGES" }), "Expected a missing request-changes body to be rejected").toThrow(/body/i);
  });

  it("passes commitOid as commitOID so the review is pinned to the commit the reviewer saw", () => {
    const req = reviewMutation({ pullRequestId: "PR_1", event: "APPROVE", commitOid: "abc123" });
    expect(input(req).commitOID, "Expected input.commitOID to carry the supplied oid").toBe("abc123");
  });

  it.each(NASTY)("keeps review text out of the query string: %s", (nasty) => {
    const a = reviewMutation({ pullRequestId: nasty, event: "REQUEST_CHANGES", body: nasty, commitOid: nasty });
    expect(a.query, "Expected the query text to be independent of the caller's text").toBe(reviewMutation({ pullRequestId: "PR_1", event: "REQUEST_CHANGES", body: "plain" }).query);
    expect(a.variables, "Expected the text to travel in variables.input").toEqual({ input: { pullRequestId: nasty, event: "REQUEST_CHANGES", body: nasty, commitOID: nasty } });
  });
});

describe("A-1: dismissReviewMutation resets the viewer's feedback", () => {
  it("calls dismissPullRequestReview with $input = { pullRequestReviewId, message }", () => {
    const req = dismissReviewMutation("PRR_1", "Feedback reset");
    expectMutation(req, "DismissPullRequestReviewInput", "dismissPullRequestReview");
    expect(req.variables, "Expected variables { input: { pullRequestReviewId, message } }").toEqual({ input: { pullRequestReviewId: "PRR_1", message: "Feedback reset" } });
  });

  // `message` is String! in DismissPullRequestReviewInput.
  it.each(["", "   "])("rejects the blank message %j, naming the message", (blank) => {
    dismissReviewMutation("PRR_1", "ok"); // a non-blank message must still build
    expect(() => dismissReviewMutation("PRR_1", blank), "Expected a blank dismissal message to be rejected").toThrow(/message/i);
  });

  it.each(NASTY)("keeps the message out of the query string: %s", (nasty) => {
    const a = dismissReviewMutation(nasty, nasty);
    expect(a.query, "Expected the query text to be independent of the caller's text").toBe(dismissReviewMutation("PRR_1", "plain").query);
    expect(input(a), "Expected the text to travel in variables.input").toEqual({ pullRequestReviewId: nasty, message: nasty });
  });
});

describe("A-2: mergePullRequestMutation completes the pull request", () => {
  const base = { pullRequestId: "PR_1", mergeMethod: "SQUASH" as const, expectedHeadOid: "deadbeef" };

  it("calls mergePullRequest with $input: MergePullRequestInput!", () => {
    expectMutation(mergePullRequestMutation(base), "MergePullRequestInput", "mergePullRequest");
  });

  it("sends { pullRequestId, mergeMethod, expectedHeadOid } and no message keys when none is customised", () => {
    expect(mergePullRequestMutation(base).variables, "Expected only pullRequestId, mergeMethod and expectedHeadOid").toEqual({
      input: { pullRequestId: "PR_1", mergeMethod: "SQUASH", expectedHeadOid: "deadbeef" },
    });
  });

  // The merge is refused by GitHub when the head moved since the reviewer looked: expectedHeadOid is mandatory here.
  it.each(["", "  "])("rejects the blank expectedHeadOid %j, naming it", (blank) => {
    mergePullRequestMutation(base); // a supplied oid must still build
    expect(() => mergePullRequestMutation({ ...base, expectedHeadOid: blank }), "Expected a merge without expectedHeadOid to be refused").toThrow(/expectedHeadOid/i);
  });

  it.each(["MERGE", "SQUASH"] as const)("%s sends the custom commitHeadline and commitBody exactly as supplied", (mergeMethod) => {
    const commitBody = "Line one\n\nLine two\n";
    const req = mergePullRequestMutation({ ...base, mergeMethod, commitHeadline: "Add widget (#5)", commitBody });
    expect(input(req), `Expected the custom message to be sent for ${mergeMethod}`).toMatchObject({ mergeMethod, commitHeadline: "Add widget (#5)", commitBody });
  });

  // GitHub cannot customise a rebase merge, so the message is dropped (not sent, not an error).
  it("REBASE drops a custom commitHeadline and commitBody", () => {
    const req = mergePullRequestMutation({ ...base, mergeMethod: "REBASE", commitHeadline: "Ignored", commitBody: "Ignored too" });
    expect(input(req), "Expected REBASE to send no commitHeadline").not.toHaveProperty("commitHeadline");
    expect(input(req), "Expected REBASE to send no commitBody").not.toHaveProperty("commitBody");
    expect(input(req).mergeMethod, "Expected the method to stay REBASE").toBe("REBASE");
  });

  it.each(["", "  \n"])("omits the blank commitHeadline and commitBody %j so GitHub uses its default", (blank) => {
    const req = mergePullRequestMutation({ ...base, mergeMethod: "MERGE", commitHeadline: blank, commitBody: blank });
    expect(input(req), "Expected a blank headline to be omitted").not.toHaveProperty("commitHeadline");
    expect(input(req), "Expected a blank body to be omitted").not.toHaveProperty("commitBody");
  });

  it.each(NASTY)("keeps commit text out of the query string: %s", (nasty) => {
    const a = mergePullRequestMutation({ ...base, pullRequestId: nasty, expectedHeadOid: nasty, commitHeadline: nasty, commitBody: nasty });
    expect(a.query, "Expected the query text to be independent of the caller's text").toBe(mergePullRequestMutation(base).query);
    expect(input(a), "Expected the text to travel in variables.input").toMatchObject({ pullRequestId: nasty, expectedHeadOid: nasty, commitHeadline: nasty, commitBody: nasty });
  });

  it.each(["MERGE", "SQUASH", "REBASE"] as const)("passes mergeMethod %s through unchanged", (mergeMethod) => {
    expect(input(mergePullRequestMutation({ ...base, mergeMethod })).mergeMethod, "Expected input.mergeMethod to be the PullRequestMergeMethod value").toBe(mergeMethod);
  });

  it("asks for the merged state back so the UI can reconcile", () => {
    expect(norm(mergePullRequestMutation(base).query), "Expected the selection to include pullRequest { ... state ... }").toMatch(/pullRequest\s*\{[^}]*\bstate\b/);
  });
});

describe("A-2: enableAutoMergeMutation sets auto-complete", () => {
  const base = { pullRequestId: "PR_1", mergeMethod: "MERGE" as const, expectedHeadOid: "deadbeef" };

  it("calls enablePullRequestAutoMerge with $input: EnablePullRequestAutoMergeInput!", () => {
    expectMutation(enableAutoMergeMutation(base), "EnablePullRequestAutoMergeInput", "enablePullRequestAutoMerge");
  });

  it("sends { pullRequestId, mergeMethod, expectedHeadOid }", () => {
    expect(enableAutoMergeMutation(base).variables, "Expected variables { input: { pullRequestId, mergeMethod, expectedHeadOid } }").toEqual({
      input: { pullRequestId: "PR_1", mergeMethod: "MERGE", expectedHeadOid: "deadbeef" },
    });
  });

  it("sends a custom message for SQUASH", () => {
    const req = enableAutoMergeMutation({ ...base, mergeMethod: "SQUASH", commitHeadline: "Title", commitBody: "Body" });
    expect(input(req), "Expected the custom message to be sent for SQUASH").toMatchObject({ commitHeadline: "Title", commitBody: "Body" });
  });

  it("REBASE drops a custom commitHeadline and commitBody", () => {
    const req = enableAutoMergeMutation({ ...base, mergeMethod: "REBASE", commitHeadline: "Ignored", commitBody: "Ignored" });
    expect(input(req), "Expected REBASE to send no commitHeadline").not.toHaveProperty("commitHeadline");
    expect(input(req), "Expected REBASE to send no commitBody").not.toHaveProperty("commitBody");
  });

  it("rejects a blank expectedHeadOid, naming it", () => {
    enableAutoMergeMutation(base);
    expect(() => enableAutoMergeMutation({ ...base, expectedHeadOid: " " }), "Expected auto-complete without expectedHeadOid to be refused").toThrow(/expectedHeadOid/i);
  });

  it.each(NASTY)("keeps commit text out of the query string: %s", (nasty) => {
    expect(enableAutoMergeMutation({ ...base, commitHeadline: nasty, commitBody: nasty }).query, "Expected the query text to be independent of the caller's text").toBe(enableAutoMergeMutation(base).query);
  });
});

describe("A-2: disableAutoMergeMutation cancels auto-complete", () => {
  it("calls disablePullRequestAutoMerge with $input = { pullRequestId }", () => {
    const req = disableAutoMergeMutation("PR_1");
    expectMutation(req, "DisablePullRequestAutoMergeInput", "disablePullRequestAutoMerge");
    expect(req.variables, "Expected variables { input: { pullRequestId } }").toEqual({ input: { pullRequestId: "PR_1" } });
  });

  it("keeps the id out of the query string", () => {
    expect(disableAutoMergeMutation('PR_"x"').query, "Expected the query text to be independent of the id").toBe(disableAutoMergeMutation("PR_2").query);
  });
});

describe("A-2: deleteRefMutation deletes the source branch after merging", () => {
  it("calls deleteRef with $input = { refId }", () => {
    const req = deleteRefMutation("REF_1");
    expectMutation(req, "DeleteRefInput", "deleteRef");
    expect(req.variables, "Expected variables { input: { refId } }").toEqual({ input: { refId: "REF_1" } });
  });

  it("keeps the ref id out of the query string", () => {
    expect(deleteRefMutation('REF_"x"').query, "Expected the query text to be independent of the ref id").toBe(deleteRefMutation("REF_2").query);
  });
});

describe("A-4: state mutations take the pull request id", () => {
  const cases = [
    ["closePullRequestMutation (Abandon)", closePullRequestMutation, "ClosePullRequestInput", "closePullRequest"],
    ["reopenPullRequestMutation (Reactivate)", reopenPullRequestMutation, "ReopenPullRequestInput", "reopenPullRequest"],
    ["convertToDraftMutation (Mark as draft)", convertToDraftMutation, "ConvertPullRequestToDraftInput", "convertPullRequestToDraft"],
    ["markReadyForReviewMutation (Publish)", markReadyForReviewMutation, "MarkPullRequestReadyForReviewInput", "markPullRequestReadyForReview"],
  ] as const;

  it.each(cases)("%s calls the mutation with $input = { pullRequestId }", (_n, build, inputType, field) => {
    const req = build("PR_1");
    expectMutation(req, inputType, field);
    expect(req.variables, "Expected variables { input: { pullRequestId } }").toEqual({ input: { pullRequestId: "PR_1" } });
  });

  it.each(cases)("%s keeps the id out of the query string", (_n, build) => {
    expect(build('PR_"x"').query, "Expected the query text to be independent of the id").toBe(build("PR_2").query);
  });

  it.each(cases)("%s selects the pull request state back for reconciliation", (_n, build) => {
    expect(norm(build("PR_1").query), "Expected pullRequest { id state isDraft } (or similar) in the selection").toMatch(/pullRequest\s*\{[^}]*\bstate\b[^}]*\bisDraft\b|pullRequest\s*\{[^}]*\bisDraft\b[^}]*\bstate\b/);
  });
});

describe("A-1 / A-2 / A-3: actionsDetailQuery fetches what the action UI needs in one request", () => {
  const params = { owner: "acme", name: "web", number: 42 };

  it("sends owner, name and number as variables", () => {
    expect(actionsDetailQuery(params).variables, "Expected variables { owner, name, number }").toEqual({ owner: "acme", name: "web", number: 42 });
  });

  it("declares $owner: String!, $name: String!, $number: Int! and uses them", () => {
    const q = norm(actionsDetailQuery(params).query);
    expect(q, "Expected $owner: String!").toMatch(/\$owner:\s*String!/);
    expect(q, "Expected $name: String!").toMatch(/\$name:\s*String!/);
    expect(q, "Expected $number: Int!").toMatch(/\$number:\s*Int!/);
    expect(q, "Expected repository(owner: $owner, name: $name)").toMatch(/repository\(owner:\s*\$owner,\s*name:\s*\$name\)/);
    expect(q, "Expected pullRequest(number: $number)").toMatch(/pullRequest\(number:\s*\$number\)/);
  });

  it.each(NASTY)("never puts caller text in the query string: %s", (nasty) => {
    const a = actionsDetailQuery({ owner: nasty, name: nasty, number: 7 });
    expect(a.query, "Expected the query text to be identical whatever the caller supplies").toBe(actionsDetailQuery(params).query);
    expect(a.variables, "Expected the caller's text to travel in variables").toMatchObject({ owner: nasty, name: nasty });
  });

  it("is a single query operation", () => {
    const q = norm(actionsDetailQuery(params).query);
    expect(q, "Expected the text to start with a query operation").toMatch(/^\s*query\b/);
    expect(q.match(/\b(query|mutation|subscription)\b\s*\w*\s*\(/g), "Expected exactly one operation").toHaveLength(1);
  });

  // Repository fields: A-2 allowed methods and auto-merge; A-2 delete-branch default; A-1 dismissal permission.
  it.each(["mergeCommitAllowed", "squashMergeAllowed", "rebaseMergeAllowed", "autoMergeAllowed", "deleteBranchOnMerge", "viewerPermission"])("selects repository.%s", (field) => {
    const q = actionsDetailQuery(params).query;
    const repoOnly = q.slice(0, q.search(/pullRequest\(number:/));
    expect(repoOnly, `Expected ${field} selected on repository, before pullRequest(...)`).toMatch(new RegExp(`\\b${field}\\b`));
  });

  it("selects repository.defaultBranchRef { name }", () => {
    const q = norm(actionsDetailQuery(params).query);
    expect(q, "Expected defaultBranchRef { name } so the default branch is never offered for deletion").toMatch(/defaultBranchRef\s*\{[^}]*\bname\b/);
  });

  // Pull request fields: ids for mutations, state for A-3/A-4, viewer flags for A-1/A-2/A-4 (PullRequest.viewerCan* in the GitHub schema).
  it.each([
    "id", "state", "isDraft", "merged", "mergeStateStatus", "reviewDecision", "baseRefName", "headRefName", "headRefOid", "isCrossRepository",
    "viewerDidAuthor", "viewerCanUpdate", "viewerCanClose", "viewerCanReopen", "viewerCanDeleteHeadRef", "viewerCanEnableAutoMerge", "viewerCanDisableAutoMerge", "viewerCanMergeAsAdmin",
  ])("selects pullRequest.%s", (field) => {
    const q = actionsDetailQuery(params).query;
    const pr = q.slice(q.search(/pullRequest\(number:/));
    expect(pr, `Expected ${field} selected on the pull request`).toMatch(new RegExp(`\\b${field}\\b`));
  });

  it("selects headRef { id name branchProtectionRule { allowsDeletions } } (the deleteRef target and its protection)", () => {
    const q = norm(actionsDetailQuery(params).query);
    expect(q, "Expected headRef { id ... } so deleteRef has a refId").toMatch(/headRef\s*\{[^}]*\bid\b/);
    expect(q, "Expected headRef to select name").toMatch(/headRef\s*\{[^}]*\bname\b/);
    expect(q, "Expected branchProtectionRule { allowsDeletions } on the head ref").toMatch(/branchProtectionRule\s*\{[^}]*\ballowsDeletions\b/);
  });

  it("selects viewerLatestReview { id state } (the review Reset feedback dismisses)", () => {
    expect(norm(actionsDetailQuery(params).query), "Expected viewerLatestReview { id state }").toMatch(/viewerLatestReview\s*\{[^}]*\bid\b[^}]*\bstate\b/);
  });

  it("selects autoMergeRequest { mergeMethod ... }", () => {
    expect(norm(actionsDetailQuery(params).query), "Expected autoMergeRequest { ... mergeMethod ... }").toMatch(/autoMergeRequest\s*\{[^}]*\bmergeMethod\b/);
  });

  // A-3: the head commit's rollup contexts, each with whether it is required for THIS pull request.
  it("selects the fields check de-duplication needs", () => {
    const q = actionsDetailQuery({ owner: "o", name: "n", number: 1 }).query.replace(/\s+/g, " ");
    expect(q).toMatch(/startedAt completedAt checkSuite \{ workflowRun \{ workflow \{ name \} \} \}/);
    expect(q).toMatch(/StatusContext \{[^}]*createdAt/);
  });
  it("selects statusCheckRollup { state contexts(first: N) { nodes { __typename ... } } }", () => {
    const q = norm(actionsDetailQuery(params).query);
    expect(q, "Expected statusCheckRollup { state contexts(first: ...) }").toMatch(/statusCheckRollup\s*\{\s*state\s+contexts\(first:\s*\d+\)/);
    expect(q, "Expected __typename on the context nodes so CheckRun and StatusContext can be told apart").toMatch(/nodes\s*\{\s*__typename/);
  });

  it("selects the CheckRun fields name status conclusion detailsUrl and isRequired(pullRequestNumber: $number)", () => {
    const q = norm(actionsDetailQuery(params).query);
    const m = /\.\.\.\s*on\s+CheckRun\s*\{([^}]*)\}/.exec(q);
    expect(m, "Expected an inline fragment `... on CheckRun { ... }`").not.toBeNull();
    for (const f of ["name", "status", "conclusion", "detailsUrl"]) expect(m![1], `Expected CheckRun.${f}`).toMatch(new RegExp(`\\b${f}\\b`));
    expect(m![1], "Expected isRequired(pullRequestNumber: $number) on CheckRun").toMatch(/isRequired\(pullRequestNumber:\s*\$number\)/);
  });

  it("selects the StatusContext fields context state targetUrl and isRequired(pullRequestNumber: $number)", () => {
    const q = norm(actionsDetailQuery(params).query);
    const m = /\.\.\.\s*on\s+StatusContext\s*\{([^}]*)\}/.exec(q);
    expect(m, "Expected an inline fragment `... on StatusContext { ... }`").not.toBeNull();
    for (const f of ["context", "state", "targetUrl"]) expect(m![1], `Expected StatusContext.${f}`).toMatch(new RegExp(`\\b${f}\\b`));
    expect(m![1], "Expected isRequired(pullRequestNumber: $number) on StatusContext").toMatch(/isRequired\(pullRequestNumber:\s*\$number\)/);
  });
});

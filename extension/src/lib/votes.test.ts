import { describe, it, expect } from "vitest";
import { voteOptions, voteMutation, type VoteContext, type VoteRequestContext, type VoteId } from "./votes";

// Module under test: src/lib/votes.ts (voteOptions, voteMutation). Requirement A-1: "Vote menu like native".
//
// Mapping fixed by these tests (native ADO vote -> GitHub review):
//   Approve                 -> addPullRequestReview event APPROVE            (body optional)
//   Approve with suggestions-> addPullRequestReview event APPROVE            (body REQUIRED: the suggestions text)
//   Wait for author         -> addPullRequestReview event REQUEST_CHANGES    (body REQUIRED: GitHub refuses it without one)
//   Reject                  -> addPullRequestReview event REQUEST_CHANGES    (body REQUIRED)
//   Reset feedback          -> dismissPullRequestReview on viewerLatestReview (only when it is APPROVED or CHANGES_REQUESTED)
//
// How the UI knows each option's availability (inputs, all fetched by actionsDetailQuery in src/lib/actionsQuery.ts):
//   - PullRequest.state: reviews are offered only while the PR is OPEN.
//   - PullRequest.viewerDidAuthor: GitHub does not let you approve or request changes on your own PR.
//     NOTE (GitHub schema, verified by introspection): there is NO PullRequest.viewerCanApprove / viewerCanRequestChanges field;
//     viewerDidAuthor is the signal. (viewerCanApprove exists only on MarketplaceListing.)
//   - PullRequest.viewerLatestReview { id state } plus Repository.viewerPermission: "Reset feedback" dismisses the viewer's latest
//     decisive review, which GitHub allows for people with write access (WRITE, MAINTAIN, ADMIN). PullRequestReview has no
//     viewerCanDismiss field. When it cannot be done the entry is ABSENT from the list ("otherwise not offered").
//   - A disabled option is still listed, with enabled: false and a non-empty disabledReason; an enabled option has no disabledReason.

const open: VoteContext = { state: "OPEN", viewerDidAuthor: false, viewerPermission: "READ", viewerLatestReview: null };
const req = (over: Partial<VoteRequestContext> = {}): VoteRequestContext => ({ ...open, pullRequestId: "PR_1", headOid: "deadbeef", ...over });
const ids = (c: VoteContext) => voteOptions(c).map((o) => o.id);
const find = (c: VoteContext, id: VoteId) => voteOptions(c).find((o) => o.id === id);
const input = (r: { variables: Record<string, unknown> }) => r.variables.input as Record<string, unknown>;
const norm = (s: string) => s.replace(/\s+/g, " ");
const WRITE_ROLES = ["WRITE", "MAINTAIN", "ADMIN"];

describe("A-1: the vote menu lists the native options in native order", () => {
  it("offers Approve, Approve with suggestions, Wait for author, Reject for a reviewer with no earlier review", () => {
    expect(ids(open), "Expected the four votes in native order, with no Reset feedback when there is nothing to reset").toEqual(["approve", "approveWithSuggestions", "waitForAuthor", "reject"]);
  });

  it("uses the native labels", () => {
    const labels = Object.fromEntries(voteOptions({ ...open, viewerPermission: "WRITE", viewerLatestReview: { id: "R", state: "APPROVED" } }).map((o) => [o.id, o.label]));
    expect(labels, "Expected native labels for every vote").toEqual({
      approve: "Approve",
      approveWithSuggestions: "Approve with suggestions",
      waitForAuthor: "Wait for author",
      reject: "Reject",
      reset: "Reset feedback",
    });
  });

  it("puts Reset feedback last when it is offered", () => {
    const list = ids({ ...open, viewerPermission: "WRITE", viewerLatestReview: { id: "R", state: "CHANGES_REQUESTED" } });
    expect(list, "Expected Reset feedback after Reject").toEqual(["approve", "approveWithSuggestions", "waitForAuthor", "reject", "reset"]);
  });

  it("marks which options need a body", () => {
    const required = Object.fromEntries(voteOptions({ ...open, viewerPermission: "WRITE", viewerLatestReview: { id: "R", state: "APPROVED" } }).map((o) => [o.id, o.bodyRequired]));
    expect(required, "Expected a body to be required for suggestions, wait and reject only (reset supplies its own message)").toEqual({
      approve: false,
      approveWithSuggestions: true,
      waitForAuthor: true,
      reject: true,
      reset: false,
    });
  });
});

describe("A-1: availability of the four votes", () => {
  it("enables all four votes for another person's open pull request, with no disabledReason", () => {
    for (const o of voteOptions(open)) {
      expect(o.enabled, `Expected ${o.id} to be enabled on someone else's open PR`).toBe(true);
      expect(o.disabledReason, `Expected no disabledReason on enabled option ${o.id}`).toBeUndefined();
    }
  });

  // The viewer cannot approve or request changes on their own pull request (PullRequest.viewerDidAuthor).
  it.each(["approve", "approveWithSuggestions", "waitForAuthor", "reject"] as const)("disables %s on the viewer's own pull request with a reason that mentions it is their own", (id) => {
    const o = find({ ...open, viewerDidAuthor: true }, id);
    expect(o, `Expected ${id} to stay listed (disabled), not vanish`).toBeDefined();
    expect(o!.enabled, `Expected ${id} to be disabled on your own PR`).toBe(false);
    expect(o!.disabledReason, `Expected a reason for ${id} that says it is your own pull request`).toMatch(/own/i);
  });

  it.each(["CLOSED", "MERGED"] as const)("disables the four votes on a %s pull request with a non-empty reason", (state) => {
    for (const id of ["approve", "approveWithSuggestions", "waitForAuthor", "reject"] as const) {
      const o = find({ ...open, state }, id)!;
      expect(o.enabled, `Expected ${id} to be disabled when the PR is ${state}`).toBe(false);
      expect((o.disabledReason ?? "").length, `Expected a non-empty disabledReason for ${id} when ${state}`).toBeGreaterThan(0);
    }
  });
});

describe("A-1: Reset feedback is offered only when it can be done", () => {
  const withReview = (state: string, viewerPermission: string | null, over: Partial<VoteContext> = {}): VoteContext => ({
    ...open,
    viewerPermission,
    viewerLatestReview: { id: "PRR_1", state },
    ...over,
  });

  it.each(["APPROVED", "CHANGES_REQUESTED"])("is offered and enabled after a %s review for someone with write access", (state) => {
    const o = find(withReview(state, "WRITE"), "reset");
    expect(o, `Expected Reset feedback to be offered after ${state}`).toBeDefined();
    expect(o!.enabled, "Expected Reset feedback to be enabled").toBe(true);
    expect(o!.disabledReason, "Expected no disabledReason").toBeUndefined();
  });

  it.each(WRITE_ROLES)("is offered for the %s role", (role) => {
    expect(ids(withReview("APPROVED", role)), `Expected reset for ${role}`).toContain("reset");
  });

  it.each(["READ", "TRIAGE", null])("is not offered to someone with %s permission (GitHub only lets write access dismiss reviews)", (role) => {
    expect(ids(withReview("APPROVED", role)), `Expected no reset for ${String(role)}`).not.toContain("reset");
  });

  it.each(["COMMENTED", "DISMISSED", "PENDING"])("is not offered when the latest review is %s (nothing decisive to reset)", (state) => {
    expect(ids(withReview(state, "ADMIN")), `Expected no reset after a ${state} review`).not.toContain("reset");
  });

  it("is not offered when the viewer has no review", () => {
    expect(ids({ ...open, viewerPermission: "ADMIN", viewerLatestReview: null }), "Expected no reset without a review").not.toContain("reset");
  });

  it.each(["CLOSED", "MERGED"] as const)("is not offered on a %s pull request", (state) => {
    expect(ids(withReview("APPROVED", "ADMIN", { state })), `Expected no reset when ${state}`).not.toContain("reset");
  });

  it("leaves the four votes listed when Reset feedback is not offered", () => {
    expect(ids(withReview("APPROVED", "READ")), "Expected the four votes to be unaffected").toEqual(["approve", "approveWithSuggestions", "waitForAuthor", "reject"]);
  });
});

describe("A-1: voteMutation maps each vote to a GitHub review", () => {
  it("Approve sends addPullRequestReview { pullRequestId, event: APPROVE, commitOID } with no body", () => {
    const r = voteMutation("approve", req());
    expect(norm(r.query), "Expected the addPullRequestReview mutation").toMatch(/addPullRequestReview\(input:\s*\$input\)/);
    expect(r.variables, "Expected variables { input: { pullRequestId, event: 'APPROVE', commitOID: headOid } }").toEqual({ input: { pullRequestId: "PR_1", event: "APPROVE", commitOID: "deadbeef" } });
  });

  it("Approve with suggestions sends event APPROVE and the suggestions as the body", () => {
    const r = voteMutation("approveWithSuggestions", req(), "Consider a guard clause.");
    expect(input(r), "Expected APPROVE with the suggestions as body and the head oid as commitOID").toEqual({ pullRequestId: "PR_1", event: "APPROVE", body: "Consider a guard clause.", commitOID: "deadbeef" });
  });

  it("Wait for author sends event REQUEST_CHANGES with the body", () => {
    const r = voteMutation("waitForAuthor", req(), "Waiting for the migration.");
    expect(input(r), "Expected REQUEST_CHANGES with the body").toEqual({ pullRequestId: "PR_1", event: "REQUEST_CHANGES", body: "Waiting for the migration.", commitOID: "deadbeef" });
  });

  it("Reject sends event REQUEST_CHANGES with the body", () => {
    const r = voteMutation("reject", req(), "Wrong approach.");
    expect(input(r), "Expected REQUEST_CHANGES with the body").toEqual({ pullRequestId: "PR_1", event: "REQUEST_CHANGES", body: "Wrong approach.", commitOID: "deadbeef" });
  });

  it.each(["approveWithSuggestions", "waitForAuthor", "reject"] as const)("%s rejects a missing or blank body, naming the body", (vote) => {
    voteMutation(vote, req(), "ok"); // a body must make it build
    expect(() => voteMutation(vote, req()), `Expected ${vote} with no body to be rejected`).toThrow(/body/i);
    expect(() => voteMutation(vote, req(), "   \n"), `Expected ${vote} with a blank body to be rejected`).toThrow(/body/i);
  });

  it("Approve accepts a blank body (the body is optional there)", () => {
    expect(() => voteMutation("approve", req(), "  "), "Expected plain Approve to build with a blank body").not.toThrow();
  });

  it("Reset feedback sends dismissPullRequestReview for the viewer's latest review with a non-blank message", () => {
    const r = voteMutation("reset", req({ viewerPermission: "WRITE", viewerLatestReview: { id: "PRR_9", state: "APPROVED" } }));
    expect(norm(r.query), "Expected the dismissPullRequestReview mutation").toMatch(/dismissPullRequestReview\(input:\s*\$input\)/);
    expect(input(r).pullRequestReviewId, "Expected the viewer's latest review id").toBe("PRR_9");
    expect(String(input(r).message ?? "").trim().length, "Expected a non-blank dismissal message (String! in the schema)").toBeGreaterThan(0);
  });

  it("Reset feedback uses the supplied text as the dismissal message when there is one", () => {
    const r = voteMutation("reset", req({ viewerPermission: "WRITE", viewerLatestReview: { id: "PRR_9", state: "CHANGES_REQUESTED" } }), "Resolved offline");
    expect(input(r).message, "Expected the supplied text to be the message").toBe("Resolved offline");
  });

  // A disabled option must not build a request: the error is the option's own reason.
  it("throws the disabledReason when voting on your own pull request", () => {
    expect(() => voteMutation("approve", req({ viewerDidAuthor: true })), "Expected approving your own PR to be refused with its reason").toThrow(/own/i);
  });

  it("throws when Reset feedback is requested but cannot be done", () => {
    expect(() => voteMutation("reset", req({ viewerPermission: "READ", viewerLatestReview: { id: "PRR_9", state: "APPROVED" } })), "Expected reset without write access to be refused, with a message that mentions the reset or dismissal").toThrow(/reset|dismiss/i);
    expect(() => voteMutation("reset", req()), "Expected reset with no review to be refused, with a message that mentions the reset or dismissal").toThrow(/reset|dismiss/i);
  });

  it("keeps the body out of the query string", () => {
    const a = voteMutation("reject", req(), 'we"ird {query} $var');
    expect(a.query, "Expected the query text to be independent of the body").toBe(voteMutation("reject", req(), "plain").query);
    expect(input(a).body, "Expected the body to travel unchanged in variables").toBe('we"ird {query} $var');
  });
});

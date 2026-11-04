import { describe, it, expect } from "vitest";
import { copilotReviewMutation, copilotAvailability, copilotFindings, copilotResult, reviewerName, type CopilotAvailabilityInput } from "./copilotReview";
import { COPILOT_OVERVIEW_BODY } from "./copilotOverview.fixture";
import { expectMutation, expectNotInQuery, NASTY, norm } from "./ciTestHelpers";

// Module under test: src/lib/copilotReview.ts (copilotReviewMutation, copilotAvailability, copilotResult).
// Requirement CI-7: "Request a Copilot review": build the request plus an availability rule: hidden when the repo or org has no Copilot code review;
// if availability can't be detected, offer it and surface GitHub's error.
//
// Research result (live schema; nothing was requested on a real PR): it is possible through GraphQL.
//  mutation requestCopilotCodeReview(input: RequestCopilotCodeReviewInput! { pullRequestId: ID!, reviewEffort: CopilotCodeReviewEffort }) returns
//  { success, failureReason: CopilotCodeReviewRequestReason (ACTOR_INELIGIBLE REPOSITORY_INELIGIBLE APP_NOT_INSTALLED NO_QUOTA_REMAINING
//  LICENSED_ORGANIZATION_UNAVAILABLE REQUEST_CONFLICT), reviewRequest { id }, pullRequest { id } }. It has a typed reason where
//  requestReviewsByLogin (botLogins: ["copilot-pull-request-reviewer[bot]"]) and REST requested_reviewers do not.
//  Availability has no schema signal (Repository and Organization have no Copilot field), so it is offered and the failureReason is surfaced.
// Decisions fixed by these tests:
//  - offered: OPEN, viewerCanUpdate, no pending Copilot request (a Bot reviewer with login "copilot-pull-request-reviewer"), and no earlier failure that cannot change
//    (ACTOR_INELIGIBLE, REPOSITORY_INELIGIBLE, APP_NOT_INSTALLED, LICENSED_ORGANIZATION_UNAVAILABLE). NO_QUOTA_REMAINING and unknown reasons keep it offered.
//  - copilotResult: success -> ok; REQUEST_CONFLICT -> "already requested", not hidden; the four permanent reasons -> hide true; the rest -> hide false.
//  - reviewEffort is sent only when given.

const avail = (over: Partial<CopilotAvailabilityInput> = {}): CopilotAvailabilityInput => ({ state: "OPEN", viewerCanUpdate: true, reviewRequests: [], lastFailureReason: null, ...over });
const copilotPending = { requestedReviewer: { __typename: "Bot", login: "copilot-pull-request-reviewer" } };
const PERMANENT = ["ACTOR_INELIGIBLE", "REPOSITORY_INELIGIBLE", "APP_NOT_INSTALLED", "LICENSED_ORGANIZATION_UNAVAILABLE"];

describe("CI-7: copilotReviewMutation calls requestCopilotCodeReview with $input", () => {
  // Given a PR node id, the input is { pullRequestId } and nothing else.
  it("takes $input: RequestCopilotCodeReviewInput! with just { pullRequestId } by default", () => {
    const req = copilotReviewMutation("PR_1");
    expectMutation(req, "RequestCopilotCodeReviewInput", "requestCopilotCodeReview");
    expect(req.variables, "Expected variables { input: { pullRequestId } } with no reviewEffort key").toEqual({ input: { pullRequestId: "PR_1" } });
  });

  it.each(["LITE", "BALANCED", "MAX", "AUTO"] as const)("sends reviewEffort %s when given", (effort) => {
    expect(copilotReviewMutation("PR_1", effort).variables, `Expected reviewEffort ${effort} in the input`).toEqual({ input: { pullRequestId: "PR_1", reviewEffort: effort } });
  });

  it("selects success and failureReason so GitHub's reason can be shown", () => {
    const q = norm(copilotReviewMutation("PR_1").query);
    expect(q, "Expected success in the selection").toMatch(/\bsuccess\b/);
    expect(q, "Expected failureReason in the selection").toMatch(/\bfailureReason\b/);
  });

  it.each(["", "  "])("throws on a blank pull request id %j", (blank) => {
    expect(() => copilotReviewMutation(blank), "Expected an error mentioning pullRequestId").toThrow(/pullRequestId/);
  });

  it.each(NASTY)("keeps %j out of the query text", (v) => {
    const req = copilotReviewMutation(v);
    expectNotInQuery(req, [v]);
    expect(req.variables, "Expected the awkward id to travel in variables").toEqual({ input: { pullRequestId: v } });
  });
});

describe("CI-7: copilotAvailability decides whether to offer 'Request Copilot review'", () => {
  it("offers it on an open pull request the viewer can update when nothing is known against it", () => {
    const a = copilotAvailability(avail());
    expect(a.offered, "Expected the option to be offered when availability cannot be detected").toBe(true);
    expect(a, "Expected no reason when offered").not.toHaveProperty("reason");
  });

  it.each(["CLOSED", "MERGED"] as const)("does not offer it on a %s pull request", (state) => {
    const a = copilotAvailability(avail({ state }));
    expect(a.offered, `Expected no Copilot review on a ${state} PR`).toBe(false);
    expect(a.reason, "Expected a reason").toBeTruthy();
  });

  it("does not offer it when the viewer cannot update the pull request", () => {
    const a = copilotAvailability(avail({ viewerCanUpdate: false }));
    expect(a.offered, "Expected no option without permission to request reviews").toBe(false);
    expect(a.reason, "Expected a reason").toBeTruthy();
  });

  it("does not offer it while a Copilot review is already requested", () => {
    const a = copilotAvailability(avail({ reviewRequests: [copilotPending] }));
    expect(a.offered, "Expected no second request while one is pending").toBe(false);
    expect(a.reason, "Expected a reason that says it is already requested").toMatch(/already|pending|requested/i);
  });

  it("is not put off by other reviewers or a missing reviewer", () => {
    const a = copilotAvailability(avail({ reviewRequests: [{ requestedReviewer: { __typename: "User", login: "octocat" } }, { requestedReviewer: null }] }));
    expect(a.offered, "Expected a human reviewer request, or one GitHub hides, not to count as Copilot").toBe(true);
  });

  it.each(PERMANENT)("hides it after an earlier attempt failed with %s", (reason) => {
    const a = copilotAvailability(avail({ lastFailureReason: reason }));
    expect(a.offered, `Expected ${reason} to hide the option (the repository or organisation has no Copilot code review for this user)`).toBe(false);
    expect(a.reason, "Expected a reason").toBeTruthy();
  });

  it.each(["NO_QUOTA_REMAINING", "REQUEST_CONFLICT", "SOMETHING_NEW"])("keeps it offered after an earlier attempt failed with %s", (reason) => {
    expect(copilotAvailability(avail({ lastFailureReason: reason })).offered, `Expected ${reason} not to hide the option`).toBe(true);
  });
});

describe("CI-7: copilotResult surfaces GitHub's answer", () => {
  it("is ok when the request succeeded", () => {
    expect(copilotResult({ success: true, failureReason: null }), "Expected ok for success").toEqual({ ok: true });
  });

  it("says a review is already requested for REQUEST_CONFLICT, without hiding the option", () => {
    const r = copilotResult({ success: false, failureReason: "REQUEST_CONFLICT" });
    expect(r.ok, "Expected not ok").toBe(false);
    expect(!r.ok && r.message, "Expected the message to say it is already requested").toMatch(/already|pending/i);
    expect(!r.ok && r.hide, "Expected the option to stay").toBe(false);
  });

  it.each(PERMANENT)("hides the option for %s and gives a message", (reason) => {
    const r = copilotResult({ success: false, failureReason: reason });
    expect(r.ok, "Expected not ok").toBe(false);
    expect(!r.ok && r.hide, `Expected ${reason} to hide the option`).toBe(true);
    expect(!r.ok && r.message.trim().length, `Expected a message for ${reason}`).toBeGreaterThan(0);
  });

  it("explains an exhausted quota without hiding the option", () => {
    const r = copilotResult({ success: false, failureReason: "NO_QUOTA_REMAINING" });
    expect(!r.ok && r.hide, "Expected the option to stay for NO_QUOTA_REMAINING").toBe(false);
    expect(!r.ok && r.message, "Expected the message to mention the quota").toMatch(/quota/i);
  });

  it("gives each failure its own message", () => {
    const all = [...PERMANENT, "NO_QUOTA_REMAINING", "REQUEST_CONFLICT"].map((reason) => {
      const r = copilotResult({ success: false, failureReason: reason });
      return r.ok ? "" : r.message;
    });
    expect(new Set(all).size, "Expected six distinct messages, one per known reason").toBe(6);
  });

  it("includes the raw reason for one it does not know, and does not hide the option", () => {
    const r = copilotResult({ success: false, failureReason: "SOMETHING_NEW" });
    expect(!r.ok && r.message, "Expected GitHub's own reason to be shown").toContain("SOMETHING_NEW");
    expect(!r.ok && r.hide, "Expected the option to stay").toBe(false);
  });

  it.each([null, undefined])("gives a generic failure for %s or success false with no reason", (payload) => {
    const r = copilotResult(payload);
    expect(r.ok, "Expected not ok without a successful payload").toBe(false);
    expect(!r.ok && r.hide, "Expected the option to stay").toBe(false);
    expect(!r.ok && r.message.trim().length, "Expected a message").toBeGreaterThan(0);
  });

  it("gives a generic failure when success is false and no reason is given", () => {
    const r = copilotResult({ success: false, failureReason: null });
    expect(r.ok, "Expected not ok").toBe(false);
    expect(!r.ok && r.message.trim().length, "Expected a message").toBeGreaterThan(0);
  });
});

describe("reviewerName", () => {
  it("labels the Copilot bot as Copilot, as GitHub does", () => expect(reviewerName("copilot-pull-request-reviewer")).toBe("Copilot"));
  it("leaves people and teams alone", () => expect(reviewerName("octocat")).toBe("octocat"));
});

describe("copilotFindings: titles and severities from Copilot's review overview", () => {
  it("reads every item of a real overview, keyed by the comment's databaseId", () => {
    const f = copilotFindings(COPILOT_OVERVIEW_BODY);
    expect([...f.keys()]).toEqual([4465220965, 4465221016, 4465221138, 4465221234]);
    expect(f.get(4465221234)).toEqual({ title: "Expand and JSON-quote the default reasoning effort", severity: "Medium" });
    expect(f.get(4465220965)).toEqual({ title: "Reject symlinks before reading agent-written output", severity: "High" });
  });

  it("takes the severity from before the link, not from a later badge", () => {
    const body = '- [Plain title](https://github.com/o/r/pull/1#discussion_r7) <img alt="High severity">';
    expect(copilotFindings(body).get(7)).toEqual({ title: "Plain title" });
  });

  it("normalises the severity's case and unescapes brackets in the title", () => {
    const body = '* <img alt="low severity"> [Use \\[\\] not Array()](https://github.com/o/r/pull/1#discussion_r9) · New';
    expect(copilotFindings(body).get(9)).toEqual({ title: "Use [] not Array()", severity: "Low" });
  });

  it("ignores links that are not list items or not discussion links", () => {
    const body = ["See [this](https://github.com/o/r/pull/1#discussion_r1).", "- [Docs](https://example.com/docs)", "- not a link"].join("\n");
    expect(copilotFindings(body).size).toBe(0);
    expect(copilotFindings(null).size).toBe(0);
  });
});

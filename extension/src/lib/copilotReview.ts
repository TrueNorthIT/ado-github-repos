// CI-7: request a Copilot review. STUBS: the developer implements them.
// Finding (schema checked live; nothing was requested on a real PR): it IS possible, and GraphQL beats REST for it.
//  - GraphQL mutation requestCopilotCodeReview(input: RequestCopilotCodeReviewInput! { pullRequestId: ID!, reviewEffort: CopilotCodeReviewEffort (LITE BALANCED MAX AUTO) })
//    returns { success, failureReason, reviewRequest { id }, pullRequest { id } }. failureReason (CopilotCodeReviewRequestReason) is ACTOR_INELIGIBLE, REPOSITORY_INELIGIBLE,
//    APP_NOT_INSTALLED, NO_QUOTA_REMAINING, LICENSED_ORGANIZATION_UNAVAILABLE or REQUEST_CONFLICT (a request is already pending), null on success.
//  - Alternatives: requestReviewsByLogin(input: { pullRequestId, botLogins: ["copilot-pull-request-reviewer[bot]"], union: true }) passes validation too (checked live with a bogus id).
//    REST POST /repos/{o}/{r}/pulls/{n}/requested_reviewers { reviewers: ["copilot-pull-request-reviewer[bot]"] } is NOT confirmed: the OpenAPI spec only says `reviewers`
//    are user logins, and it was not exercised. Neither alternative gives a typed reason.
//  - Availability cannot be detected beforehand: Repository and Organization expose no field for Copilot code review. So it is offered and GitHub's failureReason is surfaced.
//  - In GraphQL the reviewer's login is "copilot-pull-request-reviewer" (type Bot), without the "[bot]" suffix that REST and requestReviewsByLogin use.
//  - Unverified: whether a GitHub App user-to-server token is allowed to call the mutation (it answers failureReason ACTOR_INELIGIBLE or a GraphQL error if not).
import type { GraphQlRequest } from "./prQuery";

export type CopilotReviewEffort = "LITE" | "BALANCED" | "MAX" | "AUTO";

/** `mutation($input: RequestCopilotCodeReviewInput!)` with { pullRequestId } and, only when given, reviewEffort. Throws when pullRequestId is blank. Returns success failureReason reviewRequest { id } pullRequest { id }. */
export function copilotReviewMutation(pullRequestId: string, reviewEffort?: CopilotReviewEffort): GraphQlRequest {
  if (!pullRequestId.trim()) throw new Error("pullRequestId is required");
  return {
    query: `mutation($input: RequestCopilotCodeReviewInput!) {
  requestCopilotCodeReview(input: $input) { success failureReason reviewRequest { id } pullRequest { id } }
}`,
    variables: { input: { pullRequestId, ...(reviewEffort ? { reviewEffort } : {}) } },
  };
}

export interface CopilotAvailabilityInput {
  state: "OPEN" | "CLOSED" | "MERGED";
  /** PullRequest.viewerCanUpdate. */
  viewerCanUpdate: boolean;
  /** PullRequest.reviewRequests.nodes: requestedReviewer is a Bot with login "copilot-pull-request-reviewer" while a Copilot review is pending. */
  reviewRequests: { requestedReviewer: { __typename: string; login?: string } | null }[];
  /** failureReason of an earlier attempt in this session, if any. */
  lastFailureReason?: string | null;
}

export interface CopilotAvailability {
  offered: boolean;
  /** Why it is not offered; absent when offered. */
  reason?: string;
}

/**
 * Offered when the pull request is OPEN, the viewer can update it, no Copilot review request is pending, and no earlier attempt failed with a reason that will not
 * change (ACTOR_INELIGIBLE, REPOSITORY_INELIGIBLE, APP_NOT_INSTALLED, LICENSED_ORGANIZATION_UNAVAILABLE). NO_QUOTA_REMAINING and unknown reasons keep it offered.
 */
const PERMANENT = ["ACTOR_INELIGIBLE", "REPOSITORY_INELIGIBLE", "APP_NOT_INSTALLED", "LICENSED_ORGANIZATION_UNAVAILABLE"];

export function copilotAvailability(i: CopilotAvailabilityInput): CopilotAvailability {
  const no = (reason: string) => ({ offered: false, reason });
  if (i.state !== "OPEN") return no("The pull request is not open.");
  if (!i.viewerCanUpdate) return no("You cannot request reviews on this pull request.");
  if (i.reviewRequests.some((r) => r.requestedReviewer?.__typename === "Bot" && r.requestedReviewer.login === "copilot-pull-request-reviewer")) return no("A Copilot review is already requested.");
  if (i.lastFailureReason && PERMANENT.includes(i.lastFailureReason)) return no("Copilot code review is not available here.");
  return { offered: true };
}

export type CopilotResult = { ok: true } | { ok: false; message: string; /** The button should be hidden from now on. */ hide: boolean };

/** Reads the mutation payload: success true -> ok. REQUEST_CONFLICT -> "already requested" (not hidden). A known reason -> a message naming the cause, hide true for the four permanent ones above. An unknown reason -> a message containing the raw reason, not hidden. success false with no reason -> a generic message, not hidden. */
const MESSAGES: Record<string, string> = {
  REQUEST_CONFLICT: "A Copilot review is already requested on this pull request.",
  ACTOR_INELIGIBLE: "Your account is not eligible to request a Copilot review.",
  REPOSITORY_INELIGIBLE: "Copilot code review is not available for this repository.",
  APP_NOT_INSTALLED: "The Copilot code review app is not installed for this repository.",
  LICENSED_ORGANIZATION_UNAVAILABLE: "Copilot code review is not available for this organisation's licence.",
  NO_QUOTA_REMAINING: "No Copilot review quota remains.",
};

export function copilotResult(payload: { success?: boolean | null; failureReason?: string | null } | null | undefined): CopilotResult {
  if (payload?.success) return { ok: true };
  const r = payload?.failureReason;
  if (!r) return { ok: false, message: "GitHub did not accept the Copilot review request.", hide: false };
  return { ok: false, message: MESSAGES[r] ?? `GitHub refused the Copilot review request: ${r}`, hide: PERMANENT.includes(r) };
}

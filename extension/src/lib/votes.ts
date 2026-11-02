// Native ADO vote menu <-> GitHub reviews (A-1).
import type { GraphQlRequest } from "./prQuery";
import { dismissReviewMutation, reviewMutation } from "./actionsQuery";

export type VoteId = "approve" | "approveWithSuggestions" | "waitForAuthor" | "reject" | "reset";

export interface VoteContext {
  state: "OPEN" | "CLOSED" | "MERGED";
  /** PullRequest.viewerDidAuthor: GitHub refuses approve / request changes on your own pull request. */
  viewerDidAuthor: boolean;
  /** Repository.viewerPermission (ADMIN | MAINTAIN | WRITE | TRIAGE | READ). */
  viewerPermission: string | null;
  /** PullRequest.viewerLatestReview. */
  viewerLatestReview: { id: string; state: string } | null;
}

export interface VoteOption {
  id: VoteId;
  /** Native label, e.g. "Approve with suggestions". */
  label: string;
  /** true when the caller must supply a body (suggestions text, or the explanation GitHub needs for REQUEST_CHANGES). */
  bodyRequired: boolean;
  enabled: boolean;
  /** Set exactly when `enabled` is false. */
  disabledReason?: string;
}

const WRITE_ROLES = ["WRITE", "MAINTAIN", "ADMIN"];
const VOTES: { id: Exclude<VoteId, "reset">; label: string; bodyRequired: boolean }[] = [
  { id: "approve", label: "Approve", bodyRequired: false },
  { id: "approveWithSuggestions", label: "Approve with suggestions", bodyRequired: true },
  { id: "waitForAuthor", label: "Wait for author", bodyRequired: true },
  { id: "reject", label: "Reject", bodyRequired: true },
];

/** Menu entries in native order. "reset" is only present when the viewer has a decisive review they are allowed to dismiss. */
export function voteOptions(ctx: VoteContext): VoteOption[] {
  const reason = ctx.state !== "OPEN" ? "Reviews are closed: this pull request is not open." : ctx.viewerDidAuthor ? "You can't review your own pull request." : undefined;
  const list: VoteOption[] = VOTES.map((v) => (reason ? { ...v, enabled: false, disabledReason: reason } : { ...v, enabled: true }));
  const r = ctx.viewerLatestReview;
  if (ctx.state === "OPEN" && r && (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED") && WRITE_ROLES.includes(ctx.viewerPermission ?? ""))
    list.push({ id: "reset", label: "Reset feedback", bodyRequired: false, enabled: true });
  return list;
}

export interface VoteRequestContext extends VoteContext {
  pullRequestId: string;
  /** headRefOid: sent as the review's commitOID. */
  headOid: string;
}

/** The mutation for one menu choice. Throws (message = the option's disabledReason) when the option is disabled; for "reset" when it is not offered, an Error mentioning "reset" or "dismiss"; and an Error mentioning "body" when a required body is blank. "reset" uses `body` as the dismissal message, else a default non-blank one. */
export function voteMutation(vote: VoteId, ctx: VoteRequestContext, body?: string): GraphQlRequest {
  const opt = voteOptions(ctx).find((o) => o.id === vote);
  if (!opt) throw new Error("Reset feedback is not available: there is no review of yours to dismiss.");
  if (!opt.enabled) throw new Error(opt.disabledReason);
  if (vote === "reset") return dismissReviewMutation(ctx.viewerLatestReview!.id, body?.trim() ? body : "Feedback reset");
  if (opt.bodyRequired && !body?.trim()) throw new Error(`${opt.label} needs a comment: the body is empty.`);
  const event = vote === "approve" || vote === "approveWithSuggestions" ? "APPROVE" : "REQUEST_CHANGES";
  return reviewMutation({ pullRequestId: ctx.pullRequestId, event, body, commitOid: ctx.headOid });
}

// Reverting a merged pull request (native completed-PR ⋯: Revert).
//
// Schema facts (checked live with `gh api graphql`; the mutation was run with a bogus node id, so it passed validation and wrote nothing):
//  - RevertPullRequestInput: { pullRequestId: ID! (NON_NULL), title: String, body: String, draft: Boolean, clientMutationId }.
//  - RevertPullRequestPayload: { pullRequest (the ORIGINAL), revertPullRequest (the NEW one), clientMutationId }.
//  - Not exercised live (needs a real write): what GitHub puts in the body when none is sent; the app leaves it to GitHub.
import type { GraphQlRequest } from "./prQuery";
import { canWrite } from "./fileCommit";

/** Merged, and the viewer can push (GitHub refuses the revert otherwise). */
export const canRevert = (pr: { state: string; viewerPermission: string | null | undefined }): boolean => pr.state === "MERGED" && canWrite(pr.viewerPermission);

/** The title GitHub's own Revert button suggests. */
export const revertTitle = (title: string): string => `Revert "${title}"`;

export function revertPullRequestMutation(p: { pullRequestId: string; title: string; draft: boolean; body?: string }): GraphQlRequest {
  if (!p.pullRequestId.trim()) throw new Error("pullRequestId is required");
  if (!p.title.trim()) throw new Error("title is required");
  const input: Record<string, unknown> = { pullRequestId: p.pullRequestId, title: p.title.trim(), draft: p.draft };
  if (p.body?.trim()) input.body = p.body;
  return {
    query: `mutation($input: RevertPullRequestInput!) { revertPullRequest(input: $input) { revertPullRequest { id number url } } }`,
    variables: { input },
  };
}

/** The new pull request from a revertPullRequestMutation answer (the `data` object), or null. */
export function mapRevert(data: any): { id: string; number: number; url: string } | null {
  const n = data?.revertPullRequest?.revertPullRequest;
  return n?.number ? { id: n.id, number: n.number, url: n.url } : null;
}

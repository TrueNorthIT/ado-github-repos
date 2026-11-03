// CI-6: "Verified" badges on the PR Commits tab. STUBS: the developer implements them.
// Schema (checked live): Commit.signature is the GitSignature interface { isValid: Boolean!, state: GitSignatureState!, signer: User, wasSignedByGitHub: Boolean!, ... }.
// GitSignatureState: VALID INVALID MALFORMED_SIG UNKNOWN_KEY BAD_EMAIL UNVERIFIED_EMAIL NO_USER UNKNOWN_SIG_TYPE UNSIGNED GPGVERIFY_UNAVAILABLE GPGVERIFY_ERROR
// NOT_SIGNING_KEY EXPIRED_KEY OCSP_PENDING OCSP_ERROR BAD_CERT OCSP_REVOKED. An unsigned commit has signature null.
// Rule shared with feedQuery.ts / prQuery.ts: every caller-supplied value travels in `variables`, never in the query text.
import type { GraphQlRequest } from "./prQuery";

/** The selection to splice into a commit: `signature { isValid state wasSignedByGitHub signer { login } }`. */
export function signatureSelection(): string {
  throw new Error("Not implemented");
}

/** The pull request's commits (first 100, paged by `after`) with oid and the signature selection. Variables { owner, name, number, after } (after null on the first page). Selects pageInfo { hasNextPage endCursor } and nodes { commit { oid <signatureSelection> } }. */
export function commitSignaturesQuery(_p: { owner: string; name: string; number: number; after?: string }): GraphQlRequest {
  throw new Error("Not implemented");
}

export interface CommitSignature {
  isValid: boolean;
  state: string;
  wasSignedByGitHub?: boolean;
  signer?: { login: string } | null;
}

export interface SignatureBadge {
  kind: "verified" | "unverified";
  /** "Verified" or "Unverified". */
  label: string;
  /** Verified: "Signed by {login}", or "Signed by GitHub" when wasSignedByGitHub; "Signature is valid" when neither is known. Unverified: why, from `state`. Never empty. */
  detail: string;
}

/**
 * null when there is nothing to badge: signature null, or state UNSIGNED.
 * isValid true -> Verified. Otherwise Unverified with a reason taken from state: each state in the GitSignatureState list above except VALID and UNSIGNED gets its own
 * non-empty reason (the expiry of a key mentions "expired", an unverified committer email mentions "email", an unknown key mentions "key"); a state this list does not know
 * still yields Unverified with a generic reason.
 */
export function signatureBadge(_signature: CommitSignature | null | undefined): SignatureBadge | null {
  throw new Error("Not implemented");
}

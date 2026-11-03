// CI-6: "Verified" badges on the PR Commits tab. STUBS: the developer implements them.
// Schema (checked live): Commit.signature is the GitSignature interface { isValid: Boolean!, state: GitSignatureState!, signer: User, wasSignedByGitHub: Boolean!, ... }.
// GitSignatureState: VALID INVALID MALFORMED_SIG UNKNOWN_KEY BAD_EMAIL UNVERIFIED_EMAIL NO_USER UNKNOWN_SIG_TYPE UNSIGNED GPGVERIFY_UNAVAILABLE GPGVERIFY_ERROR
// NOT_SIGNING_KEY EXPIRED_KEY OCSP_PENDING OCSP_ERROR BAD_CERT OCSP_REVOKED. An unsigned commit has signature null.
// Rule shared with feedQuery.ts / prQuery.ts: every caller-supplied value travels in `variables`, never in the query text.
import type { GraphQlRequest } from "./prQuery";

/** The selection to splice into a commit: `signature { isValid state wasSignedByGitHub signer { login } }`. */
export function signatureSelection(): string {
  return "signature { isValid state wasSignedByGitHub signer { login } }";
}

/** The pull request's commits (first 100, paged by `after`) with oid and the signature selection. Variables { owner, name, number, after } (after null on the first page). Selects pageInfo { hasNextPage endCursor } and nodes { commit { oid <signatureSelection> } }. */
export function commitSignaturesQuery({ owner, name, number, after }: { owner: string; name: string; number: number; after?: string }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { commit { oid ${signatureSelection()} } } }
    }
  }
}`,
    variables: { owner, name, number, after: after ?? null },
  };
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
const REASONS: Record<string, string> = {
  INVALID: "The signature is invalid",
  MALFORMED_SIG: "The signature is malformed",
  UNKNOWN_KEY: "The signing key is not known to GitHub",
  BAD_EMAIL: "The committer email does not match the signing key",
  UNVERIFIED_EMAIL: "The committer email is not verified on the signer's account",
  NO_USER: "No GitHub user matches the committer email",
  UNKNOWN_SIG_TYPE: "The signature type is not supported",
  GPGVERIFY_UNAVAILABLE: "Signature verification is unavailable right now",
  GPGVERIFY_ERROR: "Signature verification failed with an error",
  NOT_SIGNING_KEY: "The key is not a signing key",
  EXPIRED_KEY: "The signing key has expired",
  OCSP_PENDING: "Certificate revocation check is pending",
  OCSP_ERROR: "Certificate revocation check failed",
  BAD_CERT: "The signing certificate is invalid",
  OCSP_REVOKED: "The signing certificate was revoked",
};

export function signatureBadge(signature: CommitSignature | null | undefined): SignatureBadge | null {
  if (!signature || signature.state === "UNSIGNED") return null;
  if (signature.isValid) {
    const detail = signature.wasSignedByGitHub ? "Signed by GitHub" : signature.signer?.login ? `Signed by ${signature.signer.login}` : "Signature is valid";
    return { kind: "verified", label: "Verified", detail };
  }
  return { kind: "unverified", label: "Unverified", detail: REASONS[signature.state] ?? "The signature could not be verified" };
}

import { describe, it, expect } from "vitest";
import { signatureSelection, commitSignaturesQuery, signatureBadge, type CommitSignature } from "./signatures";
import { expectNotInQuery, expectPrQuery, norm, NASTY } from "./ciTestHelpers";

// Module under test: src/lib/signatures.ts (signatureSelection, commitSignaturesQuery, signatureBadge).
// Requirement CI-6: "Verified badges on commits": map Commit.signature { isValid, state, signer { login }, wasSignedByGitHub } to a badge: "Verified" (valid),
// "Unverified" (invalid, with a reason from state), or none; add a commits-fragment builder for the PR Commits tab.
//
// Schema (checked live): Commit.signature is the GitSignature interface; GitSignatureState has 17 values (listed in signatures.ts); unsigned commits give null.
// Decisions fixed by these tests:
//  - none (null) for a null signature and for state UNSIGNED.
//  - isValid true is Verified; its detail is "Signed by {login}", or "Signed by GitHub" when wasSignedByGitHub, else "Signature is valid".
//  - every other known state is Unverified with its own reason; the wording is pinned only by a keyword for the three states a reader most needs to tell apart.
//  - an unknown future state is still Unverified with a generic reason.
//  - the builder pages the PR's commits 100 at a time (variable `after`) and selects the signature fields via signatureSelection.

const sig = (over: Partial<CommitSignature> = {}): CommitSignature => ({ isValid: true, state: "VALID", wasSignedByGitHub: false, signer: { login: "octocat" }, ...over });

const INVALID_STATES = [
  "INVALID",
  "MALFORMED_SIG",
  "UNKNOWN_KEY",
  "BAD_EMAIL",
  "UNVERIFIED_EMAIL",
  "NO_USER",
  "UNKNOWN_SIG_TYPE",
  "GPGVERIFY_UNAVAILABLE",
  "GPGVERIFY_ERROR",
  "NOT_SIGNING_KEY",
  "EXPIRED_KEY",
  "OCSP_PENDING",
  "OCSP_ERROR",
  "BAD_CERT",
  "OCSP_REVOKED",
];

describe("CI-6: signatureSelection and commitSignaturesQuery add signatures to the PR Commits tab", () => {
  it("selects signature { isValid state wasSignedByGitHub signer { login } }", () => {
    const s = norm(signatureSelection());
    expect(s, "Expected a signature selection").toMatch(/^\s*signature\s*\{/);
    for (const f of ["isValid", "state", "wasSignedByGitHub"]) expect(s, `Expected ${f} in the signature selection`).toMatch(new RegExp(`\\b${f}\\b`));
    expect(s, "Expected signer { login }").toMatch(/signer\s*\{\s*login\s*\}/);
  });

  it("takes { owner, name, number, after } with after null on the first page", () => {
    const req = commitSignaturesQuery({ owner: "octo", name: "repo", number: 2 });
    expectPrQuery(req);
    expect(req.variables, "Expected variables { owner, name, number, after: null }").toEqual({ owner: "octo", name: "repo", number: 2, after: null });
    expect(commitSignaturesQuery({ owner: "o", name: "r", number: 2, after: "CUR" }).variables, "Expected the cursor to travel as a variable").toMatchObject({ after: "CUR" });
  });

  it("pages the pull request's commits 100 at a time and selects oid and the signature", () => {
    const q = norm(commitSignaturesQuery({ owner: "o", name: "r", number: 1 }).query);
    expect(q, "Expected $after: String").toMatch(/\$after:\s*String\b/);
    expect(q, "Expected commits(first: 100, after: $after)").toMatch(/commits\(\s*first:\s*100,\s*after:\s*\$after\s*\)/);
    expect(q, "Expected pageInfo { hasNextPage endCursor }").toMatch(/pageInfo\s*\{(?=[^}]*\bhasNextPage\b)(?=[^}]*\bendCursor\b)[^}]*\}/);
    expect(q, "Expected commit { oid ... } on each node").toMatch(/commit\s*\{[^]*\boid\b/);
    expect(q, "Expected the signature selection from signatureSelection()").toContain(norm(signatureSelection()));
  });

  it.each(NASTY)("keeps %j out of the query text", (v) => {
    const req = commitSignaturesQuery({ owner: v, name: v, number: 1, after: v });
    expectNotInQuery(req, [v]);
    expect(req.variables, "Expected the awkward owner, name and cursor to travel in variables").toMatchObject({ owner: v, name: v, after: v });
  });
});

describe("CI-6: signatureBadge shows Verified for a valid signature", () => {
  it("returns a Verified badge naming the signer", () => {
    expect(signatureBadge(sig()), "Expected Verified with 'Signed by octocat'").toEqual({ kind: "verified", label: "Verified", detail: "Signed by octocat" });
  });

  it("says 'Signed by GitHub' for a commit GitHub signed (web edits, merges)", () => {
    expect(signatureBadge(sig({ wasSignedByGitHub: true, signer: { login: "web-flow" } })), "Expected GitHub as the signer for a GitHub-signed commit").toEqual({
      kind: "verified",
      label: "Verified",
      detail: "Signed by GitHub",
    });
  });

  it("still says Verified when the signer is not known", () => {
    const b = signatureBadge(sig({ signer: null }));
    expect(b?.label, "Expected Verified with no signer").toBe("Verified");
    expect(b?.detail, "Expected a non-empty detail without a signer").toBeTruthy();
  });
});

describe("CI-6: signatureBadge shows nothing when there is no signature", () => {
  it.each([null, undefined])("returns null for a %s signature", (s) => {
    expect(signatureBadge(s), "Expected no badge for an unsigned commit").toBeNull();
  });

  it("returns null for state UNSIGNED", () => {
    expect(signatureBadge(sig({ isValid: false, state: "UNSIGNED", signer: null })), "Expected no badge when GitHub reports UNSIGNED").toBeNull();
  });
});

describe("CI-6: signatureBadge shows Unverified with a reason taken from state", () => {
  it.each(INVALID_STATES)("returns Unverified with a reason for %s", (state) => {
    const b = signatureBadge(sig({ isValid: false, state, signer: null }));
    expect(b?.kind, `Expected an unverified badge for ${state}`).toBe("unverified");
    expect(b?.label, `Expected the label 'Unverified' for ${state}`).toBe("Unverified");
    expect(b?.detail.trim().length, `Expected a reason for ${state}`).toBeGreaterThan(0);
  });

  it("gives each state its own reason", () => {
    const reasons = INVALID_STATES.map((state) => signatureBadge(sig({ isValid: false, state, signer: null }))?.detail);
    expect(new Set(reasons).size, "Expected 15 distinct reasons, one per invalid state").toBe(INVALID_STATES.length);
  });

  it("says the key has expired for EXPIRED_KEY", () => {
    expect(signatureBadge(sig({ isValid: false, state: "EXPIRED_KEY" }))?.detail, "Expected the reason to mention that the key expired").toMatch(/expired/i);
  });

  it("points at the email for UNVERIFIED_EMAIL", () => {
    expect(signatureBadge(sig({ isValid: false, state: "UNVERIFIED_EMAIL" }))?.detail, "Expected the reason to mention the committer email").toMatch(/e-?mail/i);
  });

  it("points at the key for UNKNOWN_KEY", () => {
    expect(signatureBadge(sig({ isValid: false, state: "UNKNOWN_KEY" }))?.detail, "Expected the reason to mention the key").toMatch(/key/i);
  });

  it("still returns Unverified, with a reason, for a state this list does not know", () => {
    const b = signatureBadge(sig({ isValid: false, state: "SOMETHING_NEW" }));
    expect(b?.label, "Expected Unverified for an unknown state").toBe("Unverified");
    expect(b?.detail, "Expected a generic reason for an unknown state").toBeTruthy();
  });

  it("trusts isValid over state: isValid true is Verified even if the state is not VALID", () => {
    expect(signatureBadge(sig({ isValid: true, state: "OCSP_PENDING" }))?.label, "Expected isValid to decide").toBe("Verified");
  });
});

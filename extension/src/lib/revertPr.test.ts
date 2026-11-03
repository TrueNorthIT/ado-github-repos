import { describe, it, expect } from "vitest";
import { canRevert, mapRevert, revertPullRequestMutation, revertTitle } from "./revertPr";
import { expectMutation, expectNotInQuery, NASTY } from "./ciTestHelpers";

describe("canRevert", () => {
  it("is offered on a merged pull request to someone who can push", () => {
    for (const p of ["WRITE", "MAINTAIN", "ADMIN"]) expect(canRevert({ state: "MERGED", viewerPermission: p }), p).toBe(true);
  });
  it("is not offered to readers or triagers", () => {
    for (const p of ["READ", "TRIAGE", null, undefined]) expect(canRevert({ state: "MERGED", viewerPermission: p }), String(p)).toBe(false);
  });
  it("is not offered while open or when closed without merging", () => {
    expect(canRevert({ state: "OPEN", viewerPermission: "ADMIN" })).toBe(false);
    expect(canRevert({ state: "CLOSED", viewerPermission: "ADMIN" })).toBe(false);
  });
});

describe("revertTitle", () => {
  it("wraps the title the way GitHub does", () => expect(revertTitle("Add retry handling")).toBe('Revert "Add retry handling"'));
  it("keeps quotes inside the title", () => expect(revertTitle('Fix "x"')).toBe('Revert "Fix "x""'));
});

describe("revertPullRequestMutation", () => {
  it("is revertPullRequest with the checked input fields", () => {
    const m = revertPullRequestMutation({ pullRequestId: "PR_1", title: 'Revert "t"', draft: true });
    expectMutation(m, "RevertPullRequestInput", "revertPullRequest");
    expect(m.variables).toEqual({ input: { pullRequestId: "PR_1", title: 'Revert "t"', draft: true } });
  });
  it("asks for the new pull request's id, number and url", () => {
    const q = revertPullRequestMutation({ pullRequestId: "PR_1", title: "t", draft: false }).query.replace(/\s+/g, " ");
    expect(q).toMatch(/revertPullRequest \{ id number url \}/);
  });
  it("sends draft false explicitly and the body only when there is one", () => {
    expect((revertPullRequestMutation({ pullRequestId: "PR_1", title: "t", draft: false }).variables.input as any).draft).toBe(false);
    expect((revertPullRequestMutation({ pullRequestId: "PR_1", title: "t", draft: false, body: "  " }).variables.input as any).body).toBeUndefined();
    expect((revertPullRequestMutation({ pullRequestId: "PR_1", title: "t", draft: false, body: "why" }).variables.input as any).body).toBe("why");
  });
  it("trims the title and keeps caller values out of the query text", () => {
    expect((revertPullRequestMutation({ pullRequestId: "PR_1", title: "  t  ", draft: false }).variables.input as any).title).toBe("t");
    for (const v of NASTY) expectNotInQuery(revertPullRequestMutation({ pullRequestId: v, title: v, draft: false }), [v]);
  });
  it("refuses a missing id or a blank title", () => {
    expect(() => revertPullRequestMutation({ pullRequestId: "", title: "t", draft: false })).toThrow("pullRequestId is required");
    expect(() => revertPullRequestMutation({ pullRequestId: "PR_1", title: " ", draft: false })).toThrow("title is required");
  });
});

describe("mapRevert", () => {
  it("reads the new pull request", () => {
    expect(mapRevert({ revertPullRequest: { revertPullRequest: { id: "PR_2", number: 7, url: "https://github.com/o/r/pull/7" } } })).toEqual({ id: "PR_2", number: 7, url: "https://github.com/o/r/pull/7" });
  });
  it("is null when GitHub returned no new pull request", () => {
    expect(mapRevert({ revertPullRequest: { revertPullRequest: null } })).toBeNull();
    expect(mapRevert({})).toBeNull();
    expect(mapRevert(null)).toBeNull();
  });
});

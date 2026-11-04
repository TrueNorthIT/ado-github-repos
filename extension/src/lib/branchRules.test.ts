import { describe, it, expect } from "vitest";
import { branchRulesRequest, rulesBlockForcePush, rulesRequireCodeOwnerReview, toBranchRules } from "./branchRules";

// Module under test: src/lib/branchRules.ts. REST `GET /repos/{o}/{r}/rules/branches/{branch}` lists the active ruleset rules on a branch.

describe("branchRulesRequest", () => {
  it("encodes each segment and keeps the slashes", () => {
    expect(branchRulesRequest("o/r", "feature/a b")).toEqual({ method: "GET", path: "/repos/o/r/rules/branches/feature/a%20b" });
  });
  it("refuses a blank branch", () => expect(() => branchRulesRequest("o/r", " ")).toThrow());
});

describe("toBranchRules", () => {
  it("keeps entries with a string type and drops the rest", () => {
    expect(toBranchRules([{ type: "deletion" }, null, { type: 3 }, "x", { type: "pull_request", parameters: { a: 1 } }])).toEqual([{ type: "deletion" }, { type: "pull_request", parameters: { a: 1 } }]);
  });
  it("gives [] for anything that is not an array", () => {
    expect(toBranchRules({ message: "Not Found" })).toEqual([]);
    expect(toBranchRules(null)).toEqual([]);
  });
});

describe("what the rules mean", () => {
  it("a pull_request rule with require_code_owner_review true requires a code owner", () => {
    expect(rulesRequireCodeOwnerReview([{ type: "pull_request", parameters: { require_code_owner_review: true } }])).toBe(true);
    expect(rulesRequireCodeOwnerReview([{ type: "pull_request", parameters: { require_code_owner_review: false } }])).toBe(false);
    expect(rulesRequireCodeOwnerReview([{ type: "required_signatures" }])).toBe(false);
  });
  it("non_fast_forward and update refuse a rebase", () => {
    expect(rulesBlockForcePush([{ type: "non_fast_forward" }])).toBe(true);
    expect(rulesBlockForcePush([{ type: "update" }])).toBe(true);
    expect(rulesBlockForcePush([{ type: "deletion" }])).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { milestoneSearchQuery, toMilestoneOption, sortMilestones, setMilestoneMutation, type MilestoneOption } from "./milestones";
import { expectMutation, expectNotInQuery, norm, NASTY } from "./ciTestHelpers";
import { expectConnectionCall, expectQueryOperation, expectSelection } from "./editTestHelpers";

// Module under test: src/lib/milestones.ts (stubs until the developer implements them). Schema facts are in its header.
// Requirement ED-6 "Milestone. updatePullRequest(input:{pullRequestId, milestoneId}), with null to clear (verify null clears). Search repository.milestones(states:OPEN, query?), ordered by due date."
// Decisions fixed by these tests:
//  - GitHub's DUE_DATE ASC order lists undated milestones FIRST (checked live), so sortMilestones puts dated ones first (earliest first) and undated ones last.
//  - the clear request keeps an explicit milestoneId: null. (Unverified live that null clears: it needs a real write.)

const m = (number: number, dueOn: string | null, title = `v${number}`): MilestoneOption => toMilestoneOption({ id: `M${number}`, number, title, description: null, dueOn });
const numbers = (ms: MilestoneOption[]) => ms.map((x) => x.number);

describe("ED-6: milestoneSearchQuery", () => {
  it("is a variables-only query on repository.milestones, open milestones by due date", () => {
    const req = milestoneSearchQuery({ owner: "octo", name: "repo", query: "v1" });
    expectQueryOperation(req);
    expect(req.query, "Expected repository(owner: $owner, name: $name)").toMatch(/repository\(owner:\s*\$owner,\s*name:\s*\$name\)/);
    expectConnectionCall(req, "milestones", ["query:$query", "first:20"]);
    expect(norm(req.query), "Expected states: [OPEN] (or OPEN)").toMatch(/milestones\([^)]*states:\s*\[?OPEN\]?/);
    expect(norm(req.query), "Expected orderBy DUE_DATE ascending").toMatch(/orderBy:\s*\{\s*field:\s*DUE_DATE,\s*direction:\s*ASC\s*\}/);
    expect(req.variables, "Expected variables { owner, name, query }").toEqual({ owner: "octo", name: "repo", query: "v1" });
  });

  it("selects id, number, title, description, dueOn and state", () => {
    expectSelection(milestoneSearchQuery({ owner: "o", name: "r", query: "" }), /milestones\([^)]*\)\s*\{\s*nodes/, ["id", "number", "title", "description", "dueOn", "state"], "the milestone fields");
  });

  it("trims the query and sends null when blank", () => {
    expect(milestoneSearchQuery({ owner: "o", name: "r", query: " v1 " }).variables, "Expected a trimmed query").toMatchObject({ query: "v1" });
    expect(milestoneSearchQuery({ owner: "o", name: "r", query: "  " }).variables, "Expected null for a blank query").toMatchObject({ query: null });
  });

  it("keeps awkward text out of the query string", () => {
    const req = milestoneSearchQuery({ owner: NASTY[0], name: NASTY[1], query: NASTY[2] });
    expectNotInQuery(req, [NASTY[0], NASTY[1], NASTY[2]]);
  });
});

describe("ED-6: toMilestoneOption", () => {
  it("maps a dated milestone", () => {
    const o = toMilestoneOption({ id: "M1", number: 3, title: "v1.0", description: "First release", dueOn: "2026-12-01T00:00:00Z" });
    expect(o, "Expected the due date as a Date").toEqual({ id: "M1", number: 3, title: "v1.0", description: "First release", dueOn: new Date("2026-12-01T00:00:00Z") });
  });

  it("maps a null or missing description to '' and a null or missing due date to null", () => {
    expect(toMilestoneOption({ id: "M1", number: 1, title: "t", description: null, dueOn: null }), "Expected '' and null").toEqual({ id: "M1", number: 1, title: "t", description: "", dueOn: null });
    expect(toMilestoneOption({ id: "M1", number: 1, title: "t" }), "Expected '' and null for missing fields").toEqual({ id: "M1", number: 1, title: "t", description: "", dueOn: null });
  });
});

describe("ED-6: sortMilestones", () => {
  it("puts dated milestones first, earliest first, and undated ones last", () => {
    const input = [m(1, null), m(2, "2027-03-01T00:00:00Z"), m(3, null), m(4, "2026-12-01T00:00:00Z")];
    expect(numbers(sortMilestones(input)), "Expected 4 (Dec), 2 (Mar), then the undated 1 and 3").toEqual([4, 2, 1, 3]);
  });

  it("orders milestones due on the same date by number", () => {
    expect(numbers(sortMilestones([m(9, "2026-12-01T00:00:00Z"), m(5, "2026-12-01T00:00:00Z")])), "Expected 5 before 9").toEqual([5, 9]);
  });

  it("compares by instant, not by text", () => {
    expect(numbers(sortMilestones([m(1, "2026-12-01T00:00:00Z"), m(2, "2026-02-01T00:00:00Z")])), "Expected February before December").toEqual([2, 1]);
  });

  it("returns a new array and leaves the input alone", () => {
    const input = [m(2, null), m(1, "2026-01-01T00:00:00Z")];
    const out = sortMilestones(input);
    expect(out, "Expected a different array").not.toBe(input);
    expect(numbers(input), "Expected the input order kept").toEqual([2, 1]);
  });

  it("handles an empty list", () => {
    expect(sortMilestones([]), "Expected []").toEqual([]);
  });
});

describe("ED-6: setMilestoneMutation", () => {
  it("is updatePullRequest(input: $input) with $input: UpdatePullRequestInput!", () => {
    expectMutation(setMilestoneMutation("PR1", "M1"), "UpdatePullRequestInput", "updatePullRequest");
  });

  it("sets a milestone with exactly { pullRequestId, milestoneId }", () => {
    expect(setMilestoneMutation("PR1", "M1").variables, "Expected only the pull request and the milestone").toEqual({ input: { pullRequestId: "PR1", milestoneId: "M1" } });
  });

  it("clears the milestone with an explicit null (the key present)", () => {
    const input = (setMilestoneMutation("PR1", null).variables as { input: Record<string, unknown> }).input;
    expect(Object.keys(input).sort(), "Expected the milestoneId key to be present").toEqual(["milestoneId", "pullRequestId"]);
    expect(input.milestoneId, "Expected milestoneId to be null").toBeNull();
  });

  it("selects the pull request's milestone back", () => {
    expectSelection(setMilestoneMutation("PR1", "M1"), /pullRequest/, ["id", "milestone"], "the pull request payload");
  });

  it("keeps ids out of the query text", () => {
    expectNotInQuery(setMilestoneMutation(NASTY[0], NASTY[1]), [NASTY[0], NASTY[1]]);
  });

  it("refuses a blank pull request id", () => {
    expect(() => setMilestoneMutation(" ", "M1"), "Expected a blank pull request id to be refused").toThrow(/pullRequestId is required/);
  });

  it("refuses a blank milestone id (null is the way to clear)", () => {
    expect(() => setMilestoneMutation("PR1", ""), "Expected '' to be refused").toThrow(/milestoneId must not be blank/);
    expect(() => setMilestoneMutation("PR1", "  "), "Expected whitespace to be refused").toThrow(/milestoneId must not be blank/);
  });
});

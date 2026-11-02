import { describe, it, expect } from "vitest";
import {
  workItemStatesUrl,
  completeWorkItemUrl,
  completedStateName,
  completeWorkItemPatch,
  planCompletion,
  type WorkItemStatesResponse,
} from "./completeWorkItems";
import type { WorkItemRef } from "./workItems";

// Module under test: src/lib/completeWorkItems.ts. Requirement A-5: "Complete associated work items" (the Azure DevOps side).
// Azure DevOps REST 7.1 (learn.microsoft.com/en-us/rest/api/azure/devops/wit):
//   GET   {org}/{project}/_apis/wit/workitemtypes/{type}/states?api-version=7.1   -> { value: [{ name, color, category }] }, category "Completed" marks done states
//   PATCH {org}/_apis/wit/workitems/{id}?api-version=7.1   body [{ op: "add", path: "/fields/System.State", value }] (application/json-patch+json)
// URLs are built like src/lib/workItems.ts: https://dev.azure.com/{org}..., each segment through encodeURIComponent.
// Decisions fixed by these tests:
//  - the target state is the FIRST state, in response order, whose category is exactly "Completed"; none -> null.
//  - planCompletion skips: items ADO did not return (found false), items already in a Completed-category state, and items whose type has no
//    Completed state (or whose states were not supplied). Everything else becomes an update, in input order.
//  - fixtures use generic work item types and states only.

const agile: WorkItemStatesResponse = {
  value: [
    { name: "New", color: "b2b2b2", category: "Proposed" },
    { name: "Active", color: "007acc", category: "InProgress" },
    { name: "Resolved", color: "ff9d00", category: "Resolved" },
    { name: "Closed", color: "339933", category: "Completed" },
    { name: "Removed", color: "ffffff", category: "Removed" },
  ],
};
const basic: WorkItemStatesResponse = {
  value: [
    { name: "To Do", category: "Proposed" },
    { name: "Doing", category: "InProgress" },
    { name: "Done", category: "Completed" },
  ],
};
const twoCompleted: WorkItemStatesResponse = {
  value: [
    { name: "Open", category: "Proposed" },
    { name: "Shipped", category: "Completed" },
    { name: "Archived", category: "Completed" },
  ],
};
const noCompleted: WorkItemStatesResponse = { value: [{ name: "Open", category: "Proposed" }, { name: "Working", category: "InProgress" }] };

const item = (id: number, type: string, state: string): WorkItemRef => ({ id, found: true, type, state, title: `Item ${id}` });
const missing = (id: number): WorkItemRef => ({ id, found: false });

describe("A-5: workItemStatesUrl", () => {
  it("builds the states URL for a type with api-version 7.1", () => {
    expect(workItemStatesUrl("acme", "Web", "Bug"), "Expected {org}/{project}/_apis/wit/workitemtypes/{type}/states?api-version=7.1").toBe(
      "https://dev.azure.com/acme/Web/_apis/wit/workitemtypes/Bug/states?api-version=7.1",
    );
  });

  it("URI-encodes the organisation, project and type segments", () => {
    expect(workItemStatesUrl("my org", "Team Web/App", "User Story"), "Expected spaces and slashes to be encoded").toBe(
      "https://dev.azure.com/my%20org/Team%20Web%2FApp/_apis/wit/workitemtypes/User%20Story/states?api-version=7.1",
    );
  });
});

describe("A-5: completeWorkItemUrl", () => {
  it("builds the work item PATCH URL with api-version 7.1 and no project segment", () => {
    expect(completeWorkItemUrl("acme", 123), "Expected {org}/_apis/wit/workitems/{id}?api-version=7.1").toBe("https://dev.azure.com/acme/_apis/wit/workitems/123?api-version=7.1");
  });

  it("URI-encodes the organisation", () => {
    expect(completeWorkItemUrl("my org", 7), "Expected the organisation to be encoded").toBe("https://dev.azure.com/my%20org/_apis/wit/workitems/7?api-version=7.1");
  });
});

describe("A-5: completedStateName picks the target state", () => {
  it.each([
    ["Agile-style process", agile, "Closed"],
    ["Basic-style process", basic, "Done"],
  ])("%s -> %s", (_n, states, expected) => {
    expect(completedStateName(states), `Expected the Completed-category state ${expected}`).toBe(expected);
  });

  it("takes the first Completed-category state in response order when there are several", () => {
    expect(completedStateName(twoCompleted), "Expected Shipped (listed first), not Archived").toBe("Shipped");
  });

  it("returns null when no state is in the Completed category", () => {
    expect(completedStateName(noCompleted), "Expected null when there is no Completed state").toBeNull();
  });

  it.each([[{ value: [] }], [{}], [null], [undefined]] as const)("returns null for the empty response %j", (r) => {
    expect(completedStateName(r as WorkItemStatesResponse | null | undefined), "Expected null for an empty or missing response").toBeNull();
  });

  it("matches the category exactly (a state merely named Completed in another category does not count)", () => {
    expect(completedStateName({ value: [{ name: "Completed", category: "InProgress" }, { name: "Finished", category: "Completed" }] }), "Expected Finished").toBe("Finished");
  });
});

describe("A-5: completeWorkItemPatch builds the json-patch body", () => {
  it("is a single add operation on /fields/System.State", () => {
    expect(completeWorkItemPatch("Closed"), "Expected [{ op: 'add', path: '/fields/System.State', value: 'Closed' }]").toEqual([{ op: "add", path: "/fields/System.State", value: "Closed" }]);
  });

  it("sends the state exactly as supplied", () => {
    expect(completeWorkItemPatch("In Review & Done")[0].value, "Expected no trimming or rewriting").toBe("In Review & Done");
  });

  it.each(["", "  "])("rejects the blank state %j, naming the state", (blank) => {
    completeWorkItemPatch("Closed"); // a real state must still build
    expect(() => completeWorkItemPatch(blank), "Expected a blank state to be rejected").toThrow(/state/i);
  });
});

describe("A-5: planCompletion decides which work items to move", () => {
  const states = { Bug: agile, Issue: basic, Widget: noCompleted };

  it("moves each item to its own type's first Completed state", () => {
    const plan = planCompletion([item(1, "Bug", "Active"), item(2, "Issue", "Doing")], states);
    expect(plan.updates, "Expected the Bug to go to Closed and the Issue to Done").toEqual([{ id: 1, state: "Closed" }, { id: 2, state: "Done" }]);
    expect(plan.skipped, "Expected nothing skipped").toEqual([]);
  });

  it("skips items already in a Completed-category state", () => {
    const plan = planCompletion([item(1, "Bug", "Closed"), item(2, "Bug", "Active")], states);
    expect(plan.updates, "Expected only the open Bug to be updated").toEqual([{ id: 2, state: "Closed" }]);
    expect(plan.skipped, "Expected the closed Bug skipped as already complete").toEqual([{ id: 1, reason: "already-complete" }]);
  });

  it("treats any Completed-category state as done, not only the first", () => {
    const plan = planCompletion([item(1, "Release", "Archived")], { Release: twoCompleted });
    expect(plan.updates, "Expected no update for an item in Archived (Completed category)").toEqual([]);
    expect(plan.skipped, "Expected it skipped as already complete").toEqual([{ id: 1, reason: "already-complete" }]);
  });

  it("moves an item in a Resolved-category state on to Completed", () => {
    expect(planCompletion([item(1, "Bug", "Resolved")], states).updates, "Expected Resolved to move to Closed").toEqual([{ id: 1, state: "Closed" }]);
  });

  it("skips items ADO did not return", () => {
    const plan = planCompletion([missing(9), item(1, "Bug", "Active")], states);
    expect(plan.updates, "Expected only the found item to be updated").toEqual([{ id: 1, state: "Closed" }]);
    expect(plan.skipped, "Expected the missing item skipped as not found").toEqual([{ id: 9, reason: "not-found" }]);
  });

  it("skips items whose type has no Completed state", () => {
    const plan = planCompletion([item(3, "Widget", "Open")], states);
    expect(plan.updates, "Expected no update for a type without a Completed state").toEqual([]);
    expect(plan.skipped, "Expected the item skipped with no-completed-state").toEqual([{ id: 3, reason: "no-completed-state" }]);
  });

  it("skips items whose type has no states supplied", () => {
    const plan = planCompletion([item(4, "Epic", "Active")], states);
    expect(plan.skipped, "Expected an unknown type skipped with no-completed-state").toEqual([{ id: 4, reason: "no-completed-state" }]);
  });

  it("preserves input order in both lists", () => {
    const plan = planCompletion([item(5, "Bug", "Active"), item(2, "Bug", "Closed"), item(9, "Issue", "To Do"), missing(1)], states);
    expect(plan.updates.map((u) => u.id), "Expected updates in input order").toEqual([5, 9]);
    expect(plan.skipped.map((s) => s.id), "Expected skipped in input order").toEqual([2, 1]);
  });

  it("returns empty lists for no items", () => {
    expect(planCompletion([], states), "Expected an empty plan").toEqual({ updates: [], skipped: [] });
  });
});

import { describe, it, expect } from "vitest";
import { stateActions, type StateActionContext, type StateAction } from "./stateActions";

// Module under test: src/lib/stateActions.ts (stateActions). Requirement A-4: "Abandon / Reactivate, Mark as draft / Publish".
// GitHub mutations behind each id (src/lib/actionsQuery.ts): abandon -> closePullRequest, reactivate -> reopenPullRequest,
// markAsDraft -> convertPullRequestToDraft, publish -> markPullRequestReadyForReview.
// Availability by state (PullRequest.state OPEN | CLOSED | MERGED, PullRequest.isDraft):
//   open, not draft  -> [Mark as draft, Abandon]
//   open, draft      -> [Publish, Abandon]
//   closed, unmerged -> [Reactivate]            (state CLOSED is never merged: a merged PR has state MERGED)
//   merged           -> []
// Permission: PullRequest.viewerCanClose (Abandon), viewerCanReopen (Reactivate) and viewerCanUpdate (draft toggle).
// An action whose flag is false is still listed, enabled: false with a non-empty disabledReason; otherwise enabled with no disabledReason.

const all: StateActionContext = { state: "OPEN", isDraft: false, viewerCanClose: true, viewerCanReopen: true, viewerCanUpdate: true };
const ctx = (over: Partial<StateActionContext> = {}): StateActionContext => ({ ...all, ...over });
const ids = (c: StateActionContext) => stateActions(c).map((a) => a.id);
const find = (c: StateActionContext, id: StateAction["id"]) => stateActions(c).find((a) => a.id === id);

describe("A-4: which state actions are offered", () => {
  it("open and not draft: Mark as draft, then Abandon", () => {
    expect(ids(ctx()), "Expected [markAsDraft, abandon] for an open PR").toEqual(["markAsDraft", "abandon"]);
  });

  it("open and draft: Publish, then Abandon", () => {
    expect(ids(ctx({ isDraft: true })), "Expected [publish, abandon] for a draft PR").toEqual(["publish", "abandon"]);
  });

  it("closed and not merged: Reactivate only", () => {
    expect(ids(ctx({ state: "CLOSED" })), "Expected [reactivate] for an abandoned PR").toEqual(["reactivate"]);
  });

  it("merged: no actions", () => {
    expect(ids(ctx({ state: "MERGED" })), "Expected no actions for a completed PR").toEqual([]);
  });

  it("closed: isDraft does not bring back Publish or Abandon", () => {
    expect(ids(ctx({ state: "CLOSED", isDraft: true })), "Expected a closed draft to offer only Reactivate").toEqual(["reactivate"]);
  });

  it("uses the native labels", () => {
    expect(stateActions(ctx()).map((a) => a.label), "Expected 'Mark as draft' and 'Abandon'").toEqual(["Mark as draft", "Abandon"]);
    expect(stateActions(ctx({ isDraft: true })).map((a) => a.label), "Expected 'Publish' and 'Abandon'").toEqual(["Publish", "Abandon"]);
    expect(stateActions(ctx({ state: "CLOSED" })).map((a) => a.label), "Expected 'Reactivate'").toEqual(["Reactivate"]);
  });
});

describe("A-4: enabling follows the viewer's permissions", () => {
  it("enables every offered action, without a disabledReason, when the viewer has permission", () => {
    for (const c of [ctx(), ctx({ isDraft: true }), ctx({ state: "CLOSED" })]) {
      for (const a of stateActions(c)) {
        expect(a.enabled, `Expected ${a.id} to be enabled`).toBe(true);
        expect(a.disabledReason, `Expected no disabledReason on ${a.id}`).toBeUndefined();
      }
    }
  });

  it.each([
    ["abandon", ctx({ viewerCanClose: false })],
    ["markAsDraft", ctx({ viewerCanUpdate: false })],
    ["publish", ctx({ isDraft: true, viewerCanUpdate: false })],
    ["reactivate", ctx({ state: "CLOSED", viewerCanReopen: false })],
  ] as const)("%s is listed but disabled with a reason when the matching permission is missing", (id, c) => {
    const a = find(c, id);
    expect(a, `Expected ${id} to stay listed`).toBeDefined();
    expect(a!.enabled, `Expected ${id} to be disabled`).toBe(false);
    expect((a!.disabledReason ?? "").length, `Expected a non-empty disabledReason on ${id}`).toBeGreaterThan(0);
  });

  it("disabling one action leaves the others enabled", () => {
    const a = find(ctx({ viewerCanClose: false }), "markAsDraft");
    expect(a?.enabled, "Expected Mark as draft to stay enabled when only close is denied").toBe(true);
  });
});

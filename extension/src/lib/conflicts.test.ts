import { describe, it, expect } from "vitest";
import { CONFLICT_MESSAGE, CONFLICT_CHECKING_MESSAGE, conflictEditorUrl, conflictState } from "./conflicts";

// Module under test: src/lib/conflicts.ts (stubs until the developer implements them). Requirement VW-7: "Conflicts. From `mergeable` / `mergeStateStatus`, give text for conflict state ("This branch has
// conflicts that must be resolved") and the GitHub conflict editor URL (`/pull/{n}/conflicts`), which is offered when `viewerCanUpdate`. There is no list of files." Schema facts and decisions are in the
// header of src/lib/conflicts.ts.

const REPO = "octo/demo";

describe("VW-7: the conflict editor URL", () => {
  it("is the pull request's /conflicts page on github.com", () => {
    expect(conflictEditorUrl(REPO, 42), "Expected https://github.com/octo/demo/pull/42/conflicts").toBe("https://github.com/octo/demo/pull/42/conflicts");
  });
});

describe("VW-7: conflictState says whether and how to resolve conflicts", () => {
  it("words the message as in the requirement", () => {
    expect(CONFLICT_MESSAGE, "Expected the text from the requirement").toBe("This branch has conflicts that must be resolved");
  });

  it("reports conflicts for mergeable CONFLICTING and offers the editor to someone who can update", () => {
    const s = conflictState({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", viewerCanUpdate: true }, REPO, 42);
    expect(s, "Expected conflicts, not checking, the message and the editor link").toEqual({ hasConflicts: true, checking: false, message: CONFLICT_MESSAGE, editorUrl: conflictEditorUrl(REPO, 42) });
  });

  it("still says there are conflicts, but offers no editor, when the viewer cannot update", () => {
    const s = conflictState({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", viewerCanUpdate: false }, REPO, 42);
    expect([s.hasConflicts, s.message, s.editorUrl], "Expected the message without a link").toEqual([true, CONFLICT_MESSAGE, null]);
  });

  it("offers no editor when viewerCanUpdate is not known", () => {
    expect(conflictState({ mergeable: "CONFLICTING" }, REPO, 42).editorUrl, "Expected no link without viewerCanUpdate").toBeNull();
  });

  it("treats mergeStateStatus DIRTY as conflicts even while mergeable is still UNKNOWN", () => {
    const s = conflictState({ mergeable: "UNKNOWN", mergeStateStatus: "DIRTY", viewerCanUpdate: true }, REPO, 5);
    expect([s.hasConflicts, s.checking, s.message], "Expected conflicts and not 'checking'").toEqual([true, false, CONFLICT_MESSAGE]);
  });

  it("treats mergeable CONFLICTING as conflicts when mergeStateStatus is something else", () => {
    expect(conflictState({ mergeable: "CONFLICTING", mergeStateStatus: "BLOCKED", viewerCanUpdate: true }, REPO, 5).hasConflicts, "Expected CONFLICTING to be enough").toBe(true);
  });

  it("says nothing for a clean pull request", () => {
    expect(conflictState({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", viewerCanUpdate: true }, REPO, 5), "Expected no conflicts, no message, no link").toEqual({ hasConflicts: false, checking: false, message: null, editorUrl: null });
  });

  it.each(["BLOCKED", "BEHIND", "UNSTABLE", "HAS_HOOKS"])("says nothing about conflicts for a mergeable pull request that is %s", (status) => {
    expect(conflictState({ mergeable: "MERGEABLE", mergeStateStatus: status, viewerCanUpdate: true }, REPO, 5), `Expected ${status} not to be reported as a conflict`).toEqual({ hasConflicts: false, checking: false, message: null, editorUrl: null });
  });

  it("says it is checking while GitHub has not decided (UNKNOWN and UNKNOWN)", () => {
    expect(conflictState({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", viewerCanUpdate: true }, REPO, 5), "Expected checking with its message and no link").toEqual({ hasConflicts: false, checking: true, message: CONFLICT_CHECKING_MESSAGE, editorUrl: null });
  });

  it("treats a missing or unrecognised mergeable as undecided", () => {
    expect(conflictState({}, REPO, 5).checking, "Expected checking for an empty input").toBe(true);
    expect(conflictState({ mergeable: "SOMETHING_NEW" }, REPO, 5).checking, "Expected checking for an unknown value").toBe(true);
  });

  it.each(["CLOSED", "MERGED"] as const)("reports nothing for a %s pull request, even if mergeable is stale", (state) => {
    expect(conflictState({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", state, viewerCanUpdate: true }, REPO, 5), `Expected no conflict state once the pull request is ${state}`).toEqual({ hasConflicts: false, checking: false, message: null, editorUrl: null });
  });
});

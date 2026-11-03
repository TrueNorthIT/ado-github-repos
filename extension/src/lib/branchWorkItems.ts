// Batch 5, work items found from the source branch name and the commits (CP-3). STUBS: the developer implements them. Every function throws "Not implemented".
//
// Decisions fixed by the tests (branchWorkItems.test.ts). Being conservative: a wrong link to an unrelated work item is worse than a missing one.
//  - A branch yields ids from `AB#123` anywhere in the name (reusing workItems.findWorkItemIds, so `AB#1234` is not `AB#123`) and from a LEADING NUMBER ON A PATH SEGMENT AFTER A "/":
//    `users/x/123-thing`, `feature/123_thing`. The number must be 1 to 7 digits with no leading zero, be followed by "-" or "_" and then a LETTER.
//  - Not matched, on purpose: `123-thing` with no folder (GitHub's own "create a branch for an issue" format: that is a GitHub issue number, not a work item), a bare `feature/123`, `feature/2fa-login`,
//    dates (`release/2024-01-15-hotfix`, `release/20240115-x`), Jira-style keys (`feature/PROJ-123-thing`) and `feature/v2-redesign`.
//  - Ids come back unique and in the order of their position in the name.
//  - Commits contribute through findWorkItemIds over each subject and body (so `AB#` in code is ignored).
import type { NewPrCommit } from "./newPr";

const todo = (): never => {
  throw new Error("Not implemented");
};

/** Work item ids a branch name points at (rules above). */
export function findBranchWorkItemIds(branch: string): number[] {
  return todo();
}

/** The ids for the New pull request form: the branch's, then those of the commits' subjects and bodies; unique, first-seen order, capped at MAX_WORK_ITEMS. */
export function newPrWorkItemIds(p: { branch: string | null; commits: Pick<NewPrCommit, "subject" | "body">[] }): number[] {
  return todo();
}

/** `body` with each id added through prEdit.addWorkItemToBody, in order (so an id already mentioned changes nothing and the line-break style of the body is kept). No ids: the body unchanged. */
export function prefillWorkItems(body: string, ids: number[]): string {
  return todo();
}

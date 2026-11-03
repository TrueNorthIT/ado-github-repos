// Batch 4, merge conflicts (VW-7).
//
// Schema facts (checked live with `gh api graphql` against cli/cli#14570):
//  - PullRequest.mergeable: MergeableState = MERGEABLE | CONFLICTING | UNKNOWN. PullRequest.mergeStateStatus: MergeStateStatus = DIRTY ("The merge commit cannot be cleanly created") | UNKNOWN | BLOCKED | BEHIND
//    | UNSTABLE | HAS_HOOKS | CLEAN. #14570 answered mergeable CONFLICTING with mergeStateStatus DIRTY and viewerCanUpdate false for the viewer.
//  - GitHub computes both lazily: right after a push or reopen they are UNKNOWN until a background job finishes (actionStore.ts already polls for that).
//  - GraphQL gives NO list of conflicting files; there is nothing to list, only the state and the conflict editor.
//  - PullRequest.viewerCanUpdate is the gate for editing the branch; the conflict editor lives at https://github.com/{owner}/{repo}/pull/{n}/conflicts.
//
// Decisions fixed by the tests: either mergeable CONFLICTING or mergeStateStatus DIRTY means conflicts; a pull request that is not OPEN never reports conflicts; the editor link is offered only
// when there are conflicts AND viewerCanUpdate is true; the message is still shown without it.
export const CONFLICT_MESSAGE = "This branch has conflicts that must be resolved";
export const CONFLICT_CHECKING_MESSAGE = "Checking for conflicts";

export interface ConflictInput {
  /** MERGEABLE | CONFLICTING | UNKNOWN (null or anything else is treated as UNKNOWN). */
  mergeable?: string | null;
  mergeStateStatus?: string | null;
  /** Absent means OPEN. */
  state?: "OPEN" | "CLOSED" | "MERGED";
  viewerCanUpdate?: boolean;
}

export interface ConflictInfo {
  hasConflicts: boolean;
  /** Open, and GitHub has not yet decided (mergeable UNKNOWN and mergeStateStatus not DIRTY). */
  checking: boolean;
  /** CONFLICT_MESSAGE, CONFLICT_CHECKING_MESSAGE, or null when there is nothing to say. */
  message: string | null;
  /** conflictEditorUrl(repo, number) when hasConflicts and viewerCanUpdate; otherwise null. */
  editorUrl: string | null;
}

/** `https://github.com/${repo}/pull/${number}/conflicts`; repo is "owner/name". */
export function conflictEditorUrl(repo: string, number: number): string {
  return `https://github.com/${repo}/pull/${number}/conflicts`;
}

/** The conflict state of a pull request. See the header. */
export function conflictState(pr: ConflictInput, repo: string, number: number): ConflictInfo {
  const none: ConflictInfo = { hasConflicts: false, checking: false, message: null, editorUrl: null };
  if (pr.state && pr.state !== "OPEN") return none;
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY")
    return { hasConflicts: true, checking: false, message: CONFLICT_MESSAGE, editorUrl: pr.viewerCanUpdate ? conflictEditorUrl(repo, number) : null };
  if (pr.mergeable === "MERGEABLE") return none;
  return { ...none, checking: true, message: CONFLICT_CHECKING_MESSAGE };
}

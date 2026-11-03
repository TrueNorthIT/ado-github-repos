// Batch 3, reactions (CM-7). 
//
// Schema facts (checked live with `gh api graphql`; mutations were run with bogus node ids, so they passed validation and wrote nothing):
//  - ReactionContent = THUMBS_UP | THUMBS_DOWN | LAUGH | HOORAY | CONFUSED | HEART | ROCKET | EYES, which is also GitHub's picker order (+1, -1, laugh, hooray, confused, heart, rocket, eyes).
//  - ReactionGroup { content, createdAt, reactors(first:...) { totalCount }, subject, viewerHasReacted }. The requirement's `users { totalCount }` is DEPRECATED: introspection hides it, but it still
//    validates; its deprecationReason is "Reactors can now be mannequins, bots, and organizations. Use the `reactors` field instead. Removal on 2021-10-01 UTC." (the date has passed and it still
//    resolves). This module uses `reactors { totalCount }`.
//  - GitHub returns ALL EIGHT groups in the canonical order, zero counts included (read live on cli/cli issues and a PR comment), but the model does not rely on it.
//  - mutation addReaction(input: AddReactionInput! { subjectId: ID!, content: ReactionContent! }) and removeReaction(input: RemoveReactionInput! { subjectId: ID!, content: ReactionContent! }).
//    Payload { reaction { content } subject { id reactionGroups { content reactors { totalCount } viewerHasReacted } } } validates for both. (AddReactionPayload has a deprecated `reactionGroups` too.)
//  - Reactable (IssueComment, PullRequestReviewComment, PullRequestReview...) has reactionGroups and viewerCanReact; commentEdit.commentMetaQueries selects them.
import type { GraphQlRequest } from "./prQuery";

export type ReactionContent = "THUMBS_UP" | "THUMBS_DOWN" | "LAUGH" | "HOORAY" | "CONFUSED" | "HEART" | "ROCKET" | "EYES";

export interface ReactionDef {
  content: ReactionContent;
  /** The emoji GitHub shows. */
  emoji: string;
  /** GitHub's short name (the REST `content` value): +1, -1, laugh, hooray, confused, heart, rocket, eyes. */
  name: string;
}

/** One `reactionGroups` entry as GraphQL returns it. Anything missing counts as 0 / false. */
export interface RawReactionGroup {
  content: string;
  reactors?: { totalCount: number } | null;
  viewerHasReacted?: boolean | null;
}

export interface ReactionState {
  content: ReactionContent;
  emoji: string;
  count: number;
  viewerHasReacted: boolean;
}

const DEFS: ReactionDef[] = [
  { content: "THUMBS_UP", emoji: "\u{1F44D}", name: "+1" },
  { content: "THUMBS_DOWN", emoji: "\u{1F44E}", name: "-1" },
  { content: "LAUGH", emoji: "\u{1F604}", name: "laugh" },
  { content: "HOORAY", emoji: "\u{1F389}", name: "hooray" },
  { content: "CONFUSED", emoji: "\u{1F615}", name: "confused" },
  { content: "HEART", emoji: "\u2764\uFE0F", name: "heart" },
  { content: "ROCKET", emoji: "\u{1F680}", name: "rocket" },
  { content: "EYES", emoji: "\u{1F440}", name: "eyes" },
];
const GROUPS = "reactionGroups { content reactors { totalCount } viewerHasReacted }";


/**
 * The eight reactions in GitHub's order with their emoji (written as escapes here because source encodings differ):
 *  THUMBS_UP \u{1F44D} "+1", THUMBS_DOWN \u{1F44E} "-1", LAUGH \u{1F604} "laugh", HOORAY \u{1F389} "hooray", CONFUSED \u{1F615} "confused", HEART ❤️ "heart" (with the variation selector), ROCKET \u{1F680} "rocket", EYES \u{1F440} "eyes".
 */
export function reactionDefs(): ReactionDef[] {
  return DEFS.map((d) => ({ ...d }));
}

/** Always exactly eight entries in GitHub's order, whatever `raw` holds: missing groups are 0 / not reacted, order is ignored, unknown contents and null entries are dropped, a repeated content keeps the first. null or undefined raw gives eight empty entries. */
export function normaliseReactions(raw: (RawReactionGroup | null)[] | null | undefined): ReactionState[] {
  const first = new Map<string, RawReactionGroup>();
  for (const g of raw ?? []) if (g && !first.has(g.content)) first.set(g.content, g);
  return DEFS.map((d) => {
    const g = first.get(d.content);
    return { content: d.content, emoji: d.emoji, count: g?.reactors?.totalCount ?? 0, viewerHasReacted: !!g?.viewerHasReacted };
  });
}

/** The entries with count > 0, in order: the chips shown under a comment. */
export function visibleReactions(state: ReactionState[]): ReactionState[] {
  return state.filter((r) => r.count > 0);
}

/**
 * Pure toggle of the viewer's reaction: if viewerHasReacted, count - 1 (never below 0) and viewerHasReacted false; otherwise count + 1 and viewerHasReacted true. Other entries and the order are untouched;
 * the input is not modified. Applying it twice gives back an equal state, so it is also the rollback. An unknown content returns an equal array.
 */
export function toggleReaction(state: ReactionState[], content: ReactionContent): ReactionState[] {
  return state.map((r) => (r.content !== content ? r : r.viewerHasReacted ? { ...r, count: Math.max(0, r.count - 1), viewerHasReacted: false } : { ...r, count: r.count + 1, viewerHasReacted: true }));
}

/**
 * `mutation($input: AddReactionInput!) { addReaction(input: $input) { reaction { content } subject { id reactionGroups { content reactors { totalCount } viewerHasReacted } } } }` when `add`,
 * otherwise the same with RemoveReactionInput / removeReaction. variables.input { subjectId, content }. Throws "subjectId is required" and "content must be one of THUMBS_UP, THUMBS_DOWN, LAUGH, HOORAY, CONFUSED, HEART, ROCKET, EYES".
 */
export function reactionMutation(subjectId: string, content: ReactionContent, add: boolean): GraphQlRequest {
  if (!subjectId.trim()) throw new Error("subjectId is required");
  if (!DEFS.some((d) => d.content === content)) throw new Error("content must be one of " + DEFS.map((d) => d.content).join(", "));
  const [type, field] = add ? ["AddReactionInput", "addReaction"] : ["RemoveReactionInput", "removeReaction"];
  return { query: `mutation($input: ${type}!) { ${field}(input: $input) { reaction { content } subject { id ${GROUPS} } } }`, variables: { input: { subjectId, content } } };
}

export type ToggleResult = { ok: true } | { ok: false; error: unknown };

/**
 * Optimistic toggle with rollback. Synchronously calls `set(toggleReaction(current, content))`, then `send(add)` where add is true when the viewer had NOT reacted (so a mutation to add is sent) and false
 * when they had. On success resolves { ok: true } and leaves the optimistic state. On rejection calls `set(current)` with the very same array it was given, then resolves { ok: false, error }. Never rejects.
 */
export async function toggleOptimistically(
  current: ReactionState[],
  content: ReactionContent,
  send: (add: boolean) => Promise<unknown>,
  set: (state: ReactionState[]) => void,
): Promise<ToggleResult> {
  const add = !current.find((r) => r.content === content)?.viewerHasReacted;
  set(toggleReaction(current, content));
  try {
    await send(add);
    return { ok: true };
  } catch (error) {
    set(current);
    return { ok: false, error };
  }
}

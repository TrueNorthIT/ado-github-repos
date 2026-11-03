import { describe, it, expect } from "vitest";
import {
  reactionDefs,
  normaliseReactions,
  visibleReactions,
  toggleReaction,
  reactionMutation,
  toggleOptimistically,
  type ReactionContent,
  type ReactionState,
} from "./reactions";
import { expectMutation, expectNotInQuery, norm, NASTY } from "./ciTestHelpers";

// Module under test: src/lib/reactions.ts (stubs until the developer implements them). Requirement CM-7: "Reactions".
// Schema facts (reactors replaces the deprecated users; all eight groups come back, zero counts included) are in the header of src/lib/reactions.ts. Decisions fixed by these tests:
//  - the eight contents map to emoji in GitHub's order; the state is always eight entries so that toggling twice returns exactly the starting state.
//  - toggling flips viewerHasReacted and moves the count by one; the same function undoes it (rollback).
//  - the optimistic helper sends add = true when the viewer had not reacted, and restores the very same array on failure.

const ORDER: ReactionContent[] = ["THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "CONFUSED", "HEART", "ROCKET", "EYES"];
const EMOJI = ["\u{1F44D}", "\u{1F44E}", "\u{1F604}", "\u{1F389}", "\u{1F615}", "❤️", "\u{1F680}", "\u{1F440}"];
const NAMES = ["+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes"];

const raw = (content: string, totalCount: number, viewerHasReacted = false) => ({ content, reactors: { totalCount }, viewerHasReacted });
const state = (over: Partial<Record<ReactionContent, [number, boolean]>> = {}): ReactionState[] =>
  ORDER.map((content, i) => ({ content, emoji: EMOJI[i], count: over[content]?.[0] ?? 0, viewerHasReacted: over[content]?.[1] ?? false }));

describe("CM-7: reactionDefs maps the eight GitHub contents to emoji in GitHub's order", () => {
  it("lists the eight contents in GitHub's picker order", () => {
    expect(reactionDefs().map((d) => d.content), "Expected THUMBS_UP, THUMBS_DOWN, LAUGH, HOORAY, CONFUSED, HEART, ROCKET, EYES").toEqual(ORDER);
  });

  it("gives each its emoji", () => {
    expect(reactionDefs().map((d) => d.emoji), "Expected thumbs up, thumbs down, smile, party popper, confused, red heart (with variation selector), rocket, eyes").toEqual(EMOJI);
  });

  it("gives each GitHub's short name", () => {
    expect(reactionDefs().map((d) => d.name), "Expected +1, -1, laugh, hooray, confused, heart, rocket, eyes").toEqual(NAMES);
  });
});

describe("CM-7: normaliseReactions gives eight entries in order from whatever GitHub sent", () => {
  it("fills in empty entries for no data", () => {
    expect(normaliseReactions(null), "Expected eight zero entries for null").toEqual(state());
    expect(normaliseReactions(undefined), "Expected eight zero entries for undefined").toEqual(state());
    expect(normaliseReactions([]), "Expected eight zero entries for []").toEqual(state());
  });

  it("reads count from reactors.totalCount and viewerHasReacted", () => {
    expect(normaliseReactions([raw("HEART", 3, true), raw("EYES", 1)]), "Expected HEART 3 reacted and EYES 1").toEqual(state({ HEART: [3, true], EYES: [1, false] }));
  });

  it("restores GitHub's order when groups arrive shuffled", () => {
    expect(normaliseReactions([raw("EYES", 1), raw("THUMBS_UP", 2), raw("LAUGH", 5)]).map((r) => r.content), "Expected the canonical order").toEqual(ORDER);
  });

  it("treats a missing reactors object and a null viewerHasReacted as 0 and false", () => {
    const out = normaliseReactions([{ content: "ROCKET", reactors: null, viewerHasReacted: null }]);
    expect(out.find((r) => r.content === "ROCKET"), "Expected ROCKET with count 0 and not reacted").toMatchObject({ count: 0, viewerHasReacted: false });
  });

  it("drops unknown contents and null entries, and keeps the first of a repeated content", () => {
    const out = normaliseReactions([null, raw("SPARKLES", 9), raw("LAUGH", 2), raw("LAUGH", 7)]);
    expect(out, "Expected only the eight known entries, with LAUGH = 2").toEqual(state({ LAUGH: [2, false] }));
  });
});

describe("CM-7: visibleReactions keeps the chips that have a count", () => {
  it("keeps entries above zero, in order", () => {
    expect(visibleReactions(state({ EYES: [1, false], THUMBS_UP: [4, true] })).map((r) => r.content), "Expected THUMBS_UP then EYES").toEqual(["THUMBS_UP", "EYES"]);
  });

  it("is empty when nobody reacted", () => {
    expect(visibleReactions(state()), "Expected no chips").toEqual([]);
  });
});

describe("CM-7: toggleReaction flips the viewer's reaction and the count", () => {
  it("adds the viewer's reaction: count + 1 and viewerHasReacted true", () => {
    expect(toggleReaction(state({ HEART: [2, false] }), "HEART"), "Expected HEART 3 and reacted").toEqual(state({ HEART: [3, true] }));
  });

  it("starts a reaction nobody has used yet", () => {
    expect(toggleReaction(state(), "ROCKET"), "Expected ROCKET 1 and reacted").toEqual(state({ ROCKET: [1, true] }));
  });

  it("removes the viewer's reaction: count - 1 and viewerHasReacted false", () => {
    expect(toggleReaction(state({ HEART: [3, true] }), "HEART"), "Expected HEART 2 and not reacted").toEqual(state({ HEART: [2, false] }));
  });

  it("takes the last reaction away completely", () => {
    expect(toggleReaction(state({ EYES: [1, true] }), "EYES"), "Expected EYES back to 0").toEqual(state());
  });

  it("never goes below zero", () => {
    expect(toggleReaction(state({ EYES: [0, true] }), "EYES").find((r) => r.content === "EYES")?.count, "Expected a floor of 0 for an inconsistent state").toBe(0);
  });

  it("leaves the other reactions and the order alone", () => {
    const next = toggleReaction(state({ HEART: [2, true], EYES: [1, false] }), "EYES");
    expect(next.map((r) => [r.content, r.count, r.viewerHasReacted]), "Expected only EYES to change").toEqual(state({ HEART: [2, true], EYES: [2, true] }).map((r) => [r.content, r.count, r.viewerHasReacted]));
  });

  it("does not modify the state it was given", () => {
    const before = state({ HEART: [2, false] });
    toggleReaction(before, "HEART");
    expect(before, "Expected the input to be left alone (pure)").toEqual(state({ HEART: [2, false] }));
  });

  it("returns exactly the starting state when applied twice (rollback)", () => {
    for (const start of [state(), state({ HEART: [2, true], EYES: [1, false] })])
      for (const c of ORDER) expect(toggleReaction(toggleReaction(start, c), c), `Expected toggling ${c} twice to restore the state`).toEqual(start);
  });
});

describe("CM-7: reactionMutation builds addReaction and removeReaction", () => {
  it("adds with addReaction taking AddReactionInput", () => {
    const req = reactionMutation("IC_1", "HOORAY", true);
    expectMutation(req, "AddReactionInput", "addReaction");
    expect(req.variables, "Expected { input: { subjectId, content } }").toEqual({ input: { subjectId: "IC_1", content: "HOORAY" } });
  });

  it("removes with removeReaction taking RemoveReactionInput", () => {
    const req = reactionMutation("IC_1", "HOORAY", false);
    expectMutation(req, "RemoveReactionInput", "removeReaction");
    expect(req.variables, "Expected { input: { subjectId, content } }").toEqual({ input: { subjectId: "IC_1", content: "HOORAY" } });
  });

  it.each(ORDER)("accepts %s", (content) => {
    expect(reactionMutation("IC_1", content, true).variables, `Expected ${content} to be sent as given`).toEqual({ input: { subjectId: "IC_1", content } });
  });

  it("selects the subject's reaction groups with reactors, not the deprecated users", () => {
    const q = norm(reactionMutation("IC_1", "HEART", true).query);
    const words = q.split(/[^A-Za-z0-9_]+/);
    for (const f of ["subject", "reactionGroups", "content", "reactors", "totalCount", "viewerHasReacted"]) expect(words, `Expected the payload to select ${f}`).toContain(f);
    expect(words, "Expected the deprecated `users` field not to be used").not.toContain("users");
  });

  it("keeps the subject id out of the query text", () => {
    NASTY.forEach((v) => expectNotInQuery(reactionMutation(v, "HEART", true), [v]));
  });

  it("rejects a blank subject id and an unknown content", () => {
    expect(() => reactionMutation(" ", "HEART", true), "Expected a blank subjectId to be rejected").toThrow(/subjectId is required/);
    expect(() => reactionMutation("IC_1", "SPARKLES" as ReactionContent, true), "Expected an unknown content to be rejected").toThrow(/content must be one of/);
  });
});

describe("CM-7: toggleOptimistically updates at once and rolls back on failure", () => {
  it("sets the toggled state before the request settles, and sends add = true when the viewer had not reacted", async () => {
    const log: string[] = [];
    const current = state({ HEART: [2, false] });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const pending = toggleOptimistically(current, "HEART", async (add) => { log.push(`send:${add}`); await gate; }, (s) => log.push(`set:${s.find((r) => r.content === "HEART")?.count}`));
    pending.catch(() => undefined); // keeps a rejected promise (the stub) from also surfacing as an unhandled rejection
    expect(log, "Expected the optimistic set to happen synchronously, before the request is sent or settles").toEqual(["set:3", "send:true"]);
    release();
    expect(await pending, "Expected { ok: true } once the request succeeds").toEqual({ ok: true });
    expect(log, "Expected no further set on success").toEqual(["set:3", "send:true"]);
  });

  it("sends add = false when the viewer had already reacted", async () => {
    let sent: boolean | undefined;
    await toggleOptimistically(state({ EYES: [1, true] }), "EYES", async (add) => { sent = add; }, () => {});
    expect(sent, "Expected a removeReaction to be requested (add = false)").toBe(false);
  });

  it("restores the very same array and reports the error when the request fails", async () => {
    const current = state({ HEART: [2, false] });
    const sets: ReactionState[][] = [];
    const boom = new Error("network down");
    const result = await toggleOptimistically(current, "HEART", () => Promise.reject(boom), (s) => sets.push(s));
    expect(result, "Expected { ok: false, error } and no rejection").toEqual({ ok: false, error: boom });
    expect(sets.length, "Expected two set calls: optimistic, then rollback").toBe(2);
    expect(sets[1], "Expected the rollback to pass back the identical previous array").toBe(current);
  });

  it("does not reject when send throws synchronously", async () => {
    const current = state();
    const result = await toggleOptimistically(current, "ROCKET", () => { throw new Error("bad"); }, () => {});
    expect(result.ok, "Expected { ok: false } rather than a thrown error").toBe(false);
  });
});

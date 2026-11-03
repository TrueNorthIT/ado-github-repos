import { describe, it, expect } from "vitest";
import { MAX_LAST_VIEWED, viewedKey, mergeLastViewed, recordViewed, isUpdatedSinceViewed, type LastViewedMap } from "./lastViewed";

// Module under test: src/lib/lastViewed.ts (stubs until the developer implements them). Requirement VW-9: ""Updated since you viewed" on the list. A per-user map `{prNumber: lastViewedIso}` in
// extension data. A pure merge and prune function: keep 500, evict the oldest. `isUpdatedSinceViewed(pr.updatedAt, lastViewed)`. A "new" indicator when never viewed is off by default."
// Decisions (keys, tie-break, invalid times) are in the header of src/lib/lastViewed.ts.

const iso = (hours: number) => new Date(Date.UTC(2026, 0, 1) + hours * 3_600_000).toISOString();
const many = (n: number, offset = 0): LastViewedMap => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i + offset}`, iso(i + offset)]));

describe("VW-9: the cap is 500", () => {
  it("is 500", () => {
    expect(MAX_LAST_VIEWED, "Expected the cap from the requirement").toBe(500);
  });
});

describe("VW-9: viewedKey keeps pull request numbers from different repositories apart", () => {
  it("is owner/name#number", () => {
    expect(viewedKey("octo/demo", 12), "Expected octo/demo#12").toBe("octo/demo#12");
    expect(viewedKey("octo/demo", 12), "Expected another repo's #12 to differ").not.toBe(viewedKey("octo/other", 12));
  });
});

describe("VW-9: mergeLastViewed merges and prunes", () => {
  it("unions the keys and keeps the later time for a key in both", () => {
    const merged = mergeLastViewed({ a: iso(5), b: iso(1) }, { b: iso(9), c: iso(2) });
    expect(merged, "Expected a, the later b and c").toEqual({ a: iso(5), b: iso(9), c: iso(2) });
    expect(mergeLastViewed({ b: iso(9) }, { b: iso(1) }), "Expected the later time to win whichever side holds it").toEqual({ b: iso(9) });
  });

  it("drops entries whose time is not a valid date", () => {
    expect(mergeLastViewed({ a: "not a date", b: iso(1) }, { c: "" }), "Expected only the valid entry").toEqual({ b: iso(1) });
  });

  it("does not change either input", () => {
    const a = { a: iso(1) };
    const b = { b: iso(2) };
    mergeLastViewed(a, b);
    expect([a, b], "Expected both inputs untouched").toEqual([{ a: iso(1) }, { b: iso(2) }]);
  });

  it("keeps all 500 entries at the cap", () => {
    expect(Object.keys(mergeLastViewed(many(500), {})), "Expected 500 to be kept").toHaveLength(500);
  });

  it("evicts the oldest entries beyond 500, keeping the 500 newest", () => {
    const out = mergeLastViewed(many(300), many(300, 300));
    expect(Object.keys(out), "Expected 500 of the 600 entries").toHaveLength(500);
    expect(out["k99"], "Expected the 100 oldest (k0..k99) evicted").toBeUndefined();
    expect(out["k100"], "Expected the 101st oldest kept").toBe(iso(100));
    expect(out["k599"], "Expected the newest kept").toBe(iso(599));
  });

  it("prunes to a given smaller maximum", () => {
    expect(Object.keys(mergeLastViewed(many(10), {}, 3)).sort(), "Expected the three newest of ten").toEqual(["k7", "k8", "k9"]);
  });

  it("breaks a tie on time deterministically: the key that sorts later is evicted first", () => {
    const t = iso(1);
    expect(Object.keys(mergeLastViewed({ c: t, a: t, b: t }, {}, 2)).sort(), "Expected a and b kept, c evicted").toEqual(["a", "b"]);
  });
});

describe("VW-9: recordViewed notes one view", () => {
  it("adds the pull request with the time", () => {
    expect(recordViewed({ a: iso(1) }, "b", iso(2)), "Expected both entries").toEqual({ a: iso(1), b: iso(2) });
  });

  it("moves an existing entry forward but never back", () => {
    expect(recordViewed({ a: iso(1) }, "a", iso(5)), "Expected the later time").toEqual({ a: iso(5) });
    expect(recordViewed({ a: iso(5) }, "a", iso(1)), "Expected the earlier time to be ignored").toEqual({ a: iso(5) });
  });

  it("evicts the oldest entry when it would pass 500", () => {
    const out = recordViewed(many(500), "fresh", iso(9999));
    expect(Object.keys(out), "Expected still 500 entries").toHaveLength(500);
    expect([out["k0"], out["fresh"]], "Expected k0 (the oldest) evicted and the new one kept").toEqual([undefined, iso(9999)]);
  });

  it("does not change the map it was given", () => {
    const m = { a: iso(1) };
    recordViewed(m, "b", iso(2));
    expect(m, "Expected the input untouched").toEqual({ a: iso(1) });
  });
});

describe("VW-9: isUpdatedSinceViewed", () => {
  it("is true when the pull request changed after it was last viewed", () => {
    expect(isUpdatedSinceViewed(iso(10), iso(5)), "Expected a later updatedAt to be flagged").toBe(true);
  });

  it("is false when it was viewed at or after the last update", () => {
    expect(isUpdatedSinceViewed(iso(5), iso(5)), "Expected an equal time not to be flagged").toBe(false);
    expect(isUpdatedSinceViewed(iso(5), iso(10)), "Expected an earlier updatedAt not to be flagged").toBe(false);
  });

  it("compares instants, not strings: different offsets for the same moment are equal", () => {
    expect(isUpdatedSinceViewed("2026-01-01T10:00:00+01:00", "2026-01-01T09:00:00Z"), "Expected the same instant not to be flagged").toBe(false);
    expect(isUpdatedSinceViewed("2026-01-01T10:00:01+01:00", "2026-01-01T09:00:00Z"), "Expected one second later to be flagged").toBe(true);
  });

  it("does not flag a pull request that was never viewed, unless asked to", () => {
    expect(isUpdatedSinceViewed(iso(10), undefined), "Expected the 'new' indicator to be off by default").toBe(false);
    expect(isUpdatedSinceViewed(iso(10), undefined, {}), "Expected off with empty options").toBe(false);
    expect(isUpdatedSinceViewed(iso(10), undefined, { newWhenNeverViewed: true }), "Expected the opt-in to flag it").toBe(true);
    expect(isUpdatedSinceViewed(iso(10), undefined, { newWhenNeverViewed: false }), "Expected an explicit off to stay off").toBe(false);
  });

  it("treats an unreadable last-viewed time as never viewed", () => {
    expect(isUpdatedSinceViewed(iso(10), "garbage"), "Expected off by default").toBe(false);
    expect(isUpdatedSinceViewed(iso(10), "garbage", { newWhenNeverViewed: true }), "Expected the opt-in to apply").toBe(true);
  });

  it("is false for an unreadable updatedAt", () => {
    expect(isUpdatedSinceViewed("garbage", iso(5)), "Expected false").toBe(false);
    expect(isUpdatedSinceViewed("garbage", undefined, { newWhenNeverViewed: true }), "Expected false even when never viewed").toBe(false);
  });
});

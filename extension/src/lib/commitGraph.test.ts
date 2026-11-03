import { describe, it, expect } from "vitest";
import { computeGraph, type GraphInput, type GraphRow } from "./commitGraph";

// Module under test: src/lib/commitGraph.ts (computeGraph), C-2 "Commit graph lanes, like ADO's Graph column".
// Input: commits newest first in topological order (every child before its parents), each with its parent oids.
// Each output row says where to draw, for ONE row of the Graph column (lane 0 is leftmost):
//   lane     the dot's column
//   top      a line comes into the dot from above on its own lane      (false for a branch tip)
//   bottom   a line leaves the dot downwards on its own lane           (false for a root, or when the lane ends into another lane)
//   lines    other lanes drawn straight through the row (occupied above AND below), ascending
//   merges   lanes the dot connects DOWN to for additional parents (parents[1..]): the lane already waiting for that parent, else a new lane
//   branches the lane the dot's own lane ends into when the FIRST parent already has a lane elsewhere (then bottom is false)
// Lane rules (the requirement's "deterministic" rules, made explicit):
//   - a commit takes the lane waiting for it; a commit nothing waits for (a tip) takes the LOWEST free index.
//   - the first parent keeps the lane, unless that parent already has a lane: then this lane frees and `branches` names the other lane.
//   - an additional parent uses the lane already waiting for it, else opens the lowest free index.
//   - a lane frees when its commit is a root or its first parent is elsewhere. A free index is reused (lowest first).
//   - a parent that is NOT in the list (history cut at the page end) keeps its lane open to the bottom edge: `bottom` stays true.
// maxLanes is one more than the highest lane index used anywhere in the layout (0 for no commits).
// Hand-worked fixtures: oids are short strings, which is all the algorithm needs.

const c = (sha: string, ...parents: string[]): GraphInput => ({ sha, parents });
const row = (sha: string, lane: number, o: Partial<Omit<GraphRow, "sha" | "lane">> = {}): GraphRow => ({
  sha,
  lane,
  top: true,
  bottom: true,
  lines: [],
  merges: [],
  branches: [],
  ...o,
});

describe("C-2: linear history", () => {
  // a -> b -> c (root): one lane, the line runs from the first dot to the root.
  it("keeps every commit on lane 0, starting at the tip and ending at the root", () => {
    const g = () => computeGraph([c("a", "b"), c("b", "c"), c("c")]);
    expect(g().rows, "Expected a tip with no top line, a pass-through, then a root with no bottom line").toEqual([
      row("a", 0, { top: false }),
      row("b", 0),
      row("c", 0, { bottom: false }),
    ]);
    expect(g().maxLanes, "Expected one lane for linear history").toBe(1);
  });

  it("gives no commits no rows and no width", () => {
    expect(computeGraph([]), "Expected an empty layout").toEqual({ rows: [], maxLanes: 0 });
  });
});

describe("C-2: a merge commit", () => {
  // M merges a1 (first parent) and b1; both descend from base. Order: M, a1, b1, base.
  const g = () => computeGraph([c("M", "a1", "b1"), c("a1", "base"), c("b1", "base"), c("base")]);

  it("keeps the first parent on the merge's lane and opens lane 1 for the second parent", () => {
    expect(g().rows[0], "Expected M on lane 0 with a merge connection down to new lane 1").toEqual(row("M", 0, { top: false, merges: [1] }));
  });

  it("draws the other lane straight through the first parent's row", () => {
    expect(g().rows[1], "Expected a1 on lane 0 with lane 1 passing through").toEqual(row("a1", 0, { lines: [1] }));
  });

  it("ends the second parent's lane into the lane that already waits for the shared base", () => {
    expect(g().rows[2], "Expected b1 on lane 1, ending into lane 0 (bottom false, branches [0])").toEqual(row("b1", 1, { lines: [0], bottom: false, branches: [0] }));
  });

  it("finishes on lane 0 at the root", () => {
    expect(g().rows[3], "Expected base on lane 0, a root").toEqual(row("base", 0, { bottom: false }));
    expect(g().maxLanes, "Expected two lanes").toBe(2);
  });
});

describe("C-2: two concurrent branches", () => {
  // X and Y are separate tips that both descend from base. Order: X, Y, x1, y1, base.
  const g = () => computeGraph([c("X", "x1"), c("Y", "y1"), c("x1", "base"), c("y1", "base"), c("base")]);

  it("puts the second tip on the lowest free lane, with lane 0 passing through", () => {
    expect(g().rows[0], "Expected the first tip on lane 0").toEqual(row("X", 0, { top: false }));
    expect(g().rows[1], "Expected the second tip on lane 1 with lane 0 passing through").toEqual(row("Y", 1, { top: false, lines: [0] }));
  });

  it("keeps each branch in its own lane until they meet", () => {
    expect(g().rows[2], "Expected x1 on lane 0 with lane 1 passing through").toEqual(row("x1", 0, { lines: [1] }));
  });

  it("joins the second branch into the first at the shared parent and finishes on lane 0", () => {
    expect(g().rows[3], "Expected y1 on lane 1 ending into lane 0").toEqual(row("y1", 1, { lines: [0], bottom: false, branches: [0] }));
    expect(g().rows[4], "Expected base on lane 0, a root").toEqual(row("base", 0, { bottom: false }));
    expect(g().maxLanes, "Expected two lanes").toBe(2);
  });
});

describe("C-2: lane reuse", () => {
  // T1 and T2 are tips, r is T1's root, then T3 is a later tip: it must take the lane r just freed (0), not a new one (2).
  const g = () => computeGraph([c("T1", "r"), c("T2", "s"), c("r"), c("T3", "t")]);

  it("frees the lane of a root commit", () => {
    expect(g().rows[2], "Expected r on lane 0 as a root, with lane 1 (T2's) passing through").toEqual(row("r", 0, { lines: [1], bottom: false }));
  });

  it("gives a new tip the lowest free lane index", () => {
    expect(g().rows[3], "Expected T3 on the freed lane 0 with lane 1 passing through").toEqual(row("T3", 0, { top: false, lines: [1] }));
    expect(g().maxLanes, "Expected the width to stay at two lanes").toBe(2);
  });
});

describe("C-2: an additional parent that already has a lane", () => {
  // T waits for b on lane 0. M (a later tip) merges a and b: b is already on lane 0, so M connects to it instead of opening a lane.
  const g = () => computeGraph([c("T", "b"), c("M", "a", "b"), c("a"), c("b")]);

  it("connects to the existing lane and opens no new one", () => {
    expect(g().rows[1], "Expected M on lane 1 with a merge connection to existing lane 0 (also passing through)").toEqual(row("M", 1, { top: false, lines: [0], merges: [0] }));
    expect(g().maxLanes, "Expected only two lanes").toBe(2);
  });

  it("ends each lane at its root", () => {
    expect(g().rows[2], "Expected a on lane 1 (M's first parent), a root").toEqual(row("a", 1, { lines: [0], bottom: false }));
    expect(g().rows[3], "Expected b on lane 0, a root").toEqual(row("b", 0, { bottom: false }));
  });
});

describe("C-2: an octopus merge (three parents)", () => {
  // M merges p1 (first), p2 and p3, all children of base. Order: M, p1, p2, p3, base.
  const g = () => computeGraph([c("M", "p1", "p2", "p3"), c("p1", "base"), c("p2", "base"), c("p3", "base"), c("base")]);

  it("opens a lane for each additional parent, lowest index first", () => {
    expect(g().rows[0], "Expected M on lane 0 connecting down to new lanes 1 and 2").toEqual(row("M", 0, { top: false, merges: [1, 2] }));
  });

  it("passes the other lanes through each parent row and ends them into lane 0", () => {
    expect(g().rows[1], "Expected p1 on lane 0 with lanes 1 and 2 passing through").toEqual(row("p1", 0, { lines: [1, 2] }));
    expect(g().rows[2], "Expected p2 on lane 1, ending into lane 0, lane 2 passing through").toEqual(row("p2", 1, { lines: [0, 2], bottom: false, branches: [0] }));
    expect(g().rows[3], "Expected p3 on lane 2, ending into lane 0, lane 1 already free").toEqual(row("p3", 2, { lines: [0], bottom: false, branches: [0] }));
  });

  it("finishes on lane 0 and is three lanes wide", () => {
    expect(g().rows[4], "Expected base on lane 0, a root").toEqual(row("base", 0, { bottom: false }));
    expect(g().maxLanes, "Expected three lanes for a three-parent merge").toBe(3);
  });
});

describe("C-2: history truncated at the end of the page", () => {
  // M merges a and b, but the page ends before a0 and b0 (their parents) appear: both lanes continue to the bottom edge.
  const g = () => computeGraph([c("M", "a", "b"), c("a", "a0"), c("b", "b0")]);

  it("keeps the first-parent lane open below the last row that has a missing parent", () => {
    expect(g().rows[1], "Expected a on lane 0 still going down (its parent a0 is not in the list)").toEqual(row("a", 0, { lines: [1] }));
  });

  it("keeps the merged lane open to the bottom edge too", () => {
    expect(g().rows[2], "Expected b on lane 1 still going down (its parent b0 is not in the list), lane 0 passing through").toEqual(row("b", 1, { lines: [0] }));
    expect(g().rows[2].bottom, "Expected the last row's line to continue to the bottom edge").toBe(true);
    expect(g().maxLanes, "Expected two lanes").toBe(2);
  });

  it("keeps a lone commit's lane open when its parent is missing", () => {
    const only = computeGraph([c("x", "missing")]);
    expect(only.rows, "Expected a tip whose line continues downwards").toEqual([row("x", 0, { top: false })]);
  });
});

describe("C-2: the layout is deterministic", () => {
  it("gives the same layout for the same input and does not change the input", () => {
    const input = [c("M", "a", "b"), c("a", "base"), c("b", "base"), c("base")];
    const copy = JSON.parse(JSON.stringify(input));
    expect(computeGraph(input), "Expected repeated calls to agree").toEqual(computeGraph(input));
    expect(input, "Expected the input array to be left untouched").toEqual(copy);
  });
});

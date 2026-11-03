// Commit graph lanes for the Commits list's Graph column (C-2).

export interface GraphInput {
  sha: string;
  /** Parent oids, first parent first. */
  parents: string[];
}

export interface GraphRow {
  sha: string;
  /** Column index (0 is leftmost) of this commit's dot. */
  lane: number;
  /** A line enters the dot from above on its own lane (false for a branch tip). */
  top: boolean;
  /** A line leaves the dot downwards on its own lane (false for a root commit, or when the lane ends into another lane's parent). */
  bottom: boolean;
  /** Other lanes drawn straight through this row: occupied above and below it. Ascending, never contains `lane`. */
  lines: number[];
  /** Lanes the dot connects DOWN to for its additional parents (parents[1..]): a new lane, or the existing lane already waiting for that parent. Ascending. */
  merges: number[];
  /** Set only when the first parent already has a lane elsewhere: the lane this commit's own lane ends into, so `bottom` is false. */
  branches: number[];
}

export interface GraphLayout {
  rows: GraphRow[];
  /** One more than the highest lane index used anywhere (0 for no commits): the width of the Graph column in lanes. */
  maxLanes: number;
}

/**
 * Lanes for commits in topological order, newest first (every child before its parents).
 * Rules: a commit takes the lane waiting for it, or the lowest free index when none is (a new tip).
 * Its first parent keeps that lane unless the parent already has a lane. Each additional parent
 * uses the lane already waiting for it, or opens the lowest free index. A lane frees when its commit
 * has no parent (root) or its first parent is elsewhere. A parent absent from the list keeps its lane open to the bottom edge.
 */
export function computeGraph(commits: GraphInput[]): GraphLayout {
  // lanes[i] is the oid lane i is waiting for (null when free).
  const lanes: (string | null)[] = [];
  const lowestFree = (not = -1) => {
    let i = 0;
    while (lanes[i] != null || i === not) i++;
    return i;
  };
  const rows = commits.map(({ sha, parents }): GraphRow => {
    const before = [...lanes];
    let lane = lanes.indexOf(sha);
    const top = lane >= 0;
    if (!top) lane = lowestFree();
    lanes[lane] = null;
    const branches: number[] = [];
    const merges: number[] = [];
    let bottom = false;
    if (parents.length) {
      const existing = lanes.indexOf(parents[0]);
      if (existing >= 0) branches.push(existing);
      else {
        lanes[lane] = parents[0];
        bottom = true;
      }
      for (const p of parents.slice(1)) {
        let at = lanes.indexOf(p);
        if (at < 0) lanes[(at = lowestFree(lane))] = p;
        if (!merges.includes(at)) merges.push(at);
      }
    }
    const lines: number[] = [];
    for (let i = 0; i < lanes.length; i++) if (i !== lane && before[i] != null && lanes[i] != null) lines.push(i);
    return { sha, lane, top, bottom, lines, merges: merges.sort((a, b) => a - b), branches };
  });
  return { rows, maxLanes: rows.length ? Math.max(...rows.map((r) => Math.max(r.lane, ...r.merges, ...r.lines) + 1)) : 0 };
}

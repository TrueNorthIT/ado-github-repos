/** Fuzzy path finder for the "find a file or folder" box. */
export interface FuzzyHit {
  path: string;
  /** Positions in path of the matched characters, ascending. */
  indices: number[];
}

const BOUNDARY = /[/._\-\s]/;
const NEG = -Infinity;

/**
 * Best-scoring case-insensitive subsequence alignment of q in p (dynamic programming, so the highlighted
 * characters are the best ones, not just the first greedy ones). Returns undefined when q is not a subsequence.
 */
function align(p: string, q: string): { score: number; indices: number[] } | undefined {
  const n = p.length;
  const m = q.length;
  if (m > n) return undefined;
  const lp = p.toLowerCase();
  const slash = p.lastIndexOf("/");
  const bonus = (j: number) =>
    (j === 0 || BOUNDARY.test(p[j - 1]) ? 8 : /[a-z]/.test(p[j - 1]) && /[A-Z]/.test(p[j]) ? 6 : 0) + (j > slash ? 4 : 0);
  // best[i][j]: best score with q[i] matched at p[j]; from[i][j]: where q[i-1] was matched.
  const best: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < m; i++) {
    best.push(new Array(n).fill(NEG));
    from.push(new Array(n).fill(-1));
    let run = NEG; // best of best[i-1][k] for k < j
    let runAt = -1;
    for (let j = 0; j < n; j++) {
      if (i > 0 && j > 0 && best[i - 1][j - 1] > run) [run, runAt] = [best[i - 1][j - 1], j - 1];
      if (lp[j] !== q[i]) continue;
      if (i === 0) best[i][j] = 1 + bonus(j);
      else {
        let s = run === NEG ? NEG : run + 1 + bonus(j);
        let f = runAt;
        const adj = best[i - 1][j - 1];
        if (j > 0 && adj !== NEG && adj + 1 + bonus(j) + 10 > s) [s, f] = [adj + 1 + bonus(j) + 10, j - 1]; // consecutive run
        best[i][j] = s;
        from[i][j] = f;
      }
    }
  }
  let end = -1;
  for (let j = 0; j < n; j++) if (best[m - 1][j] !== NEG && (end < 0 || best[m - 1][j] > best[m - 1][end])) end = j;
  if (end < 0) return undefined;
  const indices = new Array<number>(m);
  for (let i = m - 1, j = end; i >= 0; j = from[i][j], i--) indices[i] = j;
  return { score: best[m - 1][end], indices };
}

/** Paths matching query, best first (higher score, then shorter, then alphabetical), at most limit. Blank query gives []. */
export function fuzzyFind(paths: string[], query: string, limit = 50): FuzzyHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: { path: string; score: number; indices: number[] }[] = [];
  for (const path of paths) {
    const a = align(path, q);
    if (a) hits.push({ path, ...a });
  }
  hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return hits.slice(0, limit).map(({ path, indices }) => ({ path, indices }));
}

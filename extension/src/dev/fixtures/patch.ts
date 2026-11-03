// __TN_MOCK__ A unified-diff `patch` (REST shape: hunks only, three lines of context) for two texts, so the fixture files have hunks that line comments can be placed in.
const NL = String.fromCharCode(10);

type Op = { t: " " | "-" | "+"; text: string };

/** Line diff through a longest-common-subsequence table: fine for fixture-sized files. */
function diff(a: string[], b: string[]): Op[] {
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) ops.push({ t: " ", text: a[i++] }), j++;
    else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) ops.push({ t: "+", text: b[j++] });
    else ops.push({ t: "-", text: a[i++] });
  }
  return ops;
}

const split = (s: string | undefined) => (s === undefined ? [] : s.replace(/\n$/, "").split(NL));

export function makePatch(base: string | undefined, head: string | undefined, context = 3): string | undefined {
  const ops = diff(split(base), split(head));
  const changed = ops.map((o, i) => (o.t === " " ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return undefined;
  // merge changes whose context windows touch
  const spans: [number, number][] = [];
  for (const c of changed) {
    const lo = Math.max(0, c - context), hi = Math.min(ops.length - 1, c + context);
    const last = spans[spans.length - 1];
    if (last && lo <= last[1] + 1) last[1] = hi;
    else spans.push([lo, hi]);
  }
  const out: string[] = [];
  for (const [lo, hi] of spans) {
    let oldStart = 1, newStart = 1;
    for (let k = 0; k < lo; k++) {
      if (ops[k].t !== "+") oldStart++;
      if (ops[k].t !== "-") newStart++;
    }
    const part = ops.slice(lo, hi + 1);
    const oldCount = part.filter((o) => o.t !== "+").length;
    const newCount = part.filter((o) => o.t !== "-").length;
    out.push(`@@ -${oldCount ? oldStart : oldStart - 1},${oldCount} +${newCount ? newStart : newStart - 1},${newCount} @@`);
    for (const o of part) out.push(o.t + o.text);
  }
  return out.join(NL);
}

/** The hunk text GitHub gives a review comment: its hunk's header and lines up to and including `line` on `side`. */
export function hunkUpTo(patch: string | undefined, line: number, side: "LEFT" | "RIGHT"): string {
  if (!patch) return "";
  const lines = patch.split(NL);
  let start = -1;
  let oldN = 0, newN = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[i]);
    if (h) {
      start = i;
      oldN = Number(h[1]) - 1;
      newN = Number(h[2]) - 1;
      continue;
    }
    if (lines[i][0] !== "+") oldN++;
    if (lines[i][0] !== "-") newN++;
    const hit = side === "RIGHT" ? lines[i][0] !== "-" && newN === line : lines[i][0] !== "+" && oldN === line;
    if (hit && start >= 0) return lines.slice(start, i + 1).join(NL);
  }
  return "";
}

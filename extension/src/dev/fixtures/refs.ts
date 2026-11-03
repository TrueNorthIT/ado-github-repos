// __TN_MOCK__ Fixture history, branches, tags and pushes for the Repos pages (batch R1), shaped like GitHub's GraphQL and REST answers.
// The main fixture repo has about 120 commits with real branching and merging (two-parent merges and one octopus); every other
// repo gets a short linear history. Writes (create or delete a branch or tag) change this module's state, so a refresh shows them.
import { PR_REPO, ME } from "./prs";

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const NOW = Date.now();

const COLORS = ["#0078d4", "#8764b8", "#2f7d32", "#ca5010", "#b4009e", "#038387"];
const avatar = (login: string) => {
  const c = COLORS[[...login].reduce((h, ch) => h + ch.charCodeAt(0), 0) % COLORS.length];
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${c}"/><text x="32" y="42" font-family="Segoe UI,Arial" font-size="28" fill="#fff" text-anchor="middle">${login[0].toUpperCase()}</text></svg>`)}`;
};
export interface Who { name: string; login: string | null }
const PEOPLE: Who[] = [
  { name: "Ann Author", login: "ann" },
  { name: "bob", login: "bob-dev" },
  { name: "Carol Commit", login: "carol" },
  { name: "Mock User", login: ME },
  { name: "Dave Developer", login: "dave" },
  { name: "Renovate Bot", login: "renovate" },
  { name: "Sam Unlinked", login: null }, // a git identity with no GitHub account
];
const actor = (w: Who) => ({ name: w.name, user: w.login ? { login: w.login, avatarUrl: avatar(w.login) } : null });

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sha = (n: number) => (Math.imul(n + 1, 2654435761) >>> 0).toString(16).padStart(8, "0").repeat(5).slice(0, 40);

export interface FCommit {
  idx: number;
  sha: string;
  title: string;
  message: string;
  author: Who;
  at: number;
  parents: string[];
  pr: number | null;
  status: "SUCCESS" | "FAILURE" | "PENDING" | null;
}

const TITLES = [
  "Add retry handling to the sync job", "Fix login redirect loop", "Update dependencies", "Refactor listing component", "Docs: clarify setup steps",
  "Handle empty repositories", "Bump build tooling", "Add keyboard shortcuts to the file finder", "Fix off-by-one in pagination", "Improve error messages",
  "Support tilde-fenced code blocks", "Cache branch lists", "Tidy up CSS", "Add dark theme tokens", "Remove unused exports", "Merge remote-tracking branch 'origin/main' into develop",
];

export interface FBranch { name: string; tip: string; protected: boolean; pr: number | null }
export interface FTag { name: string; commit: string; message?: string; tagger?: Who; at: number }
export interface RepoRefs {
  commits: FCommit[]; // oldest first
  bySha: Map<string, FCommit>;
  main: string;
  branches: FBranch[];
  tags: FTag[];
  /** Annotated tag objects created through REST and not yet pointed at by a ref: tag object sha to its details. */
  pendingTagObjects: Map<string, { commit: string; message: string }>;
}

function history(count: number, big: boolean): { commits: FCommit[]; main: string; open: string[] } {
  const r = rng(42);
  const commits: FCommit[] = [];
  const spacing = (big ? 560 : 20) * DAY / count;
  const add = (parents: string[], title?: string, pr?: number | null): FCommit => {
    const idx = commits.length;
    const author = PEOPLE[Math.floor(r() * 5)];
    const c: FCommit = {
      idx, sha: sha(idx), title: title ?? TITLES[Math.floor(r() * TITLES.length)], message: "", author,
      at: NOW - (count - idx) * spacing + (idx === count - 1 ? -20 * 60e3 : 0),
      parents, pr: pr ?? null, status: r() < 0.12 ? "FAILURE" : r() < 0.06 ? null : r() < 0.03 ? "PENDING" : "SUCCESS",
    };
    c.message = `${c.title}\n\n${c.title} (details).\nCo-authored in the mock fixtures.`;
    // Azure Boards mentions (AB#), in the headline of some commits and the body of others; 1000..1099 resolve in the work item mock, 4242 does not.
    if (idx % 7 === 3) { c.title = `${c.title} AB#${1000 + (idx % 6)}`; c.message = `${c.title}\n\n${c.message.split("\n").slice(2).join("\n")}`; }
    else if (idx % 5 === 2) c.message += `\n\nRelated work items: AB#${1000 + (idx % 4)}, AB#${1002 + (idx % 3)}${idx % 10 === 7 ? ", AB#4242" : ""}`;
    commits.push(c);
    return c;
  };
  if (!big) {
    for (let i = 0; i < count; i++) add(i ? [commits[i - 1].sha] : [], i === 0 ? "Initial commit" : undefined);
    return { commits, main: commits[count - 1].sha, open: [] };
  }
  let main = add([], "Initial commit").sha;
  const open: { tip: string; left: number; name: string }[] = [];
  let prNo = 170; // merged PR numbers in the PR fixtures are 141..170
  let octopusDone = false;
  while (commits.length < count) {
    const roll = r();
    const finished = open.filter((o) => o.left === 0);
    if (!octopusDone && finished.length >= 3 && commits.length > 60) {
      // The octopus merge: three finished branches in one commit.
      const three = finished.slice(0, 3);
      main = add([main, ...three.map((o) => o.tip)], "Merge branches 'feature/a', 'feature/b' and 'feature/c'").sha;
      three.forEach((o) => open.splice(open.indexOf(o), 1));
      octopusDone = true;
    } else if (finished.length && roll < 0.5 && !(commits.length > 50 && !octopusDone && finished.length < 3 && open.length >= 3 && commits.length < 70)) {
      const o = finished[0];
      open.splice(open.indexOf(o), 1);
      const n = prNo > 141 ? prNo-- : null;
      main = add([main, o.tip], n ? `Merged PR ${n}: ${TITLES[(n * 7) % TITLES.length]}` : `Merge branch '${o.name}'`, n).sha;
    } else if (open.length < 4 && roll < 0.7) {
      const base = commits[Math.max(0, commits.findIndex((c) => c.sha === main))].sha;
      open.push({ tip: base, left: 2 + Math.floor(r() * 3), name: `feature/topic-${commits.length}` });
    } else if (open.some((o) => o.left > 0) && roll < 0.85) {
      const o = open.filter((x) => x.left > 0)[Math.floor(r() * open.filter((x) => x.left > 0).length)];
      o.tip = add([o.tip]).sha;
      o.left--;
    } else {
      main = add([main]).sha;
    }
  }
  return { commits, main, open: open.map((o) => o.tip) };
}

export const ancestors = (rr: RepoRefs, tip: string): Set<string> => {
  const seen = new Set<string>();
  const stack = [tip];
  while (stack.length) {
    const s = stack.pop()!;
    if (seen.has(s)) continue;
    seen.add(s);
    stack.push(...(rr.bySha.get(s)?.parents ?? []));
  }
  return seen;
};

/** History of a tip, newest first (by commit time, so every child comes before its parents). */
export const historyOf = (rr: RepoRefs, tip: string): FCommit[] =>
  [...ancestors(rr, tip)].map((s) => rr.bySha.get(s)!).filter(Boolean).sort((a, b) => b.at - a.at || b.idx - a.idx);

function build(fullName: string): RepoRefs {
  const big = fullName.toLowerCase() === PR_REPO;
  const { commits, main, open } = history(big ? 120 : 8, big);
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const rr: RepoRefs = { commits, bySha, main, branches: [], tags: [], pendingTagObjects: new Map() };
  const at = (frac: number) => commits[Math.min(commits.length - 1, Math.max(0, Math.round((commits.length - 1) * frac)))].sha;
  if (!big) {
    rr.branches = [{ name: "main", tip: main, protected: true, pr: null }, { name: "develop", tip: at(0.8), protected: false, pr: null }];
    return rr;
  }
  const B = (name: string, tip: string, over: Partial<FBranch> = {}): FBranch => ({ name, tip, protected: false, pr: null, ...over });
  rr.branches = [
    B("main", main, { protected: true }),
    B("develop", at(0.97), { pr: 199 }),
    B("release/1.0", at(0.6), { protected: true }),
    B("release/2.0", at(0.9)),
    B("hotfix/typo", at(0.93), { pr: 196 }),
    B("feature/login", open[0] ?? at(0.95), { pr: 200 }),
    B("feature/x", at(0.7)),
    ...Array.from({ length: 8 }, (_, i) => B(`feature/ticket-${1000 + i}`, i < 3 && open[i + 1] ? open[i + 1] : at(0.82 + i * 0.02), i % 3 === 0 ? { pr: 171 + i } : {})),
    B("feature/jdp/tooling-majors", at(0.99), { pr: 198 }),
    B("feature/jdp/retry-sync", at(0.985)),
    ...["all-minor-patch", "jasmine-7.x", "major-eslint-monorepo", "pin-dependencies", "tailwindcss-monorepo"].map((n, i) => B(`renovate/${n}`, at(0.88 + i * 0.01), i === 1 ? { pr: 185 } : {})),
    B("stale/old-experiment", at(0.12)),
    B("stale/legacy-cleanup", at(0.25)),
    B("stale/spike-graphql", at(0.3)),
  ];
  // Force a few authors and a mine-friendly set for the mock user.
  const set = (name: string, who: number) => { const b = rr.branches.find((x) => x.name === name); if (b) bySha.get(b.tip)!.author = PEOPLE[who]; };
  set("feature/login", 3); set("feature/jdp/tooling-majors", 3); set("feature/jdp/retry-sync", 3);
  ["all-minor-patch", "jasmine-7.x", "major-eslint-monorepo", "pin-dependencies", "tailwindcss-monorepo"].forEach((n) => set(`renovate/${n}`, 5));
  set("stale/spike-graphql", 6);
  const T = (name: string, frac: number, annotated?: string): FTag => {
    const c = commits[Math.round((commits.length - 1) * frac)];
    return { name, commit: c.sha, at: c.at, ...(annotated ? { message: annotated, tagger: PEOPLE[3] } : {}) };
  };
  rr.tags = [
    T("v1.0.0", 0.2, "First stable release"),
    T("v1.1.0", 0.35),
    T("v1.2.0", 0.5, "Release 1.2.0\n\n- retry handling\n- login fixes"),
    T("v2.0.0-beta.1", 0.8, "Second major, first beta"),
    T("release/2025.01", 0.3),
    T("release/2025.06", 0.55, "June release"),
    T("release/2026.02", 0.9),
    T("nightly", 0.98),
  ];
  return rr;
}

const repos = new Map<string, RepoRefs>();
/** The refs state of a repo (lazily built, kept for the session; the empty-tags fixture is every repo but the main one). */
export const refsOf = (fullName: string): RepoRefs => {
  const k = fullName.toLowerCase();
  let r = repos.get(k);
  if (!r) repos.set(k, (r = build(fullName)));
  return r;
};

/** A branch name, qualified ref, tag, or SHA (prefix) to a commit sha. Unknown names resolve to a stable commit, so the 130 generic branches of the file browser fixture still show history. */
export function resolve(rr: RepoRefs, name: string): string | undefined {
  const n = name.replace(/^refs\/(heads|tags)\//, "");
  const b = rr.branches.find((x) => x.name === n);
  if (b) return b.tip;
  const t = rr.tags.find((x) => x.name === n);
  if (t) return t.commit;
  if (/^[0-9a-f]{4,40}$/i.test(n)) return rr.commits.find((c) => c.sha.startsWith(n.toLowerCase()))?.sha;
  if (name.startsWith("refs/")) return undefined;
  const h = [...n].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return rr.commits[Math.floor(rr.commits.length * (0.5 + (h % 50) / 100)) % rr.commits.length].sha;
}

// ---------- GraphQL node shapes ----------

export const commitNode = (c: FCommit) => ({
  oid: c.sha,
  messageHeadline: c.title,
  message: c.message,
  messageBody: c.message.split("\n").slice(2).join("\n"),
  committedDate: new Date(c.at + 60e3).toISOString(),
  authoredDate: new Date(c.at).toISOString(),
  author: actor(c.author),
  committer: { name: "GitHub", user: null },
  parents: { nodes: c.parents.map((oid) => ({ oid })) },
  associatedPullRequests: { nodes: c.pr ? [{ number: c.pr, title: c.title, state: "MERGED", mergeCommit: { oid: c.sha } }] : [] },
  statusCheckRollup: c.status ? { state: c.status } : null,
  tree: { oid: sha(c.idx + 5000) },
  signature: c.idx % 9 === 0 ? { isValid: true, state: "VALID", wasSignedByGitHub: c.idx % 18 === 0, signer: { login: "ann" } } : c.idx % 9 === 4 ? { isValid: false, state: "UNKNOWN_KEY", wasSignedByGitHub: false, signer: null } : null,
});

export function branchNode(rr: RepoRefs, b: FBranch) {
  const c = rr.bySha.get(b.tip)!;
  return {
    id: `REF_heads_${b.name}`,
    name: b.name,
    branchProtectionRule: b.protected ? { id: "BPR_1" } : null,
    associatedPullRequests: { nodes: b.pr ? [{ number: b.pr, title: `PR ${b.pr}` }] : [] },
    target: { oid: c.sha, authoredDate: new Date(c.at).toISOString(), author: actor(c.author), statusCheckRollup: c.status ? { state: c.status } : null },
  };
}

export function tagNode(rr: RepoRefs, t: FTag) {
  const c = rr.bySha.get(t.commit)!;
  return {
    id: `REF_tags_${t.name}`,
    name: t.name,
    target: t.message
      ? { __typename: "Tag", message: t.message, tagger: { ...actor(t.tagger ?? PEOPLE[3]), date: new Date(t.at).toISOString() }, target: { oid: t.commit } }
      : { __typename: "Commit", oid: t.commit, authoredDate: new Date(c.at).toISOString(), author: actor(c.author) },
  };
}

// ---------- REST: pushes, compare, files ----------

export function activities(rr: RepoRefs, branch: string) {
  const tip = resolve(rr, branch);
  if (!tip) return [];
  const chain: FCommit[] = [];
  for (let c = rr.bySha.get(tip); c && chain.length < 12; c = rr.bySha.get(c.parents[0])) chain.push(c); // first-parent chain, newest first
  // Four dates: today, a few days back, last month, last year. Pushes within a day are spaced by minutes.
  const dayOffsets = [0, 0, 0, 3, 3, 40, 40, 40, 40, 400, 400, 400];
  const out = chain.map((c, i) => {
    const merge = c.parents.length > 1;
    const first = i === chain.length - 1 && c.parents.length === 0;
    return {
      before: c.parents[0] ?? "0".repeat(40),
      after: c.sha,
      activity_type: first ? "branch_creation" : i === 5 ? "force_push" : merge ? "pr_merge" : "push",
      timestamp: new Date(NOW - dayOffsets[i] * DAY - (i % 4) * 25 * 60e3 - 20 * 60e3 - (dayOffsets[i] ? 5 * HOUR : 0)).toISOString(),
      actor: c.author.login ? { login: c.author.login, avatar_url: avatar(c.author.login) } : null,
    };
  });
  if (out.length) {
    const last = out[out.length - 1];
    last.activity_type = "branch_creation";
    last.before = "0".repeat(40);
  }
  return out;
}

const FILE_POOL = ["src/index.ts", "src/util/greet.ts", "package.json", "docs/guide.md", "src/Program.cs"];
export interface TouchedFile { path: string; status: "modified" | "added" | "removed" }
export function touched(c: FCommit): TouchedFile[] {
  if (c.parents.length === 0) return ["src/index.ts", "package.json", "README.md"].map((path) => ({ path, status: "added" as const }));
  const k = c.idx % 4;
  const out: TouchedFile[] = [{ path: FILE_POOL[c.idx % FILE_POOL.length], status: "modified" }];
  if (k === 1) out.push({ path: FILE_POOL[(c.idx + 2) % FILE_POOL.length], status: "modified" });
  if (k === 2) out.push({ path: `src/feature/added-${c.idx}.ts`, status: "added" });
  if (k === 3) out.push({ path: `src/legacy/removed-${c.idx}.ts`, status: "removed" });
  return out;
}

const TEXTS: Record<string, string[]> = {
  "src/index.ts": ["import { greet } from './util/greet';", "", "export function main(): void {", "  console.log(greet('world'));", "}"],
  "src/util/greet.ts": ["export const greet = (n: string) => `Hello, ${n}`;", "export const bye = (n: string) => `Bye, ${n}`;"],
  "package.json": ['{', '  "name": "demo",', '  "scripts": { "build": "tsc" }', '}'],
  "docs/guide.md": ["# Guide", "", "Follow these steps.", "", "- one", "- two"],
  "src/Program.cs": ["using System;", "", "class Program", "{", "    static void Main() => Console.WriteLine(\"hi\");", "}"],
  "README.md": ["# Demo", "", "A demo repository."],
};
/** The text of a file at a commit: a stable base plus 40 numbered lines, some of which change from commit to commit, so every diff has hunks. */
export function textAt(idx: number, path: string): string {
  const base = TEXTS[path] ?? ["export const note = true;"];
  const body = Array.from({ length: 40 }, (_, k) => ((idx + k) % 13 === 0 ? `// changed in revision ${idx}, line ${k}` : `export const v${k} = ${k * 3};`));
  return [...base, ...body, ""].join("\n");
}

export function restFile(rr: RepoRefs, c: FCommit, f: TouchedFile) {
  const parent = rr.bySha.get(c.parents[0] ?? "");
  const lines = f.status === "modified" ? Array.from({ length: 40 }, (_, k) => k).filter((k) => (c.idx + k) % 13 === 0 || ((parent?.idx ?? 0) + k) % 13 === 0).length : 30;
  return {
    filename: f.path,
    status: f.status,
    additions: f.status === "removed" ? 0 : lines,
    deletions: f.status === "added" ? 0 : lines,
    patch: "@@ -1,3 +1,3 @@ (mock patch; the diff itself is built from both sides' contents)",
  };
}

/** What the REST commit or compare answer carries: changed files of one commit, or the union over a range. */
export function filesOf(rr: RepoRefs, commits: FCommit[]) {
  const seen = new Map<string, ReturnType<typeof restFile>>();
  for (const c of commits) for (const f of touched(c)) seen.set(f.path, restFile(rr, c, f));
  return [...seen.values()];
}

/** The contents of `path` at `ref` (a commit sha), or undefined for a path this module does not own. */
export function contentAt(rr: RepoRefs, ref: string, path: string): string | undefined {
  const c = rr.bySha.get(ref);
  if (!c) return undefined;
  if (path.startsWith("src/feature/added-") || path.startsWith("src/legacy/removed-")) return `export const generated = ${c.idx};\n`;
  if (!FILE_POOL.includes(path) && path !== "README.md") return undefined;
  return textAt(c.idx, path);
}

export const writeState = { refsFail: false };
export const newId = (() => { let n = 0; return () => `NEW_${++n}`; })();
export { PEOPLE, avatar, actor };

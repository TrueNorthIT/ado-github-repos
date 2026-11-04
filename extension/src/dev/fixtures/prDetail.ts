// __TN_MOCK__ Detail for the fixture pull requests: bodies, reviews, checks, commits, changed files and their contents at the base and head shas.
import { PRS, ME } from "./prs";
import type { FixturePr } from "./prs";
import { threadTotals } from "./feed";
import { editedBodyHtml, reviewRequestNodes } from "./edit";
import { makePatch } from "./patch";

const avatarOf = (login: string) => (PRS.map((p) => p.node.author).find((a) => a?.login === login)?.avatarUrl as string | undefined) ?? "";
const who = (login: string) => ({ login, avatarUrl: avatarOf(login) });

export const baseSha = (n: number) => `ba5e${String(n).padStart(36, "0")}`;
export const headSha = (n: number) => `4ead${String(n).padStart(36, "0")}`;

// ---------- file contents ----------
const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n") + "\n";

const GREET_BASE = lines(70, (i) =>
  i === 1 ? "export function greet(name: string): string {" :
  i === 12 ? '  return "Hello, " + name;' :
  i === 68 ? '  return "Goodbye, " + name;' :
  i === 69 ? "}" :
  i === 70 ? "" :
  `  const step${i} = ${i}; // ${i}`);
const GREET_HEAD = GREET_BASE
  .replace('  return "Hello, " + name;', "  return `Hello, ${name}!`;")
  .replace('  return "Goodbye, " + name;', "  const bye = `Goodbye, ${name}!`;\n  return bye;");

const RETRY_HEAD = `// Retries an async call with exponential backoff and jitter.
export async function retry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2 ** i * 100 + Math.random() * 50));
    }
  }
  throw last;
}
`;
const NOTES_BASE = "# Old notes\n\nThese notes are out of date.\nSee the guide instead.\n";
const NAMING_BASE = lines(30, (i) => (i === 15 ? "export const prefix = 'gh';" : `export const n${i} = ${i};`));
const NAMING_HEAD = NAMING_BASE.replace("'gh'", "'tn'");
const PKG_BASE = `{
  "name": "github-repos",
  "version": "1.0.0",
  "scripts": { "build": "tsc" },
  "dependencies": {
    "react": "^16.14.0",
    "react-dom": "^16.14.0",
    "typescript": "^5.8.0"
  }
}
`;
const PKG_HEAD = PKG_BASE.replace("^5.8.0", "^5.9.3").replace('"build": "tsc"', '"build": "tsc --noEmit"');

// Batch 4: a whitespace-only change, an SVG, a markdown file and a file GitHub sends no patch for.
const FORMAT_BASE = `export function format(items: string[]): string {
  const out: string[] = [];
  for (const item of items) {
    out.push(item.trim());
  }
  return out.join(", ");
}
`;
const FORMAT_HEAD = `export function format(items: string[]): string {
    const out: string[] = [];
    for (const item of items) {
        out.push(item.trim());
    }
    return out.join(", ");
}
`;
const DIAGRAM_BASE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80">
  <rect width="200" height="80" rx="8" fill="#0078d4"/>
  <text x="100" y="46" font-family="Segoe UI,Arial" font-size="16" fill="#fff" text-anchor="middle">Before</text>
</svg>
`;
// The head is larger, with a transparent margin around a smaller badge, so the image diff modes show different sizes and transparency.
const DIAGRAM_HEAD = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
  <circle cx="120" cy="60" r="56" fill="#ca5010" fill-opacity="0.85"/>
  <text x="120" y="66" font-family="Segoe UI,Arial" font-size="16" fill="#fff" text-anchor="middle">After</text>
</svg>
`;
const GUIDE_BASE = `# Guide

Start here.

- Install the tools
- Run the build
`;
const GUIDE_HEAD = `# Guide

Start here, then read **the notes**.

- Install the tools
- Run the build
- Run the \`tests\`
`;

interface FixtureFile { path: string; status: string; additions: number; deletions: number; previous?: string; patch?: string; base?: string; head?: string }
const diffStat = (a?: string, b?: string) => {
  const x = a ? a.split("\n") : [], y = b ? b.split("\n") : [];
  const sx = new Set(x), sy = new Set(y);
  return { additions: y.filter((l) => !sx.has(l)).length, deletions: x.filter((l) => !sy.has(l)).length };
};
const f = (path: string, status: string, base?: string, head?: string, previous?: string): FixtureFile => ({ path, status, base, head, previous, patch: makePatch(base, head), ...diffStat(base, head) });

const RICH: FixtureFile[] = [
  f("src/util/greet.ts", "modified", GREET_BASE, GREET_HEAD),
  f("src/retry.ts", "added", undefined, RETRY_HEAD),
  f("docs/old-notes.md", "removed", NOTES_BASE, undefined),
  f("src/lib/names.ts", "renamed", NAMING_BASE, NAMING_HEAD, "src/lib/naming.ts"),
  f("package.json", "modified", PKG_BASE, PKG_HEAD),
  { path: "docs/img/logo.png", status: "modified", additions: 0, deletions: 0 }, // an image: no patch; the picture is served by the mock (b4.ts)
  f("src/format.ts", "modified", FORMAT_BASE, FORMAT_HEAD),
  f("docs/img/diagram.svg", "modified", DIAGRAM_BASE, DIAGRAM_HEAD),
  f("docs/guide.md", "modified", GUIDE_BASE, GUIDE_HEAD),
  { path: "assets/data.bin", status: "added", additions: 12, deletions: 0 }, // binary: GitHub sends no patch
];
const SMALL: FixtureFile[] = [f("package.json", "modified", PKG_BASE, PKG_HEAD)];
// 25 tiny files for #197: cards past the 20th start collapsed.
const MANY: FixtureFile[] = Array.from({ length: 25 }, (_, i) => f(`src/gen/file${String(i + 1).padStart(2, "0")}.ts`, "added", undefined, `export const v${i} = ${i};\n`));

export const PR_FILES: Record<number, FixtureFile[]> = { 200: RICH, 199: SMALL, 198: SMALL, 197: MANY, 170: SMALL, 312: RICH };
const RICH_NUMBERS = Object.keys(PR_FILES).map(Number);

/** Contents of `path` at a fixture sha, or undefined (404). */
export function contentAt(sha: string, path: string): string | undefined {
  const n = Number(sha.slice(4));
  const isBase = sha.startsWith("ba5e");
  if (!(isBase || sha.startsWith("4ead")) || !n) return undefined;
  for (const file of PR_FILES[n] ?? SMALL) {
    if (isBase && (file.previous ?? file.path) === path) return file.base;
    if (!isBase && file.path === path) return file.head;
  }
  return undefined;
}

// ---------- description, reviews, checks, commits ----------
const LOGO = `<img src="https://github.com/truenorthit/github-repos/blob/main/docs/img/logo.png?raw=true" alt="Logo from the repository" width="48">`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="60"><rect width="280" height="60" rx="6" fill="#0078d4"/><text x="140" y="36" font-family="Segoe UI,Arial" font-size="16" fill="#fff" text-anchor="middle">retry with backoff</text></svg>';
const DIAGRAM = `<img src="data:image/svg+xml,${encodeURIComponent(SVG)}" alt="Retry flow diagram">`;
const RICH_BODY = `<h2>What changed</h2>
<p>Adds a retry helper to the sync job and tidies the greeting. Relates to AB#1000 and AB#1001; AB#999999 is a typo for another item.</p>
<p>${LOGO}</p><p>${DIAGRAM}</p>
<ul><li>New <code>retry()</code> with exponential backoff</li><li>Greeting now uses a template string</li><li>Removes the old notes</li></ul>
<table><thead><tr><th>Package</th><th>Change</th></tr></thead><tbody><tr><td>typescript</td><td>5.8 to 5.9</td></tr></tbody></table>
<p>See <a href="https://github.com/truenorthit/github-repos/blob/main/docs/guide.md">the guide</a> and <a href="https://example.com">an external page</a>.</p>`;

const ANN = { name: "Ann Author", user: { login: "ann" } };
export const commitOid = (n: number, i: number) => (0xc0de0000 + n * 16 + i).toString(16).padEnd(40, "0");
const commit = (n: number, i: number, message: string, author: { name: string; user: { login: string } | null }, hoursAgo: number) => ({
  commit: {
    oid: commitOid(n, i),
    message,
    authoredDate: new Date(Date.now() - hoursAgo * 3600e3).toISOString(),
    author: { ...author, avatarUrl: avatarOf(author.user?.login ?? "ann") },
  },
});

/** The full detail node for a fixture PR (the list node plus what detailQuery adds). */
export function detailNode(p: FixturePr) {
  const n = p.node.number;
  const known = RICH_NUMBERS.includes(n);
  const rollup = n === 200 ? "SUCCESS" : n === 199 || n === 312 ? "FAILURE" : n === 198 ? "PENDING" : null;
  const reviews =
    n === 200
      ? [
          { author: who("ann"), state: "APPROVED", submittedAt: "2026-10-30T10:00:00Z" },
          { author: who("carol"), state: "CHANGES_REQUESTED", submittedAt: "2026-10-30T11:00:00Z" },
          { author: who("dave"), state: "COMMENTED", submittedAt: "2026-10-30T12:00:00Z" },
        ]
      : n === 199 ? [{ author: who(ME), state: "APPROVED", submittedAt: "2026-10-30T10:00:00Z" }] : [];
  return {
    ...p.node,
    body: p.node.body,
    bodyHTML: editedBodyHtml(n) ?? (n === 200 ? RICH_BODY : n === 197 ? "" : `<p>${p.node.body}</p>`),
    headRefOid: headSha(known ? n : 1),
    baseRefOid: baseSha(known ? n : 1),
    mergeable: n === 199 ? "CONFLICTING" : n === 198 ? "UNKNOWN" : "MERGEABLE",
    statusCheckRollup: rollup ? { state: rollup } : null,
    reviewRequests: { nodes: reviewRequestNodes(n) },
    reviews: { nodes: reviews },
    // Review threads follow the feed fixtures, so resolving one in the feed moves the header's "x/y comments resolved".
    ...(threadTotals(n) && { reviewThreads: { totalCount: threadTotals(n)![1], nodes: [...Array(threadTotals(n)![0]).fill(true), ...Array(threadTotals(n)![1] - threadTotals(n)![0]).fill(false)].map((isResolved) => ({ isResolved })) } }),
    commits: {
      nodes:
        n === 200 || n === 312
          ? [
              commit(n, 1, "Add retry helper\n\nBacks off exponentially.", ANN, 30),
              commit(n, 2, "Use a template string in greet (AB#1001)", ANN, 22),
              commit(n, 3, "Remove old notes", { name: "Bob", user: { login: "bob-dev" } }, 5),
            ]
          : [commit(n, 1, p.node.title, ANN, 20)],
    },
  };
}

export function restFiles(n: number) {
  return (PR_FILES[n] ?? SMALL).map((x) => ({ filename: x.path, status: x.status, additions: x.additions, deletions: x.deletions, previous_filename: x.previous, patch: x.patch }));
}

// __TN_MOCK__ Fixture pull requests for the main fixture repo, shaped like GitHub GraphQL PullRequest nodes.
import type { PrListNode } from "../../lib/prModel";

export const PR_REPO = "truenorthit/github-repos";
/** The signed-in mock user: what `author:@me` and `review-requested:@me` match. */
export const ME = "mock-user";

const COLORS = ["#0078d4", "#8764b8", "#2f7d32", "#ca5010", "#b4009e", "#038387"];
/** A data: avatar, so mock mode never calls out to avatars.githubusercontent.com. */
export const avatar = (login: string) => {
  const c = COLORS[[...login].reduce((h, ch) => h + ch.charCodeAt(0), 0) % COLORS.length];
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${c}"/><text x="32" y="42" font-family="Segoe UI,Arial" font-size="28" fill="#fff" text-anchor="middle">${login[0].toUpperCase()}</text></svg>`)}`;
};
const who = (login: string, name: string | null) => ({ login, name, avatarUrl: avatar(login) });
const AUTHORS = [who("ann", "Ann Author"), who("bob-dev", null), who("carol", "Carol Commit"), who(ME, "Mock User"), who("dave", "Dave Developer")];

const LABELS = [
  { name: "bug", color: "d73a4a" }, { name: "enhancement", color: "a2eeef" }, { name: "documentation", color: "0075ca" },
  { name: "good first issue", color: "7057ff" }, { name: "help wanted", color: "008672" }, { name: "priority: high", color: "b60205" },
  { name: "wontfix", color: "ffffff" }, { name: "dependencies", color: "0366d6" },
];
const TITLES = [
  "Add retry handling to the sync job", "Fix login redirect loop", "Update dependencies", "Refactor listing component", "Docs: clarify setup steps",
  "Handle empty repositories", "Bump build tooling", "Add keyboard shortcuts to the file finder", "Fix off-by-one in pagination", "Improve error messages",
  "Support tilde-fenced code blocks", "Cache branch lists", "Tidy up CSS", "Add dark theme tokens", "Remove unused exports",
];
const LONG_TITLE = "Rework the repository synchronisation pipeline so that failures include the correlation id, partial results are kept, and the retry policy backs off exponentially with jitter instead of hammering the API";

export interface FixturePr {
  node: PrListNode & { body: string; headRefName: string; mergeable: string };
  /** Logins a review is requested from. */
  reviewRequested: string[];
}

const HOUR = 3600e3;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const threads = (resolved: number, open: number) => ({
  totalCount: resolved + open,
  nodes: [...Array(resolved).fill(true), ...Array(open).fill(false)].map((isResolved) => ({ isResolved })),
});

function make(number: number, i: number, state: "OPEN" | "MERGED" | "CLOSED"): FixturePr {
  const ghost = number === 187;
  const author = ghost ? null : AUTHORS[i % AUTHORS.length];
  const created = (i + 1) * 5 * HOUR + (state === "OPEN" ? 0 : 3 * 24 * HOUR);
  // Every third PR was touched after it was opened ("Updated"); the rest are "Created".
  const updated = i % 3 === 0 ? created - 2 * HOUR : created;
  const labelCount = i % 4 === 0 ? 0 : (i % 3) + 1;
  const lines = i % 5 === 1 ? threads(1, 2) : i % 5 === 3 ? threads(2, 0) : { totalCount: 0, nodes: [] };
  return {
    reviewRequested: number === 199 || number === 196 ? [ME] : [],
    node: {
      number,
      title: number === 190 ? LONG_TITLE : `${TITLES[i % TITLES.length]}${i >= TITLES.length ? ` (${number})` : ""}`,
      url: `https://github.com/${PR_REPO}/pull/${number}`,
      state,
      isDraft: state === "OPEN" && i % 7 === 3,
      createdAt: iso(created),
      updatedAt: iso(updated),
      mergedAt: state === "MERGED" ? iso(updated - HOUR / 2) : null,
      closedAt: state === "CLOSED" ? iso(updated - HOUR / 2) : null,
      baseRefName: i % 6 === 5 ? "release/1.0" : i % 4 === 2 ? "develop" : "main",
      author,
      labels: { nodes: Array.from({ length: labelCount }, (_, k) => LABELS[(i + k * 3) % LABELS.length]) },
      reviewThreads: lines,
      comments: { totalCount: lines.totalCount ? 0 : i % 4 },
      body: `Mock description for #${number}. Relates to AB#${1000 + i}.`,
      headRefName: `feature/pr-${number}`,
      mergeable: "MERGEABLE",
    },
  };
}

// Open 200..171 (two by the mock user: 200 and 198; review requested from them on 199 and 196), merged 170..141, closed 140..137.
export const PRS: FixturePr[] = [
  ...Array.from({ length: 30 }, (_, i) => make(200 - i, i, "OPEN")),
  ...Array.from({ length: 30 }, (_, i) => make(170 - i, i + 30, "MERGED")),
  ...Array.from({ length: 4 }, (_, i) => make(140 - i, i + 60, "CLOSED")),
];
// Pin the cases the brief asks for (author index is i % 5: 3 is the mock user).
for (const n of [200, 198]) PRS.find((p) => p.node.number === n)!.node.author = AUTHORS[3];
for (const n of [199, 196]) PRS.find((p) => p.node.number === n)!.node.author = AUTHORS[0];
// Number 187 above is open index 13: a deleted account (author null). Number 190 carries the very long title.
// Pin an open PR with an unresolved thread, labels and a draft near the top so the first screen shows all three.
Object.assign(PRS.find((p) => p.node.number === 199)!.node, { reviewThreads: threads(1, 2), labels: { nodes: [LABELS[0], LABELS[5]] }, isDraft: false });
Object.assign(PRS.find((p) => p.node.number === 198)!.node, { isDraft: true, labels: { nodes: [LABELS[1]] } });
Object.assign(PRS.find((p) => p.node.number === 197)!.node, { labels: { nodes: [LABELS[2], LABELS[3], LABELS[6]] } });

// __TN_MOCK__ Batch 4 fixtures (PR views): updates and force pushes, viewed files, compare ranges, a rendered-markdown stand-in, and the extra list-filter facts.
import { PNG_BASE64 } from "./content";
import { PRS, ME } from "./prs";
import { PR_FILES, baseSha, commitOid, headSha, restFiles } from "./prDetail";

export const PNG2_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAIAAAAzn+mLAAAARUlEQVR4nGM4FSCAhv7vZEBD9FRDV8tGHTTqILo4aGCtx1Qz6qBRBw0/Bw2s9ZhqRh006qDh56CBtR5TzaiDRh007BwEALl8fNsNnfoGAAAAAElFTkSuQmCC";
export const PNG_BEFORE = PNG_BASE64;

const HOUR = 3600e3;
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR).toISOString();
const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** The PNG at a fixture sha: the base has one picture, the head another, so the before/after view shows a change. */
export const logoBytes = (sha: string) => bytes(sha.startsWith("ba5e") ? PNG_BEFORE : PNG2_BASE64);

// ---------- list filters (VW-8): the facts the search fixtures know beyond the PR node ----------
export const ASSIGNEES: Record<number, string[]> = { 199: [ME], 197: ["bob-dev"], 195: ["ann", "carol"], 190: ["dave"] };
export const REVIEWED_BY: Record<number, string[]> = { 200: ["ann", "carol", "dave"], 196: ["dave"], 194: ["carol"] };

/** Splits a search string into terms, keeping a quoted value such as label:"help wanted" whole. */
export function searchTerms(q: string): string[] {
  return [...q.matchAll(/(?:[^\s"]|"(?:[^"\\]|\\.)*")+/g)].map((m) => m[0]);
}
const unquote = (v: string) => (v.startsWith('"') ? v.slice(1, -1).replace(/\\(["\\])/g, "$1") : v);

/** True when the PR passes the qualifiers of the search (author, assignee, review-requested, reviewed-by, label, draft, base). */
export function passesQualifiers(number: number, terms: string[]): boolean {
  const p = PRS.find((x) => x.node.number === number)!;
  const n = p.node;
  const at = (me: string) => (me === "@me" ? ME : me);
  return terms.filter((t) => /^[a-z-]+:/.test(t)).every((t) => {
    const k = t.slice(0, t.indexOf(":"));
    const v = unquote(t.slice(t.indexOf(":") + 1));
    switch (k) {
      case "author": return n.author?.login === at(v);
      case "assignee": return (ASSIGNEES[number] ?? []).includes(at(v));
      case "review-requested": return p.reviewRequested.includes(at(v));
      case "reviewed-by": return (REVIEWED_BY[number] ?? []).includes(at(v));
      case "label": return (n.labels?.nodes ?? []).some((l) => l?.name === v);
      case "draft": return n.isDraft === (v === "true");
      case "base": return n.baseRefName === v;
      default: return true; // repo:, is:, ... are handled by the caller
    }
  });
}

// ---------- updates (VW-1) ----------
const commitNode = (n: number, i: number, headline: string, hoursAgo: number) => ({ __typename: "PullRequestCommit", id: `PRC_${n}_${i}`, commit: { oid: commitOid(n, i), messageHeadline: headline, committedDate: iso(hoursAgo) } });

/** PR 200: a first push of two commits, a second push, a force push, then a last push. Every other PR has one commit. */
export function updatesTimeline(n: number) {
  if (n !== 200) return [commitNode(n, 1, PRS.find((p) => p.node.number === n)?.node.title ?? "Change", 20)];
  return [
    commitNode(n, 1, "Add retry helper", 30),
    commitNode(n, 4, "Add tests for retry", 30 - 3 / 60),
    commitNode(n, 2, "Use a template string in greet (AB#1001)", 22),
    { __typename: "HeadRefForcePushedEvent", id: "HRF_200_1", createdAt: iso(12), beforeCommit: { oid: commitOid(n, 2) }, afterCommit: { oid: commitOid(n, 9) } },
    commitNode(n, 3, "Remove old notes", 5),
  ];
}
export const updatesData = (n: number) => ({ repository: { pullRequest: { id: `PR_${n}`, baseRefOid: baseSha(n), headRefOid: headSha(n), timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: updatesTimeline(n) } } } });

/** Every oid the updates can name, in age order: how far "forward" a compare side is, for fixture contents. */
const UPDATE_ORDER = [1, 4, 2, 9, 3];
export const isUpdateOid = (sha: string) => UPDATE_ORDER.some((i) => commitOid(200, i) === sha);
/** Which fixture side ("ba5e" or "4ead") a commit oid's contents match: the first two pushes still have the old text. */
export const sideOfOid = (sha: string) => (UPDATE_ORDER.indexOf(UPDATE_ORDER.find((i) => commitOid(200, i) === sha)!) < 2 ? "ba5e" : "4ead");

// ---------- commit ranges (VW-6) ----------
export function rangeData(n: number, sc: string) {
  const commits = n === 200 ? [1, 2, 3] : [1];
  const nodes = commits.map((i, k) => ({ commit: { oid: commitOid(n, i), messageHeadline: ["Add retry helper", "Use a template string in greet (AB#1001)", "Remove old notes"][k] ?? "Change", parents: { nodes: [{ oid: k ? commitOid(n, commits[k - 1]) : baseSha(n) }] } } }));
  const review = n === 200 && sc !== "noReview" ? { state: "COMMENTED", submittedAt: iso(20), commit: { oid: commitOid(n, 2) } } : null;
  return { repository: { pullRequest: { id: `PR_${n}`, baseRefOid: baseSha(n), headRefOid: headSha(n), viewerLatestReview: review, commits: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } };
}

/** REST compare for two oids of PR 200 (or any two shas): a deterministic slice of the PR's files, so different pairs show different diffs. */
export function compareFiles(a: string, b: string) {
  const all = restFiles(200);
  const k = [...(a + b)].reduce((h, c) => h + c.charCodeAt(0), 0);
  return all.slice(0, 2 + (k % Math.max(1, all.length - 1)));
}

// ---------- viewed files (VW-3) ----------
const viewed = new Map<string, "VIEWED" | "UNVIEWED" | "DISMISSED">([["PR_200:src/util/greet.ts", "VIEWED"], ["PR_200:src/retry.ts", "DISMISSED"]]);
export const viewedData = (n: number) => ({ repository: { pullRequest: { id: `PR_${n}`, files: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: (PR_FILES[n] ?? []).map((f) => ({ path: f.path, viewerViewedState: viewed.get(`PR_${n}:${f.path}`) ?? "UNVIEWED" })) } } } });
export function setViewed(input: { pullRequestId: string; path: string }, on: boolean) {
  viewed.set(`${input.pullRequestId}:${input.path}`, on ? "VIEWED" : "UNVIEWED");
  return { pullRequest: { id: input.pullRequestId } };
}

// ---------- rendered markdown (VW-11) ----------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
/** A tiny stand-in for GitHub's markdown renderer: headings, bullets, paragraphs, bold and code. */
export function renderMd(md: string): string {
  const out: string[] = [];
  let list = false;
  for (const line of md.split("\n")) {
    const li = /^[-*] (.*)/.exec(line);
    if (list && !li) (out.push("</ul>"), (list = false));
    const h = /^(#{1,3}) (.*)/.exec(line);
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (li) (list || out.push("<ul>"), (list = true), out.push(`<li>${inline(li[1])}</li>`));
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("\n");
}

// The Commits list over REST (C-1 filters): GET /repos/{o}/{r}/commits takes sha, path, author, since and until, so the author and date filters are
// answered by GitHub rather than by narrowing loaded rows. REST carries no PR or check status, so those (and the signature) are filled in afterwards by
// one best-effort GraphQL lookup of the page's oids; when that fails (cloud sessions refuse GraphQL) the rows still show, without them.
//
// Hash keys, new in this module (collision-checked against browseState.ts and prListFilters.ts): cAuthor, cFrom, cTo (yyyy-mm-dd), cPath, cText.
// Rule shared with the other query builders: every caller-supplied value travels in `variables`, never in the query text.
import type { GraphQlRequest } from "./prQuery";
import { mapCheckState, normalizeHistoryPath, type CheckStatus, type CommitRow } from "./commitsQuery";
import { signatureSelection, type CommitSignature } from "./signatures";

export interface CommitFilters {
  /** GitHub login or email (REST `author`). */
  author?: string;
  /** Local day, yyyy-mm-dd, inclusive. */
  from?: string;
  /** Local day, yyyy-mm-dd, inclusive. */
  to?: string;
  /** File or folder (normalised as normalizeHistoryPath). */
  path?: string;
  /** Message or author text, matched against the loaded rows only. */
  text?: string;
}

const KEYS: Record<keyof CommitFilters, string> = { author: "cAuthor", from: "cFrom", to: "cTo", path: "cPath", text: "cText" };
const ORDER: (keyof CommitFilters)[] = ["author", "from", "to", "path", "text"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const clean = (v?: string) => (v ?? "").trim().slice(0, 200);

/** The filters with blanks dropped, the path normalised and days that are not real yyyy-mm-dd dates removed. */
export function normalizeCommitFilters(f: CommitFilters): CommitFilters {
  const out: CommitFilters = {};
  const author = clean(f.author);
  const path = normalizeHistoryPath(clean(f.path));
  const text = clean(f.text);
  if (author) out.author = author;
  if (f.from && isDay(f.from)) out.from = f.from;
  if (f.to && isDay(f.to)) out.to = f.to;
  if (path) out.path = path;
  if (text) out.text = text;
  return out;
}

/** True when any filter GitHub answers (author, from, to, path) is set. */
export function hasServerFilters(f: CommitFilters): boolean {
  return !!(clean(f.author) || f.from || f.to || normalizeHistoryPath(clean(f.path)));
}

/** The commit filters in a hash. Never throws. */
export function parseCommitFilters(hash: string): CommitFilters {
  try {
    const p = new URLSearchParams(hash.replace(/^#+/, ""));
    const raw: CommitFilters = {};
    for (const k of ORDER) {
      const v = p.get(KEYS[k]);
      if (v) raw[k] = v;
    }
    return normalizeCommitFilters(raw);
  } catch {
    return {};
  }
}

/** `hash` with the commit filter keys replaced (blank ones removed); the other segments keep their order. Starts with "#". */
export function applyCommitFilters(hash: string, f: CommitFilters): string {
  const ours = new Set(Object.values(KEYS));
  const kept = hash.replace(/^#+/, "").split("&").filter((x) => x && !ours.has(x.split("=")[0]));
  const n = normalizeCommitFilters(f);
  for (const k of ORDER) if (n[k]) kept.push(`${KEYS[k]}=${encodeURIComponent(n[k]!)}`);
  return "#" + kept.join("&");
}

function isDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A typed date to yyyy-mm-dd: dd/mm/yyyy (UK, also with `-` or `.`, one-digit day and month allowed) or yyyy-mm-dd.
 * "" for blank text, null for text that is not a real date.
 */
export function parseDayText(text: string): string | null {
  const t = text.trim();
  if (!t) return "";
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const uk = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (uk) [d, m, y] = [Number(uk[1]), Number(uk[2]), Number(uk[3])];
  else return null;
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return isDay(s) ? s : null;
}

/** yyyy-mm-dd as dd/mm/yyyy, for the filter box. */
export function formatDayText(day: string | undefined): string {
  return day && DAY.test(day) ? day.split("-").reverse().join("/") : "";
}

/** `since` and `until` (ISO instants) for local days: the start of `from` and the end of `to`, in the machine's time zone. */
export function dayBounds(from?: string, to?: string): { since?: string; until?: string } {
  const at = (day: string, end: boolean) => {
    const [y, m, d] = day.split("-").map(Number);
    return (end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d)).toISOString();
  };
  return { ...(from && isDay(from) ? { since: at(from, false) } : {}), ...(to && isDay(to) ? { until: at(to, true) } : {}) };
}

/** GET /repos/{repo}/commits for a ref and the server-side filters. `page` is 1-based. */
export function commitsRestPath(repo: string, ref: string, f: CommitFilters = {}, page = 1, perPage = 50): string {
  const n = normalizeCommitFilters(f);
  const q = new URLSearchParams({ sha: ref, per_page: String(perPage) });
  if (page > 1) q.set("page", String(page));
  if (n.path) q.set("path", n.path);
  if (n.author) q.set("author", n.author);
  const { since, until } = dayBounds(n.from, n.to);
  if (since) q.set("since", since);
  if (until) q.set("until", until);
  return `/repos/${repo}/commits?${q.toString()}`;
}

/** The page number of a Link header's rel="next", or undefined on the last page. */
export function nextPageOf(link: string | null | undefined): number | undefined {
  const next = /<([^>]+)>\s*;\s*rel="next"/.exec(link ?? "");
  if (!next) return undefined;
  try {
    const p = Number(new URL(next[1]).searchParams.get("page"));
    return p > 1 ? p : undefined;
  } catch {
    return undefined;
  }
}

/** What REST lacks, per commit. */
export interface CommitExtras {
  prNumber: number | null;
  status: CheckStatus | null;
  signature?: CommitSignature;
}

/** One `object(oid:)` per sha, aliased c0, c1... with variables o0, o1... Variables { owner, name, o0... }. */
export function commitExtrasQuery(p: { owner: string; name: string; shas: string[] }): GraphQlRequest & { aliases: Record<string, string> } {
  const variables: Record<string, unknown> = { owner: p.owner, name: p.name };
  const aliases: Record<string, string> = {};
  p.shas.forEach((sha, i) => ((variables["o" + i] = sha), (aliases["c" + i] = sha)));
  const decl = p.shas.map((_, i) => `,$o${i}: GitObjectID!`).join("");
  const fields = p.shas
    .map((_, i) => `c${i}: object(oid: $o${i}) { ... on Commit { oid statusCheckRollup { state } associatedPullRequests(first: 1) { nodes { number state } } ${signatureSelection()} } }`)
    .join(" ");
  return { query: `query($owner: String!, $name: String!${decl}) { repository(owner: $owner, name: $name) { ${fields} } }`, variables, aliases };
}

export function mapCommitExtras(body: any, aliases: Record<string, string>): Record<string, CommitExtras> {
  const repo = body?.data?.repository ?? {};
  const out: Record<string, CommitExtras> = {};
  for (const [alias, oid] of Object.entries(aliases)) {
    const n = repo[alias];
    if (!n) continue;
    const pr = n.associatedPullRequests?.nodes?.[0];
    out[oid] = {
      prNumber: pr && (pr.state === "MERGED" || pr.state === "OPEN") ? pr.number : null,
      status: mapCheckState(n.statusCheckRollup?.state),
      ...(n.signature ? { signature: n.signature } : {}),
    };
  }
  return out;
}

/** The rows with their extras merged in; rows without extras are returned unchanged. */
export function withExtras(rows: CommitRow[], extras: Record<string, CommitExtras>): CommitRow[] {
  return rows.map((r) => (extras[r.sha] ? { ...r, ...extras[r.sha] } : r));
}

/** The empty state's sentence, e.g. "No commits on main by ann from 01/10/2026 to 03/11/2026 touching src match “retry”." */
export function noMatchText(ref: string, f: CommitFilters, keyword = ""): string {
  const n = normalizeCommitFilters(f);
  const parts = [`No commits on ${ref}`];
  if (n.author) parts.push(`by ${n.author}`);
  if (n.from && n.to) parts.push(`from ${formatDayText(n.from)} to ${formatDayText(n.to)}`);
  else if (n.from) parts.push(`since ${formatDayText(n.from)}`);
  else if (n.to) parts.push(`up to ${formatDayText(n.to)}`);
  if (n.path) parts.push(`touching ${n.path}`);
  const k = keyword.trim();
  return `${parts.join(" ")}${k ? ` match “${k}” among those loaded` : ""}.`;
}

/** The loaded rows a keyword keeps: message, author name or login contains it (case-insensitive). */
export function matchesKeyword(r: CommitRow, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  return !k || `${r.message} ${r.author.name} ${r.author.login ?? ""}`.toLowerCase().includes(k);
}

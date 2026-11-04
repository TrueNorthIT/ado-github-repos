// Code search (Files hub): the pure parts. REST GET /search/code with the text-match media type, which answers each file with
// `text_matches` fragments and the indices of the matched text inside each fragment.
//
// GitHub's limits, which shape this module (REST code search, the "legacy" engine):
//  - it searches only the default branch, and only files under 384 KB;
//  - it needs a signed-in user and at least one search term (qualifiers alone are a 422);
//  - a query may be at most 256 characters. GitHub says that excludes qualifiers, but long qualifier lists fail too, so here the
//    whole `q` stays within 256 and "All connected repositories" is split into batches of `repo:` qualifiers (several are ORed);
//  - about 10 requests a minute per user (x-ratelimit-resource: code_search), and a secondary limit on bursts.

export const QUERY_MAX = 256;
/** At most this many batches (requests) per search, so one search can't spend the whole minute's allowance. */
export const MAX_BATCHES = 5;
export const PER_PAGE = 50;
/** GitHub's code search allowance: requests per window. */
export const RATE_LIMIT = 10;
export const RATE_WINDOW_MS = 60_000;

export interface SearchInput {
  text: string;
  /** "owner/name" repositories to search. */
  repos: string[];
  path?: string;
  ext?: string;
}

export interface SearchBatch {
  q: string;
  repos: string[];
}

export interface SearchPlan {
  batches: SearchBatch[];
  /** Repositories left out because of MAX_BATCHES. */
  skipped: string[];
  /** Why nothing can be searched (blank text, text too long). */
  problem?: string;
}

const quote = (v: string) => (/[\s"]/.test(v) ? `"${v.replace(/"/g, "")}"` : v);

/** The search terms with any scope qualifier the user typed (repo:, org:, user:) removed: the scope is the page's to set. */
export function stripScope(text: string): string {
  return text.replace(/(^|\s)-?(?:repo|org|user):(?:"[^"]*"|\S+)/gi, " ").replace(/\s+/g, " ").trim();
}

/** The terms with only qualifiers left out: GitHub refuses a query that has none. */
const hasTerm = (terms: string) => terms.split(" ").some((w) => w && !/^-?[a-z]+:/i.test(w));

/** Splits a search into requests: the terms and filters in each, plus as many `repo:` qualifiers as fit in QUERY_MAX. */
export function planSearch(input: SearchInput): SearchPlan {
  const terms = stripScope(input.text);
  if (!terms || !hasTerm(terms)) return { batches: [], skipped: [], problem: "Enter some text to search for." };
  const base = [terms, input.path ? `path:${quote(input.path)}` : "", input.ext ? `extension:${input.ext}` : ""].filter(Boolean).join(" ");
  const repos = [...new Set(input.repos)];
  if (!repos.length) return { batches: [], skipped: [], problem: "There are no repositories to search." };
  if (base.length + 1 + `repo:${repos[0]}`.length > QUERY_MAX) return { batches: [], skipped: [], problem: `The search is too long. GitHub allows ${QUERY_MAX} characters, including the filters.` };
  const batches: SearchBatch[] = [];
  const skipped: string[] = [];
  let cur: SearchBatch | null = null;
  for (const r of repos) {
    const add = ` repo:${r}`;
    if (cur && cur.q.length + add.length <= QUERY_MAX) {
      cur.q += add;
      cur.repos.push(r);
    } else if (batches.length === MAX_BATCHES || base.length + add.length > QUERY_MAX) {
      skipped.push(r); // no batch left, or this one name is too long to fit beside the terms
    } else {
      cur = { q: base + add, repos: [r] };
      batches.push(cur);
    }
  }
  return { batches, skipped };
}

/** A batch of several repositories cut in two (each keeps the terms and filters), or undefined for a single repository. */
export function splitBatch(b: SearchBatch): [SearchBatch, SearchBatch] | undefined {
  if (b.repos.length < 2) return undefined;
  const base = b.repos.reduce((q, r) => q.replace(` repo:${r}`, ""), b.q);
  const half = Math.ceil(b.repos.length / 2);
  const make = (repos: string[]): SearchBatch => ({ q: base + repos.map((r) => ` repo:${r}`).join(""), repos });
  return [make(b.repos.slice(0, half)), make(b.repos.slice(half))];
}

// ---------- results ----------

export interface RawTextMatch {
  object_type?: string;
  property?: string;
  fragment?: string;
  matches?: { text?: string; indices?: number[] }[];
}

export interface RawSearchItem {
  name: string;
  path: string;
  sha: string;
  url: string;
  html_url: string;
  repository: { full_name: string };
  text_matches?: RawTextMatch[];
}

export interface RawSearch {
  total_count: number;
  incomplete_results: boolean;
  items: RawSearchItem[];
}

export interface Fragment {
  text: string;
  /** [start, end) offsets into `text`, sorted, not overlapping. */
  ranges: [number, number][];
}

export interface SearchHit {
  /** "owner/name/path": unique across repositories, and the hash's `searchHit`. */
  key: string;
  repo: string;
  path: string;
  name: string;
  /** The commit the result was indexed at, from the item's contents URL; falls back to the default branch (""). */
  ref: string;
  htmlUrl: string;
  fragments: Fragment[];
  /** The matched strings, for highlighting the whole file. */
  terms: string[];
  /** How many matches GitHub reported in the fragments. */
  matchCount: number;
}

/** Sorted, clamped, merged ranges from GitHub's [start, end] index pairs. */
export function normaliseRanges(pairs: (number[] | undefined)[], length: number): [number, number][] {
  const r = pairs
    .filter((p): p is number[] => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
    .map(([a, b]) => [Math.max(0, Math.min(a, length)), Math.max(0, Math.min(b, length))] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of r) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const refOf = (url: string) => {
  try {
    return new URL(url).searchParams.get("ref") ?? "";
  } catch {
    return "";
  }
};

export function toHit(item: RawSearchItem): SearchHit {
  const repo = item.repository.full_name;
  const fragments: Fragment[] = [];
  const terms = new Set<string>();
  let matchCount = 0;
  for (const tm of item.text_matches ?? []) {
    if (tm.property && tm.property !== "content") continue;
    const text = tm.fragment ?? "";
    const ms = tm.matches ?? [];
    matchCount += ms.length;
    ms.forEach((m) => {
      const t = (m.text ?? (m.indices ? text.slice(m.indices[0], m.indices[1]) : "")).trim();
      if (t) terms.add(t.toLowerCase());
    });
    fragments.push({ text, ranges: normaliseRanges(ms.map((m) => m.indices), text.length) });
  }
  return { key: `${repo}/${item.path}`, repo, path: item.path, name: item.name, ref: refOf(item.url), htmlUrl: item.html_url, fragments, terms: [...terms], matchCount };
}

export interface Segment {
  text: string;
  hit: boolean;
}

/** The lines of a fragment that hold a match, each split into plain and matched segments, leading indentation trimmed. At most `max` lines. */
export function fragmentLines(f: Fragment, max = 3): Segment[][] {
  const out: Segment[][] = [];
  let start = 0;
  for (const line of f.text.split("\n")) {
    const end = start + line.length;
    const inLine = f.ranges.filter(([a, b]) => a < end && b > start).map(([a, b]) => [Math.max(a, start) - start, Math.min(b, end) - start] as [number, number]);
    if (inLine.length && out.length < max) {
      const indent = line.length - line.trimStart().length;
      const segs: Segment[] = [];
      let at = Math.min(indent, inLine[0][0]);
      for (const [a, b] of inLine) {
        if (a > at) segs.push({ text: line.slice(at, a), hit: false });
        segs.push({ text: line.slice(a, b), hit: true });
        at = b;
      }
      if (at < line.length) segs.push({ text: line.slice(at).trimEnd(), hit: false });
      out.push(segs.filter((s) => s.text));
    }
    start = end + 1;
  }
  return out;
}

export interface HitRange {
  /** 1-based, as Monaco counts. */
  line: number;
  startColumn: number;
  endColumn: number;
}

/** Where the matched terms occur in the whole file (case-insensitive), for the preview's highlights. At most `max`. */
export function findHitRanges(content: string, terms: string[], max = 2000): HitRange[] {
  const want = [...new Set(terms.map((t) => t.toLowerCase()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!want.length) return [];
  const out: HitRange[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const low = lines[i].toLowerCase();
    const taken: [number, number][] = [];
    for (const t of want) {
      for (let at = low.indexOf(t); at >= 0; at = low.indexOf(t, at + t.length)) {
        if (taken.some(([a, b]) => at < b && at + t.length > a)) continue;
        taken.push([at, at + t.length]);
      }
    }
    taken.sort((x, y) => x[0] - y[0]).forEach(([a, b]) => out.length < max && out.push({ line: i + 1, startColumn: a + 1, endColumn: b + 1 }));
  }
  return out;
}

export interface BatchResult {
  batch: SearchBatch;
  ok?: RawSearch;
  err?: SearchFailure;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** Sum of GitHub's total_count over the batches that answered. */
  total: number;
  incomplete: boolean;
  /** Batches that failed, with the repositories they held. */
  failed: { repos: string[]; err: SearchFailure }[];
}

export function mergeBatches(results: BatchResult[]): SearchOutcome {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  let total = 0;
  let incomplete = false;
  const failed: SearchOutcome["failed"] = [];
  for (const r of results) {
    if (r.err) { failed.push({ repos: r.batch.repos, err: r.err }); continue; }
    if (!r.ok) continue;
    total += r.ok.total_count;
    incomplete ||= r.ok.incomplete_results;
    for (const it of r.ok.items) {
      const h = toHit(it);
      if (!seen.has(h.key)) { seen.add(h.key); hits.push(h); }
    }
  }
  return { hits, total, incomplete, failed };
}

// ---------- failures ----------

export type SearchFailureKind = "auth" | "rateLimit" | "validation" | "access" | "other";
export interface SearchFailure {
  kind: SearchFailureKind;
  resetAt?: Date;
  /** GitHub's message, for a validation failure. */
  message?: string;
}

/** A failed request (the GhError fields) as a code search failure. 422 is GitHub refusing the query (or a repository it can't search);
 *  a 403 with no requests left, a 429 or a 403 about the secondary limit is the rate limit. */
export function classifyFailure(e: { kind?: string; status?: number; resetAt?: Date; apiMessage?: string }): SearchFailure {
  const msg = e.apiMessage;
  if (e.kind === "auth" || e.status === 401) return { kind: "auth" };
  if (e.kind === "rateLimit" || e.status === 429 || (e.status === 403 && /rate limit/i.test(msg ?? ""))) return { kind: "rateLimit", resetAt: e.resetAt };
  if (e.status === 422) return { kind: "validation", message: msg };
  if (e.kind === "access" || e.status === 403 || e.status === 404) return { kind: "access", message: msg };
  return { kind: "other", message: msg };
}

/** Requests spent in the last RATE_WINDOW_MS, kept in the page so a burst of searches is refused before GitHub refuses it. */
export class RateWindow {
  private times: number[] = [];
  constructor(private limit = RATE_LIMIT, private windowMs = RATE_WINDOW_MS) {}
  private prune(now: number) { this.times = this.times.filter((t) => now - t < this.windowMs); }
  /** True when `n` more requests fit in the window. */
  canSpend(n: number, now = Date.now()): boolean { this.prune(now); return this.times.length + n <= this.limit; }
  spend(n: number, now = Date.now()) { this.prune(now); for (let i = 0; i < n; i++) this.times.push(now); }
  /** When enough requests leave the window for `n` more to fit. */
  freeAt(n: number, now = Date.now()): Date {
    this.prune(now);
    const over = this.times.length + n - this.limit;
    return over <= 0 ? new Date(now) : new Date(this.times[over - 1] + this.windowMs);
  }
}

/** The search on github.com, for "Open on GitHub". */
export function githubSearchUrl(input: SearchInput): string {
  const terms = stripScope(input.text);
  const scope = input.repos.length === 1 ? `repo:${input.repos[0]} ` : "";
  const q = `${scope}${terms}${input.path ? ` path:${quote(input.path)}` : ""}${input.ext ? ` path:*.${input.ext}` : ""}`;
  return `https://github.com/search?type=code&q=${encodeURIComponent(q)}`;
}

// Batch 4, filters on the pull request list (VW-8).
//
// Schema and search facts (checked live with `gh api graphql` against cli/cli and facebook/react):
//  - search(query: String!, type: ISSUE, first, after) is what prQuery.listQuery already uses for free text and for the Mine tab (variables { q, after }); the PR node fields are prQuery's NODE.
//  - These qualifiers were accepted and FILTERED (non-zero counts on cli/cli): author:login, assignee:login, review-requested:login, reviewed-by:login, label:"needs-triage", draft:true | draft:false,
//    base:trunk (target branch). `@me` works as a login.
//  - A multi-word label MUST be quoted: `label:"help wanted"` matched 558 issues, `label:help wanted` matched 0 (the second word became free text). Several label: qualifiers are ANDed.
//  - A stray unbalanced `"` did not make the search fail, but it is not safe to pass through, so free text has its double quotes removed.
//  - Escaping a quote inside quotes as \" and a backslash as \\ was ACCEPTED by the API, but whether it then matches a label whose name contains a quote was not proven (no such label found).
//  - Qualifiers typed into free text ("is:closed", "repo:other/x") could leave the repo or change the state, so a free-text term containing ":" is dropped, exactly as prQuery.listQuery does.
//
// Decisions fixed by the tests (prListFilters.test.ts):
//  - The qualifier order is fixed: author, assignee, review-requested, reviewed-by, label (in the order given), draft, base, then the free text.
//  - A value is wrapped in double quotes when it contains whitespace, `"`, `\`, `:` or `,`; inside the quotes `\` becomes `\\` and `"` becomes `\"`. Other values are left bare. Blank values are omitted.
//  - Only the Active, Completed and Abandoned tabs take filters; the state tokens are the ones prQuery uses.
//  - With no filters at all, or only free text, the request is exactly listQuery(tab, { owner, name, filter: text, after }) (so "123" still jumps to PR 123).
//  - Hash keys, new in this module (collision-checked against browseState.ts): author, assignee, reviewRequested, reviewedBy, label (repeated), draft (draft | ready), base, text (capped at 200 characters).
import { listQuery, Q_SEARCH, STATES, type PrListRequest, type PrTab } from "./prQuery";

const FILTER_KEYS = new Set(["author", "assignee", "reviewRequested", "reviewedBy", "label", "draft", "base", "text"]);
const clean = (v?: string) => (v ?? "").trim();
const labelsOf = (f: ListFilters) => [...new Set((f.labels ?? []).map(clean).filter(Boolean))];
/** Whitespace, quotes, backslash, colon or comma: quote the value, escaping backslash and double quote. */
const quote = (v: string) => (/[\s"\\:,]/.test(v) ? `"${v.replace(/[\\"]/g, "\\$&")}"` : v);
/** Free text as prQuery.listQuery treats it: quotes removed, qualifier-looking terms dropped. */
const freeText = (t?: string) => (t ?? "").replace(/"/g, "").split(/\s+/).filter((w) => w && !w.includes(":")).join(" ");

export interface ListFilters {
  /** Login, or "@me". */
  author?: string;
  assignee?: string;
  /** review-requested:login */
  reviewRequested?: string;
  /** reviewed-by:login */
  reviewedBy?: string;
  /** All of these labels (AND). */
  labels?: string[];
  draft?: "draft" | "ready";
  /** Target branch (base:). */
  base?: string;
  /** Free text. */
  text?: string;
}

/** True when any field holds a non-blank value. */
export function hasListFilters(f: ListFilters): boolean {
  return !!(clean(f.author) || clean(f.assignee) || clean(f.reviewRequested) || clean(f.reviewedBy) || labelsOf(f).length || f.draft || clean(f.base) || freeText(f.text));
}

/** The search qualifiers and free text for the filters, in the fixed order, e.g. `author:ada label:"good first issue" draft:false base:main fix typo`. "" when there are none. */
export function filterQualifiers(f: ListFilters): string {
  const q = (key: string, v?: string) => (clean(v) ? [`${key}:${quote(clean(v))}`] : []);
  return [
    ...q("author", f.author),
    ...q("assignee", f.assignee),
    ...q("review-requested", f.reviewRequested),
    ...q("reviewed-by", f.reviewedBy),
    ...labelsOf(f).map((l) => `label:${quote(l)}`),
    ...(f.draft ? [`draft:${f.draft === "draft"}`] : []),
    ...q("base", f.base),
    ...(freeText(f.text) ? [freeText(f.text)] : []),
  ].join(" ");
}

export interface FilteredListParams {
  owner: string;
  name: string;
  filters: ListFilters;
  /** Cursor from the previous page. */
  after?: string;
}

/**
 * The request for one page of a tab with filters. When the filters are empty or only free text it is listQuery(tab, ...) unchanged. Otherwise it is a search request ({ source: "search" }, the same query text
 * listQuery uses for its search path) with variables { q: `repo:${owner}/${name} is:pr ${state tokens} ${filterQualifiers(filters)}`, after }.
 */
export function listFilterQuery(tab: Exclude<PrTab, "mine">, p: FilteredListParams): PrListRequest {
  const { owner, name, filters, after } = p;
  if (!hasListFilters({ ...filters, text: undefined })) return listQuery(tab, { owner, name, filter: filters.text, after })[0];
  return {
    query: Q_SEARCH,
    variables: { q: `repo:${owner}/${name} is:pr ${STATES[tab].tokens} ${filterQualifiers(filters)}`, after: after ?? null },
    source: "search",
  };
}

/** Reads the filter keys from a location hash (with or without leading "#" or several). Blank values and unknown draft values are dropped; never throws. */
export function parseListFilters(hash: string): ListFilters {
  const f: ListFilters = {};
  const labels: string[] = [];
  for (const seg of hash.replace(/^#+/, "").split("&")) {
    const eq = seg.indexOf("=");
    if (eq < 0) continue;
    let v: string;
    try {
      v = decodeURIComponent(seg.slice(eq + 1));
    } catch {
      continue;
    }
    if (!v.trim()) continue;
    switch (seg.slice(0, eq)) {
      case "author": f.author = v; break;
      case "assignee": f.assignee = v; break;
      case "reviewRequested": f.reviewRequested = v; break;
      case "reviewedBy": f.reviewedBy = v; break;
      case "label": labels.push(v); break;
      case "draft": if (v === "draft" || v === "ready") f.draft = v; break;
      case "base": f.base = v; break;
      case "text": f.text = v.slice(0, 200); break;
    }
  }
  if (labels.length) f.labels = labels;
  return f;
}

/**
 * Returns `hash` (starting "#") with the filter keys replaced by the filters' own: other segments are kept verbatim and in order, this module's keys come last in the order author, assignee, reviewRequested,
 * reviewedBy, label (one key per label), draft, base, text; values are encodeURIComponent-encoded. Cleared filters remove their keys.
 */
export function applyListFilters(hash: string, f: ListFilters): string {
  const kept = hash.replace(/^#+/, "").split("&").filter((s) => s && !FILTER_KEYS.has(s.split("=")[0]));
  const add = (k: string, v?: string) => clean(v) && kept.push(`${k}=${encodeURIComponent(clean(v))}`);
  add("author", f.author);
  add("assignee", f.assignee);
  add("reviewRequested", f.reviewRequested);
  add("reviewedBy", f.reviewedBy);
  labelsOf(f).forEach((l) => add("label", l));
  add("draft", f.draft);
  add("base", f.base);
  add("text", f.text?.slice(0, 200));
  return "#" + kept.join("&");
}

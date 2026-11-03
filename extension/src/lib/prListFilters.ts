// Batch 4, filters on the pull request list (VW-8). STUBS: the developer implements them. Every function throws "Not implemented" except the constants.
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
import type { PrListRequest, PrTab } from "./prQuery";

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
  throw new Error("Not implemented");
}

/** The search qualifiers and free text for the filters, in the fixed order, e.g. `author:ada label:"good first issue" draft:false base:main fix typo`. "" when there are none. */
export function filterQualifiers(f: ListFilters): string {
  throw new Error("Not implemented");
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
  throw new Error("Not implemented");
}

/** Reads the filter keys from a location hash (with or without leading "#" or several). Blank values and unknown draft values are dropped; never throws. */
export function parseListFilters(hash: string): ListFilters {
  throw new Error("Not implemented");
}

/**
 * Returns `hash` (starting "#") with the filter keys replaced by the filters' own: other segments are kept verbatim and in order, this module's keys come last in the order author, assignee, reviewRequested,
 * reviewedBy, label (one key per label), draft, base, text; values are encodeURIComponent-encoded. Cleared filters remove their keys.
 */
export function applyListFilters(hash: string, f: ListFilters): string {
  throw new Error("Not implemented");
}

// R2 AS-1, request builders for the Advanced Security hub. STUBS: the developer implements them. Every function throws "Not implemented".
//
// Facts (live with `gh api` against TrueNorthIT/ado-github-repos on 2026-11-03, and the OpenAPI description github/rest-api-description api.github.com.json):
//  - Dependabot list: cursor paging only. The Link header has rel="next" with `?per_page=..&after=<base64 cursor, "=" sent as %3D>` and NEVER rel="last" or a page number.
//  - Code scanning list: `Link: <...&page=2>; rel="next", <...&page=5>; rel="last"` (page numbers; later pages also carry rel="prev" and rel="first"). The spec also offers before/after cursors; we use page numbers as the requirement says.
//  - Secret scanning list: page numbers, same as code scanning (an empty repo returns [] with no Link header).
//  - No state parameter means ALL states on the Dependabot list (the live list returned open and auto_dismissed together), so the page must send a state to show the default Open view.
//  - Dependabot `state`, `severity`, `ecosystem`, `package` take comma-separated lists. `state` values: auto_dismissed, dismissed, fixed, open. `scope`: development | runtime. `sort`: created | updated | epss_percentage.
//  - Code scanning `state` filter: open | closed | dismissed | fixed. `severity` filter: critical | high | medium | low | warning | note | error. `ref` is a full ref ("refs/heads/main") or a PR ref. `tool_name`. `sort`: created | updated.
//  - Secret scanning `state`: open | resolved; `resolution` (comma list): false_positive, wont_fix, revoked, used_in_tests; `secret_type`; `validity`: active | inactive | unknown; `hide_secret` (boolean).
//    The list returns the secret literal unless hide_secret=true, so every secret request the hub sends sets it.
//  - Dependabot and secret scanning alerts are not branch-scoped (no `ref` parameter); only code scanning is.
//  - Dismiss and reopen are PATCH (OpenAPI operations dependabot/update-alert, code-scanning/update-alert, secret-scanning/update-alert), checked against the spec only, nothing was dismissed or reopened:
//      Dependabot: { state: "open" | "dismissed", dismissed_reason: fix_started | inaccurate | no_bandwidth | not_used | tolerable_risk, dismissed_comment (max 280) }
//      Code scanning: { state: "open" | "dismissed", dismissed_reason: "false positive" | "won't fix" | "used in tests" | "mitigated", dismissed_comment (max 280) }
//        NOTE: the spec has a FOURTH code scanning reason, "mitigated", that the requirement table does not list; it is accepted here.
//      Secret scanning: { state: "open" | "resolved", resolution: false_positive | wont_fix | revoked | used_in_tests, resolution_comment }
//  - Code scanning instances: GET .../code-scanning/alerts/{n}/instances (ref, pr, page, per_page). Secret locations: GET .../secret-scanning/alerts/{n}/locations (page, per_page).
//
// Decisions fixed by the tests (securityRequests.test.ts):
//  - `repo` is "owner/name" as in the other lib modules (paths are `/repos/${repo}/...`). A repo that is not that shape, or an alert number that is not a positive integer, makes a builder throw (a PATCH must never be built for a mangled path).
//  - Values travel URL-encoded in the query string; the tests read it back with URLSearchParams, so any valid encoding is fine.
//  - per_page defaults to 30 and is clamped to 1..100.
//  - State filter mapping. Dependabot: open -> open; dismissed -> auto_dismissed,dismissed; fixed -> fixed; closed -> auto_dismissed,dismissed,fixed. Code scanning: sent as given.
//    Secret scanning: open -> state=open; closed -> state=resolved; dismissed -> state=resolved + resolution=false_positive,wont_fix,used_in_tests; fixed -> state=resolved + resolution=revoked.
//  - Filters that the source cannot take are not sent: severity for secrets, branch for Dependabot and secrets, text for all, ecosystem/package/scope for anything but Dependabot, validity for anything but secrets.
//  - `branch` "main" becomes ref=refs/heads/main; a value already starting "refs/" is sent unchanged. `tool` -> tool_name. For secrets `rule` -> secret_type. `severity` is sent lower-case.
//  - dismiss/reopen bodies hold only the documented keys; a blank comment leaves its key out.
import type { AlertKind, SecurityFilters, SecurityRequest } from "./securityTypes";

export interface CursorPaging {
  /** The `after` cursor from the previous page's Link header (parsePaging(...).nextAfter). */
  after?: string;
  perPage?: number;
}

export interface PagePaging {
  /** 1-based page number (parsePaging(...).nextPage). */
  page?: number;
  perPage?: number;
}

/** What a Link header says about the other pages. */
export interface LinkPaging {
  /** The decoded `after` query value of rel="next", or null. */
  nextAfter: string | null;
  /** The `page` query value of rel="next" as a number, or null. */
  nextPage: number | null;
  /** The `page` query value of rel="last" as a number, or null (Dependabot never has one). */
  lastPage: number | null;
}

/** `GET /repos/{repo}/dependabot/alerts` with the filters and cursor paging. */
export function dependabotAlertsRequest(repo: string, filters: SecurityFilters, paging: CursorPaging = {}): SecurityRequest {
  throw new Error("Not implemented");
}

/** `GET /repos/{repo}/code-scanning/alerts` with the filters and page numbers. */
export function codeScanningAlertsRequest(repo: string, filters: SecurityFilters, paging: PagePaging = {}): SecurityRequest {
  throw new Error("Not implemented");
}

/** `GET /repos/{repo}/secret-scanning/alerts` with the filters and page numbers; always hide_secret=true. */
export function secretScanningAlertsRequest(repo: string, filters: SecurityFilters, paging: PagePaging = {}): SecurityRequest {
  throw new Error("Not implemented");
}

/** Reads a response's `Link` header (null, undefined or garbage give all-null). Never throws. */
export function parsePaging(link: string | null | undefined): LinkPaging {
  throw new Error("Not implemented");
}

/** `GET /repos/{repo}/{dependabot|code-scanning|secret-scanning}/alerts/{number}`. */
export function alertRequest(kind: AlertKind, repo: string, number: number): SecurityRequest {
  throw new Error("Not implemented");
}

/** `GET .../code-scanning/alerts/{number}/instances`, optionally for one `ref`. */
export function codeScanningInstancesRequest(repo: string, number: number, opts: { ref?: string; page?: number; perPage?: number } = {}): SecurityRequest {
  throw new Error("Not implemented");
}

/** `GET .../secret-scanning/alerts/{number}/locations`. */
export function secretLocationsRequest(repo: string, number: number, opts: { page?: number; perPage?: number } = {}): SecurityRequest {
  throw new Error("Not implemented");
}

/** The reasons the dismiss dialog offers for a kind: the API value and the label shown. Secrets call it "resolve". */
export function dismissReasons(kind: AlertKind): { value: string; label: string }[] {
  throw new Error("Not implemented");
}

/**
 * `PATCH` that dismisses (resolves, for secrets) an alert: body { state, dismissed_reason, dismissed_comment } for Dependabot and code scanning, { state: "resolved", resolution, resolution_comment } for secrets.
 * Throws when `reason` is not one of dismissReasons(kind) (the message names the allowed values) or when the comment is over 280 characters (Dependabot and code scanning, the spec's maxLength).
 */
export function dismissRequest(kind: AlertKind, repo: string, number: number, reason: string, comment?: string): SecurityRequest {
  throw new Error("Not implemented");
}

/** `PATCH` with body { state: "open" }. */
export function reopenRequest(kind: AlertKind, repo: string, number: number): SecurityRequest {
  throw new Error("Not implemented");
}

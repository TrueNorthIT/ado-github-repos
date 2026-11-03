// R2 AS-4, the open-alert counts on the tab headers and the severity summary. STUBS: the developer implements them. Every function throws "Not implemented".
//
// Facts (live, 2026-11-03, TrueNorthIT/ado-github-repos): with per_page=1 the code scanning list answered `Link: <..page=2>; rel="next", <..page=5>; rel="last"` for 5 alerts, so the last page number IS the count.
// The Dependabot list never sends rel="last" (cursor paging), and a secret scanning list with no alerts sends no Link at all.
//
// The rule, pinned by the tests (securityCounts.test.ts):
//  1. No rel="next" in the Link header: the first page is the whole list, so the count is exactly the number of items on it.
//  2. rel="next" and rel="last" with a page number, requested with per_page=1: the count is exactly that page number.
//  3. rel="next" and no rel="last" (Dependabot): the count is only a lower bound, capped, and the label is the first page's size and a plus, "100+" for a full page of 100.
//  Case 2 is only exact for per_page=1, which is why countRequest asks for it. Dependabot is asked for per_page=100 (the largest page), so "100+" is its ceiling. A rel="last" with per_page above 1 is not pinned.
import type { AlertKind, SecurityRequest } from "./securityTypes";
import type { AlertRow, Severity } from "./securityModel";
import { codeScanningAlertsRequest, dependabotAlertsRequest, parsePaging, secretScanningAlertsRequest } from "./securityRequests";

export interface AlertCount {
  count: number;
  /** True when `count` is a lower bound ("100+"). */
  capped: boolean;
  /** What the tab header shows: "5", "100+". */
  label: string;
}

/**
 * The request whose first page gives the open count: state=open, per_page=1 for code scanning and secret scanning (so the last page number is the count), per_page=100 for Dependabot.
 * `branch` scopes code scanning to a branch (ref=refs/heads/{branch}); the others are not branch-scoped. Secret requests hide the secret literal.
 */
export function countRequest(kind: AlertKind, repo: string, opts: { branch?: string } = {}): SecurityRequest {
  if (kind === "dependabot") return dependabotAlertsRequest(repo, { state: "open" }, { perPage: 100 });
  if (kind === "code") return codeScanningAlertsRequest(repo, { state: "open", branch: opts.branch }, { perPage: 1 });
  return secretScanningAlertsRequest(repo, { state: "open" }, { perPage: 1 });
}

/** The count from the first page's size and its `Link` header (see the rule above). Never throws. */
export function countFromFirstPage(itemsOnFirstPage: number, link: string | null | undefined): AlertCount {
  const p = parsePaging(link);
  if (p.nextAfter === null && p.nextPage === null) return { count: itemsOnFirstPage, capped: false, label: String(itemsOnFirstPage) };
  if (p.lastPage !== null) return { count: p.lastPage, capped: false, label: String(p.lastPage) };
  return { count: itemsOnFirstPage, capped: true, label: `${itemsOnFirstPage}+` };
}

/** How many of `rows` have each severity. Every severity is a key, with 0 for none. */
export function severityCounts(rows: AlertRow[]): Record<Severity, number> {
  const out: Record<Severity, number> = { Critical: 0, High: 0, Medium: 0, Low: 0, Note: 0, None: 0 };
  for (const r of rows) out[r.severity]++;
  return out;
}

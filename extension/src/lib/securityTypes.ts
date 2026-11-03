// R2: Advanced Security hub, shared types only (no logic, nothing to implement here).
//
// The hub recreates ADO's Repos > Advanced Security page (GHAzDO) on GitHub's REST API. Verified live with `gh api` on 2026-11-03 against TrueNorthIT/ado-github-repos
// (open Dependabot and code scanning alerts) and the GitHub REST OpenAPI description (github/rest-api-description, api.github.com.json); see the header of each security*.ts module.
import type { RestRequest } from "./restRequest";

/** The three alert sources. The hash tabs are `dependencies | code | secrets` (securityHash.ts). */
export type AlertKind = "dependabot" | "code" | "secret";

/** One ADO-like scale for every source. "None" is what secrets have. */
export type Severity = "Critical" | "High" | "Medium" | "Low" | "Note" | "None";
export type RatedSeverity = Exclude<Severity, "None">;

export type AlertState = "Open" | "Dismissed" | "Fixed" | "Resolved" | "AutoDismissed";

/** The state filter as ADO offers it. */
export type StateFilter = "open" | "closed" | "dismissed" | "fixed";

/** A REST call as data. restRequest.ts's RestRequest has no PATCH, which dismiss and reopen need, so the method is widened here. */
export type SecurityRequest = Omit<RestRequest, "method"> & { method: RestRequest["method"] | "PATCH" };

/** Everything the filter bar can ask for. `text` is applied to the loaded rows by the page (GitHub has no free-text search on these endpoints), never sent to the server. */
export interface SecurityFilters {
  state?: StateFilter;
  severity?: RatedSeverity;
  /** Short branch name ("main") or a full ref ("refs/heads/main"). Only code scanning is branch-scoped. */
  branch?: string;
  /** Code scanning tool name, e.g. "CodeQL". */
  tool?: string;
  /** Code scanning rule id, a GHSA id (Dependabot, matched on the loaded rows), or a secret type (secret scanning). */
  rule?: string;
  text?: string;
  /** Dependabot only. */
  ecosystem?: string;
  package?: string;
  scope?: "development" | "runtime";
  /** Secret scanning only. */
  validity?: "active" | "inactive" | "unknown";
  sort?: "created" | "updated";
  direction?: "asc" | "desc";
}

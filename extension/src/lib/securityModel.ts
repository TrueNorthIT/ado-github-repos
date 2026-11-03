// R2 AS-2, normalisers from the three GitHub alert payloads to one view model, and the one severity scale. STUBS: the developer implements them. Every function throws "Not implemented".
//
// Payload facts (live with `gh api` against TrueNorthIT/ado-github-repos on 2026-11-03; fixtures in securityTestHelpers.ts keep the shapes with invented values):
//  - Dependabot alert: number, state (open | auto_dismissed here; dismissed | fixed per spec), dependency{package{ecosystem,name}, manifest_path, scope, version_requirement, relationship},
//    security_advisory{ghsa_id, cve_id (may be null), summary, description (markdown), severity, identifiers, references[{url}], cvss, cwes[{cwe_id,name}]},
//    security_vulnerability{package, severity, vulnerable_version_range, first_patched_version{identifier} (null when unpatched)}, html_url, created_at, dismissed_at, dismissed_by{login},
//    dismissed_reason, dismissed_comment, fixed_at, auto_dismissed_at.
//  - Code scanning alert: number, state, created_at, html_url, rule{id, severity (error|warning|note|none), security_severity_level (critical|high|medium|low, absent for non-security rules), description, tags, full_description, help (markdown)},
//    tool{name, version}, most_recent_instance{ref, state, commit_sha, message{text}, location{path,start_line,end_line,start_column,end_column}}, dismissed_by{login}, dismissed_at, dismissed_reason, dismissed_comment, fixed_at.
//    Live: a rule with severity "warning" had security_severity_level "high"; ADO shows the security level, so it wins.
//    CodeQL tags carry the CWE as `external/cwe/cwe-020` (zero-padded); the canonical id is CWE-20.
//  - Secret scanning alert (OpenAPI schema secret-scanning-alert; the live repos had no alerts): number, state open | resolved, resolution, resolution_comment, resolved_at, resolved_by{login}, secret_type, secret_type_display_name,
//    secret (THE LITERAL SECRET), validity, html_url, created_at, first_location_detected{type, details{path,start_line,end_line,...}} | null, has_more_locations.
//  - Instances (GET .../instances) and locations (GET .../locations) are arrays: instances as in most_recent_instance; locations are { type, details }.
//
// Decisions fixed by the tests (securityModel.test.ts):
//  - Severity. Dependabot: security_vulnerability.severity, falling back to security_advisory.severity. Code scanning: rule.security_severity_level when present, otherwise rule.severity: error -> High, warning -> Medium, note -> Note, none or anything else -> None.
//    Secrets: None. critical/high/medium/low map to Critical/High/Medium/Low.
//  - Rank for sorting: Critical 5, High 4, Medium 3, Low 2, Note 1, None 0.
//  - Pill colours: the exact ADO hex values could not be checked from here, so the tests pin the contract (a hex background and foreground per severity, distinct backgrounds for the six, readable contrast), not the hexes. The developer picks ADO's values.
//  - AlertRow. title: Dependabot advisory summary; code scanning rule.description; secret secret_type_display_name (secret_type when blank). location: Dependabot the package name; code scanning `path:startLine` (the path alone with no line, "" with no location);
//    secrets the first location as `path:startLine` for a commit, otherwise the location type with spaces and a capital ("Issue body"), "" when none. firstDetected: created_at. url: html_url.
//    ruleId: Dependabot the GHSA id; code scanning rule.id; secret secret_type. tool: code scanning tool.name only (the key is absent otherwise).
//  - State. Dependabot open/dismissed/fixed/auto_dismissed -> Open/Dismissed/Fixed/AutoDismissed. Code scanning open/dismissed/fixed. Secrets open/resolved -> Open/Resolved.
//  - AlertDetail is an AlertRow plus: description (markdown: Dependabot the advisory description; code scanning rule.full_description, else rule.description; secrets text that names the secret type), message (code scanning instance message text),
//    remediation (markdown: Dependabot a sentence naming the package and the first patched version, or saying there is no patched version yet; code scanning rule.help verbatim; secrets text that says to revoke the secret),
//    references (advisory reference URLs; none for the others), place {path, startLine?, endLine?} (Dependabot the manifest path; code scanning the instance; secrets first_location_detected when it is a commit), cwes and cves (canonical, de-duplicated, in order),
//    dismissal (only when Dismissed, AutoDismissed or Resolved), fixedAt (only when Fixed), package, vulnerableRange, patchedVersion (Dependabot), validity (secrets).
//  - SECURITY: the secret literal is never carried into a row or detail (nothing in them may contain `secret`'s value).
import type { AlertKind, AlertState, Severity } from "./securityTypes";
export type { AlertKind, AlertState, Severity } from "./securityTypes";

export interface AlertRow {
  kind: AlertKind;
  number: number;
  severity: Severity;
  title: string;
  location: string;
  firstDetected: Date;
  state: AlertState;
  tool?: string;
  ruleId?: string;
  url: string;
}

export interface AlertLocation {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface AlertDismissal {
  /** The API value: dismissed_reason or resolution, or "auto_dismissed" for an auto-dismissed Dependabot alert. */
  reason: string;
  comment?: string;
  at?: Date;
  /** Login of whoever dismissed or resolved it. */
  by?: string;
}

export interface AlertDetail extends AlertRow {
  /** Markdown. */
  description: string;
  /** Code scanning: the instance message. */
  message?: string;
  /** Markdown. */
  remediation: string;
  references: string[];
  /** The place the alert points at, with its line range (the row's `location` is the same thing as a string). */
  place?: AlertLocation;
  /** "CWE-79" style. */
  cwes: string[];
  /** "CVE-2024-0001" style. */
  cves: string[];
  dismissal?: AlertDismissal;
  fixedAt?: Date;
  package?: { ecosystem: string; name: string; manifestPath: string; scope?: string };
  vulnerableRange?: string;
  patchedVersion?: string;
  validity?: string;
}

/** One place a code scanning alert occurs (GET .../instances). */
export interface AlertInstance {
  ref: string;
  commitSha: string;
  message?: string;
  location?: AlertLocation;
}

/** One place a secret was found (GET .../locations). */
export interface SecretLocation {
  /** The API's location type, e.g. "commit" or "issue_body". */
  type: string;
  /** Commit locations only. */
  path?: string;
  startLine?: number;
  endLine?: number;
  /** details.html_url when present. */
  url?: string;
}

export interface SeverityPill {
  /** The text in the pill. */
  label: string;
  /** "#rrggbb". */
  background: string;
  /** "#rrggbb". */
  foreground: string;
}

/** Code scanning's mapping alone: security_severity_level first, then rule.severity (see the decisions above). */
export function codeScanningSeverity(rule: { severity?: string | null; security_severity_level?: string | null }): Severity {
  throw new Error("Not implemented");
}

/** 5 for Critical down to 0 for None. */
export function severityRank(severity: Severity): number {
  throw new Error("Not implemented");
}

/** The pill for a severity, in ADO's colours. */
export function severityPill(severity: Severity): SeverityPill {
  throw new Error("Not implemented");
}

/** One list item (a payload of the list endpoint) as a table row. */
export function alertRow(kind: AlertKind, json: any): AlertRow {
  throw new Error("Not implemented");
}

/** One alert (a payload of the single-alert endpoint) as the detail page's model. */
export function alertDetail(kind: AlertKind, json: any): AlertDetail {
  throw new Error("Not implemented");
}

/** GET .../instances. */
export function codeScanningInstances(json: any[]): AlertInstance[] {
  throw new Error("Not implemented");
}

/** GET .../locations. */
export function secretLocations(json: any[]): SecretLocation[] {
  throw new Error("Not implemented");
}

/**
 * The rows that pass the filters the server cannot apply: `rule` must equal the row's ruleId (case-insensitive) and `text` must be found, case-insensitively, in the title, location, ruleId, tool or "#number"
 * of the row; several words must ALL be found. Blank filters pass every row; the order is kept.
 */
export function filterRows(rows: AlertRow[], filters: { text?: string; rule?: string }): AlertRow[] {
  throw new Error("Not implemented");
}

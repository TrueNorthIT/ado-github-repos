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
  /** Dependabot only: the manifest file the dependency is declared in, shown under the package name. */
  manifestPath?: string;
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
  return level(rule.security_severity_level) ?? ({ error: "High", warning: "Medium", note: "Note" } as Record<string, Severity>)[rule.severity ?? ""] ?? "None";
}

const LEVELS: Record<string, Severity> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const level = (s: string | null | undefined): Severity | undefined => LEVELS[(s ?? "").toLowerCase()];

const RANK: Record<Severity, number> = { Critical: 5, High: 4, Medium: 3, Low: 2, Note: 1, None: 0 };
/** 5 for Critical down to 0 for None. */
export function severityRank(severity: Severity): number {
  return RANK[severity];
}

// ponytail: ADO's exact hex values could not be checked from here; these are Fluent-style stand-ins chosen for >= 4.5:1 contrast. Swap for ADO's if they differ.
const PILLS: Record<Severity, [string, string]> = {
  Critical: ["#8e1b1b", "#ffffff"],
  High: ["#b8340f", "#ffffff"],
  Medium: ["#f7d070", "#3a2c00"],
  Low: ["#cfe3f5", "#0b3a63"],
  Note: ["#d6d6d6", "#242424"],
  None: ["#f3f2f1", "#323130"],
};
/** The pill for a severity, in ADO's colours. */
export function severityPill(severity: Severity): SeverityPill {
  const [background, foreground] = PILLS[severity];
  return { label: severity, background, foreground };
}

const date = (s: string | null | undefined) => (s ? new Date(s) : undefined);
const place = (path: string, line?: number) => (line ? `${path}:${line}` : path);
const spaced = (t: string) => {
  const s = t.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function severityOf(kind: AlertKind, j: any): Severity {
  if (kind === "dependabot") return level(j.security_vulnerability?.severity) ?? level(j.security_advisory?.severity) ?? "None";
  if (kind === "code") return codeScanningSeverity(j.rule ?? {});
  return "None";
}

const STATES: Record<AlertKind, Record<string, AlertState>> = {
  dependabot: { open: "Open", dismissed: "Dismissed", fixed: "Fixed", auto_dismissed: "AutoDismissed" },
  code: { open: "Open", dismissed: "Dismissed", fixed: "Fixed" },
  secret: { open: "Open", resolved: "Resolved" },
};

/** The first location of a secret alert as text: path:line for a commit, the readable type otherwise. */
function secretWhere(first: any): string {
  if (!first) return "";
  const d = first.details ?? {};
  return first.type === "commit" && d.path ? place(d.path, d.start_line) : first.type ? spaced(first.type) : "";
}

/** One list item (a payload of the list endpoint) as a table row. */
export function alertRow(kind: AlertKind, json: any): AlertRow {
  const row: AlertRow = { kind, number: json.number, severity: severityOf(kind, json), title: "", location: "", firstDetected: new Date(json.created_at), state: STATES[kind][json.state] ?? "Open", url: json.html_url };
  if (kind === "dependabot") {
    row.title = json.security_advisory?.summary ?? "";
    row.location = json.dependency?.package?.name ?? "";
    if (json.dependency?.manifest_path) row.manifestPath = json.dependency.manifest_path;
    row.ruleId = json.security_advisory?.ghsa_id;
  } else if (kind === "code") {
    row.title = json.rule?.description ?? "";
    const loc = json.most_recent_instance?.location;
    row.location = loc?.path ? place(loc.path, loc.start_line) : "";
    row.ruleId = json.rule?.id;
    if (json.tool?.name) row.tool = json.tool.name;
  } else {
    row.title = json.secret_type_display_name || json.secret_type || "";
    row.location = secretWhere(json.first_location_detected);
    row.ruleId = json.secret_type;
  }
  return row;
}

const uniq = (a: string[]) => a.filter((x, i) => a.indexOf(x) === i);

/** One alert (a payload of the single-alert endpoint) as the detail page's model. */
export function alertDetail(kind: AlertKind, json: any): AlertDetail {
  const row = alertRow(kind, json);
  const d: AlertDetail = { ...row, description: "", remediation: "", references: [], cwes: [], cves: [] };
  if (kind === "dependabot") {
    const adv = json.security_advisory ?? {};
    const vuln = json.security_vulnerability ?? {};
    const dep = json.dependency ?? {};
    const name = dep.package?.name ?? "";
    const patched = vuln.first_patched_version?.identifier;
    d.description = adv.description ?? "";
    d.remediation = patched ? `Update ${name} to version ${patched} or later.` : `There is no patched version of ${name} available yet.`;
    d.references = (adv.references ?? []).map((r: any) => r.url);
    d.place = { path: dep.manifest_path ?? "" };
    d.cwes = uniq((adv.cwes ?? []).map((c: any) => c.cwe_id));
    d.cves = adv.cve_id ? [adv.cve_id] : [];
    d.package = { ecosystem: dep.package?.ecosystem, name, manifestPath: dep.manifest_path, scope: dep.scope };
    d.vulnerableRange = vuln.vulnerable_version_range;
    d.patchedVersion = patched;
    if (row.state === "Dismissed") d.dismissal = { reason: json.dismissed_reason, comment: json.dismissed_comment ?? undefined, at: date(json.dismissed_at), by: json.dismissed_by?.login };
    else if (row.state === "AutoDismissed") d.dismissal = { reason: "auto_dismissed", at: date(json.auto_dismissed_at) };
    if (row.state === "Fixed") d.fixedAt = date(json.fixed_at);
  } else if (kind === "code") {
    const rule = json.rule ?? {};
    const inst = json.most_recent_instance ?? {};
    d.description = rule.full_description || rule.description || "";
    d.message = inst.message?.text;
    d.remediation = rule.help ?? "";
    if (inst.location?.path) d.place = { path: inst.location.path, startLine: inst.location.start_line, endLine: inst.location.end_line };
    d.cwes = uniq((rule.tags ?? []).map((t: string) => /^external\/cwe\/cwe-0*(\d+)$/i.exec(t)?.[1]).filter(Boolean).map((n: string) => `CWE-${n}`));
    if (row.state === "Dismissed") d.dismissal = { reason: json.dismissed_reason, comment: json.dismissed_comment ?? undefined, at: date(json.dismissed_at), by: json.dismissed_by?.login };
    if (row.state === "Fixed") d.fixedAt = date(json.fixed_at);
  } else {
    // SECURITY: json.secret (the literal) is deliberately never read.
    d.description = `GitHub secret scanning found a ${row.title} in this repository.`;
    d.remediation = "Revoke the secret with its provider, then resolve this alert. Removing it from the code does not make it safe, because it stays in the repository history.";
    const first = json.first_location_detected;
    if (first?.type === "commit" && first.details?.path) d.place = { path: first.details.path, startLine: first.details.start_line, endLine: first.details.end_line };
    d.validity = json.validity;
    if (row.state === "Resolved") d.dismissal = { reason: json.resolution, comment: json.resolution_comment ?? undefined, at: date(json.resolved_at), by: json.resolved_by?.login };
  }
  return d;
}

const loc = (l: any): AlertLocation | undefined => (l?.path ? { path: l.path, startLine: l.start_line, endLine: l.end_line } : undefined);

/** GET .../instances. */
export function codeScanningInstances(json: any[]): AlertInstance[] {
  return json.map((i) => ({ ref: i.ref, commitSha: i.commit_sha, message: i.message?.text, location: loc(i.location) }));
}

/** GET .../locations. */
export function secretLocations(json: any[]): SecretLocation[] {
  return json.map((l) => {
    const d = l.details ?? {};
    const out: SecretLocation = { type: l.type };
    if (l.type === "commit" && d.path) {
      out.path = d.path;
      out.startLine = d.start_line;
      out.endLine = d.end_line;
    }
    if (d.html_url) out.url = d.html_url;
    return out;
  });
}

/**
 * The rows that pass the filters the server cannot apply: `rule` must equal the row's ruleId (case-insensitive) and `text` must be found, case-insensitively, in the title, location, ruleId, tool or "#number"
 * of the row; several words must ALL be found. Blank filters pass every row; the order is kept.
 */
export function filterRows(rows: AlertRow[], filters: { text?: string; rule?: string }): AlertRow[] {
  const rule = filters.rule?.trim().toLowerCase();
  const words = (filters.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (rule && (r.ruleId ?? "").toLowerCase() !== rule) return false;
    const hay = [r.title, r.location, r.ruleId, r.tool, `#${r.number}`].join("\n").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

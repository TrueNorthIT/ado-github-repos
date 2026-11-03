// Shared fixtures and assertions for the R2 (AS-*) tests. Test support only: not imported by any production module.
//
// The payload shapes were captured live with `gh api` on 2026-11-03 (a Dependabot list and a code scanning alert with its instances from a private repository) and checked against the GitHub REST OpenAPI description
// for the dismissed, fixed and secret scanning fields no live alert had. Every value here is invented (generic names, a made-up repository), so nothing real is published.
import { expect } from "vitest";
import type { SecurityRequest } from "./securityTypes";

export const REPO = "acme/web";
export const API = "https://api.github.com";

/** The query string of a request's path as a plain object (so any valid URL encoding passes). */
export function query(req: SecurityRequest): Record<string, string> {
  const out: Record<string, string> = {};
  new URL(API + req.path).searchParams.forEach((v, k) => (out[k] = v)); // URLSearchParams is not iterable in this lib config
  return out;
}

/** The path of a request without its query string. */
export function pathname(req: SecurityRequest): string {
  return new URL(API + req.path).pathname;
}

/** A comma-separated query value as a sorted list, so the order GitHub sees does not matter. */
export const list = (v: string | undefined): string[] => (v ?? "").split(",").filter(Boolean).sort();

/** Asserts a request is a GET of `path` carrying exactly the query parameters in `expected` (and no body). */
export function expectGet(req: SecurityRequest, path: string, expected: Record<string, string>, what: string) {
  expect(req.method, `Expected ${what} to be a GET`).toBe("GET");
  expect(pathname(req), `Expected ${what} to call ${path}`).toBe(path);
  expect(query(req), `Expected ${what} to carry exactly these query parameters`).toEqual(expected);
  expect(req.body, `Expected ${what} to have no body`).toBeUndefined();
}

// Link headers in GitHub's real format (cursors and ids made up).
export const DEPENDABOT_NEXT_LINK = `<https://api.github.com/repositories/123456789/dependabot/alerts?per_page=30&after=Y3Vyc29yOnYyOpPPAAABexample-cursor_x%3D>; rel="next"`;
export const DEPENDABOT_NEXT_CURSOR = "Y3Vyc29yOnYyOpPPAAABexample-cursor_x=";
export const CODE_FIRST_LINK = `<https://api.github.com/repositories/123456789/code-scanning/alerts?per_page=1&page=2>; rel="next", <https://api.github.com/repositories/123456789/code-scanning/alerts?per_page=1&page=5>; rel="last"`;
export const CODE_MIDDLE_LINK = `<https://api.github.com/repositories/123456789/code-scanning/alerts?per_page=1&page=2>; rel="prev", <https://api.github.com/repositories/123456789/code-scanning/alerts?per_page=1&page=4>; rel="next", <https://api.github.com/repositories/123456789/code-scanning/alerts?per_page=1&page=5>; rel="last", <https://api.github.com/repositories/123456789/code-scanning/alerts?per_page=1&page=1>; rel="first"`;

const user = (login: string) => ({ login, id: 1, type: "User" });

/** A Dependabot alert as the list and single-alert endpoints return it (open, medium, a patched version available). Replace top-level fields through `over`. */
export function dependabotJson(over: Record<string, unknown> = {}): any {
  return {
    number: 7,
    state: "open",
    dependency: { package: { ecosystem: "npm", name: "widget-parser" }, manifest_path: "app/package-lock.json", version_requirement: "9.0.9", scope: "development", relationship: "transitive" },
    security_advisory: {
      ghsa_id: "GHSA-aaaa-bbbb-cccc",
      cve_id: "CVE-2030-0001",
      summary: "widget-parser has a denial of service via pattern amplification",
      description: "widget-parser expands patterns without a limit.\n\n```js\nparse('**/../**')\n```\n\nAn attacker who controls a pattern can exhaust memory.",
      severity: "medium",
      identifiers: [{ value: "GHSA-aaaa-bbbb-cccc", type: "GHSA" }, { value: "CVE-2030-0001", type: "CVE" }],
      references: [{ url: "https://github.com/acme/widget-parser/security/advisories/GHSA-aaaa-bbbb-cccc" }, { url: "https://nvd.nist.gov/vuln/detail/CVE-2030-0001" }],
      published_at: "2030-01-02T03:04:05Z",
      withdrawn_at: null,
      vulnerabilities: [{ package: { ecosystem: "npm", name: "widget-parser" }, severity: "medium", vulnerable_version_range: "< 11.0.1", first_patched_version: { identifier: "11.0.1" } }],
      cvss: { vector_string: null, score: 0.0 },
      cwes: [{ cwe_id: "CWE-405", name: "Asymmetric Resource Consumption (Amplification)" }],
      classification: "general",
    },
    security_vulnerability: { package: { ecosystem: "npm", name: "widget-parser" }, severity: "medium", vulnerable_version_range: "< 11.0.1", first_patched_version: { identifier: "11.0.1" } },
    url: "https://api.github.com/repos/acme/web/dependabot/alerts/7",
    html_url: "https://github.com/acme/web/security/dependabot/7",
    created_at: "2030-01-03T10:00:00Z",
    updated_at: "2030-01-03T10:00:00Z",
    dismissed_at: null,
    dismissed_by: null,
    dismissed_reason: null,
    dismissed_comment: null,
    fixed_at: null,
    auto_dismissed_at: null,
    ...over,
  };
}

/** A code scanning alert (open; the rule's severity is "warning" but its security severity is "high", as the live CodeQL alert was). */
export function codeScanningJson(over: Record<string, unknown> = {}): any {
  return {
    number: 5,
    created_at: "2030-02-03T04:05:06Z",
    updated_at: "2030-02-03T04:05:06Z",
    url: "https://api.github.com/repos/acme/web/code-scanning/alerts/5",
    html_url: "https://github.com/acme/web/security/code-scanning/5",
    state: "open",
    fixed_at: null,
    dismissed_by: null,
    dismissed_at: null,
    dismissed_reason: null,
    dismissed_comment: null,
    rule: {
      id: "js/incomplete-sanitization",
      severity: "warning",
      security_severity_level: "high",
      description: "Incomplete string escaping or encoding",
      name: "js/incomplete-sanitization",
      tags: ["correctness", "external/cwe/cwe-020", "external/cwe/cwe-080", "external/cwe/cwe-116", "security"],
      full_description: "A string transformer that does not replace or escape all occurrences of a meta-character may be ineffective.",
      help: "# Incomplete string escaping or encoding\nSanitizing untrusted input is a common technique.\n\n## Recommendation\nUse a well-tested sanitization library.",
    },
    tool: { name: "CodeQL", guid: null, version: "2.27.3" },
    most_recent_instance: {
      ref: "refs/heads/main",
      analysis_key: "dynamic/github-code-scanning/codeql:analyze",
      category: "/language:javascript-typescript",
      state: "open",
      commit_sha: "0123456789abcdef0123456789abcdef01234567",
      message: { text: 'This replaces only the first occurrence of "|".' },
      location: { path: "src/escape.ts", start_line: 12, end_line: 14, start_column: 31, end_column: 69 },
      classifications: [],
    },
    instances_url: "https://api.github.com/repos/acme/web/code-scanning/alerts/5/instances",
    ...over,
  };
}

export const SECRET_LITERAL = "ghp_exampleExampleExampleExample0000";

/** A secret scanning alert (open, found in a commit). Shape from the OpenAPI schema secret-scanning-alert: no live repository had one. */
export function secretJson(over: Record<string, unknown> = {}): any {
  return {
    number: 3,
    created_at: "2030-03-04T05:06:07Z",
    updated_at: "2030-03-04T05:06:07Z",
    url: "https://api.github.com/repos/acme/web/secret-scanning/alerts/3",
    html_url: "https://github.com/acme/web/security/secret-scanning/3",
    locations_url: "https://api.github.com/repos/acme/web/secret-scanning/alerts/3/locations",
    state: "open",
    resolution: null,
    resolved_at: null,
    resolved_by: null,
    resolution_comment: null,
    secret_type: "github_personal_access_token",
    secret_type_display_name: "GitHub Personal Access Token",
    secret: SECRET_LITERAL,
    validity: "unknown",
    push_protection_bypassed: false,
    publicly_leaked: false,
    first_location_detected: {
      type: "commit",
      details: { path: "config/settings.json", start_line: 8, end_line: 8, start_column: 15, end_column: 51, blob_sha: "abc123", commit_sha: "0123456789abcdef0123456789abcdef01234567", html_url: "https://github.com/acme/web/blob/0123456/config/settings.json#L8" },
    },
    has_more_locations: false,
    ...over,
  };
}

export const dismissedBy = user("octo-user");

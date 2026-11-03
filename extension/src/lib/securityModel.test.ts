import { describe, it, expect } from "vitest";
import { alertRow, alertDetail, codeScanningSeverity, severityRank, severityPill, codeScanningInstances, secretLocations, filterRows, type AlertRow, type Severity } from "./securityModel";
import { dependabotJson, codeScanningJson, secretJson, dismissedBy, SECRET_LITERAL } from "./securityTestHelpers";

// Module under test: src/lib/securityModel.ts (stubs until the developer implements them). Requirement AS-2: "Normalisers from each source to one `AlertRow {kind, number, severity, title, location, firstDetected, state
// (Open/Dismissed/Fixed/Resolved/AutoDismissed), tool?, ruleId?, url}` and an `AlertDetail` with description (markdown), remediation (first patched version / rule help), references, location plus line range, CWE and CVE ids, and dismissal info."
// The severity requirement: "Normalise them all to one ADO-like scale (Critical / High / Medium / Low / Note, plus "None" for secrets), with the pill colours ADO uses."
// Payload shapes were captured live (see securityTestHelpers.ts); the decisions these tests fix are in the header of securityModel.ts.

const ALL: Severity[] = ["Critical", "High", "Medium", "Low", "Note", "None"];

describe("AS-2: severity on one scale", () => {
  it("Dependabot: critical, high, medium and low become Critical, High, Medium and Low", () => {
    const pairs: [string, Severity][] = [["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]];
    for (const [raw, want] of pairs) {
      const json = dependabotJson({ security_vulnerability: { ...dependabotJson().security_vulnerability, severity: raw } });
      expect(alertRow("dependabot", json).severity, `Expected Dependabot ${raw} to read ${want}`).toBe(want);
    }
  });

  it("Dependabot: falls back to the advisory's severity when the alert has no vulnerability severity", () => {
    const json = dependabotJson({ security_vulnerability: { package: { ecosystem: "npm", name: "widget-parser" } } });
    json.security_advisory.severity = "high";
    expect(alertRow("dependabot", json).severity, "Expected the advisory's high to be used").toBe("High");
  });

  it("code scanning: the security severity level wins over the rule severity (live: a 'warning' rule with level 'high' is High)", () => {
    const rule = codeScanningJson().rule;
    expect(rule.severity, "Fixture check: the live shape pairs severity warning with level high").toBe("warning");
    expect(codeScanningSeverity(rule), "Expected High, not Medium").toBe("High");
    for (const [level, want] of [["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]] as [string, Severity][]) {
      expect(codeScanningSeverity({ severity: "error", security_severity_level: level }), `Expected level ${level} to read ${want}`).toBe(want);
    }
  });

  it("code scanning: with no security level the rule severity maps error to High, warning to Medium and note to Note", () => {
    expect(codeScanningSeverity({ severity: "error" }), "Expected error to be High").toBe("High");
    expect(codeScanningSeverity({ severity: "warning", security_severity_level: null }), "Expected warning to be Medium").toBe("Medium");
    expect(codeScanningSeverity({ severity: "note" }), "Expected note to be Note").toBe("Note");
  });

  it("code scanning: a severity of none, or nothing at all, is None", () => {
    expect(codeScanningSeverity({ severity: "none" }), "Expected none to be None").toBe("None");
    expect(codeScanningSeverity({}), "Expected a missing severity to be None").toBe("None");
  });

  it("secrets have no severity: None", () => {
    expect(alertRow("secret", secretJson()).severity, "Expected a secret alert to be None").toBe("None");
  });

  it("ranks Critical highest and None lowest: 5, 4, 3, 2, 1, 0", () => {
    expect(ALL.map(severityRank), "Expected the ranks 5 down to 0 in scale order").toEqual([5, 4, 3, 2, 1, 0]);
  });

  it("gives every severity a pill with its name, a hex background and foreground, readable contrast, and its own colour", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const seen = new Set<string>();
    for (const s of ALL) {
      const p = severityPill(s);
      expect(p.label, `Expected the ${s} pill to be labelled ${s}`).toBe(s);
      expect(p.background, `Expected a #rrggbb background for ${s}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.foreground, `Expected a #rrggbb foreground for ${s}`).toMatch(/^#[0-9a-f]{6}$/i);
      const [hi, lo] = [luminance(p.background), luminance(p.foreground)].sort((a, b) => b - a);
      expect((hi + 0.05) / (lo + 0.05), `Expected a contrast ratio of at least 4.5 for ${s}`).toBeGreaterThanOrEqual(4.5);
      seen.add(p.background.toLowerCase());
    }
    expect(seen.size, "Expected six different background colours, one per severity").toBe(6);
  });
});

describe("AS-2: Dependabot rows", () => {
  it("maps an open alert to the common row", () => {
    expect(alertRow("dependabot", dependabotJson()), "Expected the Dependabot alert as a row").toEqual({
      kind: "dependabot",
      number: 7,
      severity: "Medium",
      title: "widget-parser has a denial of service via pattern amplification",
      location: "widget-parser",
      manifestPath: "app/package-lock.json",
      firstDetected: new Date("2030-01-03T10:00:00Z"),
      state: "Open",
      ruleId: "GHSA-aaaa-bbbb-cccc",
      url: "https://github.com/acme/web/security/dependabot/7",
    });
  });

  it("carries the manifest path as a separate field and leaves location as the package", () => {
    const row = alertRow("dependabot", dependabotJson({ dependency: { package: { ecosystem: "npm", name: "widget-parser" }, manifest_path: "web/package-lock.json" } }));
    expect(row.manifestPath, "Expected the manifest path for the secondary line").toBe("web/package-lock.json");
    expect(row.location, "Expected location to stay the package name").toBe("widget-parser");
  });
  it("has no manifestPath key when the alert has none, and none for other alert kinds", () => {
    expect(alertRow("dependabot", dependabotJson({ dependency: { package: { name: "widget-parser" } } })), "Expected no manifestPath key").not.toHaveProperty("manifestPath");
    expect(alertRow("code", codeScanningJson()), "Expected no manifestPath on a code scanning row").not.toHaveProperty("manifestPath");
  });

  it("reads the four states: open, dismissed, fixed and auto_dismissed", () => {
    const states: [string, string][] = [["open", "Open"], ["dismissed", "Dismissed"], ["fixed", "Fixed"], ["auto_dismissed", "AutoDismissed"]];
    for (const [raw, want] of states) expect(alertRow("dependabot", dependabotJson({ state: raw })).state, `Expected ${raw} to read ${want}`).toBe(want);
  });
});

describe("AS-2: code scanning rows", () => {
  it("maps an open alert to the common row, with tool and rule", () => {
    expect(alertRow("code", codeScanningJson()), "Expected the code scanning alert as a row").toEqual({
      kind: "code",
      number: 5,
      severity: "High",
      title: "Incomplete string escaping or encoding",
      location: "src/escape.ts:12",
      firstDetected: new Date("2030-02-03T04:05:06Z"),
      state: "Open",
      tool: "CodeQL",
      ruleId: "js/incomplete-sanitization",
      url: "https://github.com/acme/web/security/code-scanning/5",
    });
  });

  it("reads the three states: open, dismissed and fixed", () => {
    for (const [raw, want] of [["open", "Open"], ["dismissed", "Dismissed"], ["fixed", "Fixed"]]) expect(alertRow("code", codeScanningJson({ state: raw })).state, `Expected ${raw} to read ${want}`).toBe(want);
  });

  it("shows the path alone when the instance has no line, and an empty location when it has no location", () => {
    const base = codeScanningJson();
    const noLine = codeScanningJson({ most_recent_instance: { ...base.most_recent_instance, location: { path: "Dockerfile" } } });
    expect(alertRow("code", noLine).location, "Expected the path alone").toBe("Dockerfile");
    const none = codeScanningJson({ most_recent_instance: { ...base.most_recent_instance, location: undefined } });
    expect(alertRow("code", none).location, "Expected an empty location").toBe("");
  });
});

describe("AS-2: secret scanning rows", () => {
  it("maps an open alert to the common row: no severity, the secret type as title and rule, the first location", () => {
    expect(alertRow("secret", secretJson()), "Expected the secret alert as a row").toEqual({
      kind: "secret",
      number: 3,
      severity: "None",
      title: "GitHub Personal Access Token",
      location: "config/settings.json:8",
      firstDetected: new Date("2030-03-04T05:06:07Z"),
      state: "Open",
      ruleId: "github_personal_access_token",
      url: "https://github.com/acme/web/security/secret-scanning/3",
    });
  });

  it("reads open and resolved as Open and Resolved", () => {
    expect(alertRow("secret", secretJson({ state: "resolved", resolution: "revoked" })).state, "Expected resolved to read Resolved").toBe("Resolved");
  });

  it("names the location type when the secret was not found in a commit, and is empty when there is no location", () => {
    expect(alertRow("secret", secretJson({ first_location_detected: { type: "issue_body", details: { html_url: "https://github.com/acme/web/issues/9" } } })).location, "Expected a readable location type").toBe("Issue body");
    expect(alertRow("secret", secretJson({ first_location_detected: null })).location, "Expected an empty location").toBe("");
  });

  it("falls back to the secret type when the display name is blank", () => {
    expect(alertRow("secret", secretJson({ secret_type_display_name: "" })).title, "Expected the type as the title").toBe("github_personal_access_token");
  });

  it("never carries the secret literal into the row", () => {
    expect(JSON.stringify(alertRow("secret", secretJson())), "Expected the secret value not to appear anywhere in the row").not.toContain(SECRET_LITERAL);
  });
});

describe("AS-2: Dependabot detail", () => {
  const d = () => alertDetail("dependabot", dependabotJson());

  it("includes the row fields, and the description as the advisory's markdown", () => {
    expect(d(), "Expected the detail to include its row").toMatchObject(alertRow("dependabot", dependabotJson()));
    expect(d().description, "Expected the advisory description, markdown and all").toBe(dependabotJson().security_advisory.description);
  });

  it("remediation names the package and the first patched version", () => {
    expect(d().remediation, "Expected the patched version in the remediation").toContain("11.0.1");
    expect(d().remediation, "Expected the package in the remediation").toContain("widget-parser");
    expect(d().patchedVersion, "Expected patchedVersion").toBe("11.0.1");
    expect(d().vulnerableRange, "Expected vulnerableRange").toBe("< 11.0.1");
  });

  it("says there is no patched version yet when first_patched_version is null", () => {
    const json = dependabotJson();
    json.security_vulnerability.first_patched_version = null;
    const detail = alertDetail("dependabot", json);
    expect(detail.remediation, "Expected the remediation to say no patched version exists").toMatch(/no (patched|fixed) version/i);
    expect(detail.patchedVersion, "Expected no patchedVersion").toBeUndefined();
  });

  it("lists the advisory's references as URLs, in order", () => {
    expect(d().references, "Expected both reference URLs").toEqual([
      "https://github.com/acme/widget-parser/security/advisories/GHSA-aaaa-bbbb-cccc",
      "https://nvd.nist.gov/vuln/detail/CVE-2030-0001",
    ]);
  });

  it("locates the alert at the manifest path with no line range, and describes the package", () => {
    expect(d().place, "Expected the manifest path").toEqual({ path: "app/package-lock.json" });
    expect(d().package, "Expected the package").toEqual({ ecosystem: "npm", name: "widget-parser", manifestPath: "app/package-lock.json", scope: "development" });
  });

  it("gives the CWE and CVE ids, and no CVE when the advisory has none", () => {
    expect(d().cwes, "Expected CWE-405").toEqual(["CWE-405"]);
    expect(d().cves, "Expected CVE-2030-0001").toEqual(["CVE-2030-0001"]);
    const json = dependabotJson();
    json.security_advisory.cve_id = null;
    expect(alertDetail("dependabot", json).cves, "Expected no CVE ids when cve_id is null").toEqual([]);
  });

  it("an open alert has no dismissal and no fixedAt", () => {
    expect(d().dismissal, "Expected no dismissal on an open alert").toBeUndefined();
    expect(d().fixedAt, "Expected no fixedAt on an open alert").toBeUndefined();
  });

  it("a dismissed alert carries the reason, comment, time and who", () => {
    const detail = alertDetail("dependabot", dependabotJson({ state: "dismissed", dismissed_reason: "tolerable_risk", dismissed_comment: "Dev dependency only", dismissed_at: "2030-01-05T09:00:00Z", dismissed_by: dismissedBy }));
    expect(detail.state, "Expected state Dismissed").toBe("Dismissed");
    expect(detail.dismissal, "Expected the dismissal info").toEqual({ reason: "tolerable_risk", comment: "Dev dependency only", at: new Date("2030-01-05T09:00:00Z"), by: "octo-user" });
  });

  it("an auto-dismissed alert says so and when", () => {
    const detail = alertDetail("dependabot", dependabotJson({ state: "auto_dismissed", auto_dismissed_at: "2030-01-04T00:00:00Z" }));
    expect(detail.state, "Expected state AutoDismissed").toBe("AutoDismissed");
    expect(detail.dismissal, "Expected an auto_dismissed dismissal with its time and no comment").toEqual({ reason: "auto_dismissed", at: new Date("2030-01-04T00:00:00Z") });
  });

  it("a fixed alert carries fixedAt", () => {
    expect(alertDetail("dependabot", dependabotJson({ state: "fixed", fixed_at: "2030-01-06T12:00:00Z" })).fixedAt, "Expected fixedAt").toEqual(new Date("2030-01-06T12:00:00Z"));
  });
});

describe("AS-2: code scanning detail", () => {
  const d = () => alertDetail("code", codeScanningJson());

  it("includes the row fields, the rule's description as markdown text and the instance message", () => {
    expect(d(), "Expected the detail to include its row").toMatchObject(alertRow("code", codeScanningJson()));
    expect(d().description, "Expected the rule's full description").toBe(codeScanningJson().rule.full_description);
    expect(d().message, "Expected the instance message").toBe('This replaces only the first occurrence of "|".');
  });

  it("uses the short description when the rule has no full description", () => {
    const json = codeScanningJson();
    json.rule.full_description = "";
    expect(alertDetail("code", json).description, "Expected the short description as the fallback").toBe("Incomplete string escaping or encoding");
  });

  it("remediation is the rule's help, verbatim", () => {
    expect(d().remediation, "Expected rule.help").toBe(codeScanningJson().rule.help);
  });

  it("locates the alert with its path and line range", () => {
    expect(d().place, "Expected path 12 to 14").toEqual({ path: "src/escape.ts", startLine: 12, endLine: 14 });
  });

  it("turns CodeQL's zero-padded CWE tags into canonical CWE ids, in order, ignoring other tags", () => {
    expect(d().cwes, "Expected CWE-20, CWE-80, CWE-116 (external/cwe/cwe-020 is CWE-20)").toEqual(["CWE-20", "CWE-80", "CWE-116"]);
    expect(d().cves, "Expected no CVE ids for a code scanning alert").toEqual([]);
  });

  it("a dismissed alert carries the reason, comment, time and who", () => {
    const detail = alertDetail("code", codeScanningJson({ state: "dismissed", dismissed_reason: "won't fix", dismissed_comment: "Accepted", dismissed_at: "2030-02-05T09:00:00Z", dismissed_by: dismissedBy }));
    expect(detail.dismissal, "Expected the dismissal info").toEqual({ reason: "won't fix", comment: "Accepted", at: new Date("2030-02-05T09:00:00Z"), by: "octo-user" });
  });

  it("a fixed alert carries fixedAt, an open one neither fixedAt nor a dismissal", () => {
    expect(alertDetail("code", codeScanningJson({ state: "fixed", fixed_at: "2030-02-06T12:00:00Z" })).fixedAt, "Expected fixedAt").toEqual(new Date("2030-02-06T12:00:00Z"));
    expect(d().dismissal, "Expected no dismissal when open").toBeUndefined();
  });
});

describe("AS-2: secret scanning detail", () => {
  const d = () => alertDetail("secret", secretJson());

  it("includes the row fields, text that names the secret type, advice to revoke it, and the validity", () => {
    expect(d(), "Expected the detail to include its row").toMatchObject(alertRow("secret", secretJson()));
    expect(d().description, "Expected the description to name the secret type").toContain("GitHub Personal Access Token");
    expect(d().remediation, "Expected the remediation to say to revoke the secret").toMatch(/revoke/i);
    expect(d().validity, "Expected validity").toBe("unknown");
  });

  it("locates the alert at the first commit location with its line range", () => {
    expect(d().place, "Expected the path and line range").toEqual({ path: "config/settings.json", startLine: 8, endLine: 8 });
  });

  it("has no CWE or CVE ids and no references", () => {
    expect(d().cwes, "Expected no CWE ids").toEqual([]);
    expect(d().cves, "Expected no CVE ids").toEqual([]);
    expect(d().references, "Expected no references").toEqual([]);
  });

  it("a resolved alert carries the resolution, comment, time and who", () => {
    const detail = alertDetail("secret", secretJson({ state: "resolved", resolution: "revoked", resolution_comment: "Rotated", resolved_at: "2030-03-05T09:00:00Z", resolved_by: dismissedBy }));
    expect(detail.state, "Expected state Resolved").toBe("Resolved");
    expect(detail.dismissal, "Expected the resolution as the dismissal info").toEqual({ reason: "revoked", comment: "Rotated", at: new Date("2030-03-05T09:00:00Z"), by: "octo-user" });
  });

  it("never carries the secret literal into the detail", () => {
    expect(JSON.stringify(d()), "Expected the secret value not to appear anywhere in the detail").not.toContain(SECRET_LITERAL);
  });
});

describe("AS-2: instances and locations", () => {
  it("maps code scanning instances to ref, commit, message and location", () => {
    const base = codeScanningJson().most_recent_instance;
    expect(codeScanningInstances([base, { ...base, ref: "refs/heads/dev", location: { path: "src/other.ts", start_line: 3, end_line: 3 } }]), "Expected both instances").toEqual([
      { ref: "refs/heads/main", commitSha: "0123456789abcdef0123456789abcdef01234567", message: 'This replaces only the first occurrence of "|".', location: { path: "src/escape.ts", startLine: 12, endLine: 14 } },
      { ref: "refs/heads/dev", commitSha: "0123456789abcdef0123456789abcdef01234567", message: 'This replaces only the first occurrence of "|".', location: { path: "src/other.ts", startLine: 3, endLine: 3 } },
    ]);
  });

  it("maps secret locations: a commit has its path and lines, another type just its type", () => {
    const locations = [
      { type: "commit", details: { path: "config/settings.json", start_line: 8, end_line: 9, html_url: "https://github.com/acme/web/blob/0123456/config/settings.json#L8-L9" } },
      { type: "issue_body", details: { html_url: "https://github.com/acme/web/issues/9" } },
    ];
    expect(secretLocations(locations), "Expected the commit and the issue body").toEqual([
      { type: "commit", path: "config/settings.json", startLine: 8, endLine: 9, url: "https://github.com/acme/web/blob/0123456/config/settings.json#L8-L9" },
      { type: "issue_body", url: "https://github.com/acme/web/issues/9" },
    ]);
  });

  it("an empty response is an empty list", () => {
    expect(codeScanningInstances([]), "Expected no instances").toEqual([]);
    expect(secretLocations([]), "Expected no locations").toEqual([]);
  });
});

describe("AS-2: filters the server cannot apply", () => {
  const row = (over: Partial<AlertRow>): AlertRow => ({ kind: "code", number: 1, severity: "High", title: "t", location: "", firstDetected: new Date(0), state: "Open", url: "u", ...over });
  const rows = [
    row({ number: 1, title: "SQL injection", location: "src/db.ts:10", ruleId: "js/sql-injection", tool: "CodeQL" }),
    row({ number: 2, title: "Incomplete escaping", location: "src/escape.ts:12", ruleId: "js/incomplete-sanitization", tool: "CodeQL" }),
    row({ number: 3, kind: "dependabot", title: "Denial of service in widget-parser", location: "widget-parser", ruleId: "GHSA-aaaa-bbbb-cccc" }),
  ];
  const numbers = (r: AlertRow[]) => r.map((x) => x.number);

  it("blank filters pass every row in order", () => {
    expect(numbers(filterRows(rows, {})), "Expected all three rows").toEqual([1, 2, 3]);
    expect(numbers(filterRows(rows, { text: "  ", rule: "" })), "Expected blank text and rule to pass everything").toEqual([1, 2, 3]);
  });

  it("text matches the title, location, rule, tool or number, ignoring case", () => {
    expect(numbers(filterRows(rows, { text: "INJECTION" })), "Expected a title match, any case").toEqual([1]);
    expect(numbers(filterRows(rows, { text: "escape.ts" })), "Expected a location match").toEqual([2]);
    expect(numbers(filterRows(rows, { text: "ghsa-aaaa" })), "Expected a rule id match").toEqual([3]);
    expect(numbers(filterRows(rows, { text: "codeql" })), "Expected a tool match").toEqual([1, 2]);
    expect(numbers(filterRows(rows, { text: "#2" })), "Expected a number match").toEqual([2]);
  });

  it("several words must all be found", () => {
    expect(numbers(filterRows(rows, { text: "src escape" })), "Expected only the row holding both words").toEqual([2]);
    expect(numbers(filterRows(rows, { text: "src widget" })), "Expected no row to hold both words").toEqual([]);
  });

  it("rule must equal the row's rule id, ignoring case", () => {
    expect(numbers(filterRows(rows, { rule: "JS/SQL-INJECTION" })), "Expected the exact rule").toEqual([1]);
    expect(numbers(filterRows(rows, { rule: "js/sql" })), "Expected a partial rule id not to match").toEqual([]);
  });

  it("applies text and rule together", () => {
    expect(numbers(filterRows(rows, { rule: "js/incomplete-sanitization", text: "src" })), "Expected both filters to apply").toEqual([2]);
    expect(numbers(filterRows(rows, { rule: "js/incomplete-sanitization", text: "db.ts" })), "Expected no row to pass both").toEqual([]);
  });
});

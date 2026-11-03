// __TN_MOCK__ Batch R2 fixtures: the Advanced Security page's Dependabot, code scanning and secret scanning alerts (generic names throughout).
// Dependabot: 150 alerts (several severities and states) so the open count shows "100+" and the list pages by cursor.
// Code scanning: 12 alerts from two tools on two branches; alert 1 has two instances and a file to snippet. Secrets: 6 alerts with locations.
// Scenarios: dependabotDisabled (403 "Dependabot alerts are disabled..."), codeNoAnalysis (404 "no analysis found"), secretNoPermission (403 "Resource not accessible by integration"),
//   dismissFails (every PATCH answers 403 "Resource not accessible by integration"). In `ok` nothing is refused, secrets included.
import { renderMd } from "./b4";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const fail = (status: number, message: string) => json({ message, documentation_url: "https://docs.github.com/rest", status: String(status) }, status);
const ago = (days: number) => new Date(Date.now() - days * 86400e3).toISOString();
const user = { login: "octo-user", id: 1, type: "User" };

// ---------- Dependabot ----------
const PACKAGES = [["npm", "widget-parser"], ["npm", "tiny-router"], ["pip", "data-mapper"], ["nuget", "Example.Json"], ["npm", "pixel-resize"], ["pip", "report-builder"]] as const;
const SEVERITIES = ["critical", "high", "high", "medium", "medium", "medium", "low"] as const;
const DESCRIPTION = "The library expands patterns without a limit.\n\n## Impact\n\nAn attacker who controls a pattern can exhaust memory.\n\n- Affects all versions before the patched release\n- No workaround exists";

const dependabot: any[] = Array.from({ length: 150 }, (_, k) => {
  const n = 150 - k; // newest first
  const [ecosystem, name] = PACKAGES[n % PACKAGES.length];
  const severity = SEVERITIES[n % SEVERITIES.length];
  const state = n % 17 === 0 ? "dismissed" : n % 11 === 0 ? "fixed" : n % 13 === 0 ? "auto_dismissed" : "open";
  const patched = n % 9 === 0 ? null : { identifier: `${(n % 5) + 2}.0.${n % 4}` };
  const ghsa = `GHSA-${(1000 + n).toString(36).padEnd(4, "x")}-aaaa-bbbb`;
  const pkg = { ecosystem, name };
  return {
    number: n, state,
    dependency: { package: pkg, manifest_path: ecosystem === "npm" ? "app/package-lock.json" : ecosystem === "pip" ? "service/requirements.txt" : "api/Api.csproj", scope: n % 3 ? "runtime" : "development", relationship: "transitive" },
    security_advisory: {
      ghsa_id: ghsa, cve_id: n % 4 ? `CVE-2030-${String(n).padStart(4, "0")}` : null,
      summary: `${name} has ${["a denial of service via pattern amplification", "a prototype pollution flaw", "an unsafe deserialisation path", "a path traversal in archive handling"][n % 4]}`,
      description: DESCRIPTION, severity,
      identifiers: [{ value: ghsa, type: "GHSA" }],
      references: [{ url: `https://github.com/acme/${name}/security/advisories/${ghsa}` }, { url: `https://example.org/advisories/${ghsa}` }],
      cwes: [{ cwe_id: ["CWE-405", "CWE-1321", "CWE-502", "CWE-22"][n % 4], name: "Example weakness" }],
    },
    security_vulnerability: { package: pkg, severity, vulnerable_version_range: patched ? `< ${patched.identifier}` : ">= 0", first_patched_version: patched },
    html_url: `https://github.com/truenorthit/github-repos/security/dependabot/${n}`,
    created_at: ago(1 + n * 2), updated_at: ago(1 + n),
    dismissed_at: state === "dismissed" ? ago(3) : null, dismissed_by: state === "dismissed" ? user : null, dismissed_reason: state === "dismissed" ? "tolerable_risk" : null, dismissed_comment: state === "dismissed" ? "Development dependency only." : null,
    fixed_at: state === "fixed" ? ago(2) : null, auto_dismissed_at: state === "auto_dismissed" ? ago(4) : null,
  };
});

// ---------- code scanning ----------
export const SHA = "0123456789abcdef0123456789abcdef01234567";
const SHA_DEV = "89abcdef0123456789abcdef0123456789abcdef";
const RULES = [
  { id: "js/incomplete-sanitization", description: "Incomplete string escaping or encoding", level: "high", severity: "warning", cwe: "cwe-020" },
  { id: "js/sql-injection", description: "Database query built from user-controlled sources", level: "critical", severity: "error", cwe: "cwe-089" },
  { id: "js/unused-local-variable", description: "Unused variable, import, function or class", level: null, severity: "note", cwe: "" },
  { id: "js/redundant-assignment", description: "Self assignment", level: null, severity: "warning", cwe: "" },
  { id: "js/xss", description: "Client-side cross-site scripting", level: "medium", severity: "error", cwe: "cwe-079" },
];
const FILES = ["src/escape.ts", "src/db.ts", "src/util/greet.ts", "src/render.ts"];
const HELP = "# Incomplete string escaping or encoding\nSanitizing untrusted input is a common technique.\n\n## Recommendation\nUse a well-tested sanitization library.\n\n- Escape every occurrence, not only the first\n- Prefer an allow list";
const instance = (ref: string, sha: string, path: string, line: number) => ({
  ref, analysis_key: "dynamic/github-code-scanning/codeql:analyze", category: "/language:javascript-typescript", state: "open", commit_sha: sha,
  message: { text: 'This replaces only the first occurrence of "|".' }, location: { path, start_line: line, end_line: line + 2, start_column: 5, end_column: 40 }, classifications: [],
});
const codeAlerts: any[] = Array.from({ length: 12 }, (_, k) => {
  const n = 12 - k;
  const rule = RULES[n % RULES.length];
  const state = n === 7 ? "dismissed" : n === 4 ? "fixed" : "open";
  const path = n === 1 ? "src/escape.ts" : FILES[n % FILES.length];
  const line = 8 + (n % 20);
  const tool = n % 5 === 0 ? { name: "ExampleLint", guid: null, version: "1.4.0" } : { name: "CodeQL", guid: null, version: "2.27.3" };
  return {
    number: n, created_at: ago(n * 3), updated_at: ago(n), html_url: `https://github.com/truenorthit/github-repos/security/code-scanning/${n}`, state,
    fixed_at: state === "fixed" ? ago(2) : null, dismissed_by: state === "dismissed" ? user : null, dismissed_at: state === "dismissed" ? ago(3) : null,
    dismissed_reason: state === "dismissed" ? "won't fix" : null, dismissed_comment: state === "dismissed" ? "Accepted for the legacy importer." : null,
    rule: {
      id: rule.id, severity: rule.severity, ...(rule.level ? { security_severity_level: rule.level } : {}), description: rule.description, name: rule.id,
      tags: ["correctness", ...(rule.cwe ? [`external/cwe/${rule.cwe}`] : []), "security"],
      full_description: "A string transformer that does not replace or escape all occurrences of a meta-character may be ineffective.", help: HELP,
    },
    tool,
    most_recent_instance: instance(n % 3 === 0 ? "refs/heads/dev" : "refs/heads/main", n % 3 === 0 ? SHA_DEV : SHA, path, line),
  };
});
const instancesOf = (a: any) =>
  a.number === 1 ? [a.most_recent_instance, instance("refs/heads/dev", SHA_DEV, "src/escape.ts", 22)] : [a.most_recent_instance];

/** The mock source file the snippet is read from: 40 plain lines, with a recognisable line 12. */
const fileText = (path: string) => Array.from({ length: 40 }, (_, i) => (i + 1 === 12 ? `  const safe = value.replace("|", "\\\\|"); // ${path}` : `// line ${i + 1} of ${path}`)).join("\n") + "\n";

// ---------- secret scanning ----------
const LITERAL = "ghp_exampleExampleExampleExample0000"; // only ever sent when hide_secret is not true: the app must never ask for it
const SECRET_TYPES = [["github_personal_access_token", "GitHub Personal Access Token"], ["aws_access_key_id", "Amazon AWS Access Key ID"], ["slack_api_token", "Slack API Token"]] as const;
const secrets: any[] = Array.from({ length: 6 }, (_, k) => {
  const n = 6 - k;
  const [type, display] = SECRET_TYPES[n % SECRET_TYPES.length];
  const state = n === 5 ? "resolved" : "open";
  return {
    number: n, created_at: ago(n * 4), updated_at: ago(n), html_url: `https://github.com/truenorthit/github-repos/security/secret-scanning/${n}`,
    state, resolution: state === "resolved" ? "revoked" : null, resolved_at: state === "resolved" ? ago(1) : null, resolved_by: state === "resolved" ? user : null, resolution_comment: state === "resolved" ? "Rotated." : null,
    secret_type: type, secret_type_display_name: display, validity: ["unknown", "active", "inactive"][n % 3], push_protection_bypassed: false, publicly_leaked: false,
    first_location_detected: n === 3 ? { type: "issue_body", details: { html_url: "https://github.com/truenorthit/github-repos/issues/9" } }
      : { type: "commit", details: { path: `config/settings${n}.json`, start_line: 8, end_line: 8, commit_sha: SHA, html_url: `https://github.com/truenorthit/github-repos/blob/0123456/config/settings${n}.json#L8` } },
    has_more_locations: n === 1,
  };
});
const locationsOf = (a: any) => [
  { type: a.first_location_detected.type, details: a.first_location_detected.details },
  ...(a.has_more_locations ? [{ type: "commit", details: { path: "scripts/deploy.sh", start_line: 3, end_line: 3, html_url: "https://github.com/truenorthit/github-repos/blob/0123456/scripts/deploy.sh#L3" } }, { type: "issue_comment", details: { html_url: "https://github.com/truenorthit/github-repos/issues/9#issuecomment-1" } }] : []),
];

// ---------- the endpoints ----------
const csv = (u: URL, k: string) => (u.searchParams.get(k) ?? "").split(",").filter(Boolean);
const num = (u: URL, k: string, d: number) => Number(u.searchParams.get(k)) || d;
const link = (u: URL, parts: [string, string][]) => ({ link: parts.map(([q, rel]) => `<https://api.github.com/repositories/1${u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, "")}?${q}>; rel="${rel}"`).join(", ") });
const sortList = <T extends { created_at: string; updated_at: string }>(rows: T[], u: URL) => {
  const key = u.searchParams.get("sort") === "updated" ? "updated_at" : "created_at";
  const dir = u.searchParams.get("direction") === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => dir * (Date.parse(a[key]) - Date.parse(b[key])));
};

const CODE_CLOSED = ["dismissed", "fixed"];
const codeSev = (a: any) => (a.rule.security_severity_level ?? { error: "high", warning: "medium", note: "note" }[a.rule.severity as string] ?? "none") as string;

/** The Advanced Security endpoints under /repos/{owner}/{name}. `rest` starts at the first segment after the repo. undefined when it is not one of ours. */
export function securityRest(rest: string, u: URL, init: RequestInit | undefined, sc: string): Response | undefined {
  const m = /^\/(dependabot|code-scanning|secret-scanning)\/alerts(?:\/(\d+)(?:\/(instances|locations))?)?$/.exec(rest);
  if (!m) return undefined;
  const [, source, id, sub] = m;
  const method = init?.method ?? "GET";
  if (source === "dependabot" && sc === "dependabotDisabled") return fail(403, "Dependabot alerts are disabled for this repository.");
  if (source === "code-scanning" && sc === "codeNoAnalysis") return fail(404, "no analysis found");
  if (source === "secret-scanning" && sc === "secretNoPermission") return fail(403, "Resource not accessible by integration");
  const pool = source === "dependabot" ? dependabot : source === "code-scanning" ? codeAlerts : secrets;

  if (id) {
    const a = pool.find((x) => x.number === Number(id));
    if (!a) return fail(404, "Not Found");
    if (method === "PATCH") {
      if (sc === "dismissFails") return fail(403, "Resource not accessible by integration");
      const b = JSON.parse(String(init?.body ?? "{}"));
      if (source === "secret-scanning") Object.assign(a, b.state === "open" ? { state: "open", resolution: null, resolved_at: null, resolved_by: null, resolution_comment: null } : { state: "resolved", resolution: b.resolution, resolution_comment: b.resolution_comment ?? null, resolved_at: new Date().toISOString(), resolved_by: user });
      else Object.assign(a, b.state === "open" ? { state: "open", dismissed_reason: null, dismissed_comment: null, dismissed_at: null, dismissed_by: null, auto_dismissed_at: null } : { state: "dismissed", dismissed_reason: b.dismissed_reason, dismissed_comment: b.dismissed_comment ?? null, dismissed_at: new Date().toISOString(), dismissed_by: user });
      return json(a);
    }
    if (sub === "instances") return json(instancesOf(a));
    if (sub === "locations") return json(locationsOf(a));
    return json(source === "secret-scanning" && u.searchParams.get("hide_secret") !== "true" ? { ...a, secret: LITERAL } : a); // the detail view never asks for the literal, so it is not in the answer
  }

  const per = Math.min(100, num(u, "per_page", 30));
  const state = csv(u, "state");
  const severity = csv(u, "severity");
  let rows = sortList(pool, u);
  if (source === "dependabot") {
    rows = rows.filter((a) => (!state.length || state.includes(a.state)) && (!severity.length || severity.includes(a.security_vulnerability.severity)) && (!csv(u, "ecosystem").length || csv(u, "ecosystem").includes(a.dependency.package.ecosystem)) && (!csv(u, "package").length || csv(u, "package").includes(a.dependency.package.name)));
    const start = u.searchParams.get("after") ? Number(atob(u.searchParams.get("after")!).split(":")[1]) || 0 : 0;
    const end = start + per;
    return json(rows.slice(start, end), 200, end < rows.length ? link(u, [[`per_page=${per}&after=${encodeURIComponent(btoa(`c:${end}`))}`, "next"]]) : {});
  }
  if (source === "code-scanning") {
    const ref = u.searchParams.get("ref"), tool = u.searchParams.get("tool_name");
    rows = rows.filter((a) => (!state.length || (state[0] === "closed" ? CODE_CLOSED.includes(a.state) : state.includes(a.state))) && (!severity.length || severity.includes(codeSev(a))) && (!ref || instancesOf(a).some((i) => i.ref === ref)) && (!tool || a.tool.name === tool));
  } else {
    const resolution = csv(u, "resolution");
    rows = rows.filter((a) => (!state.length || state.includes(a.state)) && (!resolution.length || resolution.includes(a.resolution)) && (!u.searchParams.get("secret_type") || a.secret_type === u.searchParams.get("secret_type")));
    if (u.searchParams.get("hide_secret") !== "true") rows = rows.map((a) => ({ ...a, secret: LITERAL }));
  }
  const page = num(u, "page", 1);
  const last = Math.max(1, Math.ceil(rows.length / per));
  const parts: [string, string][] = [];
  if (page > 1) parts.push([`per_page=${per}&page=${page - 1}`, "prev"]);
  if (page < last) parts.push([`per_page=${per}&page=${page + 1}`, "next"], [`per_page=${per}&page=${last}`, "last"]);
  if (page > 1) parts.push([`per_page=${per}&page=1`, "first"]);
  return json(rows.slice((page - 1) * per, page * per), 200, parts.length ? link(u, parts) : {});
}

/** The file the code snippet is read from (GET .../contents/{path}?ref={sha}); undefined for any other commit. */
export const securityFile = (ref: string, path: string): string | undefined => (ref === SHA || ref === SHA_DEV ? fileText(path) : undefined);

/** POST /markdown: the advisory and rule text as GitHub would render it. */
export const securityMarkdown = (body: string): Response => new Response(renderMd(String(JSON.parse(body || "{}").text ?? "")), { headers: { "Content-Type": "text/html" } });

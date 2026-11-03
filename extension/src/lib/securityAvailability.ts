// R2 AS-3, what an error from an alerts endpoint means for the page. STUBS: the developer implements them. Every function throws "Not implemented".
//
// Real error bodies, captured live with `gh api` on 2026-11-03 (status and message; the body is { message, documentation_url, status }):
//   Dependabot disabled        403  "Dependabot alerts are disabled for this repository."            (TrueNorthIT private repos)   <- 403, not 404
//   Code scanning, no GHAS     403  "Code Security must be enabled for this repository to use code scanning."   (older wording from the requirement: "Advanced Security must be enabled ...")
//   Code scanning, no analysis 404  "no analysis found"                                              (repos with Code Security but no upload)
//   Secret scanning disabled   404  "Secret scanning is disabled on this repository."                <- 404, not 403
//   Bare not found             404  "Not Found"                                                      (a repo that does not exist, and secret scanning on a repo the caller cannot administer)
//   A user token without access 403 "You are not authorized to perform this operation." (Dependabot), "You are not authorized to read code scanning alerts." (code scanning)
// NOT captured live (no GitHub App installation token was available to this session, and the rate limit was not to be burned): the GitHub App's 403 "Resource not accessible by integration" (GitHub's documented wording)
// and the rate limit bodies "API rate limit exceeded for user ID N." and "You have exceeded a secondary rate limit." (documented wording; the extension already detects the primary one by x-ratelimit-remaining: 0, githubBrowse.ts).
//
// The extension's GitHub App has Dependabot alerts and Code scanning alerts permissions but NOT Secret scanning alerts, so a secret scanning 403 "Resource not accessible by integration" is the expected outcome today and its message must say which permission is missing.
//
// Decisions fixed by the tests (securityAvailability.test.ts):
//  - The message wins over the status: GitHub uses 403 for two of the disabled cases and 404 for the third, so the text is read first. Order: rate limit, then disabled, then integration permission, then status.
//  - disabled: /disabled/, /(advanced|code) security must be enabled/ or /no analysis found/ (case-insensitive). The result carries actionUrl `https://github.com/{repo}/settings/security_analysis` and an actionLabel starting "Enable".
//  - noPermission, app: 403 "Resource not accessible by integration" gives a message that says the GitHub App lacks the read permission and names it: "Dependabot alerts", "Code scanning alerts" or "Secret scanning alerts" (repository permissions, read). It names ONLY the permission of the kind asked about.
//  - noPermission, user: any other 403 gives a message about the signed-in user lacking access to the repository's alerts; it does not blame the GitHub App.
//  - notFound: any other 404. error: rate limit (message says the rate limit was reached, `resetAt` passed through), any other status including 0 (network failure), and the unexpected.
//  - rate limit is detected by `rateLimited: true` (what githubBrowse sets from x-ratelimit-remaining: 0), status 429, or a message matching /rate limit/i.
//  - A missing error means ok.
import type { AlertKind } from "./securityTypes";

/** What the data layer must keep of a failed response: the status and the body's `message` (githubBrowse.GhError drops the body's message for reads today, so it has to start keeping it). */
export interface SecurityApiError {
  /** HTTP status; 0 for a network failure. */
  status: number;
  /** The response body's `message`. */
  message?: string;
  /** True when x-ratelimit-remaining was 0. */
  rateLimited?: boolean;
  /** When the rate limit resets. */
  resetAt?: Date;
}

export type AvailabilityState = "ok" | "disabled" | "noPermission" | "notFound" | "error";

export interface Availability {
  state: AvailabilityState;
  /** A sentence for the empty state; "" when ok. */
  message: string;
  /** Disabled only: where to switch the feature on. */
  actionUrl?: string;
  /** Disabled only: the call to action, e.g. "Enable Dependabot alerts". */
  actionLabel?: string;
  /** Rate limit only. */
  resetAt?: Date;
}

const FEATURE: Record<AlertKind, { name: string; permission: string; enable: string }> = {
  dependabot: { name: "Dependabot alerts", permission: "Dependabot alerts", enable: "Enable Dependabot alerts" },
  code: { name: "Code scanning", permission: "Code scanning alerts", enable: "Enable code scanning" },
  secret: { name: "Secret scanning", permission: "Secret scanning alerts", enable: "Enable secret scanning" },
};

/** Classifies the outcome of loading `kind`'s alerts for `repo` ("owner/name"). `error` null or undefined is ok. */
export function availability(kind: AlertKind, error: SecurityApiError | null | undefined, repo: string): Availability {
  if (!error) return { state: "ok", message: "" };
  const f = FEATURE[kind];
  const msg = error.message ?? "";
  if (error.rateLimited || error.status === 429 || /rate limit/i.test(msg)) {
    return { state: "error", message: "GitHub's rate limit has been reached. Try again later.", resetAt: error.resetAt };
  }
  if (/disabled|(advanced|code) security must be enabled|no analysis found/i.test(msg)) {
    const why = /no analysis found/i.test(msg) ? "has no analysis for this repository yet" : "is not enabled for this repository";
    return { state: "disabled", message: `${f.name} ${why}.`, actionUrl: `https://github.com/${repo}/settings/security_analysis`, actionLabel: f.enable };
  }
  if (error.status === 403) {
    if (/resource not accessible by integration/i.test(msg)) {
      return { state: "noPermission", message: `The GitHub App behind this extension does not have read access to ${f.permission}. Ask a GitHub organisation owner to grant it the "${f.permission}" repository permission (read), then accept the change on the installation.` };
    }
    return { state: "noPermission", message: "You do not have access to this repository's security alerts on GitHub. Ask a repository admin for access." };
  }
  if (error.status === 404) return { state: "notFound", message: "GitHub could not find this repository, or you do not have access to its security alerts." };
  return { state: "error", message: `Could not load alerts from GitHub${error.status ? ` (status ${error.status})` : ""}. Try again.` };
}

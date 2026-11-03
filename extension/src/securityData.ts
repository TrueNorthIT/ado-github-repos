// The Advanced Security page's calls to GitHub: the lib/security* request builders sent through githubBrowse, and their answers through the normalisers.
// Nothing here ever holds a secret value: secret requests always carry hide_secret=true (securityRequests.ts) and the normalisers drop the field.
import { GhError, getRaw, rest, restJson } from "./githubBrowse";
import { codeSnippet, type SnippetLine } from "./lib/codeSnippet";
import { alertDetail, alertRow, codeScanningInstances, secretLocations, type AlertDetail, type AlertInstance, type AlertRow, type SecretLocation } from "./lib/securityModel";
import { alertPermission, availability, type SecurityApiError } from "./lib/securityAvailability";
import { countFromFirstPage, countRequest, type AlertCount } from "./lib/securityCounts";
import {
  alertRequest, codeScanningAlertsRequest, codeScanningInstancesRequest, dependabotAlertsRequest, dismissRequest, parsePaging, reopenRequest, secretLocationsRequest, secretScanningAlertsRequest,
} from "./lib/securityRequests";
import type { AlertKind, SecurityFilters } from "./lib/securityTypes";

/** What availability() needs from a failed call. */
export function toApiError(e: unknown): SecurityApiError {
  if (e instanceof GhError) return { status: e.kind === "auth" ? 401 : e.status, message: e.apiMessage, rateLimited: e.kind === "rateLimit", resetAt: e.resetAt };
  return { status: 0 };
}

export interface AlertPage {
  rows: AlertRow[];
  /** What to ask for next (a Dependabot cursor or a page number), or null on the last page. */
  next: { after?: string; page?: number } | null;
}

/** One page of a tab's list. `next` is the previous page's `next`. The text filter is not sent (the page applies it to the loaded rows). */
export async function listAlerts(kind: AlertKind, repo: string, filters: SecurityFilters, next: AlertPage["next"] = null): Promise<AlertPage> {
  const req =
    kind === "dependabot" ? dependabotAlertsRequest(repo, filters, { after: next?.after })
    : kind === "code" ? codeScanningAlertsRequest(repo, filters, { page: next?.page })
    : secretScanningAlertsRequest(repo, filters, { page: next?.page });
  const { body, link } = await restJson<any[]>(req);
  const p = parsePaging(link);
  return {
    rows: body.map((j) => alertRow(kind, j)),
    next: kind === "dependabot" ? (p.nextAfter ? { after: p.nextAfter } : null) : p.nextPage ? { page: p.nextPage } : null,
  };
}

/** The open count for a tab header, or undefined when the call failed (the tab body explains why). */
export async function openCount(kind: AlertKind, repo: string, branch?: string): Promise<AlertCount | undefined> {
  try {
    const { body, link } = await restJson<any[]>(countRequest(kind, repo, { branch }));
    return countFromFirstPage(body.length, link);
  } catch {
    return undefined;
  }
}

export interface DetailData {
  detail: AlertDetail;
  /** Code scanning: where the alert was last seen, with the commit its snippet is read at. */
  latest?: AlertInstance;
  /** Code scanning: every instance. Secrets: see `locations`. */
  instances: AlertInstance[];
  locations: SecretLocation[];
}

export async function loadDetail(kind: AlertKind, repo: string, number: number): Promise<DetailData> {
  const { body } = await restJson<any>(alertRequest(kind, repo, number));
  const out: DetailData = { detail: alertDetail(kind, body), instances: [], locations: [] };
  if (kind === "code") {
    out.latest = body.most_recent_instance ? codeScanningInstances([body.most_recent_instance])[0] : undefined;
    out.instances = await restJson<any[]>(codeScanningInstancesRequest(repo, number, { perPage: 100 })).then((r) => codeScanningInstances(r.body), () => (out.latest ? [out.latest] : []));
  }
  if (kind === "secret") out.locations = await restJson<any[]>(secretLocationsRequest(repo, number, { perPage: 100 })).then((r) => secretLocations(r.body), () => []);
  return out;
}

/** The lines around an instance, read from the file at the instance's commit. Empty when the file or line is gone. */
export async function loadSnippet(repo: string, i: AlertInstance): Promise<SnippetLine[]> {
  const loc = i.location;
  if (!loc?.startLine) return [];
  try {
    return codeSnippet(new TextDecoder().decode(await getRaw(repo, i.commitSha, loc.path)), loc.startLine, loc.endLine);
  } catch {
    return [];
  }
}

// One write at a time: GitHub answers two quick PATCHes to the same alert in either order, so they are queued.
let queue: Promise<unknown> = Promise.resolve();
const serialise = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
};

export const dismissAlert = (kind: AlertKind, repo: string, number: number, reason: string, comment?: string) => serialise(() => rest(dismissRequest(kind, repo, number, reason, comment)));
export const reopenAlert = (kind: AlertKind, repo: string, number: number) => serialise(() => rest(reopenRequest(kind, repo, number)));

/** What to tell the user when dismissing or reopening failed. A 403 is the permission message. */
export function writeErrorText(kind: AlertKind, repo: string, e: unknown): string {
  if (e instanceof Error && !(e instanceof GhError)) return e.message; // the builders' own validation (reason, comment length)
  if (e instanceof GhError && e.kind === "auth") return "Your GitHub sign-in has expired. Sign in again to continue.";
  const a = availability(kind, toApiError(e), repo);
  if (a.state === "noPermission") {
    return /GitHub App/.test(a.message)
      ? `The GitHub App behind this extension does not have write access to ${alertPermission(kind)}. Ask a GitHub organisation owner to grant the "${alertPermission(kind)}" repository permission (read and write).`
      : "You do not have write access to this repository's security alerts on GitHub.";
  }
  return a.state === "error" ? a.message : "Could not update the alert. Try again.";
}

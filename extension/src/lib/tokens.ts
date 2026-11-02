import type { GitHubTokenSet } from "../../../shared/contract";

export type TokenAction = "use" | "refresh" | "signedOut";

/** Refresh when the access token expires within skewMs; signed out if the refresh token is gone too. */
export function tokenAction(t: GitHubTokenSet | null | undefined, now = Date.now(), skewMs = 120000): TokenAction {
  if (!t) return "signedOut";
  if (Date.parse(t.expiresAt) - skewMs > now) return "use";
  return Date.parse(t.refreshTokenExpiresAt) > now ? "refresh" : "signedOut";
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  const ms = Date.parse(iso ?? "");
  if (isNaN(ms)) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  const units: [string, number][] = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, sec] of units) {
    const n = Math.floor(s / sec);
    if (n >= 1) return `${n} ${u}${n > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

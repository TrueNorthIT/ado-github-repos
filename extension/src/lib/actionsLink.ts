// Cross-links into the Actions hub: a GitHub Actions check run's details URL names its run and job
// (https://github.com/{owner}/{repo}/actions/runs/{run}/job/{job}); a job's id is also the check run's id.
import type { ActionsHashState } from "./actionsHash";

/** The Actions hub state for a check's details URL in `repo`, or null when it is not one of that repository's Actions runs. */
export function actionsStateFromUrl(url: string | null | undefined, repo: string): ActionsHashState | null {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/job\/(\d+))?\/?(?:[?#].*)?$/.exec(url ?? "");
  if (!m || m[1].toLowerCase() !== repo.toLowerCase()) return null;
  const run = Number(m[2]);
  const job = m[3] ? Number(m[3]) : undefined;
  if (!Number.isSafeInteger(run) || run <= 0 || (job !== undefined && (!Number.isSafeInteger(job) || job <= 0))) return null;
  return { repo, run, ...(job ? { job } : {}) };
}

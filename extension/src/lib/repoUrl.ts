export interface RepoRef {
  host: string;
  owner: string;
  repo: string;
}

/** Parses https://host/owner/repo[.git][/] . Returns null if it isn't an owner/repo URL. */
export function parseRepoUrl(url: string | undefined | null): RepoRef | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const [owner, repo, ...rest] = u.pathname.split("/").filter(Boolean);
  if (!owner || !repo || rest.length) return null;
  const name = repo.replace(/\.git$/i, "");
  return name ? { host: u.host.toLowerCase(), owner, repo: name } : null;
}

export const repoKey = (r: RepoRef) => `${r.host}/${r.owner}/${r.repo}`.toLowerCase();
export const isGitHubDotCom = (r: RepoRef) => r.host === "github.com";

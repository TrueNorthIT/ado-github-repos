// The Files page's Clone callout and its repository download. Pure, so the URL rules are tested without the page.

export interface CloneUrls {
  https: string;
  ssh: string;
}

const REPO = /^[\w.-]+\/[\w.-]+$/;

/** GitHub's own `clone_url` and `ssh_url` from the repository metadata; each falls back to the github.com form for `repo` when absent. */
export function cloneUrls(repo: string, meta?: { cloneUrl?: string | null; sshUrl?: string | null }): CloneUrls {
  const ok = REPO.test(repo) && repo.split("/").every((s) => s !== "." && s !== "..");
  return {
    https: meta?.cloneUrl || (ok ? `https://github.com/${repo}.git` : ""),
    ssh: meta?.sshUrl || (ok ? `git@github.com:${repo}.git` : ""),
  };
}

/** VS Code's Git extension clone handler (the same link native Repos' "Clone in VS Code" opens). */
export const vscodeCloneUrl = (url: string) => `vscode://vscode.git/clone?url=${encodeURIComponent(url)}`;

/** github.com's archive download for a ref (a branch, tag or commit). The browser downloads it with its own GitHub session, which a
 *  private repository needs. The API's zipball redirects to codeload.github.com, which only allows render.githubusercontent.com
 *  cross-origin (checked 2026-11-03), so the extension cannot fetch the archive itself. */
export function archiveUrl(repo: string, ref: string): string {
  return `https://github.com/${repo}/archive/${ref.split("/").map(encodeURIComponent).join("/")}.zip`;
}

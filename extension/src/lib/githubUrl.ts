/** "Open on GitHub" URL (B-10). */
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** https://github.com/{repo}/tree|blob/{ref}/{path}; repo is "owner/name". Folder or root uses /tree/, a file /blob/. */
export function githubUrl(repo: string, ref: string, path: string, isFile: boolean): string {
  return `https://github.com/${repo}/${isFile ? "blob" : "tree"}/${enc(ref)}${path ? "/" + enc(path) : ""}`;
}

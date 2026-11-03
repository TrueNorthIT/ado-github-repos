// Batch 4, "Open in github.dev" links (VW-12).
//
// Facts: githubUrl.ts builds https://github.com/{repo}/blob/{ref}/{path} with the ref and the path both encoded segment by segment (slashes in a branch name are kept). github.dev serves the same
// repository paths as github.com, so the file URL is that URL on the github.dev host. `repo` is a validated "owner/name".
import { githubUrl } from "./githubUrl";

export const GITHUB_DEV = "https://github.dev";

/** `https://github.dev/${repo}/pull/${number}`. Throws "number must be a positive integer" otherwise. */
export function githubDevPrUrl(repo: string, number: number): string {
  if (!Number.isInteger(number) || number < 1) throw new Error("number must be a positive integer");
  return `${GITHUB_DEV}/${repo}/pull/${number}`;
}

/** `https://github.dev/${repo}/blob/${ref encoded per segment}/${path encoded per segment}`: githubUrl(repo, ref, path, true) on the github.dev host. Throws "path is required" for a blank path. */
export function githubDevFileUrl(repo: string, ref: string, path: string): string {
  if (!path.trim()) throw new Error("path is required");
  return githubUrl(repo, ref, path, true).replace("https://github.com", GITHUB_DEV);
}

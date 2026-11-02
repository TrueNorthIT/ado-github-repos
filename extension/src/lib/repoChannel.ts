// Same-origin channel between the hub frame and the header breadcrumb frame (both served from the publisher's CDN origin).
export const REPO_CHANNEL = "tn-gh-repos";
export type RepoMessage = { type: "hello" } | { type: "repo"; repo?: string };

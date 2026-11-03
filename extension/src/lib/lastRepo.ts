// The repo you last had open, per organisation and project, so a hub opened from the left nav (which carries no hash) opens it rather
// than the project's first connected repo, as native Repos does. Every hub is its own iframe on the same origin, so they share localStorage.
// Storage can be unavailable (private window, blocked site data): reads and writes are best effort.

const key = (org: string, project: string) => `gh-last-repo:${org.toLowerCase()}/${project.toLowerCase()}`;

export function rememberRepo(org: string, project: string, repo: string, store: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  try {
    store?.setItem(key(org, project), repo);
  } catch {
    /* not remembered; the default still works */
  }
}

export function recallRepo(org: string, project: string, store: Pick<Storage, "getItem"> | undefined = safeStorage()): string | undefined {
  try {
    return store?.getItem(key(org, project)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The remembered repo when it is still one of the project's connected repos (matched case-insensitively, returned as connected),
 *  otherwise the first connected one; undefined when there are none. */
export function pickDefaultRepo(connected: string[], remembered: string | undefined): string | undefined {
  const hit = remembered && connected.find((r) => r.toLowerCase() === remembered.toLowerCase());
  return hit || connected[0];
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

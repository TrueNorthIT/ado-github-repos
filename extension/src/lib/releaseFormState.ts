// The release form's decisions (REL-8..13, 18) kept out of the component: starting values, which buttons show, when to confirm, error text.
import type { Release, ReleaseForm } from "./releases";

export const emptyForm = (tagName: string, target: string): ReleaseForm => ({ tagName, target, name: "", body: "", prerelease: false, makeLatest: true });

/** The edit form's starting values. A release with no title reads as its tag name (toRelease fills that in), so the title field starts blank for it. */
export function formFromRelease(r: Pick<Release, "tagName" | "name" | "description" | "isDraft" | "isPrerelease" | "isLatest">, target: string): ReleaseForm {
  return { tagName: r.tagName, target, name: r.name === r.tagName ? "" : r.name, body: r.description, prerelease: r.isPrerelease, makeLatest: r.isDraft ? !r.isPrerelease : r.isLatest };
}

/** Which buttons the form shows. Editing a published release can only be updated; a draft keeps both. */
export function formButtons(mode: "new" | "edit", wasDraft: boolean): { primary: string; saveDraft: boolean } {
  return mode === "edit" && !wasDraft ? { primary: "Update release", saveDraft: false } : { primary: "Publish release", saveDraft: true };
}

/** Generated notes replace the notes box; anything already typed there needs the user's say-so first. */
export const needsOverwriteConfirm = (body: string): boolean => body.trim() !== "";

/** The checkbox's state: a pre-release is never the latest release. */
export const latestChecked = (f: Pick<ReleaseForm, "prerelease" | "makeLatest">): boolean => !f.prerelease && f.makeLatest;

export const sameForm = (a: ReleaseForm, b: ReleaseForm): boolean =>
  a.tagName === b.tagName && a.target === b.target && a.name === b.name && a.body === b.body && a.prerelease === b.prerelease && a.makeLatest === b.makeLatest;

/** What to tell the user when GitHub refuses or the call fails (GhError, read by shape so this file stays free of the data layer). */
export function releaseErrorText(what: string, e: unknown): string {
  const { kind, status, apiMessage } = (e ?? {}) as { kind?: string; status?: number; apiMessage?: string };
  const github = apiMessage ? ` GitHub said: ${apiMessage}` : "";
  if (kind === "auth") return `${what}: your GitHub sign-in has expired. Sign in again; what you entered is kept.`;
  if (kind === "rateLimit") return `${what}: GitHub's rate limit has been reached. Try again later.${github}`;
  if (kind === "access") return `${what}: your GitHub sign-in cannot do this here (${status ?? 403}). You need write access to the repository.${github}`;
  if (kind === "other" && status) return `${what}.${github || ` GitHub answered ${status}.`}`;
  return `${what}: could not reach GitHub. Try again.`;
}

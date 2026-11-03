// Releases (REL-*): the Tags page's Releases tab, release detail, draft/edit form, Tags cross-links and the Files page's latest-release line.
//
// FROZEN CONTRACT (2026-11-03). Types and signatures here are shared by the read-side and write-side work; change them only by agreement.
// Bodies marked "not implemented" are filled in against src/lib/releases.test.ts.
//
// Facts checked live (gh api, 2026-11-03):
//  - GraphQL Release has: author createdAt databaseId description descriptionHTML id isDraft isLatest isPrerelease name publishedAt
//    reactionGroups releaseAssets tagName tagCommit url viewerCanReact. ReleaseAsset has name size downloadCount downloadUrl (no numeric id).
//  - uploads.github.com rejects the CORS preflight (400, no Access-Control-Allow-Origin), so assets cannot be uploaded from the extension:
//    uploads go to GitHub's own edit page (releaseEditUrl). Deleting an asset is REST on api.github.com (CORS ok) and needs the numeric id,
//    which only REST GET /repos/{repo}/releases/{id} gives (restAssetIds).
//  - Fetching an asset in code fails (the API 302s to release-assets.githubusercontent.com, which sends no CORS header). A plain link to
//    downloadUrl works, private repos included, because github.com authorises it with the user's session.
//  - Reactions on releases: GitHub allows only +1, laugh, hooray, heart, rocket, eyes (no -1, no confused).
import type { GraphQlRequest } from "./prQuery";
import type { RestRequest } from "./restRequest";
import type { RawReactionGroup, ReactionContent } from "./reactions";
import type { Person } from "./commitsQuery";

export type ReleaseBadge = "latest" | "prerelease" | "draft";

export interface ReleaseAsset {
  name: string;
  /** Bytes. */
  size: number;
  downloadCount: number;
  /** github.com/.../releases/download/... ; open as a plain link (see header). */
  downloadUrl: string;
}

export interface Release {
  /** GraphQL node id (reactions use it). */
  id: string;
  /** REST id (edit, delete, asset ids). */
  databaseId: number;
  /** The title; GitHub shows the tag name when a release has no name, and so does this (toRelease fills it). */
  name: string;
  tagName: string;
  /** The tag's commit; absent for a draft whose tag does not exist yet. */
  commitOid?: string;
  author?: Person;
  createdAt: Date;
  /** Absent for a draft. */
  publishedAt?: Date;
  isDraft: boolean;
  isPrerelease: boolean;
  isLatest: boolean;
  /** Markdown source (the edit form). */
  description: string;
  /** GitHub's rendered HTML (the list and detail); sanitise like PR descriptions before rendering. */
  descriptionHTML: string;
  assets: ReleaseAsset[];
  reactions: RawReactionGroup[];
  viewerCanReact: boolean;
  /** github.com page for the release. */
  url: string;
}

export interface ReleasesPage {
  releases: Release[];
  hasNextPage: boolean;
  endCursor: string | null;
  /** repository.viewerPermission is ADMIN, MAINTAIN or WRITE (draft/edit/delete controls). */
  viewerCanWrite: boolean;
}

/** GraphQL: one page of releases, newest first (orderBy CREATED_AT DESC), 100 per page, with viewerPermission. */
export function releasesQuery(repo: string, after: string | null = null): GraphQlRequest {
  throw new Error("not implemented");
}

/** Maps the releasesQuery response (`data`) to a page. */
export function toReleasesPage(data: unknown): ReleasesPage {
  throw new Error("not implemented");
}

/** Badges in display order. Draft shows only "draft". A pre-release is never "latest". */
export function releaseBadges(r: Pick<Release, "isDraft" | "isPrerelease" | "isLatest">): ReleaseBadge[] {
  throw new Error("not implemented");
}

/** Case-insensitive match on name or tag name; a blank query returns the list unchanged. Order is kept. */
export function filterReleases<T extends Pick<Release, "name" | "tagName">>(list: T[], query: string): T[] {
  throw new Error("not implemented");
}

export const RELEASES_PAGE_SIZE = 10;

/** Client-side paging. `page` is 1-based and clamped to [1, pageCount]; an empty list is one empty page. */
export function pageReleases<T>(list: T[], page: number, size = RELEASES_PAGE_SIZE): { items: T[]; page: number; pageCount: number } {
  throw new Error("not implemented");
}

/** 1024-based. Bytes as a whole number; KB, MB and GB with one decimal place below 10 of the unit and none at 10 or above:
 *  0 -> "0 B", 512 -> "512 B", 1229 -> "1.2 KB", 2907697 -> "2.8 MB", 15728640 -> "15 MB", 1610612736 -> "1.5 GB". */
export function formatBytes(bytes: number): string {
  throw new Error("not implemented");
}

/** The two archives GitHub lists under every release's assets. */
export function sourceArchives(repo: string, tagName: string): { name: string; url: string }[] {
  throw new Error("not implemented");
}

/** The release for a tag name, or undefined. */
export function releaseForTag<T extends Pick<Release, "tagName">>(list: T[], tagName: string): T | undefined {
  throw new Error("not implemented");
}

/** GraphQL: repository.latestRelease { tagName name publishedAt url } for the Files page line. */
export function latestReleaseQuery(repo: string): GraphQlRequest {
  throw new Error("not implemented");
}

/** Maps latestReleaseQuery's `data`; undefined when the repo has no (non-draft, non-pre-release) latest release. */
export function toLatestRelease(data: unknown): { tagName: string; name: string; publishedAt: Date; url: string } | undefined {
  throw new Error("not implemented");
}

/** GitHub allows these six reactions on a release, in this order. */
export const RELEASE_REACTIONS: ReactionContent[] = ["THUMBS_UP", "LAUGH", "HOORAY", "HEART", "ROCKET", "EYES"];

// ---------- the draft / edit form ----------

export type MakeLatest = "true" | "false" | "legacy";

export interface ReleaseForm {
  tagName: string;
  /** Branch or commit the new tag is created from; ignored when the tag already exists. */
  target: string;
  name: string;
  body: string;
  prerelease: boolean;
  /** "Set as the latest release". Sent as make_latest "true"/"false"; a pre-release always sends "false". */
  makeLatest: boolean;
}

export interface ReleaseFormContext {
  /** Tag names that exist in the repo. */
  existingTags: string[];
  /** Tag names that already have a release (drafts included). */
  releasedTags: string[];
  /** Editing: the release's current tag (it may keep it). Absent for a new release. */
  editingTag?: string;
}

export type ReleaseFormErrors = Partial<Record<"tagName" | "target" | "name", string>>;

/** Errors by field, empty when valid. Tag: required, a valid ref name (refName.ts validateRefName), and not already released unless it is the
 *  tag being edited ("A release for v1.0 already exists"). Target: required only when the tag is new. Name: at most 1024 characters. */
export function validateReleaseForm(form: ReleaseForm, ctx: ReleaseFormContext): ReleaseFormErrors {
  throw new Error("not implemented");
}

/** True when the form's tag does not exist yet (so GitHub will create it from `target` on publish). */
export function isNewTag(form: Pick<ReleaseForm, "tagName">, ctx: Pick<ReleaseFormContext, "existingTags">): boolean {
  throw new Error("not implemented");
}

/** POST /repos/{repo}/releases (create) or PATCH /repos/{repo}/releases/{id} (edit). `draft` is the button pressed (Save draft / Publish).
 *  Body: tag_name, name, body, draft, prerelease, make_latest; target_commitish only when the tag is new. A blank name is sent as "". */
export function saveReleaseRequest(repo: string, form: ReleaseForm, ctx: ReleaseFormContext, opts: { draft: boolean; releaseId?: number }): RestRequest {
  throw new Error("not implemented");
}

/** POST /repos/{repo}/releases/generate-notes with tag_name, target_commitish (new tags only) and previous_tag_name when given. Response: { name, body }. */
export function generateNotesRequest(repo: string, form: Pick<ReleaseForm, "tagName" | "target">, ctx: Pick<ReleaseFormContext, "existingTags">, previousTag?: string): RestRequest {
  throw new Error("not implemented");
}

/** DELETE /repos/{repo}/releases/{id}. The tag is left in place. */
export function deleteReleaseRequest(repo: string, releaseId: number): RestRequest {
  throw new Error("not implemented");
}

/** DELETE /repos/{repo}/releases/assets/{assetId}. */
export function deleteAssetRequest(repo: string, assetId: number): RestRequest {
  throw new Error("not implemented");
}

/** GET /repos/{repo}/releases/{id}: the edit form reads asset ids from it. */
export function getReleaseRequest(repo: string, releaseId: number): RestRequest {
  throw new Error("not implemented");
}

/** Maps the REST release's `assets` to { name -> id }. */
export function restAssetIds(body: unknown): Record<string, number> {
  throw new Error("not implemented");
}

/** GitHub's edit page for a release (where files are attached). The tag is URL-encoded per segment. */
export function releaseEditUrl(repo: string, tagName: string): string {
  throw new Error("not implemented");
}

/** The tag GitHub would offer as "previous tag" for notes: the newest released, non-draft tag other than `tagName`, or undefined. */
export function defaultPreviousTag(list: Pick<Release, "tagName" | "isDraft">[], tagName: string): string | undefined {
  throw new Error("not implemented");
}

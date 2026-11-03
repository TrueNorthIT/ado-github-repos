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
import { validateRefName } from "./refName";

const RELEASE_FIELDS =
  "id databaseId name tagName tagCommit { oid } author { login avatarUrl } createdAt publishedAt isDraft isPrerelease isLatest description descriptionHTML releaseAssets(first: 100) { nodes { name size downloadCount downloadUrl } } reactionGroups { content reactors { totalCount } viewerHasReacted } viewerCanReact url";
const splitRepo = (repo: string) => {
  const [owner = "", name = ""] = repo.split("/");
  return { owner, name };
};
const encodeTag = (tag: string) => tag.split("/").map(encodeURIComponent).join("/");

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
  return {
    query: `query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { viewerPermission releases(first: 100, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) { pageInfo { hasNextPage endCursor } nodes { ${RELEASE_FIELDS} } } } }`,
    variables: { ...splitRepo(repo), after },
  };
}

/** Maps the releasesQuery response (`data`) to a page. */
export function toReleasesPage(data: unknown): ReleasesPage {
  const repo = (data as any)?.repository;
  const rel = repo?.releases;
  const releases: Release[] = (rel?.nodes ?? []).map((n: any): Release => {
    const author: Person | undefined = n.author?.login ? { name: n.author.login, login: n.author.login, avatarUrl: n.author.avatarUrl } : undefined;
    return {
      id: n.id,
      databaseId: n.databaseId,
      name: n.name || n.tagName,
      tagName: n.tagName,
      ...(n.tagCommit?.oid ? { commitOid: n.tagCommit.oid } : {}),
      ...(author ? { author } : {}),
      createdAt: new Date(n.createdAt),
      ...(n.publishedAt ? { publishedAt: new Date(n.publishedAt) } : {}),
      isDraft: !!n.isDraft,
      isPrerelease: !!n.isPrerelease,
      isLatest: !!n.isLatest,
      description: n.description ?? "",
      descriptionHTML: n.descriptionHTML ?? "",
      assets: (n.releaseAssets?.nodes ?? []).map((a: any) => ({ name: a.name, size: a.size, downloadCount: a.downloadCount, downloadUrl: a.downloadUrl })),
      reactions: n.reactionGroups ?? [],
      viewerCanReact: !!n.viewerCanReact,
      url: n.url,
    };
  });
  return {
    releases,
    hasNextPage: !!rel?.pageInfo?.hasNextPage,
    endCursor: rel?.pageInfo?.endCursor ?? null,
    viewerCanWrite: ["ADMIN", "MAINTAIN", "WRITE"].includes(repo?.viewerPermission),
  };
}

/** Badges in display order. Draft shows only "draft". A pre-release is never "latest". */
export function releaseBadges(r: Pick<Release, "isDraft" | "isPrerelease" | "isLatest">): ReleaseBadge[] {
  if (r.isDraft) return ["draft"];
  if (r.isPrerelease) return ["prerelease"];
  return r.isLatest ? ["latest"] : [];
}

/** Case-insensitive match on name or tag name; a blank query returns the list unchanged. Order is kept. */
export function filterReleases<T extends Pick<Release, "name" | "tagName">>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? list.filter((r) => r.name.toLowerCase().includes(q) || r.tagName.toLowerCase().includes(q)) : list;
}

export const RELEASES_PAGE_SIZE = 10;

/** Client-side paging. `page` is 1-based and clamped to [1, pageCount]; an empty list is one empty page. */
export function pageReleases<T>(list: T[], page: number, size = RELEASES_PAGE_SIZE): { items: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  return { items: list.slice((p - 1) * size, p * size), page: p, pageCount };
}

/** 1024-based. Bytes as a whole number; KB, MB and GB with one decimal place below 10 of the unit and none at 10 or above:
 *  0 -> "0 B", 512 -> "512 B", 1229 -> "1.2 KB", 2907697 -> "2.8 MB", 15728640 -> "15 MB", 1610612736 -> "1.5 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let v = bytes;
  let u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < 2);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${["KB", "MB", "GB"][u]}`;
}

/** The two archives GitHub lists under every release's assets. */
export function sourceArchives(repo: string, tagName: string): { name: string; url: string }[] {
  const base = `https://github.com/${repo}/archive/refs/tags/${encodeTag(tagName)}`;
  return [
    { name: "Source code (zip)", url: `${base}.zip` },
    { name: "Source code (tar.gz)", url: `${base}.tar.gz` },
  ];
}

/** The release for a tag name, or undefined. */
export function releaseForTag<T extends Pick<Release, "tagName">>(list: T[], tagName: string): T | undefined {
  return list.find((r) => r.tagName === tagName);
}

/** GraphQL: repository.latestRelease { tagName name publishedAt url } for the Files page line. */
export function latestReleaseQuery(repo: string): GraphQlRequest {
  return {
    query: "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { latestRelease { tagName name publishedAt url } } }",
    variables: splitRepo(repo),
  };
}

/** Maps latestReleaseQuery's `data`; undefined when the repo has no (non-draft, non-pre-release) latest release. */
export function toLatestRelease(data: unknown): { tagName: string; name: string; publishedAt: Date; url: string } | undefined {
  const l = (data as any)?.repository?.latestRelease;
  return l ? { tagName: l.tagName, name: l.name || l.tagName, publishedAt: new Date(l.publishedAt), url: l.url } : undefined;
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
  const errors: ReleaseFormErrors = {};
  const tag = form.tagName.trim();
  const check = validateRefName(tag, []);
  if (!check.ok) errors.tagName = check.reason;
  else if (ctx.releasedTags.includes(tag) && tag !== ctx.editingTag) errors.tagName = `A release for ${tag} already exists`;
  if (!ctx.existingTags.includes(tag) && !form.target.trim()) errors.target = "Choose a branch or commit for the new tag.";
  if (form.name.trim().length > 1024) errors.name = "The title can be at most 1024 characters.";
  return errors;
}

/** True when the form's tag does not exist yet (so GitHub will create it from `target` on publish). */
export function isNewTag(form: Pick<ReleaseForm, "tagName">, ctx: Pick<ReleaseFormContext, "existingTags">): boolean {
  return !ctx.existingTags.includes(form.tagName.trim());
}

/** POST /repos/{repo}/releases (create) or PATCH /repos/{repo}/releases/{id} (edit). `draft` is the button pressed (Save draft / Publish).
 *  Body: tag_name, name, body, draft, prerelease, make_latest; target_commitish only when the tag is new. A blank name is sent as "". */
export function saveReleaseRequest(repo: string, form: ReleaseForm, ctx: ReleaseFormContext, opts: { draft: boolean; releaseId?: number }): RestRequest {
  const body: Record<string, unknown> = { tag_name: form.tagName.trim() };
  if (isNewTag(form, ctx)) body.target_commitish = form.target.trim();
  Object.assign(body, {
    name: form.name.trim(),
    body: form.body,
    draft: opts.draft,
    prerelease: form.prerelease,
    make_latest: form.makeLatest && !form.prerelease ? "true" : "false",
  });
  return opts.releaseId === undefined
    ? { method: "POST", path: `/repos/${repo}/releases`, body }
    : { method: "PATCH", path: `/repos/${repo}/releases/${opts.releaseId}`, body };
}

/** POST /repos/{repo}/releases/generate-notes with tag_name, target_commitish (new tags only) and previous_tag_name when given. Response: { name, body }. */
export function generateNotesRequest(repo: string, form: Pick<ReleaseForm, "tagName" | "target">, ctx: Pick<ReleaseFormContext, "existingTags">, previousTag?: string): RestRequest {
  const body: Record<string, unknown> = { tag_name: form.tagName.trim() };
  if (isNewTag(form, ctx)) body.target_commitish = form.target.trim();
  if (previousTag) body.previous_tag_name = previousTag;
  return { method: "POST", path: `/repos/${repo}/releases/generate-notes`, body };
}

/** DELETE /repos/{repo}/releases/{id}. The tag is left in place. */
export function deleteReleaseRequest(repo: string, releaseId: number): RestRequest {
  return { method: "DELETE", path: `/repos/${repo}/releases/${releaseId}` };
}

/** DELETE /repos/{repo}/releases/assets/{assetId}. */
export function deleteAssetRequest(repo: string, assetId: number): RestRequest {
  return { method: "DELETE", path: `/repos/${repo}/releases/assets/${assetId}` };
}

/** GET /repos/{repo}/releases/{id}: the edit form reads asset ids from it. */
export function getReleaseRequest(repo: string, releaseId: number): RestRequest {
  return { method: "GET", path: `/repos/${repo}/releases/${releaseId}` };
}

/** Maps the REST release's `assets` to { name -> id }. */
export function restAssetIds(body: unknown): Record<string, number> {
  return Object.fromEntries(((body as any)?.assets ?? []).map((a: any) => [a.name, a.id]));
}

/** GitHub's edit page for a release (where files are attached). The tag is URL-encoded per segment. */
export function releaseEditUrl(repo: string, tagName: string): string {
  return `https://github.com/${repo}/releases/edit/${encodeTag(tagName)}`;
}

/** The tag GitHub would offer as "previous tag" for notes: the newest released, non-draft tag other than `tagName`, or undefined. */
export function defaultPreviousTag(list: Pick<Release, "tagName" | "isDraft">[], tagName: string): string | undefined {
  const rest = list.filter((r) => !r.isDraft);
  const i = rest.findIndex((r) => r.tagName === tagName);
  return rest[i + 1]?.tagName;
}

// ---------- the list's filter chips ----------

/** The Releases list's chips. "published" is a release that is neither a draft nor a pre-release. */
export type ReleaseKind = "all" | "published" | "prerelease" | "draft";
export const RELEASE_KINDS: ReleaseKind[] = ["all", "published", "prerelease", "draft"];

export const releaseKindOf = (r: Pick<Release, "isDraft" | "isPrerelease">): Exclude<ReleaseKind, "all"> =>
  r.isDraft ? "draft" : r.isPrerelease ? "prerelease" : "published";

/** The releases of one kind ("all" keeps every release). Order is kept. */
export const filterByKind = <T extends Pick<Release, "isDraft" | "isPrerelease">>(list: T[], kind: ReleaseKind): T[] =>
  kind === "all" ? list : list.filter((r) => releaseKindOf(r) === kind);

/** How many releases each chip would show. */
export function kindCounts(list: Pick<Release, "isDraft" | "isPrerelease">[]): Record<ReleaseKind, number> {
  const c: Record<ReleaseKind, number> = { all: list.length, published: 0, prerelease: 0, draft: 0 };
  for (const r of list) c[releaseKindOf(r)]++;
  return c;
}

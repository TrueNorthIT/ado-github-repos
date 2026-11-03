// GitHub REST calls for the file browser. Every call carries the signed-in user's token.
import { getTokens } from "./auth";
import { tokenAction } from "./lib/tokens";
import { buildQueries, mapResponse, type CommitInfo } from "./lib/commits";
import { listFolder, listFromFolderTree, needsFolderFetch, pathExists, type GitTree, type TreeEntry } from "./lib/tree";
import { detailQuery, listQuery, type GraphQlRequest, type PrTab } from "./lib/prQuery";
import { hasListFilters, listFilterQuery, type ListFilters } from "./lib/prListFilters";
import { toUpdates, updatesQuery, type PrUpdate } from "./lib/prUpdates";
import { mergeViewed, markViewedMutation, toViewedPage, unmarkViewedMutation, viewedFilesQuery, type ViewedPage, type ViewedState } from "./lib/viewedFiles";
import { rangeQuery, toRangeContext, type RangeContext, type RangePrNode } from "./lib/commitRange";
import { toListRow, toPrPage, type PrListNode, type PrListRow, type PrPageData } from "./lib/prModel";
import { fromRestFile, type PrFile } from "./lib/prFiles";
import { actionsDetailQuery, branchesQuery, mergeMessageQuery, type PrActionsNode } from "./lib/actionsQuery";
import { feedQuery, addCommentMutation, replyMutation, resolveMutation, unresolveMutation } from "./lib/feedQuery";
import type { FeedComment, FeedItem, ThreadItem, TimelineNode } from "./lib/feedModel";
import { pendingReplyMutation, pendingReviewQuery, toFeedForViewer, toPendingReview, type PendingAwareThread, type PendingFeedComment, type PendingReview } from "./lib/pendingReview";
import { commentMetaQueries, toCommentMeta, type CommentMeta } from "./lib/commentEdit";
import type { RawReactionGroup } from "./lib/reactions";
import type { GhActor } from "./lib/prModel";
import { commitsByPathQuery, commitsQuery, commitSearchQuery, mapCommitSearch, mapCommitsPage, type CommitRow, type CommitsPage } from "./lib/commitsQuery";
import { commitDetailQuery, comparePath, diffPath, mapCommitDetail, type CommitDetail, type ParentOption } from "./lib/commitDetail";
import { isPushActivity, mapActivity, nextActivityCursor, mapPushHeads, pushExpansion, pushHeadsQuery, pushesPath, type PushHead, type PushRow, type RestActivity } from "./lib/pushes";
import { branchListQuery, createBranchMutation, mapBranchesPage, mapCompare, type AheadBehind, type Branch } from "./lib/branches";
import { createTagMutation, createTagObjectRequest, mapTagsPage, tagListQuery, type TagRow } from "./lib/tags";
import { deleteRefMutation } from "./lib/actionsQuery";
import { mapWriteContext, writeContextQuery, type WriteContext } from "./lib/fileCommit";
import { mapRestCommit, type RestCommit } from "./lib/restCommit";
import { blameQuery, mapBlame, type BlameRange } from "./lib/blame";
import { mergeCompare, type BranchCompare, type RestComparePage } from "./lib/branchCompare";
import { annotationsQuery, type AnnotatedContext } from "./lib/annotations";
import { deploymentsQuery, type DeploymentNode } from "./lib/deployments";
import type { RestRequest } from "./lib/restRequest";
import { commitSignaturesQuery, type CommitSignature } from "./lib/signatures";
import { prEditQuery, type PrEditNode } from "./lib/prEdit";
import { projectItemsQuery, orgProjectsQuery, repoProjectsQuery, mergeProjectOptions, toProjectRows, type ProjectOption, type ProjectRow } from "./lib/projects";
import { teamCandidates, teamSearchQuery, userCandidates, userSearchQuery, type Candidate } from "./lib/reviewerSearch";
import { labelSearchQuery, toLabelOption, type LabelOption } from "./lib/labels";
import { milestoneSearchQuery, sortMilestones, toMilestoneOption, type MilestoneOption } from "./lib/milestones";
import { mapNewPr, newPrQuery, type NewPrCompare } from "./lib/newPr";
import { listedPaths, mapTemplateBlobs, resolveTemplates, templateBlobsQuery, templateListingQuery, type TemplateBlob } from "./lib/prTemplates";
import type { GitHubTokenSet } from "../../shared/contract";

const API = "https://api.github.com";
const MAX_BRANCHES = 1000;

export type GhErrorKind = "auth" | "access" | "rateLimit" | "other";

export class GhError extends Error {
  constructor(public kind: GhErrorKind, public status = 0, public resetAt?: Date, /** GitHub's own message, when a mutation was refused. */ public detail?: string, /** The failed response's body `message` (reads and writes), for the Security page's availability(). */ public apiMessage?: string) {
    super(`${kind} (${status})`);
  }
}

export const repoPath = (repo: string) => `/repos/${repo}`; // repo is a validated "owner/name"
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

let cached: GitHubTokenSet | null = null;
async function token(force = false): Promise<string> {
  if (force || !cached || tokenAction(cached) !== "use") cached = await getTokens();
  if (!cached) throw new GhError("auth", 401);
  return cached.accessToken;
}

/** The `message` of a GitHub error body, or undefined when there is none. */
async function bodyMessage(res: Response): Promise<string | undefined> {
  try {
    const m = (await res.json())?.message;
    return typeof m === "string" ? m : undefined;
  } catch {
    return undefined;
  }
}

async function request(url: string, accept: string, retry = true, body?: string, method = body ? "POST" : "GET"): Promise<Response> {
  let res: Response;
  try {
    // The raw and html representations of a file share one ETag (the blob sha). Through the HTTP cache, an html request after a
    // raw one revalidated, got 304 and was handed the cached raw text, so "Rendered" markdown showed source (seen live in 0.28.0).
    const cache: RequestCache = /\.(raw|html)\b/.test(accept) ? "no-store" : "default";
    res = await fetch(url.startsWith("http") ? url : API + url, { method, body, cache, headers: { Authorization: `Bearer ${await token(!retry)}`, Accept: accept, ...(body && { "Content-Type": "application/json" }) } });
  } catch (e) {
    if (e instanceof GhError) throw e;
    throw new GhError("other");
  }
  if (res.ok) return res;
  if (res.status === 401) {
    if (retry) return request(url, accept, false, body, method); // token may have been revoked or just expired: refresh once
    cached = null;
    throw new GhError("auth", 401);
  }
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    throw new GhError("rateLimit", 403, reset ? new Date(reset * 1000) : undefined, undefined, await bodyMessage(res));
  }
  const apiMessage = await bodyMessage(res);
  if (res.status === 403 || res.status === 404) throw new GhError("access", res.status, undefined, undefined, apiMessage);
  throw new GhError("other", res.status, undefined, undefined, apiMessage);
}

/** A REST call described as data (lib/restRequest.ts). GitHub answers a re-run with 201 and no body, so nothing is parsed. */
export async function rest(r: RestRequest): Promise<void> {
  await request(r.path, "application/vnd.github+json", true, r.body ? JSON.stringify(r.body) : undefined, r.method);
}

/** A GET of a security-alerts request: the parsed body and the Link header (for paging). */
export async function restJson<T = any>(r: RestRequest): Promise<{ body: T; link: string | null }> {
  const res = await request(r.path, "application/vnd.github+json", true, undefined, r.method);
  return { body: await res.json(), link: res.headers.get("link") };
}

/** A write that answers with JSON (release create/update, generate-notes): sends the method and body, parses the reply; 204 gives undefined. */
export async function restSend<T = any>(r: RestRequest): Promise<T> {
  const res = await request(r.path, "application/vnd.github+json", true, r.body ? JSON.stringify(r.body) : undefined, r.method);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** A GET whose answer is not JSON. Job logs and artifact zips 302 to Azure blob storage with a signed URL; both hops send
 *  Access-Control-Allow-Origin: * (checked 2026-11-03) and fetch drops Authorization on the cross-origin hop. (Actions) */
export const restText = async (path: string): Promise<string> => (await request(path, "application/vnd.github+json")).text();
export const restBlob = async (path: string): Promise<Blob> => (await request(path, "application/vnd.github+json")).blob();

const json = async <T>(url: string): Promise<T> => (await request(url, "application/vnd.github+json")).json();

export interface RepoInfo {
  defaultBranch: string;
  isPrivate: boolean;
}

export async function getRepo(repo: string): Promise<RepoInfo> {
  const j = await json<{ default_branch: string; private: boolean }>(repoPath(repo));
  return { defaultBranch: j.default_branch, isPrivate: j.private };
}

/** Branch names, following Link pagination up to 1000. */
export async function listBranches(repo: string): Promise<string[]> {
  const names: string[] = [];
  let url: string | undefined = `${repoPath(repo)}/branches?per_page=100`;
  while (url && names.length < MAX_BRANCHES) {
    const res = await request(url, "application/vnd.github+json");
    names.push(...(await res.json()).map((b: { name: string }) => b.name));
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1];
  }
  return names.slice(0, MAX_BRANCHES);
}

// In-memory caches. ponytail: unbounded; fine for one browsing session, add eviction if memory shows up.
const trees = new Map<string, Promise<GitTree>>();
const folderTrees = new Map<string, Promise<GitTree>>();
const commits = new Map<string, Promise<Record<string, CommitInfo>>>();
const memo = <T>(m: Map<string, Promise<T>>, key: string, make: () => Promise<T>) => {
  let p = m.get(key);
  if (!p) m.set(key, (p = make().catch((e) => (m.delete(key), Promise.reject(e)))));
  return p;
};

/** Drops the cached trees and folder commits of every ref: a file write changes them. */
export const invalidateBrowse = () => {
  trees.clear();
  folderTrees.clear();
  commits.clear();
};

/** The viewer's permission and the head commit of `branch`, for committing a web edit. headOid is null when `branch` is not a branch (a tag or a commit). Not cached: it is the head the edit is made against. */
export async function getWriteContext(repo: string, branch: string): Promise<WriteContext> {
  const [owner, name] = repo.split("/");
  return mapWriteContext(await graphql(writeContextQuery({ owner, name, branch })));
}

export const clearCache = () => {
  trees.clear();
  folderTrees.clear();
  commits.clear();
  prLists.clear();
  prPages.clear();
  prFiles.clear();
  feeds.clear();
  cached = null;
};

/** The recursive tree for a ref (GitHub may truncate it; see needsFolderFetch). Cached per repo and ref. */
export const getTree = (repo: string, ref: string) =>
  memo(trees, `${repo}@${ref}`, () => json<GitTree>(`${repoPath(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`));

const getFolderTree = (repo: string, sha: string) => memo(folderTrees, `${repo}#${sha}`, () => json<GitTree>(`${repoPath(repo)}/git/trees/${sha}`));

/** Children of a folder, from the cached recursive tree or, when that was truncated, folder by folder. */
export async function listDir(repo: string, tree: GitTree, folder: string): Promise<TreeEntry[]> {
  if (!needsFolderFetch(tree, folder)) return listFolder(tree, folder);
  let sha = tree.sha;
  for (const seg of folder.split("/").filter(Boolean)) {
    const item = (await getFolderTree(repo, sha)).tree.find((i) => i.path === seg && i.type === "tree");
    if (!item) return [];
    sha = item.sha;
  }
  return listFromFolderTree(await getFolderTree(repo, sha), folder);
}

const parentOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));

/** The entry at a path (undefined when missing); "" has no entry. */
export async function findEntry(repo: string, tree: GitTree, path: string): Promise<TreeEntry | undefined> {
  return (await listDir(repo, tree, parentOf(path))).find((e) => e.path === path);
}

/** pathExists that also works for truncated trees. */
export async function pathExistsOn(repo: string, tree: GitTree, path: string): Promise<boolean> {
  return needsFolderFetch(tree, path) ? path === "" || !!(await findEntry(repo, tree, path)) : pathExists(tree, path);
}

const contents = (repo: string, ref: string, path: string) => `${repoPath(repo)}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`;

export async function getRaw(repo: string, ref: string, path: string): Promise<ArrayBuffer> {
  return (await request(contents(repo, ref, path), "application/vnd.github.raw")).arrayBuffer();
}

export async function getRenderedMarkdown(repo: string, ref: string, path: string): Promise<string> {
  return (await request(contents(repo, ref, path), "application/vnd.github.html")).text();
}

const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml" };

/** Fetches a file as a Blob (images get a proper type so SVG renders). The caller owns, and must revoke, any object URL made from it. */
export async function getBlob(repo: string, ref: string, path: string): Promise<Blob> {
  const blob = await (await request(contents(repo, ref, path), "application/vnd.github.raw")).blob();
  const mime = IMAGE_MIME[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
  return mime ? new Blob([blob], { type: mime }) : blob;
}

const COMMIT_PARALLEL = 4;

/** Latest commit per entry of a folder (one GraphQL request per 50 entries, a few at a time). Cached per repo, ref and folder. Rejects only when every request failed. */
export const getCommits = (repo: string, ref: string, folder: string, entries: TreeEntry[]) =>
  memo(commits, `${repo}@${ref}:${folder}`, async () => {
    const queue = buildQueries(repo, ref, entries);
    const out: Record<string, CommitInfo> = {};
    let failure: unknown;
    let ok = 0;
    const worker = async () => {
      for (let q = queue.shift(); q; q = queue.shift()) {
        try {
          const res = await request("/graphql", "application/json", true, JSON.stringify({ query: q.query, variables: q.variables }));
          Object.assign(out, mapResponse(await res.json(), q.aliases));
          ok++;
        } catch (e) {
          failure = e;
        }
      }
    };
    await Promise.all(Array.from({ length: COMMIT_PARALLEL }, worker));
    if (!ok && failure) throw failure;
    return out;
  });

// ---------- pull requests (PR-1 to PR-4) ----------

export interface PrListResult {
  /** Active / Completed / Abandoned rows (also a number filter's single row). Empty on Mine. */
  rows: PrListRow[];
  hasNextPage: boolean;
  /** Pass as `cursor` to get the next page. */
  endCursor: string | null;
  /** Mine only. */
  mine?: { created: PrListRow[]; reviewRequested: PrListRow[] };
}

interface GqlConnection { nodes?: (PrListNode | null)[]; pageInfo?: { hasNextPage: boolean; endCursor: string | null } }

/** One GraphQL call through request(), so it shares the 401 refresh-retry and error mapping. A body with errors and no data is an error. */
export async function graphql(q: GraphQlRequest): Promise<any> {
  const body = await (await request("/graphql", "application/json", true, JSON.stringify({ query: q.query, variables: q.variables }))).json();
  if (!body?.data) {
    const notFound = (body?.errors ?? []).some((e: { type?: string }) => e.type === "NOT_FOUND");
    throw new GhError(notFound ? "access" : "other");
  }
  return body;
}

const pageOf = (c: GqlConnection | null | undefined, now: number) => ({
  rows: (c?.nodes ?? []).filter((n): n is PrListNode => !!n?.number).map((n) => toListRow(n, now)),
  hasNextPage: !!c?.pageInfo?.hasNextPage,
  endCursor: c?.pageInfo?.endCursor ?? null,
});

const PR_TTL_MS = 30_000;
const prLists = new Map<string, { at: number; p: Promise<PrListResult> }>();

/**
 * One tab of the PR list for "owner/name". `filter` is the keyword (a number jumps to that PR), `cursor` the previous page's endCursor.
 * Cached 30 s per repo, tab, filter and cursor, so changing tab or filter never shows another key's rows; failures are not cached.
 */
export function listPrs(repo: string, tab: PrTab, filter = "", cursor: string | null = null, filters?: ListFilters): Promise<PrListResult> {
  const withFilters = tab !== "mine" && !!filters && hasListFilters(filters);
  const key = JSON.stringify([repo, tab, tab === "mine" ? "" : filter.trim(), tab === "mine" ? null : cursor, withFilters ? filters : null]);
  const hit = prLists.get(key);
  if (hit && Date.now() - hit.at < PR_TTL_MS) return hit.p;
  const [owner, name] = repo.split("/");
  const p = (async (): Promise<PrListResult> => {
    const reqs = withFilters ? [listFilterQuery(tab as Exclude<PrTab, "mine">, { owner, name, filters: { ...filters, text: filters!.text ?? filter }, after: cursor ?? undefined })] : listQuery(tab, { owner, name, filter, after: cursor ?? undefined });
    const bodies = await Promise.all(reqs.map(graphql));
    const now = Date.now();
    if (tab === "mine") {
      const rowsFor = (section: string) => pageOf(bodies[reqs.findIndex((r) => r.section === section)]?.data?.search, now).rows;
      return { rows: [], hasNextPage: false, endCursor: null, mine: { created: rowsFor("created"), reviewRequested: rowsFor("review-requested") } };
    }
    const d = bodies[0].data;
    if (reqs[0].source === "pullRequest") return { ...pageOf({ nodes: [d.repository?.pullRequest] }, now), hasNextPage: false, endCursor: null };
    return pageOf(reqs[0].source === "search" ? d.search : d.repository?.pullRequests, now);
  })();
  prLists.set(key, { at: Date.now(), p });
  p.catch(() => prLists.get(key)?.p === p && prLists.delete(key));
  return p;
}

/** Drops cached PR pages (Try again). */
export const invalidatePrs = () => (prLists.clear(), newPrCompares.clear(), newPrTemplates.clear());

// ---------- pull request page (PR-5 to PR-9) ----------

const ttl = <T>(m: Map<string, { at: number; p: Promise<T> }>, key: string, make: () => Promise<T>): Promise<T> => {
  const hit = m.get(key);
  if (hit && Date.now() - hit.at < PR_TTL_MS) return hit.p;
  const p = make();
  m.set(key, { at: Date.now(), p });
  p.catch(() => m.get(key)?.p === p && m.delete(key));
  return p;
};
const prPages = new Map<string, { at: number; p: Promise<PrPageData> }>();
const prFiles = new Map<string, { at: number; p: Promise<PrFile[]> }>();
const MAX_PR_FILES = 3000; // GitHub's own cap for this endpoint

/** One PR for the page: GraphQL detail through toPrPage. Cached 30 s per repo and number; failures are not cached. */
export const getPr = (repo: string, number: number) =>
  ttl(prPages, `${repo}#${number}`, async () => {
    const [owner, name] = repo.split("/");
    const node = (await graphql(detailQuery({ owner, name, number }))).data?.repository?.pullRequest;
    if (!node) throw new GhError("access", 404);
    return toPrPage(node);
  });

/** The changed files (REST, paginated up to 3000), with each file's patch. Cached 30 s. */
export const getPrFiles = (repo: string, number: number) =>
  ttl(prFiles, `${repo}#${number}`, async () => {
    const out: PrFile[] = [];
    let url: string | undefined = `${repoPath(repo)}/pulls/${number}/files?per_page=100`;
    while (url && out.length < MAX_PR_FILES) {
      const res = await request(url, "application/vnd.github+json");
      out.push(...(await res.json()).map(fromRestFile));
      url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1];
    }
    return out.slice(0, MAX_PR_FILES);
  });

/** Drops the cached PR page and files (Try again). */
export const invalidatePr = () => (prPages.clear(), prFiles.clear(), updateLists.clear(), rangeContexts.clear());

// ---------- batch 4: updates, viewed files, ranges ----------

const MAX_PAGES = 20;
const updateLists = new Map<string, { at: number; p: Promise<PrUpdate[]> }>();
const rangeContexts = new Map<string, { at: number; p: Promise<RangeContext> }>();

/** VW-1: the PR's updates (pushes), oldest first, from the timeline's commits and force pushes. Cached 30 s. */
export const getUpdates = (repo: string, number: number) =>
  ttl(updateLists, `${repo}#${number}`, async () => {
    const [owner, name] = repo.split("/");
    const timeline: any[] = [];
    let base: string | null = null;
    for (let after: string | undefined, i = 0; i < MAX_PAGES; i++) {
      const pr = (await graphql(updatesQuery({ owner, name, number, after }))).data?.repository?.pullRequest;
      if (!pr) throw new GhError("access", 404);
      base = pr.baseRefOid ?? base;
      timeline.push(...(pr.timelineItems?.nodes ?? []));
      if (!pr.timelineItems?.pageInfo?.hasNextPage) break;
      after = pr.timelineItems.pageInfo.endCursor;
    }
    return toUpdates(timeline, base);
  });

/** VW-3: every changed file's viewed state, and the PR's node id the mutations need. */
export async function getViewedStates(repo: string, number: number): Promise<{ pullRequestId: string; states: Record<string, ViewedState> }> {
  const [owner, name] = repo.split("/");
  const pages: ViewedPage[] = [];
  for (let after: string | undefined, i = 0; i < MAX_PAGES; i++) {
    const page = toViewedPage(await graphql(viewedFilesQuery({ owner, name, number, after })));
    pages.push(page);
    if (!page.hasNextPage || !page.cursor) break;
    after = page.cursor;
  }
  return { pullRequestId: pages[0]?.pullRequestId ?? "", states: mergeViewed(pages) };
}

export const setFileViewed = (pullRequestId: string, path: string, viewed: boolean) => mutate((viewed ? markViewedMutation : unmarkViewedMutation)(pullRequestId, path));

/** VW-6: base, head, every commit with its parents, and the viewer's last review. Cached 30 s. */
export const getRangeContext = (repo: string, number: number) =>
  ttl(rangeContexts, `${repo}#${number}`, async () => {
    const [owner, name] = repo.split("/");
    const pages: RangePrNode[] = [];
    for (let after: string | undefined, i = 0; i < MAX_PAGES; i++) {
      const pr = (await graphql(rangeQuery({ owner, name, number, after }))).data?.repository?.pullRequest;
      if (!pr) throw new GhError("access", 404);
      pages.push(pr);
      if (!pr.commits?.pageInfo?.hasNextPage) break;
      after = pr.commits.pageInfo.endCursor;
    }
    return toRangeContext(pages);
  });

/** VW-6/VW-1: the changed files of a compare (or single-commit) REST path, 100 a page up to GitHub's cap, with each file's patch. */
export const getRangeFiles = (path: string): Promise<PrFile[]> =>
  refTtl(`range|${path}`, async () => {
    const out: PrFile[] = [];
    for (let page = 1; out.length < MAX_DIFF_FILES; page++) {
      const j = await json<{ files?: Parameters<typeof fromRestFile>[0][] }>(`${path}?per_page=100&page=${page}`);
      const files = j.files ?? [];
      out.push(...files.map(fromRestFile));
      if (files.length < 100) break;
    }
    return out;
  });

/** VW-11: a file's bytes from a contents-API path (richDiff.imageSources) as a Blob; the caller owns, and must revoke, any object URL made from it. */
export async function getBlobAt(restPath: string, mimeFrom: string): Promise<Blob> {
  const blob = await (await request(restPath, "application/vnd.github.raw")).blob();
  const mime = IMAGE_MIME[mimeFrom.slice(mimeFrom.lastIndexOf(".") + 1).toLowerCase()];
  return mime ? new Blob([blob], { type: mime }) : blob;
}

// ---------- activity feed (AF-7) ----------

export interface FeedData {
  /** The pull request's node id: addComment's subjectId. */
  prId: string;
  /** The signed-in user, for the composer and reply avatars. */
  viewer: GhActor;
  items: FeedItem[];
  /** Per comment id: raw body, permissions, edit info, minimised state, reactions. Empty when the lookup failed. */
  meta: Record<string, CommentMeta>;
  /** The viewer's unsubmitted review on this PR, if any. */
  pending: PendingReview | null;
  /** The PR's own reactions and what the viewer may do to it. */
  pr: PrExtras;
}

export interface PrExtras {
  viewerCanReact: boolean;
  reactionGroups: RawReactionGroup[];
  viewerCanApplySuggestion: boolean;
}
const NO_EXTRAS: PrExtras = { viewerCanReact: false, reactionGroups: [], viewerCanApplySuggestion: false };
const PR_EXTRAS_QUERY = `query($id: ID!) { node(id: $id) { ... on PullRequest { viewerCanReact viewerCanApplySuggestion reactionGroups { content reactors { totalCount } viewerHasReacted } } } }`;

/** Comment metadata by node id (edit rights, edit history marker, minimised state, reactions). */
export async function loadCommentMeta(ids: string[]): Promise<Record<string, CommentMeta>> {
  const out: Record<string, CommentMeta> = {};
  const pages = await Promise.all(commentMetaQueries(ids).map((r) => graphql(r)));
  for (const page of pages) for (const n of page.data?.nodes ?? []) {
    const m = toCommentMeta(n);
    if (m) out[m.id] = m;
  }
  return out;
}

const commentIds = (items: FeedItem[]) => items.flatMap((i) => (i.kind === "comment" ? [i.id] : i.kind === "thread" ? i.comments.map((c) => c.id) : []));

/** A thread node as addPullRequestReviewThread returns it, as a feed item. */
export function toThreadItem(node: PendingAwareThread, viewerLogin: string): ThreadItem | undefined {
  return toFeedForViewer([], [node], { author: null, createdAt: new Date().toISOString() }, viewerLogin).find((i): i is ThreadItem => i.kind === "thread");
}

const feeds = new Map<string, { at: number; p: Promise<FeedData> }>();
const MAX_FEED_ITEMS = 500;

/** The activity feed: timeline pages (100 each, up to 500 items) plus the review threads, through toFeed. Cached 30 s per repo and number; failures are not cached. */
export const getFeed = (repo: string, number: number) =>
  ttl(feeds, `${repo}#${number}`, async (): Promise<FeedData> => {
    const [owner, name] = repo.split("/");
    const nodes: (TimelineNode | null)[] = [];
    let threads: (PendingAwareThread | null)[] = [];
    let pr: any;
    let viewer: GhActor = { login: "" };
    for (let after: string | undefined; ; ) {
      const d = (await graphql(feedQuery({ owner, name, number, after }))).data;
      const node = d?.repository?.pullRequest;
      if (!node) throw new GhError("access", 404);
      if (!pr) (pr = node), (threads = node.reviewThreads?.nodes ?? []), (viewer = d.viewer ?? viewer);
      nodes.push(...(node.timelineItems?.nodes ?? []));
      const next = node.timelineItems?.pageInfo;
      if (!next?.hasNextPage || !next.endCursor || nodes.length >= MAX_FEED_ITEMS) break;
      after = next.endCursor;
    }
    const items = toFeedForViewer(nodes.slice(0, MAX_FEED_ITEMS), threads, { author: pr.author, createdAt: pr.createdAt }, viewer.login || null);
    // Everything below is extra: if it can't be read (no permission, an older GitHub), the feed still shows and the controls it feeds stay off.
    const [meta, pending, extras] = await Promise.all([
      loadCommentMeta(commentIds(items)).catch(() => ({}) as Record<string, CommentMeta>),
      viewer.login ? graphql(pendingReviewQuery({ owner, name, number, author: viewer.login })).then((b) => toPendingReview(b.data, viewer.login), () => null) : null,
      graphql({ query: PR_EXTRAS_QUERY, variables: { id: pr.id } }).then((b): PrExtras => ({ ...NO_EXTRAS, ...b.data?.node }), () => NO_EXTRAS),
    ]);
    return { prId: pr.id, viewer, items, meta, pending, pr: extras };
  });

/** Drops this PR's cached page and feed, so the header's "x/y comments resolved" and the list's counts refetch. */
export const invalidatePrPage = (repo: string, number: number) => (prPages.delete(`${repo}#${number}`), feeds.delete(`${repo}#${number}`), actionNodes.delete(`${repo}#${number}`), editNodes.delete(`${repo}#${number}`), projectNodes.delete(`${repo}#${number}`));

/** Drops just the cached actions node, so the next getActions asks GitHub again. */
export const invalidateActions = (repo: string, number: number) => void actionNodes.delete(`${repo}#${number}`);

/** A mutation through request(), so it shares the 401 refresh-retry. GitHub reports a missing scope or permission as a 200 with a FORBIDDEN error, which becomes the same "access" 403 as an HTTP 403. */
export async function mutate(q: { query: string; variables: Record<string, unknown> }): Promise<any> {
  const body = await (await request("/graphql", "application/json", true, JSON.stringify(q))).json();
  const errors: { type?: string; message?: string }[] = body?.errors ?? [];
  if (errors.some((e) => e.type === "FORBIDDEN" || /resource not accessible/i.test(e.message ?? ""))) throw new GhError("access", 403);
  if (!body?.data || errors.length) throw new GhError("other", 0, undefined, errors[0]?.message);
  return body.data;
}

const toFeedComment = (n: { id: string; url: string; bodyHTML: string; createdAt: string; author?: GhActor | null }): FeedComment => ({
  id: n.id, author: n.author?.login ?? "ghost", avatarUrl: n.author?.avatarUrl ?? "https://github.com/ghost.png", html: n.bodyHTML, date: new Date(n.createdAt), url: n.url,
});

/** Posts a top-level PR comment; returns the new comment as GitHub rendered it. */
export async function postComment(prId: string, body: string): Promise<FeedComment> {
  return toFeedComment((await mutate(addCommentMutation(prId, body))).addComment.commentEdge.node);
}

/** Replies to a review thread; returns the new comment. */
export async function postReply(threadId: string, body: string): Promise<FeedComment> {
  return toFeedComment((await mutate(replyMutation(threadId, body))).addPullRequestReviewThreadReply.comment);
}

/** Replies inside the viewer's pending review; the comment comes back PENDING. */
export async function postPendingReply(threadId: string, reviewId: string, body: string): Promise<PendingFeedComment> {
  const n = (await mutate(pendingReplyMutation(threadId, reviewId, body))).addPullRequestReviewThreadReply.comment;
  return { ...toFeedComment(n), ...(n.state === "PENDING" ? { pending: true } : {}) };
}

/** Resolves or reactivates a thread; returns the thread's isResolved as GitHub now has it. */
export async function setThreadResolved(threadId: string, resolved: boolean): Promise<boolean> {
  const d = await mutate(resolved ? resolveMutation(threadId) : unresolveMutation(threadId));
  return (resolved ? d.resolveReviewThread : d.unresolveReviewThread).thread.isResolved;
}

// ---------- CI: annotations, deployments, commit signatures (batch 1b) ----------

const annotationNodes = new Map<string, { at: number; p: Promise<AnnotatedContext[]> }>();
/** The head commit's check runs with their first 50 annotations each (one GraphQL call). Cached 30 s. */
export const getAnnotations = (repo: string, number: number) =>
  ttl(annotationNodes, `${repo}#${number}`, async () => {
    const [owner, name] = repo.split("/");
    const node = (await graphql(annotationsQuery({ owner, name, number }))).data?.repository?.pullRequest;
    return ((node?.statusCheckRollup?.contexts?.nodes ?? []) as AnnotatedContext[]).filter((c) => c?.__typename === "CheckRun" || c?.__typename === "StatusContext");
  });

/** The PR's DeployedEvent deployments (last 50). Not cached: the Overview asks again after every action. */
export async function getDeployments(repo: string, number: number): Promise<DeploymentNode[]> {
  const [owner, name] = repo.split("/");
  const nodes: ({ deployment?: DeploymentNode | null } | null)[] = (await graphql(deploymentsQuery({ owner, name, number }))).data?.repository?.pullRequest?.timelineItems?.nodes ?? [];
  return nodes.flatMap((n) => (n?.deployment ? [n.deployment] : []));
}

const signatureMaps = new Map<string, { at: number; p: Promise<Map<string, CommitSignature | null>> }>();
/** Signature of each commit of the PR, by oid (a null value is an unsigned commit). Pages of 100, up to 1000 commits. Cached 30 s. */
export const getCommitSignatures = (repo: string, number: number) =>
  ttl(signatureMaps, `${repo}#${number}`, async () => {
    const [owner, name] = repo.split("/");
    const out = new Map<string, CommitSignature | null>();
    for (let after: string | undefined, i = 0; i < 10; i++) {
      const c = (await graphql(commitSignaturesQuery({ owner, name, number, after }))).data?.repository?.pullRequest?.commits;
      for (const n of c?.nodes ?? []) if (n?.commit?.oid) out.set(n.commit.oid, n.commit.signature ?? null);
      if (!c?.pageInfo?.hasNextPage || !c.pageInfo.endCursor) break;
      after = c.pageInfo.endCursor;
    }
    return out;
  });

// ---------- acting on a pull request (batch 1) ----------

const actionNodes = new Map<string, { at: number; p: Promise<NonNullable<PrActionsNode["repository"]>> }>();

/** What the header and policies card need: repo merge settings, viewer flags, checks. Cached 30 s per PR; invalidatePrPage drops it. */
export const getActions = (repo: string, number: number) =>
  ttl(actionNodes, `${repo}#${number}`, async () => {
    const [owner, name] = repo.split("/");
    const node = (await graphql(actionsDetailQuery({ owner, name, number }))).data?.repository;
    if (!node?.pullRequest) throw new GhError("access", 404);
    return node as NonNullable<PrActionsNode["repository"]>;
  });

/** The repository's branch names (first 100), for Change target branch. */
export async function getBranchNames(repo: string): Promise<string[]> {
  const [owner, name] = repo.split("/");
  const nodes: { name: string }[] = (await graphql(branchesQuery({ owner, name }))).data?.repository?.refs?.nodes ?? [];
  return nodes.map((n) => n.name);
}

/** GitHub's suggested merge commit headline and body per method. Best effort: null when GitHub will not say. */
export async function getMergeMessages(repo: string, number: number): Promise<{ MERGE: { headline: string; body: string }; SQUASH: { headline: string; body: string } } | null> {
  try {
    const [owner, name] = repo.split("/");
    const n = (await graphql(mergeMessageQuery({ owner, name, number }))).data?.repository?.pullRequest;
    if (!n) return null;
    return { MERGE: { headline: n.mergeH ?? "", body: n.mergeB ?? "" }, SQUASH: { headline: n.squashH ?? "", body: n.squashB ?? "" } };
  } catch {
    return null;
  }
}

// ---------- commits, pushes, branches and tags (batch R1) ----------

const refCaches: Map<string, unknown>[] = [];
/** A 30 s cache like the PR pages', dropped as a whole by invalidateRefs() after any branch or tag write. */
const refTtl = (() => {
  const m = new Map<string, { at: number; p: Promise<unknown> }>();
  refCaches.push(m as Map<string, unknown>);
  return <T>(key: string, make: () => Promise<T>): Promise<T> => ttl(m as Map<string, { at: number; p: Promise<T> }>, key, make);
})();

/** Drops cached commit lists, pushes, branches and tags (after a write, or Try again). */
export const invalidateRefs = () => refCaches.forEach((m) => m.clear());

const split = (repo: string) => repo.split("/") as [string, string];

/** One page of history for a ref (50 commits), with PR and check status. `after` is the previous page's endCursor. */
export const listCommits = (repo: string, ref: string, after?: string, path?: string): Promise<CommitsPage> =>
  refTtl(`commits|${repo}|${ref}|${after ?? ""}|${path ?? ""}`, async () => {
    const [owner, name] = split(repo);
    return mapCommitsPage(await graphql(path?.trim() ? commitsByPathQuery({ owner, name, ref, after, path }) : commitsQuery({ owner, name, ref, after })));
  });

/** One commit by SHA prefix for the Commit ID box; null when there is none. */
export async function findCommit(repo: string, sha: string): Promise<CommitRow | null> {
  const [owner, name] = split(repo);
  return mapCommitSearch(await graphql(commitSearchQuery({ owner, name, sha })));
}

/** The commit detail header and Details tab. Throws a 404 "access" error when the commit is not there. */
export const getCommitDetail = (repo: string, sha: string): Promise<CommitDetail> =>
  refTtl(`detail|${repo}|${sha}`, async () => {
    const [owner, name] = split(repo);
    const d = mapCommitDetail(await graphql(commitDetailQuery({ owner, name, sha })));
    if (!d) throw new GhError("access", 404);
    return d;
  });

const MAX_DIFF_FILES = 3000;

/** The changed files of a commit against the chosen parent (REST, 100 a page up to 3000), with each file's patch. */
export const getCommitFiles = (repo: string, sha: string, option: ParentOption): Promise<PrFile[]> =>
  refTtl(`files|${repo}|${sha}|${option.baseSha}`, async () => {
    const out: PrFile[] = [];
    const base = diffPath(repo, sha, option);
    for (let page = 1; out.length < MAX_DIFF_FILES; page++) {
      const j = await json<{ files?: Parameters<typeof fromRestFile>[0][] }>(`${base}?per_page=100&page=${page}`);
      const files = j.files ?? [];
      out.push(...files.map(fromRestFile));
      if (files.length < 100) break;
    }
    return out;
  });

export interface PushesData {
  pushes: PushRow[];
  /** Keyed by the push's `after` oid. */
  heads: Record<string, PushHead>;
  /** Cursor for the next page; undefined on the last. */
  next?: string;
}

/** Pushes to a branch, 30 a page, with the commit each one ended at (headline and merged PR) for its title. `next` is the cursor for the following page. */
export const listPushes = (repo: string, branch: string, opts: { after?: string; actor?: string } = {}): Promise<PushesData> =>
  refTtl(`pushes|${repo}|${branch}|${opts.after ?? ""}|${opts.actor ?? ""}`, async () => {
    const res = await request(pushesPath(repo, branch, 30, opts), "application/vnd.github+json");
    const next = nextActivityCursor(res.headers.get("link"));
    const acts: RestActivity[] = await res.json();
    const pushes = acts.filter((a) => isPushActivity(a.activity_type)).map(mapActivity);
    const shas = [...new Set(pushes.map((p) => p.after))];
    const [owner, name] = split(repo);
    let heads: Record<string, PushHead> = {};
    if (shas.length) {
      try {
        const q = pushHeadsQuery({ owner, name, shas });
        heads = mapPushHeads(await graphql(q), q.aliases);
      } catch {
        /* titles fall back to the short SHA; the list itself still works */
      }
    }
    return { pushes, heads, next };
  });

/** The commits an expanded push lists: before...after, or just the after commit for a new branch. */
export const listPushCommits = (repo: string, push: PushRow): Promise<CommitRow[]> =>
  refTtl(`pushcommits|${repo}|${push.before}|${push.after}`, async () => {
    const x = pushExpansion(repo, push);
    if (x.kind === "single") {
      const one = await findCommit(repo, x.sha);
      return one ? [one] : [];
    }
    const j = await json<{ commits?: RestCommit[] }>(x.path);
    return (j.commits ?? []).map(mapRestCommit).reverse(); // newest first, like every other commit list
  });

export interface BranchesData {
  repoId: string;
  defaultBranch: string | null;
  branches: Branch[];
}

/** Every branch (100 a page up to 1000, alphabetical) with its head commit, check status and open PR. */
export const listAllBranches = (repo: string): Promise<BranchesData> =>
  refTtl(`branches|${repo}`, async () => {
    const [owner, name] = split(repo);
    const out: BranchesData = { repoId: "", defaultBranch: null, branches: [] };
    for (let after: string | undefined; out.branches.length < MAX_BRANCHES; ) {
      const page = mapBranchesPage(await graphql(branchListQuery({ owner, name, after })));
      out.repoId = page.repoId;
      out.defaultBranch = page.defaultBranch;
      out.branches.push(...page.branches);
      if (!page.hasNextPage || !page.endCursor) break;
      after = page.endCursor;
    }
    return out;
  });

/** Ahead and behind of a branch against the default branch (one REST compare; commits are not listed). */
export const getAheadBehind = (repo: string, base: string, branch: string): Promise<AheadBehind> =>
  refTtl(`compare|${repo}|${base}|${branch}`, async () => mapCompare(await json(`${comparePath(repo, base, branch)}?per_page=1`)));

/** The blame ranges of a file at a ref (GraphQL Commit.blame). [] when GitHub has none. Cached 30 s. */
export const getBlame = (repo: string, ref: string, path: string): Promise<BlameRange[]> =>
  refTtl(`blame|${repo}|${ref}|${path}`, async () => {
    const [owner, name] = split(repo);
    return mapBlame(await graphql(blameQuery({ owner, name, ref, path })));
  });

const COMPARE_PAGE = 100;
const MAX_COMPARE_COMMITS = 250; // GitHub's compare endpoint lists at most 250 commits

/** Ahead, behind and the commits of `base...head` (REST compare, 100 a page up to 250). Cached 30 s; invalidateRefs() drops it. */
export const getBranchCompare = (repo: string, base: string, head: string): Promise<BranchCompare> =>
  refTtl(`compare|${repo}|${base}|${head}`, async () => {
    const pages: RestComparePage[] = [];
    for (let page = 1; ; page++) {
      const j = await json<RestComparePage>(`${comparePath(repo, base, head)}?per_page=${COMPARE_PAGE}&page=${page}`);
      pages.push(j);
      const got = pages.reduce((n, p) => n + (p.commits?.length ?? 0), 0);
      if (!j.commits?.length || got >= Math.min(j.total_commits ?? 0, MAX_COMPARE_COMMITS)) break;
    }
    return mergeCompare(pages);
  });

export interface TagsData {
  repoId: string;
  tags: TagRow[];
}

/** Every tag (100 a page up to 1000, newest first). */
export const listAllTags = (repo: string): Promise<TagsData> =>
  refTtl(`tags|${repo}`, async () => {
    const [owner, name] = split(repo);
    const out: TagsData = { repoId: "", tags: [] };
    for (let after: string | undefined; out.tags.length < MAX_BRANCHES; ) {
      const page = mapTagsPage(await graphql(tagListQuery({ owner, name, after })));
      out.repoId = page.repoId;
      out.tags.push(...page.tags);
      if (!page.hasNextPage || !page.endCursor) break;
      after = page.endCursor;
    }
    return out;
  });

let viewer: Promise<string> | undefined;
/** The signed-in GitHub login, for the Mine tab. */
export const getViewerLogin = (): Promise<string> =>
  (viewer ??= graphql({ query: "query { viewer { login } }", variables: {} }).then(
    (b) => b.data.viewer.login as string,
    (e) => ((viewer = undefined), Promise.reject(e))
  ));

/** Creates a branch at a commit; the repository id comes from the list. */
export const createBranch = (repoId: string, name: string, oid: string) => mutate(createBranchMutation(repoId, name, oid));

/** Deletes a branch or tag by its ref node id. */
export const deleteRef = (refId: string) => mutate(deleteRefMutation(refId));

/** Lightweight tag (no message) or annotated tag (message: the tag object first, then the ref). */
export async function createTag(repo: string, repoId: string, p: { name: string; oid: string; message?: string }): Promise<void> {
  let oid = p.oid;
  if (p.message?.trim()) {
    const r = createTagObjectRequest(repo, { tag: p.name, message: p.message, oid });
    const res = await request(r.path, "application/vnd.github+json", true, JSON.stringify(r.body));
    oid = (await res.json()).sha;
  }
  await mutate(createTagMutation(repoId, p.name, oid));
}

// ---------- editing a pull request (batch 2) ----------

const editNodes = new Map<string, { at: number; p: Promise<PrEditNode> }>();
const projectNodes = new Map<string, { at: number; p: Promise<ProjectRow[] | null> }>();

const editNodeOf = async (repo: string, number: number): Promise<PrEditNode> => {
  const [owner, name] = repo.split("/");
  const node = (await graphql(prEditQuery({ owner, name, number }))).data?.repository?.pullRequest;
  if (!node) throw new GhError("access", 404);
  return node;
};

/** What the edit controls need (ids, permissions, code owners, assignees, labels, milestone, linked issues). Cached 30 s; invalidatePrPage drops it. */
export const getEdit = (repo: string, number: number) => ttl(editNodes, `${repo}#${number}`, () => editNodeOf(repo, number));

/** The pull request's current description, read fresh so a body edit never overwrites a newer one. */
export async function getBodyNow(repo: string, number: number): Promise<string> {
  return (await editNodeOf(repo, number)).body ?? "";
}

/** The pull request's Projects (v2) items, or null when GitHub refuses them (the app lacks the Projects permission): the page then hides the section. */
export const getProjectRows = (repo: string, number: number) =>
  ttl(projectNodes, `${repo}#${number}`, async () => {
    const [owner, name] = repo.split("/");
    try {
      const body = await graphql(projectItemsQuery({ owner, name, number }));
      const items = body.data?.repository?.pullRequest?.projectItems;
      return items && !body.errors?.length ? toProjectRows(items.nodes) : null;
    } catch {
      return null;
    }
  });

/** Users and teams for the reviewer picker: two requests, so a user-owned repository (no teams) still gives its users. */
export async function searchReviewers(repo: string, query: string): Promise<Candidate[]> {
  const [owner, name] = repo.split("/");
  const [users, teams] = await Promise.all([
    graphql(userSearchQuery({ owner, name, query })).then((b) => userCandidates(b.data)),
    graphql(teamSearchQuery({ org: owner, query })).then((b) => teamCandidates(b.data), () => [] as Candidate[]),
  ]);
  return [...users, ...teams];
}

export async function searchAssignees(repo: string, query: string): Promise<Candidate[]> {
  const [owner, name] = repo.split("/");
  return userCandidates((await graphql(userSearchQuery({ owner, name, query }))).data);
}

export async function searchLabels(repo: string, query: string): Promise<LabelOption[]> {
  const [owner, name] = repo.split("/");
  return ((await graphql(labelSearchQuery({ owner, name, query }))).data?.repository?.labels?.nodes ?? []).filter(Boolean).map(toLabelOption);
}

export async function searchMilestones(repo: string, query: string): Promise<MilestoneOption[]> {
  const [owner, name] = repo.split("/");
  return sortMilestones(((await graphql(milestoneSearchQuery({ owner, name, query }))).data?.repository?.milestones?.nodes ?? []).filter(Boolean).map(toMilestoneOption));
}

/** Projects the viewer can add this pull request to: the repository's, then the organisation's. Either request may fail alone (no organisation for a user-owned repository). */
export async function searchProjects(repo: string, query: string, attached: string[]): Promise<ProjectOption[]> {
  const [owner, name] = repo.split("/");
  const nodes = (p: Promise<any>, pick: (d: any) => any) => p.then((b) => pick(b.data)?.projectsV2?.nodes ?? null, () => null);
  const [r, o] = await Promise.all([
    nodes(graphql(repoProjectsQuery({ owner, name, query })), (d) => d?.repository),
    nodes(graphql(orgProjectsQuery({ org: owner, query })), (d) => d?.organization),
  ]);
  return mergeProjectOptions(r, o, attached);
}

// ---------- creating a pull request (batch 5) ----------

const newPrCompares = new Map<string, { at: number; p: Promise<NewPrCompare> }>();
const newPrTemplates = new Map<string, { at: number; p: Promise<TemplateBlob[]> }>();
const compareFileSets = new Map<string, { at: number; p: Promise<{ files: PrFile[]; mergeBase: string | null }> }>();

/** The comparison of `head` into `base`, the open PR for the pair and the repository facts, in one request. Cached 30 s per pair; invalidatePrs() drops it. */
export const getNewPrCompare = (repo: string, base: string, head: string) =>
  ttl(newPrCompares, JSON.stringify([repo, base, head]), async () => {
    const [owner, name] = repo.split("/");
    return mapNewPr(await graphql(newPrQuery({ owner, name, base, head })));
  });

/** The PR templates at the base branch, in the order the page offers them (one entry means use it, several mean the user picks). [] when there is none. */
export const getPrTemplates = (repo: string, base: string) =>
  ttl(newPrTemplates, JSON.stringify([repo, base]), async () => {
    const [owner, name] = repo.split("/");
    const r = resolveTemplates(listedPaths(await graphql(templateListingQuery({ owner, name, base }))));
    const paths = r.kind === "none" ? [] : r.kind === "single" ? [r.path] : r.paths;
    return paths.length ? mapTemplateBlobs(await graphql(templateBlobsQuery({ owner, name, base }, paths)), paths) : [];
  });

/** The changed files of base...head and the merge base (the left side of every diff), 100 files a page up to GitHub's cap. Cached 30 s. */
export const getCompareFiles = (repo: string, base: string, head: string) =>
  ttl(compareFileSets, JSON.stringify([repo, base, head]), async () => {
    const out: PrFile[] = [];
    let mergeBase: string | null = null;
    for (let page = 1; out.length < MAX_DIFF_FILES; page++) {
      const j = await json<{ merge_base_commit?: { sha?: string }; files?: Parameters<typeof fromRestFile>[0][] }>(`${comparePath(repo, base, head)}?per_page=100&page=${page}`);
      mergeBase = j.merge_base_commit?.sha ?? mergeBase;
      const files = j.files ?? [];
      out.push(...files.map(fromRestFile));
      if (files.length < 100) break;
    }
    return { files: out, mergeBase };
  });

/** GitHub-flavoured markdown rendered to HTML by GitHub (POST /markdown), for the Security page's advisory text. Run the result through prepareMarkdownHtml. */
export async function renderMarkdown(repo: string, text: string): Promise<string> {
  return (await request("/markdown", "text/html", true, JSON.stringify({ text, mode: "gfm", context: repo }))).text();
}

// ---------- releases (REL) ----------

import { deleteReleaseRequest, latestReleaseQuery, releasesQuery, toLatestRelease, toReleasesPage, type ReleasesPage } from "./lib/releases";
import { reactionMutation, type ReactionContent } from "./lib/reactions";

const releaseSets = new Map<string, { at: number; p: Promise<ReleasesPage> }>();
const latestReleases = new Map<string, { at: number; p: Promise<ReturnType<typeof toLatestRelease>> }>();

/** Drops the cached releases and latest release, after a write (the form's onDone, delete) or Try again. */
export const invalidateReleases = () => (releaseSets.clear(), latestReleases.clear());

/** Every release (100 a page, newest first), cached 30 s like the other lists. */
export const listAllReleases = (repo: string): Promise<ReleasesPage> =>
  ttl(releaseSets, repo, async () => {
    const out: ReleasesPage = { releases: [], hasNextPage: false, endCursor: null, viewerCanWrite: false };
    for (let after: string | null = null; ; ) {
      const page = toReleasesPage((await graphql(releasesQuery(repo, after))).data);
      out.releases.push(...page.releases);
      out.viewerCanWrite = page.viewerCanWrite;
      if (!page.hasNextPage || !page.endCursor) break;
      after = page.endCursor;
    }
    return out;
  });

/** The repo's latest release for the Files page line; undefined when there is none. */
export const getLatestRelease = (repo: string) => ttl(latestReleases, repo, async () => toLatestRelease((await graphql(latestReleaseQuery(repo))).data));

/** Adds or removes the viewer's reaction on a release (its GraphQL node id). */
export const releaseReact = (subjectId: string, content: ReactionContent, add: boolean) => mutate(reactionMutation(subjectId, content, add));

/** Deletes a release; its tag stays. */
export const deleteRelease = async (repo: string, releaseId: number) => {
  await rest(deleteReleaseRequest(repo, releaseId));
  invalidateReleases();
};

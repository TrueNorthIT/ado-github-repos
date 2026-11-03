// GitHub REST calls for the file browser. Every call carries the signed-in user's token.
import { getTokens } from "./auth";
import { tokenAction } from "./lib/tokens";
import { buildQueries, mapResponse, type CommitInfo } from "./lib/commits";
import { listFolder, listFromFolderTree, needsFolderFetch, pathExists, type GitTree, type TreeEntry } from "./lib/tree";
import { detailQuery, listQuery, type GraphQlRequest, type PrTab } from "./lib/prQuery";
import { toListRow, toPrPage, type PrListNode, type PrListRow, type PrPageData } from "./lib/prModel";
import { fromRestFile, type PrFile } from "./lib/prFiles";
import { actionsDetailQuery, branchesQuery, mergeMessageQuery, type PrActionsNode } from "./lib/actionsQuery";
import { feedQuery, addCommentMutation, replyMutation, resolveMutation, unresolveMutation } from "./lib/feedQuery";
import { toFeed, type FeedComment, type FeedItem, type ReviewThreadNode, type TimelineNode } from "./lib/feedModel";
import type { GhActor } from "./lib/prModel";
import { commitsQuery, commitSearchQuery, mapCommitSearch, mapCommitsPage, type CommitRow, type CommitsPage } from "./lib/commitsQuery";
import { commitDetailQuery, comparePath, diffPath, mapCommitDetail, type CommitDetail, type ParentOption } from "./lib/commitDetail";
import { isPushActivity, mapActivity, mapPushHeads, pushExpansion, pushHeadsQuery, pushesPath, type PushHead, type PushRow, type RestActivity } from "./lib/pushes";
import { branchListQuery, createBranchMutation, mapBranchesPage, mapCompare, type AheadBehind, type Branch } from "./lib/branches";
import { createTagMutation, createTagObjectRequest, mapTagsPage, tagListQuery, type TagRow } from "./lib/tags";
import { deleteRefMutation } from "./lib/actionsQuery";
import { mapRestCommit, type RestCommit } from "./lib/restCommit";
import type { GitHubTokenSet } from "../../shared/contract";

const API = "https://api.github.com";
const MAX_BRANCHES = 1000;

export type GhErrorKind = "auth" | "access" | "rateLimit" | "other";

export class GhError extends Error {
  constructor(public kind: GhErrorKind, public status = 0, public resetAt?: Date, /** GitHub's own message, when a mutation was refused. */ public detail?: string) {
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

async function request(url: string, accept: string, retry = true, body?: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url.startsWith("http") ? url : API + url, { method: body ? "POST" : "GET", body, headers: { Authorization: `Bearer ${await token(!retry)}`, Accept: accept, ...(body && { "Content-Type": "application/json" }) } });
  } catch (e) {
    if (e instanceof GhError) throw e;
    throw new GhError("other");
  }
  if (res.ok) return res;
  if (res.status === 401) {
    if (retry) return request(url, accept, false, body); // token may have been revoked or just expired: refresh once
    cached = null;
    throw new GhError("auth", 401);
  }
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    throw new GhError("rateLimit", 403, reset ? new Date(reset * 1000) : undefined);
  }
  if (res.status === 403 || res.status === 404) throw new GhError("access", res.status);
  throw new GhError("other", res.status);
}

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
export function listPrs(repo: string, tab: PrTab, filter = "", cursor: string | null = null): Promise<PrListResult> {
  const key = JSON.stringify([repo, tab, tab === "mine" ? "" : filter.trim(), tab === "mine" ? null : cursor]);
  const hit = prLists.get(key);
  if (hit && Date.now() - hit.at < PR_TTL_MS) return hit.p;
  const [owner, name] = repo.split("/");
  const p = (async (): Promise<PrListResult> => {
    const reqs = listQuery(tab, { owner, name, filter, after: cursor ?? undefined });
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
export const invalidatePrs = () => prLists.clear();

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
export const invalidatePr = () => (prPages.clear(), prFiles.clear());

// ---------- activity feed (AF-7) ----------

export interface FeedData {
  /** The pull request's node id: addComment's subjectId. */
  prId: string;
  /** The signed-in user, for the composer and reply avatars. */
  viewer: GhActor;
  items: FeedItem[];
}

const feeds = new Map<string, { at: number; p: Promise<FeedData> }>();
const MAX_FEED_ITEMS = 500;

/** The activity feed: timeline pages (100 each, up to 500 items) plus the review threads, through toFeed. Cached 30 s per repo and number; failures are not cached. */
export const getFeed = (repo: string, number: number) =>
  ttl(feeds, `${repo}#${number}`, async (): Promise<FeedData> => {
    const [owner, name] = repo.split("/");
    const nodes: (TimelineNode | null)[] = [];
    let threads: (ReviewThreadNode | null)[] = [];
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
    return { prId: pr.id, viewer, items: toFeed(nodes.slice(0, MAX_FEED_ITEMS), threads, { author: pr.author, createdAt: pr.createdAt }, Date.now()) };
  });

/** Drops this PR's cached page and feed, so the header's "x/y comments resolved" and the list's counts refetch. */
export const invalidatePrPage = (repo: string, number: number) => (prPages.delete(`${repo}#${number}`), feeds.delete(`${repo}#${number}`), actionNodes.delete(`${repo}#${number}`));

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

/** Resolves or reactivates a thread; returns the thread's isResolved as GitHub now has it. */
export async function setThreadResolved(threadId: string, resolved: boolean): Promise<boolean> {
  const d = await mutate(resolved ? resolveMutation(threadId) : unresolveMutation(threadId));
  return (resolved ? d.resolveReviewThread : d.unresolveReviewThread).thread.isResolved;
}

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
export const listCommits = (repo: string, ref: string, after?: string): Promise<CommitsPage> =>
  refTtl(`commits|${repo}|${ref}|${after ?? ""}`, async () => {
    const [owner, name] = split(repo);
    return mapCommitsPage(await graphql(commitsQuery({ owner, name, ref, after })));
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
}

/** The latest pushes to a branch (30), with the commit each one ended at (headline and merged PR) for its title. */
export const listPushes = (repo: string, branch: string): Promise<PushesData> =>
  refTtl(`pushes|${repo}|${branch}`, async () => {
    const acts = await json<RestActivity[]>(pushesPath(repo, branch));
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
    return { pushes, heads };
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

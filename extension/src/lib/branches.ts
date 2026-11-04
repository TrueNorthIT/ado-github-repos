// Branches page logic: list query, mapper, folder tree, tabs, behind/ahead and actions (B-1..B-5).
// Rule shared with feedQuery.ts / actionsQuery.ts: every caller-supplied value travels in `variables`, never in the query text.
// Deleting a branch reuses deleteRefMutation(refId) from actionsQuery.ts, with Branch.id as the ref node id.
import type { GraphQlRequest } from "./prQuery";
import type { RestRequest } from "./restRequest";
import { mapCheckState, mapPerson, type CheckStatus, type GqlActor, type Person } from "./commitsQuery";

export interface GqlBranchNode {
  /** Ref node id (what deleteRef needs). */
  id: string;
  name: string;
  branchProtectionRule?: { id: string } | null;
  associatedPullRequests?: { nodes: { number: number; title: string }[] } | null;
  target?: { oid: string; authoredDate: string; author?: GqlActor | null; statusCheckRollup?: { state: string } | null } | null;
}

export interface Branch {
  id: string;
  name: string;
  sha: string;
  shortSha: string;
  author: Person;
  authoredDate: Date;
  status: CheckStatus | null;
  /** Number of the first OPEN PR from this branch, else null. */
  prNumber: number | null;
  /** A branchProtectionRule applies. */
  protected: boolean;
  isDefault: boolean;
}

export interface BranchesPage {
  /** repository.id, the repositoryId createRef needs. */
  repoId: string;
  /** defaultBranchRef.name, null for an empty repository. */
  defaultBranch: string | null;
  branches: Branch[];
  hasNextPage: boolean;
  endCursor: string | null;
}

/**
 * `refs(refPrefix: "refs/heads/", first: 100, after: $after, orderBy: {field: ALPHABETICAL, direction: ASC})` plus
 * repository id and defaultBranchRef. Variables { owner, name, after }.
 * TAG_COMMIT_DATE exists in RefOrderField but, live, it orders refs/heads/ exactly as ALPHABETICAL does (DESC is Z to A),
 * so it gives no recency order for branches: ALPHABETICAL ASC is used and says what it is.
 */
export function branchListQuery(p: { owner: string; name: string; after?: string }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { id defaultBranchRef { name } refs(refPrefix: "refs/heads/", first: 100, after: $after, orderBy: {field: ALPHABETICAL, direction: ASC}) { pageInfo { hasNextPage endCursor } nodes { id name branchProtectionRule { id } associatedPullRequests(states: OPEN, first: 1) { nodes { number title } } target { ... on Commit { oid authoredDate author { name email user { login avatarUrl } } statusCheckRollup { state } } } } } } }`,
    variables: { owner: p.owner, name: p.name, after: p.after ?? null },
  };
}

/** Maps a branchListQuery body; ghost fallback as mapPerson in commitsQuery.ts. */
export function mapBranchesPage(body: any): BranchesPage {
  const r = body?.data?.repository;
  const def: string | null = r?.defaultBranchRef?.name ?? null;
  return {
    repoId: r?.id ?? "",
    defaultBranch: def,
    branches: (r?.refs?.nodes ?? []).map((n: GqlBranchNode): Branch => {
      const t = n.target;
      const sha = t?.oid ?? "";
      return {
        id: n.id,
        name: n.name,
        sha,
        shortSha: sha.slice(0, 8),
        author: mapPerson(t?.author),
        authoredDate: new Date(t?.authoredDate ?? 0),
        status: mapCheckState(t?.statusCheckRollup?.state),
        prNumber: n.associatedPullRequests?.nodes?.[0]?.number ?? null,
        protected: !!n.branchProtectionRule,
        isDefault: n.name === def,
      };
    }),
    hasNextPage: !!r?.refs?.pageInfo?.hasNextPage,
    endCursor: r?.refs?.pageInfo?.endCursor ?? null,
  };
}

// ---- B-2 folder grouping (generic: Tags reuses it) ----

export interface RefFolder<T> {
  kind: "folder";
  /** This segment only. */
  name: string;
  /** Full folder path, no trailing slash. */
  path: string;
  children: RefNode<T>[];
}

export interface RefLeaf<T> {
  kind: "ref";
  /** Last segment, or the whole name for a pinned ref. */
  name: string;
  item: T;
}

export type RefNode<T> = RefFolder<T> | RefLeaf<T>;

/**
 * Nested tree by `/`. Single-child folders are not collapsed. At every level folders come first (case-insensitive A-Z, ties ordinal),
 * then refs in input order. `pin` (the default branch) is a top-level leaf, first of all, named with its whole name, and not inside any folder.
 * `query` is a trimmed, case-insensitive substring match on the whole name; only matches stay, folders left empty are dropped.
 */
export function buildRefTree<T extends { name: string }>(items: T[], opts: { query?: string; pin?: string } = {}): RefNode<T>[] {
  const q = opts.query?.trim().toLowerCase();
  const kept = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  const pinned = opts.pin !== undefined ? kept.find((i) => i.name === opts.pin) : undefined;
  const root: RefFolder<T> = { kind: "folder", name: "", path: "", children: [] };
  for (const item of kept) {
    if (item === pinned) continue;
    const parts = item.name.split("/");
    let at = root;
    parts.slice(0, -1).forEach((seg, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let f = at.children.find((c): c is RefFolder<T> => c.kind === "folder" && c.name === seg);
      if (!f) at.children.push((f = { kind: "folder", name: seg, path, children: [] }));
      at = f;
    });
    at.children.push({ kind: "ref", name: parts[parts.length - 1], item });
  }
  const order = (nodes: RefNode<T>[]): RefNode<T>[] => {
    const folders = nodes.filter((n): n is RefFolder<T> => n.kind === "folder");
    folders.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    folders.forEach((f) => (f.children = order(f.children)));
    return [...folders, ...nodes.filter((n) => n.kind === "ref")];
  };
  const tree = order(root.children);
  return pinned ? [{ kind: "ref", name: pinned.name, item: pinned }, ...tree] : tree;
}

// ---- B-3 tabs ----

export type BranchTab = "mine" | "all" | "stale";

/** A branch is stale when its head commit's authoredDate is more than this many days before `now`. */
export const STALE_DAYS = 90;

export interface TabContext {
  viewer: string;
  /** Branch names the viewer starred. */
  favourites: ReadonlySet<string>;
  now: Date;
}

/** mine: author.login is the viewer, or the name is a favourite. all: everything. stale: older than STALE_DAYS (exactly 90 days is not stale). Input order is kept. */
export function filterByTab(branches: Branch[], tab: BranchTab, ctx: TabContext): Branch[] {
  const day = 24 * 60 * 60 * 1000;
  if (tab === "all") return branches;
  if (tab === "mine") return branches.filter((b) => b.author.login === ctx.viewer || ctx.favourites.has(b.name));
  return branches.filter((b) => ctx.now.getTime() - b.authoredDate.getTime() > STALE_DAYS * day);
}

// ---- B-4 behind / ahead ----

export interface AheadBehind {
  ahead: number;
  behind: number;
}

/** Branch names that need a compare: all of them except the default branch, in order. */
export function branchesToCompare(names: string[], defaultBranch: string): string[] {
  return names.filter((n) => n !== defaultBranch);
}

/** REST compare response to { ahead, behind } (ahead_by, behind_by). The path is comparePath(repo, defaultBranch, branch) in commitDetail.ts. */
export function mapCompare(rest: { ahead_by: number; behind_by: number }): AheadBehind {
  return { ahead: rest.ahead_by, behind: rest.behind_by };
}

/** Splits items into consecutive batches of at most `size`, order kept; a caller runs one batch at a time to cap concurrency. THROWS RangeError when size is below 1. */
export function inBatches<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new RangeError("Batch size must be at least 1.");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The largest ahead or behind value across the visible rows (rows without a compare are skipped); 0 when none. */
export function maxDivergence(rows: (AheadBehind | null | undefined)[]): number {
  return Math.max(0, ...rows.map((r) => (r ? Math.max(r.ahead, r.behind) : 0)));
}

/** Each side of the split bar as a fraction of its half, 0 to 1: value / max. Both are 0 when max is 0. */
export function barWidths(value: AheadBehind, max: number): { behind: number; ahead: number } {
  return max > 0 ? { behind: value.behind / max, ahead: value.ahead / max } : { behind: 0, ahead: 0 };
}

// ---- B-5 actions ----

/** createRef: input { repositoryId, name: `refs/heads/${name}`, oid }, as one `$input: CreateRefInput!` variable. */
export function createBranchMutation(repositoryId: string, name: string, oid: string): GraphQlRequest {
  return {
    query: "mutation($input: CreateRefInput!) { createRef(input: $input) { ref { id name } } }",
    variables: { input: { repositoryId, name: `refs/heads/${name}`, oid } },
  };
}

export type DeleteCheck = { ok: true } | { ok: false; code: "default" | "protected"; reason: string };

/** The default branch (code "default", checked first) and a protected branch (code "protected") cannot be deleted. */
export function canDeleteBranch(branch: { name: string; protected: boolean }, defaultBranch: string | null): DeleteCheck {
  if (branch.name === defaultBranch) return { ok: false, code: "default", reason: "Default branch" };
  if (branch.protected) return { ok: false, code: "protected", reason: "Protected" };
  return { ok: true };
}

// ---- Rename and set as default ----

const branchPath = (repo: string, branch: string) => `/repos/${repo}/branches/${encodeURIComponent(branch)}`;

/** POST /repos/{o}/{r}/branches/{branch}/rename with { new_name }. GitHub moves open PRs, protection rules and the default branch with it. */
export function renameBranchRequest(repo: string, from: string, to: string): RestRequest {
  return { method: "POST", path: `${branchPath(repo, from)}/rename`, body: { new_name: to } };
}

/** PATCH /repos/{o}/{r} with { default_branch }. Needs admin. */
export function setDefaultBranchRequest(repo: string, branch: string): RestRequest {
  return { method: "PATCH", path: `/repos/${repo}`, body: { default_branch: branch } };
}

/** The sentence for a failed rename: 403 explains the admin rule for the default and protected branches; otherwise GitHub's own message when it gave one. */
export function renameErrorText(status: number, apiMessage: string | undefined, b: { isDefault: boolean; protected: boolean }): string | null {
  if (status === 403) {
    if (b.isDefault) return "Renaming the default branch needs admin access to the repository on GitHub.";
    if (b.protected) return "Renaming a protected branch needs admin access to the repository on GitHub.";
    return "Your GitHub sign-in isn't allowed to rename branches in this repository. It needs write access.";
  }
  if (status === 404) return "The branch wasn't found, or your GitHub sign-in can't see it. Refresh and try again.";
  if (status === 422 && apiMessage) return `GitHub said: ${apiMessage}`;
  return null;
}

/** Per-repo favourites and compare branch with `from` renamed to `to`. The same object back when neither named `from`. */
export function renameInPrefs<P extends { favourites: Record<string, string[]>; compareBase?: Record<string, string> }>(prefs: P, repo: string, from: string, to: string): P {
  const favs = prefs.favourites[repo];
  const favHit = !!favs?.includes(from);
  const baseHit = prefs.compareBase?.[repo] === from;
  if (!favHit && !baseHit) return prefs;
  return {
    ...prefs,
    ...(favHit && { favourites: { ...prefs.favourites, [repo]: favs!.map((n) => (n === from ? to : n)) } }),
    ...(baseHit && { compareBase: { ...prefs.compareBase, [repo]: to } }),
  };
}

// ---- Compare any two refs ----

export type RefKind = "branch" | "tag" | "commit";

/** What a compare ref names: a known branch first, then a known tag, then a commit SHA (4 to 40 hex); otherwise a branch (GitHub resolves it). */
export function refKind(name: string, branches: readonly string[], tags: readonly string[]): RefKind {
  if (branches.includes(name)) return "branch";
  if (tags.includes(name)) return "tag";
  return /^[0-9a-f]{4,40}$/i.test(name) ? "commit" : "branch";
}

/**
 * What the compare picker lists for a search: matching branches (default first), matching tags, and, when the search is a
 * commit SHA (7 to 40 hex) that names no branch or tag, that commit. Matching is a trimmed, case-insensitive substring.
 */
export function compareRefOptions(branches: readonly string[], tags: readonly string[], query: string, defaultBranch?: string): { branches: string[]; tags: string[]; commit?: string } {
  const q = query.trim().toLowerCase();
  const hit = (n: string) => n.toLowerCase().includes(q);
  const bs = branches.filter(hit);
  const ordered = defaultBranch && bs.includes(defaultBranch) ? [defaultBranch, ...bs.filter((b) => b !== defaultBranch)] : bs;
  const sha = query.trim();
  const commit = /^[0-9a-f]{7,40}$/i.test(sha) && !branches.includes(sha) && !tags.includes(sha) ? sha.toLowerCase() : undefined;
  return { branches: ordered, tags: tags.filter(hit), ...(commit && { commit }) };
}

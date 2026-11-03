// GitHub GraphQL builders and row mapper for the Commits list (C-1).
// Rule shared with feedQuery.ts / prQuery.ts: every caller-supplied value travels in `variables`, never in the query text.
import type { GraphQlRequest } from "./prQuery";
import { signatureSelection, type CommitSignature } from "./signatures";

/** Avatar for an account GitHub no longer knows (same value as prModel.ts / feedModel.ts). */
export const GHOST_AVATAR = "https://github.com/ghost.png";

export type CheckStatus = "succeeded" | "failed" | "running";

export interface Person {
  name: string;
  /** null when the commit's email is not linked to a GitHub account. */
  login: string | null;
  avatarUrl: string;
}

export interface GqlActor {
  name?: string | null;
  user?: { login: string; avatarUrl: string } | null;
}

export interface GqlCommitNode {
  oid: string;
  messageHeadline: string;
  message: string;
  committedDate: string;
  authoredDate: string;
  author?: GqlActor | null;
  parents?: { nodes: { oid: string }[] } | null;
  associatedPullRequests?: { nodes: { number: number; title: string; state: "OPEN" | "CLOSED" | "MERGED" }[] } | null;
  statusCheckRollup?: { state: string } | null;
  signature?: CommitSignature | null;
}

export interface CommitRow {
  sha: string;
  /** First 8 characters (see shortSha in commits.ts). */
  shortSha: string;
  /** messageHeadline. */
  title: string;
  /** The full message, headline included. */
  message: string;
  author: Person;
  /** authoredDate. */
  date: Date;
  committedDate: Date;
  /** Parent oids in order; the first is the first parent. */
  parents: string[];
  /** Number of the associated PR when it is MERGED or OPEN, else null. */
  prNumber: number | null;
  status: CheckStatus | null;
  /** CI-6: present only when the commit is signed. */
  signature?: CommitSignature;
}

export interface CommitsPage {
  rows: CommitRow[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface CommitsParams {
  owner: string;
  name: string;
  /** Branch or tag name, or a qualified ref (`refs/heads/main`). */
  ref: string;
  /** History cursor from the previous page; absent on the first page. */
  after?: string;
}

const COMMIT_FIELDS = `oid messageHeadline message committedDate authoredDate
  author { name user { login avatarUrl } }
  parents(first: 5) { nodes { oid } }
  associatedPullRequests(first: 1) { nodes { number title state } }
  statusCheckRollup { state }
  ${signatureSelection()}`;

/** `history(first: 50, after: $after)` on the ref's target commit, with the fields CommitRow is built from. Variables { owner, name, ref, after }. */
export function commitsQuery(p: CommitsParams): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $ref: String!, $after: String) { repository(owner: $owner, name: $name) { ref(qualifiedName: $ref) { target { ... on Commit { history(first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${COMMIT_FIELDS} } } } } } } }`,
    variables: { owner: p.owner, name: p.name, ref: p.ref, after: p.after ?? null },
  };
}

/** A file or folder path as `history(path:)` wants it: trimmed, no leading `./` or `/`, no trailing `/`. "" when nothing is left. */
export function normalizeHistoryPath(raw: string): string {
  return raw.trim().replace(/^(\.?\/)+/, "").replace(/\/+$/, "");
}

/** commitsQuery with `history(first: 50, after: $after, path: $path)`: only commits that touched a file or folder. A blank path is sent as null (live: "" is an ARGUMENT_ERROR). Variables { owner, name, ref, after, path }. */
export function commitsByPathQuery(p: CommitsParams & { path: string }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $ref: String!, $after: String, $path: String) { repository(owner: $owner, name: $name) { ref(qualifiedName: $ref) { target { ... on Commit { history(first: 50, after: $after, path: $path) { pageInfo { hasNextPage endCursor } nodes { ${COMMIT_FIELDS} } } } } } } }`,
    variables: { owner: p.owner, name: p.name, ref: p.ref, after: p.after ?? null, path: normalizeHistoryPath(p.path) || null },
  };
}

/** True for 4 to 40 hexadecimal characters (either case), nothing else. */
export function isShaPrefix(text: string): boolean {
  return /^[0-9a-fA-F]{4,40}$/.test(text);
}

/** `object(expression: $sha)` for one commit by SHA prefix. THROWS an Error mentioning "SHA" unless isShaPrefix(sha); no request is built then. Variables { owner, name, sha }. */
export function commitSearchQuery(p: { owner: string; name: string; sha: string }): GraphQlRequest {
  if (!isShaPrefix(p.sha)) throw new Error("Enter 4 to 40 hexadecimal characters of a commit SHA.");
  return {
    query: `query($owner: String!, $name: String!, $sha: String!) { repository(owner: $owner, name: $name) { object(expression: $sha) { ... on Commit { ${COMMIT_FIELDS} } } } }`,
    variables: { owner: p.owner, name: p.name, sha: p.sha },
  };
}

/** SUCCESS to succeeded, FAILURE and ERROR to failed, PENDING and EXPECTED to running, anything else (including null) to null. */
export function mapCheckState(state: string | null | undefined): CheckStatus | null {
  switch (state) {
    case "SUCCESS": return "succeeded";
    case "FAILURE":
    case "ERROR": return "failed";
    case "PENDING":
    case "EXPECTED": return "running";
    default: return null;
  }
}

/** A null actor is the ghost (name and login "ghost"); an actor without a linked user keeps its name, has a null login and the ghost avatar. */
export function mapPerson(actor: GqlActor | null | undefined): Person {
  if (!actor) return { name: "ghost", login: "ghost", avatarUrl: GHOST_AVATAR };
  const u = actor.user;
  return { name: actor.name ?? u?.login ?? "ghost", login: u?.login ?? null, avatarUrl: u?.avatarUrl ?? GHOST_AVATAR };
}

export function mapCommitNode(node: GqlCommitNode): CommitRow {
  const pr = node.associatedPullRequests?.nodes?.[0];
  return {
    sha: node.oid,
    shortSha: node.oid.slice(0, 8),
    title: node.messageHeadline,
    message: node.message,
    author: mapPerson(node.author),
    date: new Date(node.authoredDate),
    committedDate: new Date(node.committedDate),
    parents: (node.parents?.nodes ?? []).map((n) => n.oid),
    prNumber: pr && (pr.state === "MERGED" || pr.state === "OPEN") ? pr.number : null,
    status: mapCheckState(node.statusCheckRollup?.state),
    ...(node.signature ? { signature: node.signature } : {}),
  };
}

/** Maps a commitsQuery response body (`data.repository.ref.target.history`). A missing ref gives no rows and hasNextPage false. */
export function mapCommitsPage(body: any): CommitsPage {
  const h = body?.data?.repository?.ref?.target?.history;
  if (!h) return { rows: [], hasNextPage: false, endCursor: null };
  return { rows: (h.nodes ?? []).map(mapCommitNode), hasNextPage: !!h.pageInfo?.hasNextPage, endCursor: h.pageInfo?.endCursor ?? null };
}

/** Maps a commitSearchQuery response body; null when no commit matches. */
export function mapCommitSearch(body: any): CommitRow | null {
  const o = body?.data?.repository?.object;
  return o?.oid ? mapCommitNode(o) : null;
}

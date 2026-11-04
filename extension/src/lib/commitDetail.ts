// Commit detail: query, mapper, parent options and REST paths (C-3). Also owns comparePath, which C-4 and B-4 reuse.
// REST paths start with `/repos/{owner}/{name}`, as githubBrowse.ts builds them; `repo` is a validated "owner/name".
import type { GraphQlRequest } from "./prQuery";
import { signatureSelection, type CommitSignature } from "./signatures";
import { mapCheckState, mapPerson, type CheckStatus, type GqlActor, type Person } from "./commitsQuery";

export interface GqlCommitDetailNode {
  oid: string;
  messageHeadline: string;
  messageBody: string;
  message: string;
  authoredDate: string;
  committedDate: string;
  author?: GqlActor | null;
  committer?: GqlActor | null;
  parents?: { nodes: { oid: string }[] } | null;
  associatedPullRequests?: { nodes: { number: number; title: string; state: "OPEN" | "CLOSED" | "MERGED" }[] } | null;
  statusCheckRollup?: { state: string } | null;
  tree?: { oid: string } | null;
  signature?: CommitSignature | null;
}

export interface CommitDetail {
  sha: string;
  shortSha: string;
  title: string;
  /** messageBody: the message after the headline, without the blank separator line. */
  body: string;
  message: string;
  author: Person;
  committer: Person;
  authoredDate: Date;
  committedDate: Date;
  parents: string[];
  status: CheckStatus | null;
  /** The associated PR when it is MERGED or OPEN, else null. */
  pullRequest: { number: number; title: string } | null;
  /** The commit's tree SHA, for the Details tab. */
  treeSha: string | null;
  /** The signature check, when the commit is signed. */
  signature: CommitSignature | null;
}

/** One commit by SHA (or prefix) with headline, body, author, committer, dates, parents(first: 10), status and associatedPullRequests(first: 1). Variables { owner, name, sha }. */
export function commitDetailQuery(p: { owner: string; name: string; sha: string }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $sha: String!) { repository(owner: $owner, name: $name) { object(expression: $sha) { ... on Commit { oid messageHeadline messageBody message authoredDate committedDate author { name email user { login avatarUrl } } committer { name email user { login avatarUrl } } parents(first: 10) { nodes { oid } } associatedPullRequests(first: 1) { nodes { number title state } } statusCheckRollup { state } tree { oid } ${signatureSelection()} } } } }`,
    variables: { owner: p.owner, name: p.name, sha: p.sha },
  };
}

/** Maps a commitDetailQuery response body (`data.repository.object`); null when there is no such commit. */
export function mapCommitDetail(body: any): CommitDetail | null {
  const n: GqlCommitDetailNode | null | undefined = body?.data?.repository?.object;
  if (!n?.oid) return null;
  const pr = n.associatedPullRequests?.nodes?.[0];
  return {
    sha: n.oid,
    shortSha: n.oid.slice(0, 8),
    title: n.messageHeadline,
    body: n.messageBody,
    message: n.message,
    author: mapPerson(n.author),
    committer: mapPerson(n.committer),
    authoredDate: new Date(n.authoredDate),
    committedDate: new Date(n.committedDate),
    parents: (n.parents?.nodes ?? []).map((x) => x.oid),
    status: mapCheckState(n.statusCheckRollup?.state),
    pullRequest: pr && (pr.state === "MERGED" || pr.state === "OPEN") ? { number: pr.number, title: pr.title } : null,
    treeSha: n.tree?.oid ?? null,
    signature: n.signature ?? null,
  };
}

/** REST commit, `/repos/{o}/{r}/commits/{sha}`: its `files` carry status, additions, deletions, patch and previous_filename (map them with fromRestFile in prFiles.ts). */
export function commitFilesPath(repo: string, sha: string): string {
  return `/repos/${repo}/commits/${sha}`;
}

/** REST compare, `/repos/{o}/{r}/compare/{base}...{head}`. base and head are each percent-encoded (a `/` in a branch name becomes %2F). */
export function comparePath(repo: string, base: string, head: string): string {
  return `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
}

export interface ParentOption {
  /** "Parent 1", "Parent 2", ... or "Initial commit". */
  label: string;
  /** The parent oid to diff against; null for the initial commit. */
  baseSha: string | null;
}

/** One option per parent, labelled "Parent N" from 1; a root commit gets the single option { label: "Initial commit", baseSha: null }. */
export function parentOptions(parents: string[]): ParentOption[] {
  return parents.length ? parents.map((baseSha, i) => ({ label: `Parent ${i + 1}`, baseSha })) : [{ label: "Initial commit", baseSha: null }];
}

/** The option selected first: always the first one (parent 1 for a merge commit). */
export function defaultParentOption(parents: string[]): ParentOption {
  return parentOptions(parents)[0];
}

/** Where the changed files come from for the chosen option: comparePath(repo, baseSha, sha), or commitFilesPath(repo, sha) when there is no base. */
export function diffPath(repo: string, sha: string, option: ParentOption): string {
  return option.baseSha ? comparePath(repo, option.baseSha, sha) : commitFilesPath(repo, sha);
}

// Tags page logic: list query, mapper and create actions (T-1, T-2).
// Folder grouping and search reuse buildRefTree (branches.ts); deleting reuses deleteRefMutation(refId) (actionsQuery.ts) with TagRow.id; names are checked with validateRefName (refName.ts).
import type { GraphQlRequest } from "./prQuery";
import type { GqlActor, Person } from "./commitsQuery";

export interface GqlTagNode {
  /** Ref node id (what deleteRef needs). */
  id: string;
  name: string;
  target?:
    | { __typename: "Tag"; message?: string | null; tagger?: (GqlActor & { date: string }) | null; target?: { oid: string } | null }
    | { __typename: "Commit"; oid: string; authoredDate: string; author?: GqlActor | null }
    | null;
}

export interface TagRow {
  id: string;
  name: string;
  /** The commit the tag points at. */
  sha: string;
  shortSha: string;
  annotated: boolean;
  /** Annotated tags only (the key is absent for a lightweight tag). */
  message?: string;
  /** Annotated: the tagger. Lightweight: the commit's author. */
  author: Person;
  /** Annotated: tagger.date. Lightweight: the commit's authoredDate. */
  date: Date;
}

export interface TagsPage {
  /** repository.id, the repositoryId createRef needs. */
  repoId: string;
  tags: TagRow[];
  hasNextPage: boolean;
  endCursor: string | null;
}

/** A REST call described as data, for the caller's fetch wrapper. */
export interface RestRequest {
  method: "POST";
  path: string;
  body: Record<string, unknown>;
}

import { mapPerson } from "./commitsQuery";

const PERSON = "name user { login avatarUrl }";

/** `refs(refPrefix: "refs/tags/", first: 100, after: $after, orderBy: {field: TAG_COMMIT_DATE, direction: DESC})` plus repository id. Variables { owner, name, after }. Live: newest first, unlike for branches. */
export function tagListQuery(p: { owner: string; name: string; after?: string }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { id refs(refPrefix: "refs/tags/", first: 100, after: $after, orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) { pageInfo { hasNextPage endCursor } nodes { id name target { __typename ... on Tag { message tagger { ${PERSON.replace("name user", "name date user")} } target { oid } } ... on Commit { oid authoredDate author { ${PERSON} } } } } } } }`,
    variables: { owner: p.owner, name: p.name, after: p.after ?? null },
  };
}

export function mapTag(node: GqlTagNode): TagRow {
  const t = node.target;
  if (t?.__typename === "Tag") {
    const sha = t.target?.oid ?? "";
    return {
      id: node.id,
      name: node.name,
      sha,
      shortSha: sha.slice(0, 8),
      annotated: true,
      message: t.message ?? "",
      author: mapPerson(t.tagger),
      date: new Date(t.tagger?.date ?? 0),
    };
  }
  const sha = t?.oid ?? "";
  return { id: node.id, name: node.name, sha, shortSha: sha.slice(0, 8), annotated: false, author: mapPerson(t?.author), date: new Date(t?.authoredDate ?? 0) };
}

/** Maps a tagListQuery body. */
export function mapTagsPage(body: any): TagsPage {
  const r = body?.data?.repository;
  return {
    repoId: r?.id ?? "",
    tags: (r?.refs?.nodes ?? []).map(mapTag),
    hasNextPage: !!r?.refs?.pageInfo?.hasNextPage,
    endCursor: r?.refs?.pageInfo?.endCursor ?? null,
  };
}

/** createRef: input { repositoryId, name: `refs/tags/${name}`, oid }. Lightweight tags pass the commit oid, annotated tags the new tag object's sha. */
export function createTagMutation(repositoryId: string, name: string, oid: string): GraphQlRequest {
  return {
    query: "mutation($input: CreateRefInput!) { createRef(input: $input) { ref { id name } } }",
    variables: { input: { repositoryId, name: `refs/tags/${name}`, oid } },
  };
}

/** Step 1 of an annotated tag: POST `/repos/{o}/{r}/git/tags` with { tag, message, object: oid, type: "commit" }. THROWS an Error mentioning "message" when it is blank. */
export function createTagObjectRequest(repo: string, p: { tag: string; message: string; oid: string }): RestRequest {
  if (!p.message.trim()) throw new Error("An annotated tag needs a message.");
  return { method: "POST", path: `/repos/${repo}/git/tags`, body: { tag: p.tag, message: p.message, object: p.oid, type: "commit" } };
}

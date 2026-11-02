// Latest-commit-per-entry lookups for the folder listing: GraphQL query building and response mapping (pure).
import type { TreeEntry } from "./tree";

export const CHUNK_SIZE = 50;

export interface CommitInfo {
  sha: string;
  shortSha: string;
  headline: string;
  date: Date;
  author: string;
}

export interface CommitQuery {
  query: string;
  variables: Record<string, string>;
  /** alias (e0, e1, ...) to entry path */
  aliases: Record<string, string>;
}

export const shortSha = (oid: string) => oid.slice(0, 8);
export const commitUrl = (repo: string, sha: string) => `https://github.com/${repo}/commit/${sha}`;

/** One query per chunk of entries. Paths travel as variables, never in the query text. Submodules have no history. */
export function buildQueries(repo: string, ref: string, entries: TreeEntry[], chunk = CHUNK_SIZE): CommitQuery[] {
  const [owner, name] = repo.split("/");
  const paths = entries.filter((e) => e.kind !== "submodule").map((e) => e.path);
  const out: CommitQuery[] = [];
  for (let i = 0; i < paths.length; i += chunk) {
    const part = paths.slice(i, i + chunk);
    const variables: Record<string, string> = { owner, name, ref };
    const aliases: Record<string, string> = {};
    part.forEach((p, n) => ((variables[`p${n}`] = p), (aliases[`e${n}`] = p)));
    const decl = part.map((_, n) => `,$p${n}: String!`).join("");
    const fields = part.map((_, n) => `e${n}: history(first: 1, path: $p${n}) { nodes { oid messageHeadline committedDate author { name user { name login } } } }`).join(" ");
    out.push({
      query: `query($owner: String!, $name: String!, $ref: String!${decl}) { repository(owner: $owner, name: $name) { object(expression: $ref) { ... on Commit { ${fields} } } } }`,
      variables,
      aliases,
    });
  }
  return out;
}

interface Node {
  oid: string;
  messageHeadline: string;
  committedDate: string;
  author?: { name?: string | null; user?: { name?: string | null; login?: string | null } | null } | null;
}

/** Maps a GraphQL body to path-keyed commits. Entries without history are left out; partial data survives `errors`. */
export function mapResponse(body: any, aliases: Record<string, string>): Record<string, CommitInfo> {
  const obj = body?.data?.repository?.object ?? {};
  const out: Record<string, CommitInfo> = {};
  for (const [alias, path] of Object.entries(aliases)) {
    const n: Node | undefined = obj[alias]?.nodes?.[0];
    if (!n?.oid) continue;
    out[path] = {
      sha: n.oid,
      shortSha: shortSha(n.oid),
      headline: n.messageHeadline,
      date: new Date(n.committedDate),
      author: n.author?.user?.name || n.author?.name || n.author?.user?.login || "",
    };
  }
  return out;
}

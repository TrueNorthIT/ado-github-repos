// Batch 5, pull request templates (CP-2). STUBS: the developer implements them. Every function throws "Not implemented" except the constants.
//
// Flow: templateListingQuery (what files sit in the candidate folders at the BASE branch) -> listedPaths (flat blob paths) -> resolveTemplates (which are templates) -> templateBlobsQuery (their text) -> mapTemplateBlobs.
//
// Schema facts (checked live with `gh api graphql` against cli/cli, 2026-11-03; read-only):
//  - Repository.object(expression: String!) works with the expression in a VARIABLE and with aliases: `d1: object(expression: $d1) { ... on Tree { entries { name type } } }` with $d1 = "trunk:.github" listed
//    that folder (entries { name type }, type is "blob" or "tree"). The root is the expression "trunk:" (empty path). A folder that does not exist gives null for that alias, and no error.
//  - A file: `t0: object(expression: $e0) { ... on Blob { text byteSize isTruncated } }` with $e0 = "trunk:.github/PULL_REQUEST_TEMPLATE.md" returned text, byteSize 3590, isTruncated false.
//    The lookup is CASE-SENSITIVE: "trunk:.github/pull_request_template.md" gave null for that file, so paths must keep the case the listing returned.
//    An alias that resolves to a TREE (not a blob) gives {} (the Blob fragment does not match), so a mapper must skip objects without a string `text`.
//  - Repository.pullRequestTemplates { filename } exists (cli/cli gave [{filename: "PULL_REQUEST_TEMPLATE.md"}]) but it carries the BASENAME only and reads the default branch, not the target branch, so it is not used.
//
// Decisions fixed by the tests (prTemplates.test.ts):
//  - Single-file templates: `pull_request_template.md` or `.txt`, any letter case, directly in `.github/`, `docs/` or the root. Precedence .github, then docs, then root (the order the requirement lists them;
//    GitHub does not document it); only the best one counts.
//  - Folder templates: any `.md` / `.txt` file directly inside a folder named `PULL_REQUEST_TEMPLATE` (any case) in `.github/`, `docs/` or the root. Listed .github first, then docs, then root, each by name
//    (case-insensitive). Other extensions (config.yml) and nested folders are ignored.
//  - The result: no templates -> none; exactly one in total -> single; otherwise pick = the single-file template first (when there is one) followed by the folder templates.
//  - Paths are returned exactly as given (their case matters for the blob lookup).
import type { GraphQlRequest } from "./prQuery";

const todo = (): never => {
  throw new Error("Not implemented");
};

/** The folders the listing query reads, in the order of its aliases d0..d5 ("" is the root). */
export const LISTING_DIRS = ["", ".github", "docs", "PULL_REQUEST_TEMPLATE", ".github/PULL_REQUEST_TEMPLATE", "docs/PULL_REQUEST_TEMPLATE"] as const;

export type TemplateResolution = { kind: "none" } | { kind: "single"; path: string } | { kind: "pick"; paths: string[] };

/** Which of the repository file `paths` are pull request templates, and whether the user has to pick (see the decisions above). */
export function resolveTemplates(paths: string[]): TemplateResolution {
  return todo();
}

/**
 * `query($owner: String!, $name: String!, $d0: String!, ... $d5: String!)` over repository(owner: $owner, name: $name) with one alias per LISTING_DIRS entry:
 * `d0: object(expression: $d0) { ... on Tree { entries { name type } } }`. Variables { owner, name, d0: `${base}:${LISTING_DIRS[0]}`, d1: `${base}:${LISTING_DIRS[1]}`, ... }.
 * Nothing caller-supplied appears in the query text.
 */
export function templateListingQuery(p: { owner: string; name: string; base: string }): GraphQlRequest {
  return todo();
}

/** The paths of the blob entries of a templateListingQuery response body ({ data }), each `${dir}/${name}` (just `name` for the root), in alias order then entry order. Null folders and tree entries give nothing; garbage gives []. */
export function listedPaths(body: any): string[] {
  return todo();
}

/**
 * `query($owner: String!, $name: String!, $e0: String!, ... )` with one alias per path: `t0: object(expression: $e0) { ... on Blob { text byteSize isTruncated } }`.
 * Variables { owner, name, e0: `${base}:${paths[0]}`, e1: `${base}:${paths[1]}`, ... }. Throws "at least one template path is required" for an empty list.
 */
export function templateBlobsQuery(p: { owner: string; name: string; base: string }, paths: string[]): GraphQlRequest {
  return todo();
}

export interface TemplateBlob {
  path: string;
  text: string;
}

/** The templates of a templateBlobsQuery response body ({ data }) in the order of `paths`. Aliases that are null, not blobs (no string text) or truncated are left out; garbage gives []. */
export function mapTemplateBlobs(body: any, paths: string[]): TemplateBlob[] {
  return todo();
}

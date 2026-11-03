// Web edits to a repository's files (native Files: Edit, New, Upload, Rename, Delete). Pure logic: building the commit, checking what the user typed, keeping the file's bytes intact.
//
// Schema facts (checked live with `gh api graphql`; the mutation was run against a repository that does not exist, so it passed validation and wrote nothing):
//  - createCommitOnBranch(input: CreateCommitOnBranchInput!): { branch: { repositoryNameWithOwner, branchName }, message: { headline, body? }, expectedHeadOid, fileChanges: { additions: [{ path, contents: Base64String }], deletions: [{ path }] } }.
//    `contents` is the WHOLE file as base64 of its bytes, so a binary upload and a UTF-8 edit go through the same field. Payload: commit { oid url }, ref { name target { oid } }.
//  - A rename is an addition at the new path plus a deletion of the old path in one commit; GitHub records it as a rename when the contents match.
//  - repository(owner:, name:) { id viewerPermission ref(qualifiedName: "refs/heads/<branch>") { target { oid } } } gives the permission and the branch head in one call; ref is null for a tag, a commit or a missing branch.
//  - Not exercised live (needs a real write): the exact text of the stale-head error. GitHub documents it as `Expected branch to point to "<oid>" but it did not. Pull and try again.`; isStaleHeadError matches that phrase.
import type { GraphQlRequest } from "./prQuery";
import { validateRefName } from "./refName";

/** Per file through createCommitOnBranch. GitHub's own limit is about 100 MB, but the whole request travels as one base64 JSON body, so a sane cap keeps it reliable. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // ponytail: GitHub documents no request-size limit for this path; 10 MB (about 13.4 MB of base64) is a guess that real use can raise
/** All the files of one upload together. */
export const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024;

/** Repository.viewerPermission values that can push to a branch. */
export const canWrite = (permission: string | null | undefined): boolean => ["WRITE", "MAINTAIN", "ADMIN"].includes(permission ?? "");

// ---- bytes -------------------------------------------------------------------------------------------------------------------------------------------

/** Base64 of bytes, in chunks so a large file does not overflow the argument list of String.fromCharCode. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Base64 of the UTF-8 bytes of a string. */
export const utf8ToBase64 = (s: string): string => bytesToBase64(new TextEncoder().encode(s));

export type Decoded = { ok: true; text: string; bom: boolean } | { ok: false };

/**
 * The text of a file's bytes for the editor, or { ok: false } when the file is not text we can write back faithfully (invalid UTF-8, or a NUL byte).
 * A UTF-8 BOM is reported in `bom` rather than left in `text`, so the editor does not show it and prepareEdited can put it back.
 */
export function decodeForEdit(bytes: Uint8Array): Decoded {
  if (bytes.includes(0)) return { ok: false };
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.startsWith("﻿") ? { ok: true, text: text.slice(1), bom: true } : { ok: true, text, bom: false };
  } catch {
    return { ok: false };
  }
}

/** The line ending that most of `text`'s breaks use (the editor normalises a mixed file to the same one); LF when there are none or it is a tie. */
function dominantEol(text: string | undefined): "\r\n" | "\n" {
  if (!text) return "\n";
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

/** The edited text as it should be committed: the original file's line ending throughout, its BOM back on, the final newline as the editor left it. */
export function prepareEdited(edited: string, o: { original?: string; bom?: boolean }): string {
  const lf = edited.replace(/\r\n/g, "\n");
  const text = dominantEol(o.original) === "\r\n" ? lf.replace(/\n/g, "\r\n") : lf;
  return o.bom ? "﻿" + text : text;
}

// ---- the Commit dialog -------------------------------------------------------------------------------------------------------------------------------

export type CommitTarget = { kind: "direct" } | { kind: "branch"; name: string };
export interface CommitForm { headline: string; body: string; target: CommitTarget }
export type FormCheck = { ok: true; message: { headline: string; body?: string } } | { ok: false; field: "headline" | "branch"; reason: string };

export function validateCommitForm(f: CommitForm, existingBranches: string[]): FormCheck {
  const headline = f.headline.trim();
  if (!headline) return { ok: false, field: "headline", reason: "Enter a commit message." };
  if (f.target.kind === "branch") {
    const c = validateRefName(f.target.name, existingBranches);
    if (!c.ok) return { ok: false, field: "branch", reason: c.reason };
  }
  const body = f.body.trimEnd();
  return { ok: true, message: body.trim() ? { headline, body } : { headline } };
}

export interface CommitPlan {
  /** The branch the commit lands on. */
  branch: string;
  /** Create `branch` at this oid first (a new-branch commit). */
  createFrom?: string;
  /** The head the file was loaded at; the commit is refused when the branch has moved. */
  expectedHeadOid: string;
  /** Go to the New pull request page afterwards. */
  openPr: boolean;
}

/** A new branch is cut from the loaded head and committed to against that same head, so only a direct commit can find the branch has moved. */
export function planCommit(target: CommitTarget, currentBranch: string, headOid: string): CommitPlan {
  return target.kind === "direct"
    ? { branch: currentBranch, expectedHeadOid: headOid, openPr: false }
    : { branch: target.name, createFrom: headOid, expectedHeadOid: headOid, openPr: true };
}

/** GitHub's refusal when expectedHeadOid is no longer the branch tip. */
export const isStaleHeadError = (detail: string | undefined): boolean => /expected branch to point to/i.test(detail ?? "");

// ---- the mutation ------------------------------------------------------------------------------------------------------------------------------------

export interface FileChanges {
  additions: { path: string; contents: string }[];
  deletions: { path: string }[];
}

export interface CommitOnBranchParams {
  repo: string;
  branch: string;
  expectedHeadOid: string;
  message: { headline: string; body?: string };
  /** `contents` of an addition is already base64. */
  changes: FileChanges;
}

/** createCommitOnBranch. Throws "repo must be owner/name", "branchName is required", "expectedHeadOid is required", "at least one file change is required". */
export function commitOnBranchMutation(p: CommitOnBranchParams): GraphQlRequest {
  const parts = p.repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("repo must be owner/name");
  if (!p.branch.trim()) throw new Error("branchName is required");
  if (!p.expectedHeadOid.trim()) throw new Error("expectedHeadOid is required");
  if (!p.changes.additions.length && !p.changes.deletions.length) throw new Error("at least one file change is required");
  const message = p.message.body === undefined ? { headline: p.message.headline } : { headline: p.message.headline, body: p.message.body };
  const fileChanges: Record<string, unknown> = {};
  if (p.changes.additions.length) fileChanges.additions = p.changes.additions.map((a) => ({ path: a.path, contents: a.contents }));
  if (p.changes.deletions.length) fileChanges.deletions = p.changes.deletions.map((d) => ({ path: d.path }));
  return {
    query: `mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } ref { name target { oid } } } }`,
    variables: { input: { branch: { repositoryNameWithOwner: p.repo, branchName: p.branch }, expectedHeadOid: p.expectedHeadOid, message, fileChanges } },
  };
}

export const renameChanges = (from: string, to: string, base64: string): FileChanges => ({ additions: [{ path: to, contents: base64 }], deletions: [{ path: from }] });
export const deleteChanges = (path: string): FileChanges => ({ additions: [], deletions: [{ path }] });

/** `repository { id viewerPermission ref(qualifiedName) { target { oid } } }`. Variables { owner, name, qualifiedName }. */
export function writeContextQuery(p: { owner: string; name: string; branch: string }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $qualifiedName: String!) { repository(owner: $owner, name: $name) { id viewerPermission ref(qualifiedName: $qualifiedName) { target { oid } } } }`,
    variables: { owner: p.owner, name: p.name, qualifiedName: `refs/heads/${p.branch}` },
  };
}

export interface WriteContext {
  repoId: string;
  /** The viewer may push and the ref is a branch, so there is a head to commit against. */
  headOid: string | null;
  canWrite: boolean;
}

/** Maps a writeContextQuery body. */
export function mapWriteContext(body: any): WriteContext {
  const r = body?.data?.repository;
  return { repoId: r?.id ?? "", headOid: r?.ref?.target?.oid ?? null, canWrite: canWrite(r?.viewerPermission) };
}

// ---- paths and uploads -------------------------------------------------------------------------------------------------------------------------------

export const joinPath = (dir: string, name: string): string => (dir ? `${dir.replace(/\/+$/, "")}/${name}` : name);

/** A sentence saying why `path` can't be a new file, or null. `lookup` says what is at a path now: a file, a folder, or nothing. The path is trimmed first. */
export function validatePath(path: string, lookup: (p: string) => "file" | "folder" | undefined): string | null {
  const p = path.trim();
  if (!p) return "Enter a path.";
  if (p.startsWith("/") || p.endsWith("/")) return "The path can't start or end with '/'.";
  if (p.includes("\\")) return "Use '/' between folders, not a backslash.";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(p)) return "The path can't contain control characters.";
  const segs = p.split("/");
  if (segs.some((s) => s === "")) return "The path can't have an empty folder name.";
  if (segs.some((s) => s === "." || s === "..")) return "The path can't contain '.' or '..'.";
  if (segs.some((s) => s.toLowerCase() === ".git")) return "The path can't contain a .git folder.";
  for (let i = 1; i < segs.length; i++) {
    const above = segs.slice(0, i).join("/");
    if (lookup(above) === "file") return `${above} is a file, so it can't hold other files.`;
  }
  return lookup(p) ? `${p} already exists.` : null;
}

export interface Upload { name: string; size: number }
export interface AcceptedUpload extends Upload { path: string; replaces: boolean }
export interface UploadCheck { accepted: AcceptedUpload[]; rejected: { name: string; reason: string }[] }

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/** Which picked files can go in one commit under `dir`: each at most MAX_UPLOAD_BYTES, all together at most MAX_UPLOAD_TOTAL_BYTES, and no name twice. `fileExists` marks files that would be replaced. */
export function checkUploads(files: Upload[], dir: string, fileExists: (path: string) => boolean): UploadCheck {
  const accepted: AcceptedUpload[] = [];
  const rejected: UploadCheck["rejected"] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const f of files) {
    if (seen.has(f.name)) { rejected.push({ name: f.name, reason: "A file with this name was picked more than once." }); continue; }
    if (f.size > MAX_UPLOAD_BYTES) { rejected.push({ name: f.name, reason: `${f.name} is over the ${mb(MAX_UPLOAD_BYTES)} limit for one file.` }); continue; }
    if (total + f.size > MAX_UPLOAD_TOTAL_BYTES) { rejected.push({ name: f.name, reason: `${f.name} would take this upload over the ${mb(MAX_UPLOAD_TOTAL_BYTES)} total.` }); continue; }
    seen.add(f.name);
    total += f.size;
    const path = joinPath(dir, f.name);
    accepted.push({ ...f, path, replaces: fileExists(path) });
  }
  return { accepted, rejected };
}

// ---- wording -----------------------------------------------------------------------------------------------------------------------------------------

export type MessageKind =
  | { kind: "edit" | "create" | "delete"; path: string }
  | { kind: "rename"; from: string; to: string }
  | { kind: "upload"; paths: string[] };

export function defaultMessage(k: MessageKind): string {
  switch (k.kind) {
    case "edit": return `Update ${k.path}`;
    case "create": return `Create ${k.path}`;
    case "delete": return `Delete ${k.path}`;
    case "rename": return `Rename ${k.from} to ${k.to}`;
    case "upload": return k.paths.length === 1 ? `Add ${k.paths[0]}` : `Add ${k.paths.length} files`;
  }
}

/** `<login>-patch-N` with the first N that is free (GitHub's own web editor names its branches the same way). */
export function suggestBranchName(login: string, existing: string[]): string {
  const taken = new Set(existing);
  const stem = login ? `${login}-patch-` : "patch-";
  let n = 1;
  while (taken.has(stem + n)) n++;
  return stem + n;
}

/** A `lookup` for validatePath over a Git tree listing (a submodule counts as a file: nothing can be put inside it). A truncated tree only knows part of the repository. */
export function treeLookup(tree: { tree: { path: string; type: string }[] }): (p: string) => "file" | "folder" | undefined {
  const m = new Map(tree.tree.map((i) => [i.path, i.type === "tree" ? ("folder" as const) : ("file" as const)]));
  return (p) => m.get(p);
}

// Blame for the Files page's Blame tab: the GraphQL query, its mapper and the line layout.
//
// Schema facts (checked live with `gh api graphql` against TrueNorthIT/TrueTunes):
//  - Commit.blame(path: String!) { ranges { startingLine endingLine age commit { oid abbreviatedOid messageHeadline committedDate author { name user { login avatarUrl } } } } } validates.
//  - `age` is GitHub's own 1 to 10 bucket (1 newest, 10 oldest), the one its blame page uses for the gutter colour.
//  - Ranges are 1-based and inclusive, in line order, and may be adjacent for the same commit (separate hunks).
import type { GraphQlRequest } from "./prQuery";
import { normalizeHistoryPath, mapPerson, type Person } from "./commitsQuery";

export interface BlameCommit {
  oid: string;
  abbreviatedOid: string;
  messageHeadline: string;
  committedDate: string;
  author: Person;
}

export interface BlameRange {
  startingLine: number;
  endingLine: number;
  age: number;
  commit: BlameCommit;
}

/** `blame(path: $path)` on the ref's commit. Variables { owner, name, ref, path }; `ref` may be a branch name or qualified ref. */
export function blameQuery(p: { owner: string; name: string; ref: string; path: string }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $ref: String!, $path: String!) { repository(owner: $owner, name: $name) { ref(qualifiedName: $ref) { target { ... on Commit { blame(path: $path) { ranges { startingLine endingLine age commit { oid abbreviatedOid messageHeadline committedDate author { name user { login avatarUrl } } } } } } } } } }`,
    variables: { owner: p.owner, name: p.name, ref: p.ref, path: normalizeHistoryPath(p.path) },
  };
}

/** The ranges of a blameQuery response; [] when the ref or file is missing. */
export function mapBlame(body: any): BlameRange[] {
  const ranges = body?.data?.repository?.ref?.target?.blame?.ranges;
  if (!Array.isArray(ranges)) return [];
  return ranges.map((r: any) => ({
    startingLine: r.startingLine,
    endingLine: r.endingLine,
    age: r.age,
    commit: {
      oid: r.commit.oid,
      abbreviatedOid: r.commit.abbreviatedOid,
      messageHeadline: r.commit.messageHeadline,
      committedDate: r.commit.committedDate,
      author: mapPerson(r.commit.author),
    },
  }));
}

/** Lines as the editor counts them: a final newline does not start another line, and an empty file is one (empty) line. */
export function lineCountOf(text: string): number {
  const t = text.replace(/(\r\n|\r|\n)$/, "");
  return t.split(/\r\n|\r|\n/).length;
}

/** GitHub's age as a 1 (newest) to 10 (oldest) bucket; anything unusable is 1. */
export function heatBucket(age: number | undefined | null): number {
  return typeof age === "number" && Number.isFinite(age) ? Math.min(10, Math.max(1, Math.round(age))) : 1;
}

export interface BlameBlock {
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  /** null for lines GitHub gave no blame for (a gap, or lines past the last range). */
  commit: BlameCommit | null;
  /** 1 to 10, or 0 when there is no commit. */
  heat: number;
}

/**
 * Covers lines 1..lineCount with blocks, each line in exactly one. Ranges are sorted, cut to the file, trimmed where they overlap an earlier
 * one, and malformed ones (end before start, wholly outside the file) are dropped. Lines no range covers become commit-less blocks.
 * Adjacent ranges from the same commit are one block.
 */
export function blameBlocks(ranges: BlameRange[], lineCount: number): BlameBlock[] {
  const out: BlameBlock[] = [];
  if (lineCount < 1) return out;
  const push = (startLine: number, endLine: number, commit: BlameCommit | null, age?: number) => {
    const last = out[out.length - 1];
    if (last && commit && last.commit?.oid === commit.oid) last.endLine = endLine;
    else out.push({ startLine, endLine, commit, heat: commit ? heatBucket(age) : 0 });
  };
  let next = 1;
  const sorted = ranges.filter((r) => r.endingLine >= r.startingLine && r.endingLine >= 1).sort((a, b) => a.startingLine - b.startingLine);
  for (const r of sorted) {
    const start = Math.max(r.startingLine, next);
    const end = Math.min(r.endingLine, lineCount);
    if (end < start) continue;
    if (start > next) push(next, start - 1, null);
    push(start, end, r.commit, r.age);
    next = end + 1;
  }
  if (next <= lineCount) push(next, lineCount, null);
  return out;
}

// Batch 3, @mentions in the comment box (CM-8). 
//
// Schema facts (checked live with `gh api graphql`):
//  - The user and team searches already exist and are validated in reviewerSearch.ts: userSearchQuery (repository.assignableUsers(query:, first:)), teamSearchQuery (organization.teams(query:, first:)),
//    userCandidates, teamCandidates. They are reused as they are; this module adds only the text handling and the mention-specific ranking.
//  - Repository.mentionableUsers(query: String, first: Int) also exists ("A list of Users that can be mentioned in the context of the repository"); it includes people who merely took part in the repository and
//    is what GitHub's own box uses. The requirement asks for assignableUsers, which lists only people who can be assigned (collaborators), so a commenter who is not a collaborator cannot be found by it.
//    Left as the requirement says (reviewerSearch.userSearchQuery); switching is a one-word change in a query builder, flagged in the batch report.
//  - A team is mentioned as @org/team-slug. Candidate.login for a team is its slug, so the handle needs the organisation name.
//  - GitHub logins are letters, digits and hyphens; Enterprise Managed Users logins also contain an underscore. A team handle adds "/".
import type { Candidate } from "./reviewerSearch";

export interface MentionMatch {
  /** The text typed after the "@" (no "@"), possibly empty. */
  query: string;
  /** Index of the "@" in the value. */
  start: number;
  /** The caret position: the replaced range is [start, end). */
  end: number;
}

import { fuzzyFind } from "./fuzzy";
const NL = String.fromCharCode(10);
const WORD = /[A-Za-z0-9_\-/]/;
const BOUNDARY = " \t" + NL + "([{\"'";

function inFence(before: string): boolean {
  let open: { ch: string; len: number } | null = null;
  for (const line of before.split(NL)) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!m) continue;
    if (!open) open = { ch: m[1][0], len: m[1].length };
    else if (m[1][0] === open.ch && m[1].length >= open.len && !m[2].trim()) open = null;
  }
  return !!open;
}


/**
 * The @mention being typed at `caret`, or null.
 *  - the text between an "@" and the caret must be made only of letters, digits, "-", "_" and "/" (so a space, comma or other punctuation after the "@" ends the mention). "@" alone gives query "".
 *  - the "@" must be at the start of the value or follow a space, tab, newline, "(", "[", "{", a double quote or a single quote. So "joe@example.com", "word@x", "@@x" and "https://host/@x" are not mentions.
 *  - not inside an inline code span (an unclosed single backtick earlier on the same line) and not inside a fenced code block (a line beginning with up to three spaces then ``` or ~~~ that is still open at the caret).
 *  - a caret outside 0..value.length gives null. Text after the caret is ignored: "hi @bo|b" gives query "bo".
 */
export function detectMention(value: string, caret: number): MentionMatch | null {
  if (caret < 0 || caret > value.length) return null;
  let i = caret;
  while (i > 0 && WORD.test(value[i - 1])) i--;
  if (i === 0 || value[i - 1] !== "@") return null;
  const start = i - 1;
  if (start > 0 && !BOUNDARY.includes(value[start - 1])) return null;
  const lineStart = value.lastIndexOf(NL, start - 1) + 1;
  if (value.slice(lineStart, start).split("`").length % 2 === 0) return null;
  if (inFence(value.slice(0, lineStart))) return null;
  return { query: value.slice(start + 1, caret), start, end: caret };
}

export interface RankMentionOptions {
  /** Logins of people already in this pull request (author, reviewers, commenters): ranked ahead of others in the same match tier. Compared ignoring case. */
  participants?: string[];
  /** Default 10. */
  limit?: number;
  /** The repository owner: needed for "org/slug" queries, which are matched against teams of that organisation only. */
  org?: string;
}

/**
 * Ranks users and teams for the mention list. Same tiers as reviewerSearch.rankCandidates (1 exact login, 2 login prefix, 3 fuzzy over login and name; everything else dropped; blank query keeps everyone),
 * but nobody is excluded (the author and current reviewers can be mentioned), and WITHIN a tier participants come first, then shorter login, then alphabetical by login, then users before teams.
 * A blank query: participants first, then alphabetical by login, users before teams. Case-insensitive; the query is trimmed. A query containing "/" is "org/slug-part": only teams, only when the part before
 * "/" equals options.org (ignoring case), ranked by the part after "/" (blank after "/" keeps every team). At most `limit` results.
 */
export function rankMentions(candidates: Candidate[], query: string, opts?: RankMentionOptions): Candidate[] {
  let q = query.trim().toLowerCase();
  let pool = candidates;
  if (q.includes("/")) {
    const [org, ...rest] = q.split("/");
    if (org !== (opts?.org ?? "").toLowerCase()) return [];
    q = rest.join("/");
    pool = candidates.filter((c) => c.kind === "team");
  }
  const people = new Set((opts?.participants ?? []).map((p) => p.toLowerCase()));
  const tier = (c: Candidate) => {
    const l = c.login.toLowerCase();
    if (!q) return 0;
    if (l === q) return 1;
    if (l.startsWith(q)) return 2;
    return fuzzyFind([c.login, c.name ?? ""].filter(Boolean), q, 1).length ? 3 : 4;
  };
  return pool
    .map((c) => ({ c, t: tier(c), l: c.login.toLowerCase() }))
    .filter((x) => x.t < 4)
    .sort((a, b) =>
      a.t - b.t || Number(!people.has(a.l)) - Number(!people.has(b.l)) || (a.t === 0 ? 0 : a.l.length - b.l.length) || (a.l < b.l ? -1 : a.l > b.l ? 1 : 0) || (a.c.kind === b.c.kind ? 0 : a.c.kind === "user" ? -1 : 1))
    .slice(0, opts?.limit ?? 10)
    .map((x) => x.c);
}

/** What goes after the "@": a user's login, or `${org}/${slug}` for a team (candidate.login is the slug). Throws "org is required for a team" for a team without an org. */
export function mentionHandle(c: Candidate, org?: string): string {
  if (c.kind === "user") return c.login;
  if (!org) throw new Error("org is required for a team");
  return `${org}/${c.login}`;
}

/**
 * Replaces [match.start, match.end) with `@${handle}` and makes sure one space follows. If the character right after the range is already a space (U+0020) no space is added; either way the caret goes
 * after that space. Everything else is untouched. Returns the new value and caret.
 */
export function insertMention(value: string, match: MentionMatch, handle: string): { value: string; caret: number } {
  const at = `@${handle}`;
  const space = value[match.end] === " " ? "" : " ";
  return { value: value.slice(0, match.start) + at + space + value.slice(match.end), caret: match.start + at.length + 1 };
}

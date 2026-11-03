// Batch 3, @mentions in the comment box (CM-8). STUBS: the developer implements them. Every function throws "Not implemented" except the types.
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

const NOT_IMPLEMENTED = "Not implemented";

/**
 * The @mention being typed at `caret`, or null.
 *  - the text between an "@" and the caret must be made only of letters, digits, "-", "_" and "/" (so a space, comma or other punctuation after the "@" ends the mention). "@" alone gives query "".
 *  - the "@" must be at the start of the value or follow a space, tab, newline, "(", "[", "{", a double quote or a single quote. So "joe@example.com", "word@x", "@@x" and "https://host/@x" are not mentions.
 *  - not inside an inline code span (an unclosed single backtick earlier on the same line) and not inside a fenced code block (a line beginning with up to three spaces then ``` or ~~~ that is still open at the caret).
 *  - a caret outside 0..value.length gives null. Text after the caret is ignored: "hi @bo|b" gives query "bo".
 */
export function detectMention(_value: string, _caret: number): MentionMatch | null {
  throw new Error(NOT_IMPLEMENTED);
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
export function rankMentions(_candidates: Candidate[], _query: string, _opts?: RankMentionOptions): Candidate[] {
  throw new Error(NOT_IMPLEMENTED);
}

/** What goes after the "@": a user's login, or `${org}/${slug}` for a team (candidate.login is the slug). Throws "org is required for a team" for a team without an org. */
export function mentionHandle(_c: Candidate, _org?: string): string {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Replaces [match.start, match.end) with `@${handle}` and makes sure one space follows. If the character right after the range is already a space (U+0020) no space is added; either way the caret goes
 * after that space. Everything else is untouched. Returns the new value and caret.
 */
export function insertMention(_value: string, _match: MentionMatch, _handle: string): { value: string; caret: number } {
  throw new Error(NOT_IMPLEMENTED);
}

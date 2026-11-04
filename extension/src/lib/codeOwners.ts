// Required and Optional reviewers. Native ADO lists reviewers under "Required" and "Optional". GitHub's nearest idea: when the target
// branch requires a code owner's review (classic protection's requiresCodeOwnerReviews, or a ruleset's pull_request rule with
// require_code_owner_review), the code owners of the changed files are effectively required; everyone else is optional.
//
// Who is a code owner comes from two places, and nothing is guessed:
//  - ReviewRequest.asCodeOwner (prEdit.ts): GitHub made the request because of CODEOWNERS. A request disappears once the reviewer has
//    reviewed, so this alone can't place someone who already voted;
//  - the CODEOWNERS file on the target branch (.github/, the root, then docs/, the first found) matched against the changed files, last
//    matching line winning. An owner given as a team or an email might be anyone, so a reviewer only covered that way is unknown.
// If the requirement or any reviewer's place is unknown, the section keeps its single "Requested" list.
import type { BranchRule } from "./branchRules";
import { rulesRequireCodeOwnerReview } from "./branchRules";

/** Where GitHub looks for CODEOWNERS, in its order. */
export const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

export interface CodeOwnersRule {
  pattern: string;
  /** As written: "@user", "@org/team" or an email. Empty: the paths have no owner. */
  owners: string[];
  re: RegExp;
}

const esc = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/** gitignore-style pattern as GitHub's CODEOWNERS reads it: anchored when it has a slash before its end, `*`, `**` and `?`, and a directory matches everything under it. */
export function patternRegExp(pattern: string): RegExp {
  let p = pattern;
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith("/") || p.includes("/");
  p = p.replace(/^\//, "");
  let body = "";
  for (let i = 0; i < p.length; i++) {
    if (p.startsWith("**/", i)) (body += "(?:.*/)?"), (i += 2);
    else if (p.startsWith("/**", i) && i + 3 === p.length) (body += "/.*"), (i += 2);
    else if (p.startsWith("**", i)) (body += ".*"), (i += 1);
    else if (p[i] === "*") body += "[^/]*";
    else if (p[i] === "?") body += "[^/]";
    else body += esc(p[i]);
  }
  // A literal last segment may name a directory, which owns everything under it; a wildcard one ("docs/*") matches one level only (GitHub's own example).
  const descend = !/[*?]/.test(p.split("/").pop() ?? "");
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${body}${dirOnly ? "/.*" : descend ? "(?:/.*)?" : ""}$`);
}

/** The rules of a CODEOWNERS file in order; blank lines and comments are skipped (a `#` token ends a line). */
export function parseCodeOwners(text: string): CodeOwnersRule[] {
  const out: CodeOwnersRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    const cut = tokens.findIndex((t) => t.startsWith("#"));
    const parts = cut < 0 ? tokens : tokens.slice(0, cut);
    if (!parts.length) continue;
    const [pattern, ...owners] = parts;
    out.push({ pattern, owners, re: patternRegExp(pattern) });
  }
  return out;
}

/** The owners of `path`: the last matching rule's, [] when none matches. */
export function ownersOf(rules: CodeOwnersRule[], path: string): string[] {
  let hit: string[] = [];
  for (const r of rules) if (r.re.test(path)) hit = r.owners;
  return hit;
}

export interface CodeOwnerSet {
  /** Lower-case user logins without "@". */
  users: Set<string>;
  /** Lower-case "org/slug". */
  teams: Set<string>;
  /** Some owner is an email: it could be any user. */
  emails: boolean;
}

/** Everyone who owns at least one of `paths`. */
export function codeOwnerSet(rules: CodeOwnersRule[], paths: string[]): CodeOwnerSet {
  const s: CodeOwnerSet = { users: new Set(), teams: new Set(), emails: false };
  for (const path of paths)
    for (const o of ownersOf(rules, path)) {
      if (!o.startsWith("@")) s.emails = s.emails || o.includes("@");
      else if (o.includes("/")) s.teams.add(o.slice(1).toLowerCase());
      else s.users.add(o.slice(1).toLowerCase());
    }
  return s;
}

/**
 * Does the target branch require a code owner's review? true when either source says so; false only when both are known and neither
 * does; undefined otherwise. classicRule: baseRef.branchProtectionRule (null: no rule, undefined: not known). rules: branchRules.ts (null or undefined: not known).
 */
export function codeOwnerRequirement(classicRule: { requiresCodeOwnerReviews?: boolean | null } | null | undefined, rules: BranchRule[] | null | undefined): boolean | undefined {
  const classic = classicRule === null ? false : classicRule?.requiresCodeOwnerReviews ?? undefined;
  const ruleset = rules ? rulesRequireCodeOwnerReview(rules) : undefined;
  if (classic === true || ruleset === true) return true;
  if (classic === false && ruleset === false) return false;
  return undefined;
}

export interface GroupReviewer {
  /** What the page shows and keys on: the user login, or the team's name. */
  login: string;
  /** The matching review request, when there is one: its kind, slug (team) and asCodeOwner. */
  request?: { kind: "user" | "team" | "bot"; login: string; codeOwner: boolean };
}

export type ReviewerGroups = { kind: "single" } | { kind: "grouped"; required: string[]; optional: string[] };

/**
 * Splits the reviewers into Required (code owners, when the branch requires their review) and Optional, keeping their order.
 * owners: codeOwnerSet of the changed files; null when the branch has no CODEOWNERS file, undefined when it isn't known. `org` is the repository owner (for team owners).
 */
export function reviewerGroups(list: GroupReviewer[], requirement: boolean | undefined, owners: CodeOwnerSet | null | undefined, org: string): ReviewerGroups {
  if (requirement === undefined) return { kind: "single" };
  if (requirement === false) return { kind: "grouped", required: [], optional: list.map((r) => r.login) };
  const required: string[] = [];
  const optional: string[] = [];
  for (const r of list) {
    const place = placeOf(r, owners, org);
    if (place === undefined) return { kind: "single" };
    (place ? required : optional).push(r.login);
  }
  return { kind: "grouped", required, optional };
}

/** true: a code owner; false: not one; undefined: can't tell. */
function placeOf(r: GroupReviewer, owners: CodeOwnerSet | null | undefined, org: string): boolean | undefined {
  if (r.request?.codeOwner) return true;
  if (r.request?.kind === "bot" || /\[bot\]$|^copilot-pull-request-reviewer$/i.test(r.login)) return false; // a bot is never a code owner
  if (owners === null) return false; // no CODEOWNERS file: nobody owns anything
  if (owners === undefined) return undefined;
  if (r.request?.kind === "team") return owners.teams.has(`${org}/${r.request.login}`.toLowerCase());
  if (owners.users.has(r.login.toLowerCase())) return true;
  return owners.teams.size || owners.emails ? undefined : false; // a team or email owner might be this user
}

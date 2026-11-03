// R2 AS-5, the Advanced Security page's place in the location hash. STUBS: the developer implements them. Every function throws "Not implemented".
//
// Sits alongside browseState.ts without editing it, as newPrHash.ts and prListFilters.ts do. Hash keys: `view=security`, `secTab`, `alert`, and the filters `secState`, `secSeverity`, `secBranch`, `secTool`, `secRule`, `secText`.
// Collision-checked against browseState.ts (repo, ref, path, tab, switch, view, prTab, pr, prPage, file, commit, commitTab, parent, branchTab, q), prListFilters.ts (author, assignee, reviewRequested, reviewedBy, label, draft, base, text)
// and newPrHash.ts (source, target). `ref`, `q` and `text` are taken, hence the `sec` prefix on the filters.
//
// Decisions fixed by the tests (securityHash.test.ts):
//  - `view` is shared with browseState, which only knows prs and repos: browseState.parse keeps a valid `repo` for `#repo=o/n&view=security&...` and DROPS the view and every key of this module, so the app reads parseSecurity(hash)
//    BEFORE it routes on browseState.parse, and a hash that browseState rewrites is put back with applySecurity (the same dance as newPrHash).
//  - serializeSecurity writes `#repo=...&view=security&secTab=...&alert=...&secState=...&secSeverity=...&secBranch=...&secTool=...&secRule=...&secText=...` in that order, leaving out anything absent or blank. Values are encodeURIComponent-encoded.
//  - Tabs: dependencies | code | secrets (AlertKind dependabot | code | secret). `alert` is a positive integer and only meaningful with a tab (an alert number belongs to one source), so it is read and written only with a valid secTab.
//  - secState is open | closed | dismissed | fixed; secSeverity is written lower-case (critical | high | medium | low | note) and read back as Critical ... Note; "none" is not a filter. Anything else is dropped.
//  - secBranch, secTool and secRule are capped at 255 characters, secText at 200; all are trimmed and blank ones dropped.
//  - parseSecurity is null unless the hash has view=security AND a valid repo (browseState's own rule); it never throws. A missing secState means "the page's default" (Open); the hash does not store defaults.
//  - applySecurity keeps the other segments verbatim and in order, drops every earlier `view` and every key of this module, and appends `view=security` then the module's keys in the order above.
import type { AlertKind, RatedSeverity, StateFilter } from "./securityTypes";

export type SecTab = "dependencies" | "code" | "secrets";

export interface SecurityHashState {
  /** "owner/name". */
  repo: string;
  tab?: SecTab;
  /** Only with `tab`. */
  alert?: number;
  state?: StateFilter;
  severity?: RatedSeverity;
  branch?: string;
  tool?: string;
  rule?: string;
  text?: string;
}

/** The Security state of a hash, or null (see the decisions above). */
export function parseSecurity(hash: string): SecurityHashState | null {
  throw new Error("Not implemented");
}

/** `#repo=...&view=security&secTab=...` (see the decisions above). */
export function serializeSecurity(s: SecurityHashState): string {
  throw new Error("Not implemented");
}

/** `hash` (with or without "#") with view and this module's keys replaced by view=security and the given state; the other segments are kept. Always starts with "#". */
export function applySecurity(hash: string, s: Omit<SecurityHashState, "repo">): string {
  throw new Error("Not implemented");
}

/** The Repos menu entry: the Advanced Security page of a repository, on its default tab. */
export function securityPageHash(repo: string): string {
  throw new Error("Not implemented");
}

/** A table row's link: the alert's detail page on its tab. */
export function alertDetailHash(repo: string, kind: AlertKind, number: number): string {
  throw new Error("Not implemented");
}

/** dependabot -> dependencies, code -> code, secret -> secrets. */
export function tabForKind(kind: AlertKind): SecTab {
  throw new Error("Not implemented");
}

/** dependencies -> dependabot, code -> code, secrets -> secret. */
export function kindForTab(tab: SecTab): AlertKind {
  throw new Error("Not implemented");
}

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
//  - Added later: secEcosystem (max 50) and secPackage (max 255) for Dependabot, secValidity (active | inactive | unknown) for secrets, written after secText.
//    The hash keeps them whatever the tab; the page sends each only to the source that takes it.
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
  /** Dependabot only: a package ecosystem (npm, pip, ...). */
  ecosystem?: string;
  /** Dependabot only: a package name. */
  package?: string;
  /** Secret scanning only. */
  validity?: SecretValidity;
}

export type SecretValidity = "active" | "inactive" | "unknown";

const REPO = /^[\w.-]+\/[\w.-]+$/;
const TABS: SecTab[] = ["dependencies", "code", "secrets"];
const STATES: StateFilter[] = ["open", "closed", "dismissed", "fixed"];
const SEVERITIES: RatedSeverity[] = ["Critical", "High", "Medium", "Low", "Note"];
const KEYS = ["view", "secTab", "alert", "secState", "secSeverity", "secBranch", "secTool", "secRule", "secText", "secEcosystem", "secPackage", "secValidity"];
const CAPS = { branch: 255, tool: 255, rule: 255, text: 200, ecosystem: 50, package: 255 } as const;
const VALIDITIES: SecretValidity[] = ["active", "inactive", "unknown"];

/** The Security state of a hash, or null (see the decisions above). */
export function parseSecurity(hash: string): SecurityHashState | null {
  const p = new URLSearchParams(hash.replace(/^#+/, ""));
  const repo = p.get("repo");
  if (p.get("view") !== "security" || !repo || !REPO.test(repo) || repo.split("/").some((s) => s === "." || s === "..")) return null;
  const out: SecurityHashState = { repo };
  const tab = p.get("secTab") as SecTab;
  if (TABS.includes(tab)) {
    out.tab = tab;
    const a = p.get("alert") ?? "";
    if (/^\d+$/.test(a) && Number.isSafeInteger(Number(a)) && Number(a) > 0) out.alert = Number(a);
  }
  const state = p.get("secState") as StateFilter;
  if (STATES.includes(state)) out.state = state;
  const sev = SEVERITIES.find((s) => s.toLowerCase() === p.get("secSeverity"));
  if (sev) out.severity = sev;
  for (const [k, key] of [["branch", "secBranch"], ["tool", "secTool"], ["rule", "secRule"], ["text", "secText"], ["ecosystem", "secEcosystem"], ["package", "secPackage"]] as const) {
    const v = (p.get(key) ?? "").trim().slice(0, CAPS[k]);
    if (v) out[k] = v;
  }
  const validity = p.get("secValidity") as SecretValidity;
  if (VALIDITIES.includes(validity)) out.validity = validity;
  return out;
}

/** `#repo=...&view=security&secTab=...` (see the decisions above). */
export function serializeSecurity(s: SecurityHashState): string {
  const { repo, ...rest } = s;
  return applySecurity(`#repo=${encodeURIComponent(repo)}`, rest);
}

/** `hash` (with or without "#") with view and this module's keys replaced by view=security and the given state; the other segments are kept. Always starts with "#". */
export function applySecurity(hash: string, s: Omit<SecurityHashState, "repo">): string {
  const kept = hash.replace(/^#+/, "").split("&").filter((x) => x && !KEYS.includes(x.split("=")[0]));
  kept.push("view=security");
  const add = (k: string, v: string | number | undefined) => {
    const t = String(v ?? "").trim();
    if (t) kept.push(`${k}=${encodeURIComponent(t)}`);
  };
  if (s.tab) {
    add("secTab", s.tab);
    add("alert", s.alert);
  }
  add("secState", s.state);
  add("secSeverity", s.severity?.toLowerCase());
  add("secBranch", s.branch?.trim().slice(0, CAPS.branch));
  add("secTool", s.tool?.trim().slice(0, CAPS.tool));
  add("secRule", s.rule?.trim().slice(0, CAPS.rule));
  add("secText", s.text?.trim().slice(0, CAPS.text));
  add("secEcosystem", s.ecosystem?.trim().slice(0, CAPS.ecosystem));
  add("secPackage", s.package?.trim().slice(0, CAPS.package));
  add("secValidity", s.validity && VALIDITIES.includes(s.validity) ? s.validity : undefined);
  return "#" + kept.join("&");
}

/** The Repos menu entry: the Advanced Security page of a repository, on its default tab. */
export function securityPageHash(repo: string): string {
  return serializeSecurity({ repo });
}

/** A table row's link: the alert's detail page on its tab. */
export function alertDetailHash(repo: string, kind: AlertKind, number: number): string {
  return serializeSecurity({ repo, tab: tabForKind(kind), alert: number });
}

/** dependabot -> dependencies, code -> code, secret -> secrets. */
export function tabForKind(kind: AlertKind): SecTab {
  return { dependabot: "dependencies", code: "code", secret: "secrets" }[kind] as SecTab;
}

/** dependencies -> dependabot, code -> code, secrets -> secret. */
export function kindForTab(tab: SecTab): AlertKind {
  return { dependencies: "dependabot", code: "code", secrets: "secret" }[tab] as AlertKind;
}

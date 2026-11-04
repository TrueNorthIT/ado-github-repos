// The hub's address-bar state lives in the host page's hash, reached through ADO's host navigation service.
import * as SDK from "azure-devops-extension-sdk";
import type { IHostNavigationService } from "azure-devops-extension-api/Common/CommonServices";
import { BrowseState, parse, serialize } from "./lib/browseState";
import { getProjectCtx } from "./connections";
import { rememberRepo } from "./lib/lastRepo";
import { onRepoMessage, post, sibling } from "./lib/repoChannel";
import { applyDiffHash, parseDiffHash, type DiffHashState } from "./lib/diffPrefs";
import { applyListFilters, parseListFilters, type ListFilters } from "./lib/prListFilters";
import { parseNewPr, type NewPrHashState } from "./lib/newPrHash";
import { parseSecurity, type SecurityHashState } from "./lib/securityHash";
import { parseActions, type ActionsHashState } from "./lib/actionsHash";
import { decideNav } from "./lib/dirtyGuard";
import { parseAgainst } from "./lib/fileTabs";
import { parseCompare, type CompareHashState } from "./lib/compareHash";
import { parsePolicies, type PolicyHashState } from "./lib/policyHash";
import { applyCommitFilters, parseCommitFilters, type CommitFilters } from "./lib/commitsRest";
import { applyPushFilters, parsePushFilters, type PushFilters } from "./lib/pushesHash";
import { parseLines, type LineRange } from "./lib/lineHash";
import { parseSearch, type SearchHashState } from "./lib/searchHash";
import * as React from "react";

// CommonServiceIds is a const enum, which esbuild cannot inline, so use the literal.
const NAV_SERVICE = "ms.vss-features.host-navigation-service";

/**
 * On a cold full load the host's getHash() can answer "" before it has read the address bar (seen live in 0.26.0: a
 * #...&pr=234 link opened the PR list, because the empty state made the PR hub fill in its default repo and replace
 * the real hash). An empty first answer is therefore read once more after a short wait before it is trusted.
 */
/** Delays (ms) between the re-reads of the host hash before a default repo is written to the address (about 10 s in all).
 *  4 s was not enough in 0.37.3: a cold load of an Actions job link (a heavier page) got its address replaced by #repo=<default>. */
export const IF_EMPTY_WAITS = [300, 700, 1200, 1800, 2500, 3500];

export async function readInitialHash(get: () => Promise<string>, waitMs = 400): Promise<string> {
  const first = await get();
  if (first.replace(/^#+/, "")) return first;
  await new Promise((r) => setTimeout(r, waitMs));
  return get();
}

// VW-2/4/8: the diff (sbs, ws) and list-filter keys are owned by diffPrefs and prListFilters, and BrowseState does not carry them. They are read from, and written
// to, the raw hash here; navigating inside the same repo keeps them (the diff keys while a PR is open, the filters while the PR hub is).
let rawHash = "";
let patcher: ((fn: (hash: string) => string) => void) | undefined;
const listeners = new Set<() => void>();
const setRaw = (h: string) => { rawHash = h; listeners.forEach((f) => f()); };

/** The sbs / ws keys and the list filters in the current hash; re-renders when the hash changes. */
export function useHashExtras(): { diff: DiffHashState; filters: ListFilters; newPr: NewPrHashState | null; security: SecurityHashState | null; actions: ActionsHashState | null; compare: CompareHashState | null; against: string | undefined; commitFilters: CommitFilters; pushFilters: PushFilters; policies: PolicyHashState | null; lines: LineRange | null; search: SearchHashState | null } {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => { listeners.add(tick as () => void); return () => void listeners.delete(tick as () => void); }, []);
  return React.useMemo(() => ({ diff: parseDiffHash(rawHash), filters: parseListFilters(rawHash), newPr: parseNewPr(rawHash), security: parseSecurity(rawHash), actions: parseActions(rawHash), compare: parseCompare(rawHash), against: parseAgainst(rawHash), commitFilters: parseCommitFilters(rawHash), pushFilters: parsePushFilters(rawHash), policies: parsePolicies(rawHash), lines: parseLines(rawHash), search: parseSearch(rawHash) }), [rawHash]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Rewrites the current hash without a history entry, e.g. `patchHash((h) => applyDiffHash(h, {...}))`. */
export const patchHash = (fn: (hash: string) => string) => patcher?.(fn);

/** Sets the whole hash (with a history entry). For states BrowseState cannot carry, such as the New pull request page (view=newpr, source, target). */
let hasher: ((hash: string) => void) | undefined;
export const gotoHash = (hash: string) => hasher?.(hash);

/**
 * An open editor with unsaved text (or a New file draft) registers itself here; every in-app navigation and every external
 * hash change then asks it first. `ask` shows the Discard dialog and calls `proceed` on Discard; `discard` closes the editor.
 */
export interface EditGuard { dirty: boolean; path: string; ask: (proceed: () => void) => void; discard: () => void }
let editGuard: EditGuard | null = null;
export const setEditGuard = (g: EditGuard | null) => { editGuard = g; };
const guarded = (cur: BrowseState, next: BrowseState, proceed: () => void): boolean => {
  const g = editGuard;
  if (!g || decideNav(g.dirty, cur, next) === "allow") return false;
  g.ask(() => { g.discard(); proceed(); });
  return true;
};

const carry = (next: BrowseState, prev: string) => {
  const h = serialize(next);
  if (!next.repo || next.repo !== parse(prev).repo) return h;
  // The Commits and Pushes filters stay while the repo does (a branch switch, a commit and back), as the PR list filters do.
  if (next.view !== "prs") return applyPushFilters(applyCommitFilters(h, parseCommitFilters(prev)), parsePushFilters(prev));
  return next.view === "prs" ? applyListFilters(next.pr ? applyDiffHash(h, parseDiffHash(prev)) : h, parseListFilters(prev)) : h;
};

export async function connectNav(onChange: (s: BrowseState) => void): Promise<(s: BrowseState, replace?: boolean | "ifEmpty") => void> {
  const svc = await SDK.getService<IHostNavigationService>(NAV_SERVICE);
  let current: BrowseState = {};

  // Tell the header breadcrumb frame on this page which repo is open; its own getHash() is unreliable.
  let remembered: string | undefined;
  const announce = (s: BrowseState) => {
    current = s;
    // Remember the repo on screen, so a hub opened from the left nav (no hash) opens it too (lib/lastRepo.ts).
    if (s.repo && s.repo !== remembered) {
      remembered = s.repo;
      const repo = s.repo;
      getProjectCtx().then((c) => rememberRepo(c.org, c.project, repo), () => {});
    }
    post(sibling("breadcrumb.html"), { type: "tn-gh-repo", repo: s.repo });
  };

  onRepoMessage((m, source) => {
    if (m.type === "tn-gh-hello") post(source, { type: "tn-gh-repo", repo: current.repo });
  });

  patcher = (fn) => {
    const h = fn(rawHash || "#");
    svc.replaceHash(h.slice(1));
    setRaw(h);
  };

  const applyHash = (h: string) => {
    setRaw(h);
    svc.setHash(h);
    const next = parse(h);
    announce(next);
    onChange(next);
  };
  hasher = (h) => { if (!guarded(current, parse(h), () => applyHash(h))) applyHash(h); };

  const emit = (h: string) => {
    setRaw(h);
    const s = parse(h);
    if (s.switch) svc.replaceHash(serialize({ ...s, switch: false }).slice(1)); // no leading "#": replaceHash adds its own. One-shot: clear the flag so reload/back do not reopen it
    announce(s);
    onChange(s);
  };

  // Bumped by every navigation, so a pending default fill can tell it has been overtaken.
  let navs = 0;
  emit(await readInitialHash(() => svc.getHash()));
  svc.onHashChanged((h) => {
    navs++;
    // Back/forward cannot be blocked: put the old address back, keep the editor, and ask. Discard moves on to the new address.
    // Discard must also put the new address back in the bar: the old one was restored while the dialog was up.
    const moveOn = () => { svc.replaceHash(h.replace(/^#+/, "")); emit(h); };
    if (h.replace(/^#+/, "") !== rawHash.replace(/^#+/, "") && guarded(current, parse(h), moveOn)) svc.replaceHash(rawHash.replace(/^#+/, ""));
    else emit(h);
  });
  const write = (s: BrowseState, replace?: boolean) => {
    navs++;
    const h = carry(s, rawHash);
    setRaw(h);
    if (replace) svc.replaceHash(h.slice(1)); // e.g. a hub filling in its default repo: no extra history entry
    else svc.setHash(h);
    const next = parse(h);
    announce(next);
    onChange(next); // do not rely on the host echoing programmatic changes back
  };
  return (s, replace) => {
    if (replace === undefined || replace === false) { if (guarded(current, s, () => write(s, replace))) return; } // a replace is a programmatic fix-up, not the user leaving
    if (replace !== "ifEmpty") return write(s, replace);
    // A default repo must never overwrite a real address. On a cold load the host can answer getHash() with "" for well
    // over a second (0.26.0, 0.27.1, and 0.31.0 even after a re-read: a #...&path=README.md link opened the repo root).
    // So show the default in memory only, keep asking, and adopt the real hash if it turns up; write the default to the
    // address only once it is still empty at the end, and never if the user navigated meanwhile.
    const at = navs;
    announce(s);
    onChange(parse(serialize(s)));
    void (async () => {
      for (const wait of IF_EMPTY_WAITS) {
        await new Promise((r) => setTimeout(r, wait));
        if (navs !== at) return;
        const h = await svc.getHash().catch(() => "");
        if (navs !== at) return;
        if (parse(h).repo) return emit(h);
      }
      write(s, true);
    })();
  };
}

export type HubId = "files" | "commits" | "pushes" | "branches" | "tags" | "prs" | "actions" | "security";
/** The contribution id of each hub, as in vss-extension.json. Files keeps the original id so old links survive. */
export const HUB_CONTRIBUTION: Record<HubId, string> = {
  files: "github-repos-hub",
  commits: "github-repos-commits-hub",
  pushes: "github-repos-pushes-hub",
  branches: "github-repos-branches-hub",
  tags: "github-repos-tags-hub",
  prs: "github-repos-prs-hub",
  actions: "github-repos-actions-hub",
  security: "github-repos-security-hub",
};
const HUB_SUFFIX = /github-repos(?:-[a-z]+)?-hub$/;

/** Which hub this page is, from the contribution id (every hub loads the same hub.html). */
export const currentHub = (contributionId: string = SDK.getContributionId()): HubId =>
  (/github-repos-(commits|pushes|branches|tags|prs|actions|security)-hub$/.exec(contributionId)?.[1] as HubId | undefined) ?? "files";

/** A hub's full contribution id from the current one: its hub suffix swapped, or, from a frame that is not a hub (a dashboard widget), its relative id. */
export const hubContributionId = (hub: HubId, current: string = SDK.getContributionId()) =>
  HUB_SUFFIX.test(current) ? current.replace(HUB_SUFFIX, HUB_CONTRIBUTION[hub]) : current.replace(/[^.]+$/, HUB_CONTRIBUTION[hub]);

/** Another hub's URL for a state: the current contribution id with its hub suffix swapped. */
export const hubHref = (ctx: { org: string; project: string }, hub: HubId, s: BrowseState | string) =>
  `https://dev.azure.com/${encodeURIComponent(ctx.org)}/${encodeURIComponent(ctx.project)}/_apps/hub/${hubContributionId(hub)}${typeof s === "string" ? s : serialize(s)}`;

/** `s` may be a ready-made hash (the New pull request page's, which BrowseState cannot carry). */
export async function openHub(hub: HubId, s: BrowseState | string): Promise<void> {
  (await SDK.getService<IHostNavigationService>(NAV_SERVICE)).navigate(hubHref(await getProjectCtx(), hub, s));
}

/** The Files hub's URL for a state (the PR page's branch and file links). */
export const repoHubHref = (ctx: { org: string; project: string }, s: BrowseState) => hubHref(ctx, "files", { ...s, view: undefined });

export const openRepoHub = (s: BrowseState) => openHub("files", { ...s, view: undefined });

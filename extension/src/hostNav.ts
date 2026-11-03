// The hub's address-bar state lives in the host page's hash, reached through ADO's host navigation service.
import * as SDK from "azure-devops-extension-sdk";
import type { IHostNavigationService } from "azure-devops-extension-api/Common/CommonServices";
import { BrowseState, parse, serialize } from "./lib/browseState";
import { getProjectCtx } from "./connections";
import { onRepoMessage, post, sibling } from "./lib/repoChannel";
import { applyDiffHash, parseDiffHash, type DiffHashState } from "./lib/diffPrefs";
import { applyListFilters, parseListFilters, type ListFilters } from "./lib/prListFilters";
import { parseNewPr, type NewPrHashState } from "./lib/newPrHash";
import { parseSecurity, type SecurityHashState } from "./lib/securityHash";
import * as React from "react";

// CommonServiceIds is a const enum, which esbuild cannot inline, so use the literal.
const NAV_SERVICE = "ms.vss-features.host-navigation-service";

/**
 * On a cold full load the host's getHash() can answer "" before it has read the address bar (seen live in 0.26.0: a
 * #...&pr=234 link opened the PR list, because the empty state made the PR hub fill in its default repo and replace
 * the real hash). An empty first answer is therefore read once more after a short wait before it is trusted.
 */
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
export function useHashExtras(): { diff: DiffHashState; filters: ListFilters; newPr: NewPrHashState | null; security: SecurityHashState | null } {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => { listeners.add(tick as () => void); return () => void listeners.delete(tick as () => void); }, []);
  return React.useMemo(() => ({ diff: parseDiffHash(rawHash), filters: parseListFilters(rawHash), newPr: parseNewPr(rawHash), security: parseSecurity(rawHash) }), [rawHash]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Rewrites the current hash without a history entry, e.g. `patchHash((h) => applyDiffHash(h, {...}))`. */
export const patchHash = (fn: (hash: string) => string) => patcher?.(fn);

/** Sets the whole hash (with a history entry). For states BrowseState cannot carry, such as the New pull request page (view=newpr, source, target). */
let hasher: ((hash: string) => void) | undefined;
export const gotoHash = (hash: string) => hasher?.(hash);

const carry = (next: BrowseState, prev: string) => {
  const h = serialize(next);
  if (!next.repo || next.repo !== parse(prev).repo) return h;
  return next.view === "prs" ? applyListFilters(next.pr ? applyDiffHash(h, parseDiffHash(prev)) : h, parseListFilters(prev)) : h;
};

export async function connectNav(onChange: (s: BrowseState) => void): Promise<(s: BrowseState, replace?: boolean | "ifEmpty") => void> {
  const svc = await SDK.getService<IHostNavigationService>(NAV_SERVICE);
  let current: BrowseState = {};

  // Tell the header breadcrumb frame on this page which repo is open; its own getHash() is unreliable.
  const announce = (s: BrowseState) => {
    current = s;
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

  hasher = (h) => {
    setRaw(h);
    svc.setHash(h);
    const next = parse(h);
    announce(next);
    onChange(next);
  };

  const emit = (h: string) => {
    setRaw(h);
    const s = parse(h);
    if (s.switch) svc.replaceHash(serialize({ ...s, switch: false }).slice(1)); // no leading "#": replaceHash adds its own. One-shot: clear the flag so reload/back do not reopen it
    announce(s);
    onChange(s);
  };

  emit(await readInitialHash(() => svc.getHash()));
  svc.onHashChanged(emit);
  const write = (s: BrowseState, replace?: boolean) => {
    const h = carry(s, rawHash);
    setRaw(h);
    if (replace) svc.replaceHash(h.slice(1)); // e.g. a hub filling in its default repo: no extra history entry
    else svc.setHash(h);
    const next = parse(h);
    announce(next);
    onChange(next); // do not rely on the host echoing programmatic changes back
  };
  return (s, replace) => {
    if (replace !== "ifEmpty") return write(s, replace);
    // A default repo must never overwrite a real address: the host can answer the first getHash() before it has the
    // hash (0.26.0 and again 0.27.1: a #...&pr=234 link opened the PR list). Ask again now; if a repo is there, use it.
    void (async () => {
      const h = await svc.getHash().catch(() => "");
      if (parse(h).repo) emit(h);
      else write(s, true);
    })();
  };
}

export type HubId = "files" | "commits" | "pushes" | "branches" | "tags" | "prs" | "security";
/** The contribution id of each hub, as in vss-extension.json. Files keeps the original id so old links survive. */
export const HUB_CONTRIBUTION: Record<HubId, string> = {
  files: "github-repos-hub",
  commits: "github-repos-commits-hub",
  pushes: "github-repos-pushes-hub",
  branches: "github-repos-branches-hub",
  tags: "github-repos-tags-hub",
  prs: "github-repos-prs-hub",
  security: "github-repos-security-hub",
};
const HUB_SUFFIX = /github-repos(?:-[a-z]+)?-hub$/;

/** Which hub this page is, from the contribution id (every hub loads the same hub.html). */
export const currentHub = (contributionId: string = SDK.getContributionId()): HubId =>
  (/github-repos-(commits|pushes|branches|tags|prs|security)-hub$/.exec(contributionId)?.[1] as HubId | undefined) ?? "files";

/** Another hub's URL for a state: the current contribution id with its hub suffix swapped. */
export const hubHref = (ctx: { org: string; project: string }, hub: HubId, s: BrowseState | string) =>
  `https://dev.azure.com/${encodeURIComponent(ctx.org)}/${encodeURIComponent(ctx.project)}/_apps/hub/${SDK.getContributionId().replace(HUB_SUFFIX, HUB_CONTRIBUTION[hub])}${typeof s === "string" ? s : serialize(s)}`;

/** `s` may be a ready-made hash (the New pull request page's, which BrowseState cannot carry). */
export async function openHub(hub: HubId, s: BrowseState | string): Promise<void> {
  (await SDK.getService<IHostNavigationService>(NAV_SERVICE)).navigate(hubHref(await getProjectCtx(), hub, s));
}

/** The Files hub's URL for a state (the PR page's branch and file links). */
export const repoHubHref = (ctx: { org: string; project: string }, s: BrowseState) => hubHref(ctx, "files", { ...s, view: undefined });

export const openRepoHub = (s: BrowseState) => openHub("files", { ...s, view: undefined });

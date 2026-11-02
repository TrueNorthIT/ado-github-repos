// The hub's address-bar state lives in the host page's hash, reached through ADO's host navigation service.
import * as SDK from "azure-devops-extension-sdk";
import type { IHostNavigationService } from "azure-devops-extension-api/Common/CommonServices";
import { BrowseState, parse, serialize } from "./lib/browseState";
import { getProjectCtx } from "./connections";
import { onRepoMessage, post, sibling } from "./lib/repoChannel";

// CommonServiceIds is a const enum, which esbuild cannot inline, so use the literal.
const NAV_SERVICE = "ms.vss-features.host-navigation-service";

export async function connectNav(onChange: (s: BrowseState) => void): Promise<(s: BrowseState, replace?: boolean) => void> {
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

  const emit = (h: string) => {
    const s = parse(h);
    if (s.switch) svc.replaceHash(serialize({ ...s, switch: false }).slice(1)); // no leading "#": replaceHash adds its own. One-shot: clear the flag so reload/back do not reopen it
    announce(s);
    onChange(s);
  };

  emit(await svc.getHash());
  svc.onHashChanged(emit);
  return (s, replace) => {
    if (replace) svc.replaceHash(serialize(s).slice(1)); // e.g. the PR hub filling in its default repo: no extra history entry
    else svc.setHash(serialize(s));
    const next = parse(serialize(s));
    announce(next);
    onChange(next); // do not rely on the host echoing programmatic changes back
  };
}

/** The Repositories hub's URL for a state (the PR page's branch and file links: the PR hub itself has no file browser). */
export const repoHubHref = (ctx: { org: string; project: string }, s: BrowseState) =>
  `https://dev.azure.com/${encodeURIComponent(ctx.org)}/${encodeURIComponent(ctx.project)}/_apps/hub/${SDK.getContributionId().replace(/-prs-hub$/, "-hub")}${serialize({ ...s, view: undefined })}`;

export async function openRepoHub(s: BrowseState): Promise<void> {
  (await SDK.getService<IHostNavigationService>(NAV_SERVICE)).navigate(repoHubHref(await getProjectCtx(), s));
}

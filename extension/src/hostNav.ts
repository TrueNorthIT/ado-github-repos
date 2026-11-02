// The hub's address-bar state lives in the host page's hash, reached through ADO's host navigation service.
import * as SDK from "azure-devops-extension-sdk";
import type { IHostNavigationService } from "azure-devops-extension-api/Common/CommonServices";
import { BrowseState, parse, serialize } from "./lib/browseState";
import { REPO_CHANNEL, type RepoMessage } from "./lib/repoChannel";

// CommonServiceIds is a const enum, which esbuild cannot inline, so use the literal.
const NAV_SERVICE = "ms.vss-features.host-navigation-service";

export async function connectNav(onChange: (s: BrowseState) => void): Promise<(s: BrowseState) => void> {
  const svc = await SDK.getService<IHostNavigationService>(NAV_SERVICE);
  // Tell the header breadcrumb frame (same origin) which repo is open; its own getHash is unreliable on a direct load.
  const ch = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(REPO_CHANNEL);
  let current: string | undefined;
  const announce = (repo?: string) => { current = repo; ch?.postMessage({ type: "repo", repo } satisfies RepoMessage); };
  ch?.addEventListener("message", (e: MessageEvent<RepoMessage>) => { if (e.data?.type === "hello") announce(current); });

  const emit = (h: string) => {
    const s = parse(h);
    if (s.switch) svc.replaceHash(serialize({ ...s, switch: false })); // one-shot: clear the flag so reload/back do not reopen it
    announce(s.repo);
    onChange(s);
  };
  emit(await svc.getHash());
  svc.onHashChanged(emit);
  return (s) => {
    svc.setHash(serialize(s));
    const next = parse(serialize(s));
    announce(next.repo);
    onChange(next); // do not rely on the host echoing programmatic changes back
  };
}

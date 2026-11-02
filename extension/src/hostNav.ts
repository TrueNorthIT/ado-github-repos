// The hub's address-bar state lives in the host page's hash, reached through ADO's host navigation service.
import * as SDK from "azure-devops-extension-sdk";
import type { IHostNavigationService } from "azure-devops-extension-api/Common/CommonServices";
import { BrowseState, parse, serialize } from "./lib/browseState";
import { onRepoMessage, post, sibling } from "./lib/repoChannel";
import { getProjectCtx } from "./connections";

// CommonServiceIds is a const enum, which esbuild cannot inline, so use the literal.
const NAV_SERVICE = "ms.vss-features.host-navigation-service";

// Self-navigation workaround: on a full page load ADO never subscribes to the header breadcrumb provider (seen live,
// 0.8.0-0.11.0), but it does after an in-app navigation. When the breadcrumb frame reports no subscriber, navigate to
// this hub once and restore the state, which ADO drops from the hash on in-app navigation.
// ponytail: relies on undocumented ADO behaviour; GUARD_MS stops a loop if navigate() turns out to be a full reload.
const GUARD = "tn-gh-selfnav-at";
const STASH = "tn-gh-selfnav-hash";
const GUARD_MS = 30_000;
const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); return true; } catch { return false; } },
  del: (k: string) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};
const recent = (k: string) => Date.now() - Number(store.get(k) ?? 0) < GUARD_MS;

export async function connectNav(onChange: (s: BrowseState) => void): Promise<(s: BrowseState) => void> {
  const svc = await SDK.getService<IHostNavigationService>(NAV_SERVICE);
  let current: BrowseState = {};

  // Tell the header breadcrumb frame on this page which repo is open; its own getHash() is unreliable.
  const announce = (s: BrowseState) => {
    current = s;
    post(sibling("breadcrumb.html"), { type: "tn-gh-repo", repo: s.repo });
  };

  async function selfNavigate() {
    if (!current.repo || recent(GUARD)) return;
    if (!store.set(GUARD, String(Date.now())) || !store.set(STASH, serialize({ ...current, switch: false }))) return;
    const ctx = await getProjectCtx();
    svc.navigate(`https://dev.azure.com/${encodeURIComponent(ctx.org)}/${encodeURIComponent(ctx.project)}/_apps/hub/${SDK.getContributionId()}`);
  }

  onRepoMessage((m, source) => {
    if (m.type === "tn-gh-hello") post(source, { type: "tn-gh-repo", repo: current.repo });
    else if (m.type === "tn-gh-unsubscribed") void selfNavigate();
  });

  const emit = (h: string) => {
    const s = parse(h);
    if (s.switch) svc.replaceHash(serialize({ ...s, switch: false })); // one-shot: clear the flag so reload/back do not reopen it
    announce(s);
    onChange(s);
  };

  let initial = await svc.getHash();
  const stash = store.get(STASH);
  if (stash && recent(GUARD) && !parse(initial).repo) {
    // Landed here from selfNavigate(): put the state back.
    svc.replaceHash(stash);
    initial = stash;
  }
  store.del(STASH);
  emit(initial);
  svc.onHashChanged(emit);
  return (s) => {
    svc.setHash(serialize(s));
    const next = parse(serialize(s));
    announce(next);
    onChange(next); // do not rely on the host echoing programmatic changes back
  };
}

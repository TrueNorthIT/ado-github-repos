// Header breadcrumb provider (loaded in its own small frame by breadcrumb.html): shows "owner/name" for the repo the hub is on.
// Keep this free of React and the app: it ships as its own bundle.
import * as SDK from "azure-devops-extension-sdk";
import type { IHostNavigationService } from "azure-devops-extension-api/Common/CommonServices";
import { ObservableArray } from "azure-devops-ui/Core/Observable";
import type { IBreadcrumbItem } from "azure-devops-ui/Breadcrumb";
import { parse, serialize } from "./lib/browseState";
import { onRepoMessage, post, sibling } from "./lib/repoChannel";

// Must match serviceName in vss-extension.json. CommonServiceIds is a const enum, so the nav service id is a literal.
const SERVICE = "github-repos-breadcrumb";
const NAV_SERVICE = "ms.vss-features.host-navigation-service";

const items = new ObservableArray<IBreadcrumbItem>([]);
let shown: string | undefined;
let isReady = false;

function setRepo(candidate?: string) {
  const repo = candidate ? parse(serialize({ repo: candidate })).repo : undefined; // validate owner/name
  if (repo === shown) return;
  shown = repo;
  // Clicking sets the one-shot switch flag; the hub opens its repo switcher (see hostNav.ts).
  items.splice(0, items.length, ...(repo ? [{ key: "gh-repo", text: repo, ariaLabel: `Repository ${repo}. Switch repository`, href: serialize({ repo, switch: true }), iconProps: { iconName: "GitHubLogo" }, rank: 1000 }] : []));
  if (isReady) checkSubscribed();
}

// On a full page load ADO never subscribes to this list, so the item would never reach the header. Tell the hub, which
// re-enters itself with an in-app navigation (see selfNavigate in hostNav.ts). Short delay: ADO subscribes right after
// it receives the list.
let checkTimer: ReturnType<typeof setTimeout> | undefined;
function checkSubscribed() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    // subscriberCount is protected in the typings but a plain field at runtime (it is in the list ADO receives).
    if (shown && (items as unknown as { subscriberCount: number }).subscriberCount === 0) post(sibling("hub.html"), { type: "tn-gh-unsubscribed" });
  }, 2500);
}

// Source 1: the hub frame on this page tells us the open repo (see hostNav.ts).
let heard: () => void = () => {};
const heardFromHub = new Promise<void>((r) => (heard = r));
onRepoMessage((m) => {
  if (m.type === "tn-gh-repo") { setRepo(m.repo); heard(); }
});
post(sibling("hub.html"), { type: "tn-gh-hello" });

// The host asks the frame for an object by exact name: registeredObjectId, the full contribution id or serviceName,
// depending on the code path. Register under all of them. It then calls getBreadcrumbItems(breadcrumbId) if present,
// otherwise treats the object itself as the observable list (host ContributedBreadcrumb.getBreadcrumbItems).
// The host snapshots the list, then subscribes, so answer only once the initial repo is known (or after a short wait).
let ready: Promise<void> = Promise.resolve();
const provider = { getBreadcrumbItems: () => ready.then(() => items) };
for (const id of [SERVICE, `TrueNorthIT.github-repos.${SERVICE}`]) SDK.register(id, provider);

ready = SDK.init().then(async () => {
  const nav = await SDK.getService<IHostNavigationService>(NAV_SERVICE);
  // Source 2 (fallback): the host hash.
  const fromHash = (h: string) => { const r = parse(h).repo; if (r) setRepo(r); };
  fromHash(await nav.getHash());
  nav.onHashChanged(fromHash);
  if (!shown) await Promise.race([heardFromHub, new Promise((r) => setTimeout(r, 1500))]);
});
ready.then(() => { isReady = true; checkSubscribed(); });

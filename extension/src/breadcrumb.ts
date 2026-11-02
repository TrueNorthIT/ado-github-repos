// Header breadcrumb provider (loaded in its own small frame by breadcrumb.html): shows "owner/name" for the repo the hub is on.
// Keep this free of React and the app: it ships as its own bundle.
import * as SDK from "azure-devops-extension-sdk";
import type { IHostNavigationService } from "azure-devops-extension-api/Common/CommonServices";
import { ObservableArray } from "azure-devops-ui/Core/Observable";
import type { IBreadcrumbItem } from "azure-devops-ui/Breadcrumb";
import { parse, serialize } from "./lib/browseState";

// Must match serviceName in vss-extension.json. CommonServiceIds is a const enum, so the nav service id is a literal.
const SERVICE = "github-repos-breadcrumb";
const NAV_SERVICE = "ms.vss-features.host-navigation-service";

const items = new ObservableArray<IBreadcrumbItem>([]);
let shown: string | undefined;

function show(hash: string) {
  const repo = parse(hash).repo;
  if (repo === shown) return;
  shown = repo;
  // Clicking sets the one-shot switch flag; the hub opens its repo switcher (see hostNav.ts).
  items.splice(0, items.length, ...(repo ? [{ key: "gh-repo", text: repo, ariaLabel: `Repository ${repo}. Switch repository`, href: serialize({ repo, switch: true }), iconProps: { iconName: "GitHubLogo" }, rank: 1000 }] : []));
}

SDK.register(SERVICE, () => items);

SDK.init().then(async () => {
  const nav = await SDK.getService<IHostNavigationService>(NAV_SERVICE);
  show(await nav.getHash());
  nav.onHashChanged(show);
  // ponytail: untested whether this frame gets hash events; the poll is the fallback. Drop it once confirmed in real ADO.
  setInterval(async () => show(await nav.getHash()), 2000);
});

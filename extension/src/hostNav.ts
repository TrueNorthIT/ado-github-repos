// The hub's address-bar state lives in the host page's hash, reached through ADO's host navigation service.
import * as SDK from "azure-devops-extension-sdk";
import type { IHostNavigationService } from "azure-devops-extension-api/Common/CommonServices";
import { BrowseState, parse, serialize } from "./lib/browseState";

// CommonServiceIds is a const enum, which esbuild cannot inline, so use the literal.
const NAV_SERVICE = "ms.vss-features.host-navigation-service";

export async function connectNav(onChange: (s: BrowseState) => void): Promise<(s: BrowseState) => void> {
  const svc = await SDK.getService<IHostNavigationService>(NAV_SERVICE);
  onChange(parse(await svc.getHash()));
  svc.onHashChanged((h) => onChange(parse(h)));
  return (s) => {
    svc.setHash(serialize(s));
    onChange(parse(serialize(s))); // do not rely on the host echoing programmatic changes back
  };
}

// Links between the hubs (each hub is its own page; the PR hub has no file browser, the Files hub has no commit list...).
import * as React from "react";
import { BrowseState, serialize } from "./lib/browseState";
import { loadProject } from "./connections";
import { hubHref, openHub, openRepoHub, repoHubHref, type HubId } from "./hostNav";
import { hubClick } from "./Browser";

/** Hrefs into any hub. Plain hash links until the project context is known. */
export function useHubHref() {
  const [ctx, setCtx] = React.useState<{ org: string; project: string }>();
  React.useEffect(() => { void loadProject().then((p) => setCtx(p.ctx), () => {}); }, []);
  return React.useCallback((hub: HubId, s: BrowseState) => (ctx ? hubHref(ctx, hub, s) : serialize(s)), [ctx]);
}

/** Hrefs into the Repositories (Files) hub. Plain until the project context is known. */
export function useRepoHref() {
  const [ctx, setCtx] = React.useState<{ org: string; project: string }>();
  React.useEffect(() => { void loadProject().then((p) => setCtx(p.ctx), () => {}); }, []);
  return React.useCallback((s: BrowseState) => (ctx ? repoHubHref(ctx, s) : serialize({ ...s, view: undefined })), [ctx]);
}
export const openInRepos = (s: BrowseState) => (e?: React.MouseEvent | React.KeyboardEvent) => hubClick(() => void openRepoHub(s))(e);
/** Plain clicks open another hub; modified clicks keep the link's own behaviour. */
export const openInHub = (hub: HubId, s: BrowseState) => (e?: React.MouseEvent | React.KeyboardEvent) => hubClick(() => void openHub(hub, s))(e);

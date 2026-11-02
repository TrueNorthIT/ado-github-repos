// Links from the PR page into the Repositories hub (the PR hub has no file browser).
import * as React from "react";
import { BrowseState, serialize } from "./lib/browseState";
import { loadProject } from "./connections";
import { openRepoHub, repoHubHref } from "./hostNav";
import { hubClick } from "./Browser";

/** Hrefs into the Repositories hub (the PR hub has no file browser). Plain until the project context is known. */
export function useRepoHref() {
  const [ctx, setCtx] = React.useState<{ org: string; project: string }>();
  React.useEffect(() => { void loadProject().then((p) => setCtx(p.ctx), () => {}); }, []);
  return React.useCallback((s: BrowseState) => (ctx ? repoHubHref(ctx, s) : serialize({ ...s, view: undefined })), [ctx]);
}
export const openInRepos = (s: BrowseState) => (e?: React.MouseEvent | React.KeyboardEvent) => hubClick(() => void openRepoHub(s))(e);


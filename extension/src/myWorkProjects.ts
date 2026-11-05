// Which projects in this organisation connect which GitHub repositories (Azure Boards GitHub connections), for the My work tab.
// Listing projects needs the vso.project scope. Without it (an org that hasn't approved the scope yet) the tab falls back to the
// project the page is in, when there is one.
import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import { fetchConnections, get, getProjectCtx, PermissionError } from "./connections";
import { connectedRepos, projectIndex, readProjectCache, type ProjectRepos } from "./lib/myWork";

const POOL = 6;

async function pooled<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function reposOf(org: string, project: string): Promise<ProjectRepos> {
  try {
    return { project, repos: connectedRepos(await fetchConnections({ org, project, settingsUrl: "" })) };
  } catch {
    return { project, repos: [] }; // no access to this project's connections: it connects nothing we can see
  }
}

/** Every well-formed project's connected repositories; throws PermissionError without the vso.project scope. */
export async function scanProjects(org: string): Promise<ProjectRepos[]> {
  const r = await get<{ value?: { name: string }[] }>(`https://dev.azure.com/${encodeURIComponent(org)}/_apis/projects?stateFilter=wellFormed&$top=1000&api-version=7.1`);
  const names = (r.value ?? []).map((p) => p.name).sort((a, b) => a.localeCompare(b));
  return (await pooled(names, (n) => reposOf(org, n))).filter((p) => p.repos.length);
}

export type ProjectsLoad =
  | { t: "loading" }
  | { t: "ready"; index: Map<string, string[]>; /** Only the current project could be read (no vso.project scope). */ partial: boolean }
  | { t: "error"; message: string };

const cacheKey = (org: string) => `gh-mywork-projects:${org.toLowerCase()}`;
const readStore = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeStore = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: scan again next time */ } };

/** The repository → projects index: from the cache straight away when there is one, refreshed in the background when it is old. */
export function useProjectIndex(): ProjectsLoad {
  const [load, setLoad] = React.useState<ProjectsLoad>({ t: "loading" });
  React.useEffect(() => {
    let dead = false;
    const org = SDK.getHost().name;
    const cached = readProjectCache(readStore(cacheKey(org)), Date.now());
    if (cached) setLoad({ t: "ready", index: projectIndex(cached.list), partial: false });
    if (cached?.fresh) return;
    scanProjects(org).then(
      (list) => {
        writeStore(cacheKey(org), JSON.stringify({ at: Date.now(), list }));
        if (!dead) setLoad({ t: "ready", index: projectIndex(list), partial: false });
      },
      async (e) => {
        console.warn("[GitHub my work] could not list the organisation's projects", e);
        if (dead || cached) return; // keep showing the cached index
        if (e instanceof PermissionError) {
          try {
            const ctx = await getProjectCtx(); // the page's own project, if the flyout was opened inside one
            const one = await reposOf(org, ctx.project);
            if (!dead) setLoad({ t: "ready", index: projectIndex([one]), partial: true });
            return;
          } catch {
            /* not in a project */
          }
        }
        if (!dead) setLoad({ t: "error", message: e instanceof PermissionError ? "This extension can't list the organisation's projects yet. An administrator needs to approve its updated permissions (Organization settings, Extensions)." : "Could not read which projects your GitHub repositories are connected to." });
      }
    );
    return () => { dead = true; };
  }, []);
  return load;
}

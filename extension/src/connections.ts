// All Azure DevOps githubconnections access lives here, so a fallback can replace it later.
import * as SDK from "azure-devops-extension-sdk";
import type { IProjectPageService } from "azure-devops-extension-api/Common/CommonServices";
import type { Connection } from "./lib/rows";

// CommonServiceIds is a const enum, which esbuild cannot inline, so use the literal.
const PROJECT_PAGE_SERVICE = "ms.vss-tfs-web.tfs-page-data-service";
const API = "api-version=7.1-preview.1";

export class PermissionError extends Error {}

export interface ProjectCtx {
  org: string;
  project: string;
  settingsUrl: string;
}

export async function getProjectCtx(): Promise<ProjectCtx> {
  const host = SDK.getHost();
  const proj = await (await SDK.getService<IProjectPageService>(PROJECT_PAGE_SERVICE)).getProject();
  if (!proj) throw new Error("No project context.");
  const base = `https://dev.azure.com/${encodeURIComponent(host.name)}/${encodeURIComponent(proj.name)}`;
  // ponytail: settings page slug taken from ADO's UI (Project settings > GitHub connections); verify in a live org.
  return { org: host.name, project: proj.name, settingsUrl: `${base}/_settings/boards-external-integration` };
}

export async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await SDK.getAccessToken()}`, Accept: "application/json" } });
  if (res.status === 401 || res.status === 403) throw new PermissionError(String(res.status));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Lists connections and their repos. Only `id` is guaranteed on a connection (non-admins get fewer fields). */
export async function fetchConnections(ctx: ProjectCtx): Promise<Connection[]> {
  const base = `https://dev.azure.com/${encodeURIComponent(ctx.org)}/${encodeURIComponent(ctx.project)}/_apis/githubconnections`;
  const list = await get<{ value?: { id: string; isConnectionValid?: boolean }[] }>(`${base}?${API}`);
  return Promise.all(
    (list.value ?? []).map(async (c): Promise<Connection> => {
      try {
        const r = await get<{ value?: Connection["repos"] }>(`${base}/${encodeURIComponent(c.id)}/repos?${API}`);
        return { id: c.id, isConnectionValid: c.isConnectionValid, repos: r.value ?? [] };
      } catch (e) {
        return { id: c.id, isConnectionValid: c.isConnectionValid, repos: [], fetchError: "could not load its repositories." };
      }
    })
  );
}

let cached: Promise<{ ctx: ProjectCtx; connections: Connection[] }> | undefined;
/** The project context and its connections, fetched once and shared by the list and the repo switcher. A failure is not cached. */
export function loadProject() {
  cached ??= (async () => {
    const ctx = await getProjectCtx();
    return { ctx, connections: await fetchConnections(ctx) };
  })().catch((e) => {
    cached = undefined;
    throw e;
  });
  return cached;
}

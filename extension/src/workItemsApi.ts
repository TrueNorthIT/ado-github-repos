// Azure Boards lookups for the PR page (PR-7), through the ADO access token like connections.ts.
import { PermissionError, get, getProjectCtx, patch } from "./connections";
import { completeWorkItemPatch, completeWorkItemUrl, planCompletion, workItemStatesUrl, type WorkItemStatesResponse } from "./lib/completeWorkItems";
import { parseWorkItems, workItemsUrl, workItemUrl, type WorkItemRef } from "./lib/workItems";

export interface WorkItemType { color?: string; iconUrl?: string }
export interface WorkItemsResult { items: WorkItemRef[]; types: Record<string, WorkItemType>; url: (id: number) => string }

// Colour and icon per type name, once per session. ponytail: project-scoped, so an item from another project with a custom type just gets no icon.
let types: Promise<Record<string, WorkItemType>> | undefined;
const loadTypes = (org: string, project: string) =>
  (types ??= get<{ value?: { name: string; color?: string; icon?: { url?: string } }[] }>(`https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes?api-version=7.1`)
    .then((r) => Object.fromEntries((r.value ?? []).map((t) => [t.name, { color: t.color, iconUrl: t.icon?.url }])))
    .catch(() => ((types = undefined), {} as Record<string, WorkItemType>)));

/** One call for all ids. Rejects with connections.ts PermissionError on 401/403; type colours are best effort. */
export async function fetchWorkItems(ids: number[]): Promise<WorkItemsResult> {
  const { org, project } = await getProjectCtx();
  const [body, t] = await Promise.all([get<{ value?: never[] }>(workItemsUrl(org, ids)), loadTypes(org, project)]);
  return { items: parseWorkItems(ids, body), types: t, url: (id) => workItemUrl(org, project, id) };
}

export interface CompletionResult { updated: number; skipped: number; failed: number }

/** Moves each item to its type's first Completed-category state. Per-item failures are counted, not thrown; a missing work_write scope rejects with PermissionError. */
export async function completeWorkItems(items: WorkItemRef[]): Promise<CompletionResult> {
  const { org, project } = await getProjectCtx();
  const typeNames = [...new Set(items.filter((i) => i.found && i.type).map((i) => i.type!))];
  const statesByType: Record<string, WorkItemStatesResponse> = {};
  await Promise.all(typeNames.map(async (t) => { statesByType[t] = await get<WorkItemStatesResponse>(workItemStatesUrl(org, project, t)); }));
  const plan = planCompletion(items, statesByType);
  let failed = 0;
  for (const u of plan.updates) {
    try {
      await patch(completeWorkItemUrl(org, u.id), completeWorkItemPatch(u.state));
    } catch (e) {
      if (e instanceof PermissionError) throw e;
      failed++;
    }
  }
  return { updated: plan.updates.length - failed, skipped: plan.skipped.length, failed };
}

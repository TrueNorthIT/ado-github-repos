// Azure Boards lookups for the PR page (PR-7), through the ADO access token like connections.ts.
import { PermissionError, get, getProjectCtx, patch, post } from "./connections";
import { completeWorkItemPatch, completeWorkItemUrl, planCompletion, workItemStatesUrl, type WorkItemStatesResponse } from "./lib/completeWorkItems";
import { parseWiqlIds, parseWorkItemId, wiqlTitleQuery, wiqlUrl } from "./lib/workItemSearch";
import { parseWorkItems, workItemsUrl, workItemUrl, type WorkItemRef } from "./lib/workItems";
import { toWorkItemCard, workItemCardUrl, type WorkItemCard } from "./lib/hoverCard";

/** A type's colour and icon, and its states' colours by name (hex without "#"), from the types list. */
export interface WorkItemType { color?: string; iconUrl?: string; states?: Record<string, string> }
export interface WorkItemsResult { items: WorkItemRef[]; types: Record<string, WorkItemType>; url: (id: number) => string }

// Colour and icon per type name, once per session. ponytail: project-scoped, so an item from another project with a custom type just gets no icon.
let types: Promise<Record<string, WorkItemType>> | undefined;
const loadTypes = (org: string, project: string) =>
  (types ??= get<{ value?: { name: string; color?: string; icon?: { url?: string }; states?: { name: string; color?: string }[] }[] }>(`https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes?api-version=7.1`)
    .then((r) => Object.fromEntries((r.value ?? []).map((t) => [t.name, { color: t.color, iconUrl: t.icon?.url, states: Object.fromEntries((t.states ?? []).filter((s) => s.color).map((s) => [s.name, s.color!])) }])))
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

const SEARCH_TOP = 10;

/** ED-4: work items to link. An id (or AB#id) looks that item up; anything else is a title search (WIQL) in the current project. Items ADO does not return are left out. */
export async function searchWorkItems(text: string): Promise<WorkItemRef[]> {
  const { org, project } = await getProjectCtx();
  const id = parseWorkItemId(text);
  const ids = id ? [id] : text.trim() ? parseWiqlIds(await post(wiqlUrl(org, project, SEARCH_TOP), wiqlTitleQuery(text))) : [];
  if (!ids.length) return [];
  return parseWorkItems(ids, await get<{ value?: never[] }>(workItemsUrl(org, ids))).filter((w) => w.found);
}

// Hover cards: one item with the card's fields (assigned to, area, iteration), cached for the session; a failure is retried next time.
const cards = new Map<number, Promise<{ item: WorkItemCard | null; type?: WorkItemType; url: string }>>();
export function fetchWorkItemCard(id: number): Promise<{ item: WorkItemCard | null; type?: WorkItemType; url: string }> {
  let p = cards.get(id);
  if (!p) {
    p = (async () => {
      const { org, project } = await getProjectCtx();
      const [body, t] = await Promise.all([get<{ value?: never[] }>(workItemCardUrl(org, id)), loadTypes(org, project)]);
      const item = toWorkItemCard(id, body);
      return { item, type: item?.type ? t[item.type] : undefined, url: workItemUrl(org, project, id) };
    })();
    p.catch(() => cards.delete(id));
    cards.set(id, p);
  }
  return p;
}

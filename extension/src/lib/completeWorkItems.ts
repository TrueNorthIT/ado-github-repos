// "Complete associated work items after merging": the pure parts (A-5).
import type { WorkItemRef } from "./workItems";

/** One entry of GET .../workitemtypes/{type}/states: `category` is e.g. Proposed, InProgress, Resolved, Completed, Removed. */
export interface WorkItemStateInfo {
  name: string;
  category: string;
  color?: string;
}
export interface WorkItemStatesResponse {
  value?: WorkItemStateInfo[];
}

const enc = encodeURIComponent;

/** GET {org}/{project}/_apis/wit/workitemtypes/{type}/states?api-version=7.1, each segment URI-encoded. */
export const workItemStatesUrl = (org: string, project: string, type: string) =>
  `https://dev.azure.com/${enc(org)}/${enc(project)}/_apis/wit/workitemtypes/${enc(type)}/states?api-version=7.1`;

/** PATCH {org}/_apis/wit/workitems/{id}?api-version=7.1. */
export const completeWorkItemUrl = (org: string, id: number) => `https://dev.azure.com/${enc(org)}/_apis/wit/workitems/${id}?api-version=7.1`;

/** The first state, in response order, whose category is "Completed"; null when there is none. */
export function completedStateName(states: WorkItemStatesResponse | null | undefined): string | null {
  return states?.value?.find((s) => s.category === "Completed")?.name ?? null;
}

/** json-patch body `[{ op: "add", path: "/fields/System.State", value }]`. Throws on a blank state. */
export function completeWorkItemPatch(state: string): { op: "add"; path: string; value: string }[] {
  if (!state.trim()) throw new Error("A work item state is required.");
  return [{ op: "add", path: "/fields/System.State", value: state }];
}

export interface CompletionPlan {
  /** Work items to PATCH, in input order. */
  updates: { id: number; state: string }[];
  skipped: { id: number; reason: "not-found" | "already-complete" | "no-completed-state" }[];
}

/** `statesByType` is keyed by work item type name. Items whose current state is already in the Completed category are skipped. */
export function planCompletion(items: WorkItemRef[], statesByType: Record<string, WorkItemStatesResponse>): CompletionPlan {
  const plan: CompletionPlan = { updates: [], skipped: [] };
  for (const it of items) {
    if (!it.found) {
      plan.skipped.push({ id: it.id, reason: "not-found" });
      continue;
    }
    const states = it.type ? statesByType[it.type] : undefined;
    const target = completedStateName(states);
    if (!target) plan.skipped.push({ id: it.id, reason: "no-completed-state" });
    else if (states!.value!.some((s) => s.name === it.state && s.category === "Completed")) plan.skipped.push({ id: it.id, reason: "already-complete" });
    else plan.updates.push({ id: it.id, state: target });
  }
  return plan;
}

// The policies card's checks accordion: group the check rows, order the groups, say how each group looks, and decide which are open.
import type { PolicyKind, PolicyState } from "./policies";

export const OTHER_CHECKS = "Other checks";

/** The part of a policy row grouping needs; `group` is set on check rows by policyRows (workflow, else app). */
export interface GroupableRow { kind: PolicyKind; title: string; state: PolicyState; required: boolean; group?: string }

export interface CheckGroup<R> { name: string; rows: R[]; state: PolicyState; required: boolean; summary: string }

const SEVERITY: Record<PolicyState, number> = { failure: 3, pending: 2, success: 1, neutral: 0 };
const BUCKET = (s: PolicyState) => (s === "failure" ? 0 : s === "pending" ? 1 : 2);
const plural = (n: number) => `${n} check${n === 1 ? "" : "s"}`;

function summarise(states: PolicyState[]): string {
  const failed = states.filter((s) => s === "failure").length;
  const running = states.filter((s) => s === "pending").length;
  return [plural(states.length), failed && `${failed} failed`, running && (running === states.length ? "running" : `${running} running`)].filter(Boolean).join(" · ");
}

/** Non-check rows stay in `top`; check rows group by `group` (none: Other checks). Groups: failing, then pending, then the rest; by name within each, Other checks last. Rows keep their order. */
export function groupChecks<R extends GroupableRow>(rows: R[]): { top: R[]; groups: CheckGroup<R>[] } {
  const top = rows.filter((r) => r.kind !== "check");
  const by = new Map<string, R[]>();
  for (const r of rows) if (r.kind === "check") by.set(r.group || OTHER_CHECKS, [...(by.get(r.group || OTHER_CHECKS) ?? []), r]);
  const groups = [...by].map(([name, rs]): CheckGroup<R> => {
    const states = rs.map((r) => r.state);
    return { name, rows: rs, state: states.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a)), required: rs.some((r) => r.required), summary: summarise(states) };
  });
  const last = (g: CheckGroup<R>) => Number(g.name === OTHER_CHECKS);
  groups.sort((a, b) => BUCKET(a.state) - BUCKET(b.state) || last(a) - last(b) || a.name.localeCompare(b.name));
  return { top, groups };
}

/**
 * Which groups are open. A group with no entry starts open when it has a failure or is pending. After that the user's toggle (an entry in `open`) wins,
 * with one exception: a collapsed group that goes from passing (success or neutral) to failing opens. `seen` is each group's state last time round.
 */
export function reconcileOpen(open: Record<string, boolean>, seen: Record<string, PolicyState>, groups: { name: string; state: PolicyState }[]) {
  const o = { ...open };
  const s: Record<string, PolicyState> = {};
  for (const { name, state } of groups) {
    if (!(name in o)) o[name] = state === "failure" || state === "pending";
    else if (!o[name] && state === "failure" && (seen[name] === "success" || seen[name] === "neutral")) o[name] = true;
    s[name] = state;
  }
  return { open: o, seen: s };
}

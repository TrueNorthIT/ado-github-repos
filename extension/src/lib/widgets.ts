// Dashboard widgets (GitHub pull requests, GitHub Actions history): which widget a frame is, its saved settings, and the pure
// shaping of the REST answers. The widget frames themselves are src/widget.tsx and src/Widgets.tsx.
import { runState, type RunState, type WorkflowRun } from "./workflows";

export type WidgetKind = "prs" | "runs";
export type PrFilter = "all" | "mine" | "assigned";

/** Relative contribution ids, as in vss-extension.json. Each widget has its own configuration contribution. */
export const WIDGET_CONTRIBUTION: Record<WidgetKind, string> = { prs: "github-prs-widget", runs: "github-runs-widget" };
export const CONFIG_SUFFIX = "-config";

/** Which widget (or widget configuration) a frame is, from its full contribution id; null for anything else. */
export function widgetFrame(contributionId: string): { kind: WidgetKind; config: boolean } | null {
  const m = /(?:^|\.)github-(prs|runs)-widget(-config)?$/.exec(contributionId);
  return m ? { kind: m[1] as WidgetKind, config: !!m[2] } : null;
}

const REPO = /^[\w.-]+\/[\w.-]+$/;
const FILTERS: PrFilter[] = ["all", "mine", "assigned"];

export interface PrWidgetSettings { repo?: string; filter: PrFilter }
export interface RunsWidgetSettings { repo?: string; workflowId?: number }

function obj(data: string | undefined | null): Record<string, unknown> {
  try {
    const o = JSON.parse(data ?? "");
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}
const repoOf = (v: unknown) => (typeof v === "string" && REPO.test(v) && !v.split("/").some((p) => /^\.+$/.test(p)) ? v : undefined);

/** customSettings.data of the pull requests widget. Anything missing or malformed falls back: no repo (the first connected one is used), filter all. */
export function parsePrSettings(data: string | undefined | null): PrWidgetSettings {
  const o = obj(data);
  return { repo: repoOf(o.repo), filter: FILTERS.includes(o.filter as PrFilter) ? (o.filter as PrFilter) : "all" };
}

/** customSettings.data of the Actions history widget. No workflow means all workflows. */
export function parseRunsSettings(data: string | undefined | null): RunsWidgetSettings {
  const o = obj(data);
  const wf = typeof o.workflowId === "number" && Number.isSafeInteger(o.workflowId) && o.workflowId > 0 ? o.workflowId : undefined;
  return { repo: repoOf(o.repo), workflowId: wf };
}

export const serializeSettings = (s: PrWidgetSettings | RunsWidgetSettings) => JSON.stringify(s);

export const PR_FILTER_TEXT: Record<PrFilter, string> = { all: "All active", mine: "Created by me", assigned: "Assigned to me" };

// ---------- pull requests (GET /repos/{repo}/pulls?state=open) ----------

export interface WidgetPr {
  number: number;
  title: string;
  isDraft: boolean;
  authorLogin: string;
  avatarUrl?: string;
  createdAt: Date;
  baseRef: string;
  /** Logins of the requested reviewers and the assignees. */
  assigned: string[];
}

type Raw = Record<string, any>;
const logins = (v: unknown): string[] => (Array.isArray(v) ? v.map((u: Raw) => u?.login).filter((l): l is string => typeof l === "string") : []);

export function toWidgetPr(raw: unknown): WidgetPr {
  const r = (raw ?? {}) as Raw;
  return {
    number: Number(r.number),
    title: String(r.title ?? ""),
    isDraft: !!r.draft,
    authorLogin: typeof r.user?.login === "string" ? r.user.login : "ghost",
    avatarUrl: typeof r.user?.avatar_url === "string" ? r.user.avatar_url : undefined,
    createdAt: new Date(r.created_at),
    baseRef: String(r.base?.ref ?? ""),
    assigned: [...new Set([...logins(r.requested_reviewers), ...logins(r.assignees)])],
  };
}

/** "Created by me" is the author; "Assigned to me" is a requested reviewer or an assignee (GitHub drops a reviewer from the
 *  request once they have reviewed, and team requests are not expanded). Logins compare case-insensitively. */
export function filterPrs(prs: WidgetPr[], filter: PrFilter, me: string | undefined): WidgetPr[] {
  if (filter === "all") return prs;
  if (!me) return [];
  const m = me.toLowerCase();
  return prs.filter((p) => (filter === "mine" ? p.authorLogin.toLowerCase() === m : p.assigned.some((l) => l.toLowerCase() === m)));
}

export const pullsPath = (repo: string, perPage = 50) => `/repos/${repo}/pulls?state=open&sort=created&direction=desc&per_page=${perPage}`;

// ---------- Actions history ----------

export interface RunBar {
  run: WorkflowRun;
  state: RunState;
  /** Wall time so far (a running run counts up to `now`). */
  durationMs: number;
  /** Bar height as a share of the tallest bar, 0.08..1 (a zero-length run still shows a sliver). */
  height: number;
}

const MIN_BAR = 0.08;

/** Bars oldest to newest (native Build History draws the newest on the right), height relative to the longest finished run. */
export function runBars(runs: WorkflowRun[], now: Date): RunBar[] {
  const bars = [...runs].reverse().map((run) => {
    const start = (run.startedAt ?? run.createdAt).getTime();
    const state = runState(run.status, run.conclusion);
    const end = run.status === "completed" ? run.updatedAt.getTime() : now.getTime();
    return { run, state, durationMs: Math.max(0, end - start), height: 0 };
  });
  // Scaled to the longest finished run: a run waiting hours for an approval would otherwise flatten the rest. Unfinished runs cap at full height.
  const done = bars.filter((b) => b.run.status === "completed");
  const max = Math.max(0, ...(done.length ? done : bars).map((b) => b.durationMs));
  for (const b of bars) b.height = max > 0 ? Math.min(1, Math.max(MIN_BAR, b.durationMs / max)) : MIN_BAR;
  return bars;
}

/** How many runs fit the widget's width: 160px grid columns with a 10px gutter, 10px padding each side, bars 10px + 4px gap. */
export function barCount(columnSpan: number): number {
  const width = 160 * columnSpan + 10 * (columnSpan - 1) - 20;
  return Math.max(5, Math.min(100, Math.floor((width + 4) / 14)));
}

/** The dashboard grid: 160px cells and a 10px gutter (azure-devops-extension-api WidgetSizeConverter). */
export const widgetPixels = (size: { columnSpan: number; rowSpan: number }) => ({ width: 160 * size.columnSpan + 10 * (size.columnSpan - 1), height: 160 * size.rowSpan + 10 * (size.rowSpan - 1) });

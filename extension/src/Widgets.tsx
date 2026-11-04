// Dashboard widgets: GitHub pull requests (native's Pull Requests widget) and GitHub Actions history (native's Build History widget),
// and their configuration. Each renders in its own small iframe on the dashboard (src/widget.tsx); REST only.
import * as React from "react";
import { Table, ITableColumn, SimpleTableCell, TableColumnLayout, TwoLineTableCell } from "azure-devops-ui/Table";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { PersonHover } from "./HoverCard";
import { actorName } from "./lib/botIdentity";
import { Link } from "azure-devops-ui/Link";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { Dropdown } from "azure-devops-ui/Dropdown";
import { FormItem } from "azure-devops-ui/FormItem";
import { Tooltip } from "azure-devops-ui/TooltipEx";
import { StatusSize } from "azure-devops-ui/Status";
import { DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { ObservableValue, type IReadonlyObservableValue } from "azure-devops-ui/Core/Observable";
import { ArrayItemProvider, type IItemProvider } from "azure-devops-ui/Utilities/Provider";
import { loadProject, type ProjectCtx } from "./connections";
import { getTokens } from "./auth";
import { GhError, restJson } from "./githubBrowse";
import { listRuns, listWorkflows } from "./actionsApi";
import { hubHref, openHub, type HubId } from "./hostNav";
import { serialize } from "./lib/browseState";
import { serializeActions } from "./lib/actionsHash";
import { mergeRows } from "./lib/rows";
import { pickDefaultRepo, recallRepo } from "./lib/lastRepo";
import { isGitHubDotCom, parseRepoUrl } from "./lib/repoUrl";
import { formatDuration, type Workflow, type WorkflowRun } from "./lib/workflows";
import {
  PR_FILTER_TEXT, barCount, filterPrs, parsePrSettings, parseRunsSettings, pullsPath, runBars, serializeSettings, toWidgetPr,
  type PrFilter, type PrWidgetSettings, type RunBar, type RunsWidgetSettings, type WidgetKind, type WidgetPr,
} from "./lib/widgets";
import { RunStatusIcon, RUN_STATE_TEXT } from "./ActionsUi";
import { RelDate } from "./RelDate";
import "./widgets.css";

/** The parts of WidgetSettings (azure-devops-extension-api/Dashboard) the widgets read. */
export interface WidgetSettingsLike {
  name?: string;
  size: { columnSpan: number; rowSpan: number };
  customSettings?: { data?: string };
}

export const DEFAULT_TITLE: Record<WidgetKind, string> = { prs: "GitHub pull requests", runs: "GitHub Actions history" };

// ---------- shared ----------

interface Project { ctx: ProjectCtx; repos: string[]; /** What an unconfigured widget shows. */ fallback?: string }

/** The project and its connected github.com repos, once. */
function useProject(): Project | null | "error" {
  const [p, setP] = React.useState<Project | null | "error">(null);
  React.useEffect(() => {
    let dead = false;
    loadProject().then(
      (r) => {
        const repos = mergeRows(r.connections).rows.filter((x) => { const ref = parseRepoUrl(x.url); return ref && isGitHubDotCom(ref); }).map((x) => x.label);
        // An unconfigured widget shows the repo you last had open in this project, as the hubs do, else the first connected one.
        if (!dead) setP({ ctx: r.ctx, repos, fallback: pickDefaultRepo(repos, recallRepo(r.ctx.org, r.ctx.project)) });
      },
      () => !dead && setP("error")
    );
    return () => { dead = true; };
  }, []);
  return p;
}

type LoadError = { kind: "signedOut" } | { kind: "message"; text: string };

function errorOf(e: unknown, what: string, repo: string): LoadError {
  if (e instanceof GhError && e.kind === "auth") return { kind: "signedOut" };
  if (e instanceof GhError && e.kind === "access") return { kind: "message", text: `GitHub didn't let you see ${what} for ${repo}.` };
  if (e instanceof GhError && e.kind === "rateLimit") return { kind: "message", text: `GitHub's rate limit was reached${e.resetAt ? `; try again after ${e.resetAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}.` };
  return { kind: "message", text: `Could not load ${what} from GitHub.` };
}

/** A link into one of our hubs. From a dashboard frame a plain click goes through the host's navigation service (the frame can't
 *  navigate the page itself); modified and middle clicks keep the link's own behaviour (a new tab). */
function HubLink({ ctx, hub, hash, className, children, ariaLabel }: { ctx: ProjectCtx; hub: HubId; hash: string; className?: string; children: React.ReactNode; ariaLabel?: string }) {
  return (
    <Link className={className} subtle removeUnderline href={hubHref(ctx, hub, hash)} target="_blank" rel="noopener noreferrer" ariaLabel={ariaLabel} onClick={(e) => go(e, hub, hash)}>
      {children}
    </Link>
  );
}
function go(e: React.MouseEvent | React.KeyboardEvent, hub: HubId, hash: string) {
  if ("button" in e && (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) return;
  e.preventDefault();
  void openHub(hub, hash);
}

/** Native widget chrome: a 16px regular-weight title, 10px from the top and 14px from the sides, then the body. */
function WidgetFrame({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="gh-widget flex-column">
      <h2 className="gh-widget-title font-size-ml font-weight-normal text-ellipsis" title={title}>{title}</h2>
      {subtitle && <div className="gh-widget-subtitle secondary-text body-s text-ellipsis">{subtitle}</div>}
      <div className="gh-widget-body flex-column flex-grow">{children}</div>
    </div>
  );
}

function SignInNotice({ ctx, what }: { ctx: ProjectCtx | undefined; what: string }) {
  return (
    <div className="gh-widget-notice body-m">
      Sign in to GitHub to see {what}.{" "}
      {ctx ? <HubLink ctx={ctx} hub="prs" hash="#">Open Pull requests to sign in</HubLink> : "Open the GitHub Repos Pull requests hub to sign in."}
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <div className="gh-widget-notice secondary-text body-m">{text}</div>;
}

function ProjectNotice({ project }: { project: Project | "error" }) {
  if (project === "error") return <MessageCard className="gh-widget-message" severity={MessageCardSeverity.Error}>Could not load this project's GitHub connections.</MessageCard>;
  return <Notice text="No GitHub repositories are connected to this project." />;
}

// ---------- pull requests ----------

/** Native shimmer rows while loading (the same Table, rows holding an empty observable), as skeletonRows() in RepoHub. */
const skeleton = new ArrayItemProvider(Array.from({ length: 5 }, () => new ObservableValue<undefined>(undefined))) as unknown as IItemProvider<WidgetPr | IReadonlyObservableValue<WidgetPr | undefined>>;

function prColumns(ctx: ProjectCtx, repo: string, wide: boolean): ITableColumn<WidgetPr>[] {
  return [
    {
      id: "avatar",
      width: 44,
      columnLayout: TableColumnLayout.none,
      renderCell: (_r, columnIndex, tableColumn, pr) => (
        <SimpleTableCell key="avatar" columnIndex={columnIndex} tableColumn={tableColumn}>
          <PersonHover repo={repo} login={pr.authorLogin} avatarUrl={pr.avatarUrl}><VssPersona imageUrl={pr.avatarUrl} displayName={actorName(pr.authorLogin)} size="medium" suppressPersonaCard showInitialsOnImageError /></PersonHover>
        </SimpleTableCell>
      ),
    },
    {
      id: "title",
      width: -100,
      columnLayout: TableColumnLayout.twoLinePrefix,
      renderCell: (_r, columnIndex, tableColumn, pr) => (
        <TwoLineTableCell
          key="title"
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          line1={
            <div className="flex-row flex-center gh-widget-pr-line1">
              <HubLink ctx={ctx} hub="prs" hash={serialize({ repo, view: "prs", pr: pr.number })} className="gh-widget-pr-title text-ellipsis">{pr.title}</HubLink>
              {pr.isDraft && <Pill className="gh-widget-pill" size={PillSize.compact} variant={PillVariant.standard}>Draft</Pill>}
            </div>
          }
          line2={
            <span className="secondary-text body-s text-ellipsis">
              #{pr.number} · {actorName(pr.authorLogin)} · <RelDate date={pr.createdAt} />{wide && pr.baseRef ? <> · into <span className="monospaced-xs">{pr.baseRef}</span></> : null}
            </span>
          }
        />
      ),
    },
  ];
}

export function PrWidget({ settings }: { settings: WidgetSettingsLike }) {
  const s = parsePrSettings(settings.customSettings?.data);
  const project = useProject();
  const ctx = project && project !== "error" ? project.ctx : undefined;
  const repo = s.repo ?? (project && project !== "error" ? project.fallback : undefined);
  const [data, setData] = React.useState<{ key: string; rows: WidgetPr[]; more: boolean } | { key: string; error: LoadError }>();
  const key = `${repo}|${s.filter}`;

  React.useEffect(() => {
    if (!repo) return;
    let dead = false;
    (async () => {
      if (!(await getTokens())) return !dead && setData({ key, error: { kind: "signedOut" } });
      try {
        const [list, me] = await Promise.all([
          restJson<unknown[]>({ method: "GET", path: pullsPath(repo) }),
          s.filter === "all" ? Promise.resolve(undefined) : restJson<{ login?: string }>({ method: "GET", path: "/user" }).then((r) => r.body.login),
        ]);
        const rows = filterPrs((Array.isArray(list.body) ? list.body : []).map(toWidgetPr), s.filter, me);
        if (!dead) setData({ key, rows, more: /rel="next"/.test(list.link ?? "") });
      } catch (e) {
        if (!dead) setData({ key, error: errorOf(e, "pull requests", repo) });
      }
    })();
    return () => { dead = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const wide = settings.size.columnSpan >= 3;
  const cols = React.useMemo(() => (ctx && repo ? prColumns(ctx, repo, wide) : []), [ctx, repo, wide]);
  const current = data?.key === key ? data : undefined;
  const rows = current && "rows" in current ? current.rows : undefined;
  const provider = React.useMemo<IItemProvider<WidgetPr | IReadonlyObservableValue<WidgetPr | undefined>>>(() => (rows ? new ArrayItemProvider(rows) : skeleton), [rows]);
  const title = settings.name || DEFAULT_TITLE.prs;

  if (project && (project === "error" || !repo)) return <WidgetFrame title={title}><ProjectNotice project={project} /></WidgetFrame>;
  const count = current && "rows" in current ? ` (${current.rows.length}${current.more && s.filter === "all" ? "+" : ""})` : "";
  const subtitle = repo ? `${repo} · ${PR_FILTER_TEXT[s.filter]}${count}` : undefined;
  let body: React.ReactNode;
  if (current && "error" in current) body = current.error.kind === "signedOut" ? <SignInNotice ctx={ctx} what="pull requests" /> : <Notice text={current.error.text} />;
  else if (rows && rows.length === 0) body = <Notice text={s.filter === "all" ? "No active pull requests." : s.filter === "mine" ? "You have no active pull requests." : "No active pull requests are assigned to you."} />;
  else if (!ctx || !repo) body = null;
  else
    body = (
      <div className="gh-widget-scroll flex-grow">
        <Table<WidgetPr>
          ariaLabel={`Pull requests in ${repo}`}
          role="table"
          columns={cols}
          itemProvider={provider}
          showHeader={false}
          spacerWidth={0}
          singleClickActivation
          onActivate={(_e, r) => void openHub("prs", serialize({ repo, view: "prs", pr: r.data.number }))}
        />
      </div>
    );
  return <WidgetFrame title={title} subtitle={subtitle}>{body}</WidgetFrame>;
}

// ---------- Actions history ----------

const barText = (b: RunBar) => `#${b.run.runNumber} ${b.run.title} · ${RUN_STATE_TEXT[b.state]} · ${formatDuration(b.durationMs)}${b.run.branch ? ` · ${b.run.branch}` : ""}`;

/** Native Build History's bar strip: one bar per run, height for duration, colour for result. Hand-rolled: azure-devops-ui has no chart. */
function RunStrip({ ctx, repo, bars }: { ctx: ProjectCtx; repo: string; bars: RunBar[] }) {
  return (
    <div className="gh-widget-bars flex-row flex-grow" role="list" aria-label="Recent runs, oldest first">
      {bars.map((b) => (
        <Tooltip key={b.run.id} text={barText(b)}>
          <a
            role="listitem"
            className={`gh-widget-bar gh-widget-bar-${b.state}`}
            style={{ height: `${Math.round(b.height * 1000) / 10}%` }}
            href={hubHref(ctx, "actions", serializeActions({ repo, run: b.run.id }))}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={barText(b)}
            onClick={(e) => go(e, "actions", serializeActions({ repo, run: b.run.id }))}
          />
        </Tooltip>
      ))}
    </div>
  );
}

function LastRun({ ctx, repo, bar }: { ctx: ProjectCtx; repo: string; bar: RunBar }) {
  const r = bar.run;
  return (
    <div className="gh-widget-last flex-row">
      <RunStatusIcon state={bar.state} size={StatusSize.l} />
      <div className="gh-widget-last-text flex-column">
        <HubLink ctx={ctx} hub="actions" hash={serializeActions({ repo, run: r.id })} className="text-ellipsis body-m">#{r.runNumber} · {r.title}</HubLink>
        <span className="secondary-text body-s text-ellipsis">
          {RUN_STATE_TEXT[bar.state]} · {r.branch ? <>{r.branch} · </> : null}<RelDate date={r.createdAt} /> · {formatDuration(bar.durationMs)}
        </span>
      </div>
    </div>
  );
}

export function RunsWidget({ settings }: { settings: WidgetSettingsLike }) {
  const s = parseRunsSettings(settings.customSettings?.data);
  const project = useProject();
  const ctx = project && project !== "error" ? project.ctx : undefined;
  const repo = s.repo ?? (project && project !== "error" ? project.fallback : undefined);
  const perPage = barCount(settings.size.columnSpan);
  const key = `${repo}|${s.workflowId ?? ""}|${perPage}`;
  const [data, setData] = React.useState<{ key: string; runs: WorkflowRun[] } | { key: string; error: LoadError }>();

  React.useEffect(() => {
    if (!repo) return;
    let dead = false;
    (async () => {
      if (!(await getTokens())) return !dead && setData({ key, error: { kind: "signedOut" } });
      try {
        const page = await listRuns(repo, { workflowId: s.workflowId, perPage });
        if (!dead) setData({ key, runs: page.runs });
      } catch (e) {
        if (!dead) setData({ key, error: errorOf(e, "workflow runs", repo) });
      }
    })();
    return () => { dead = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = data?.key === key ? data : undefined;
  const runs = current && "runs" in current ? current.runs : undefined;
  const bars = React.useMemo(() => (runs ? runBars(runs, new Date()) : []), [runs]);
  const title = settings.name || DEFAULT_TITLE.runs;
  if (project && (project === "error" || !repo)) return <WidgetFrame title={title}><ProjectNotice project={project} /></WidgetFrame>;
  const workflow = s.workflowId ? runs?.[0]?.name ?? "Workflow" : "All workflows";
  const subtitle = repo ? `${repo} · ${workflow}` : undefined;
  let body: React.ReactNode;
  if (current && "error" in current) body = current.error.kind === "signedOut" ? <SignInNotice ctx={ctx} what="workflow runs" /> : <Notice text={current.error.text} />;
  else if (!runs || !ctx || !repo) body = <div className="gh-widget-loading flex-row flex-center justify-center flex-grow"><Spinner size={SpinnerSize.medium} ariaLabel="Loading runs" /></div>;
  else if (!bars.length) body = <Notice text={s.workflowId ? "This workflow hasn't run yet." : "No workflow runs yet."} />;
  else
    body = (
      <>
        <LastRun ctx={ctx} repo={repo} bar={bars[bars.length - 1]} />
        <RunStrip ctx={ctx} repo={repo} bars={bars} />
      </>
    );
  return <WidgetFrame title={title} subtitle={subtitle}>{body}</WidgetFrame>;
}

// ---------- configuration ----------

function Picker({ label, items, value, onPick, disabled, placeholder }: { label: string; items: { id: string; text: string }[]; value: string | undefined; onPick: (id: string) => void; disabled?: boolean; placeholder?: string }) {
  const sel = React.useMemo(() => new DropdownSelection(), []);
  const idx = items.findIndex((i) => i.id === value);
  React.useEffect(() => { if (idx >= 0) sel.select(idx); else sel.clear(); }, [idx, sel]);
  return (
    <FormItem label={label} className="gh-widget-config-item">
      <Dropdown ariaLabel={label} placeholder={placeholder ?? "Choose"} items={items} selection={sel} onSelect={(_e, i) => onPick(i.id)} disabled={disabled} showFilterBox={items.length > 8} />
    </FormItem>
  );
}

/** The configuration panel: the connected repo, then the PR filter or the workflow. `onChange` gets the serialised settings. */
export function WidgetConfig({ kind, settings, onChange }: { kind: WidgetKind; settings: WidgetSettingsLike; onChange: (data: string) => void }) {
  const project = useProject();
  const [pr, setPr] = React.useState<PrWidgetSettings>(() => parsePrSettings(settings.customSettings?.data));
  const [runs, setRuns] = React.useState<RunsWidgetSettings>(() => parseRunsSettings(settings.customSettings?.data));
  const repos = project && project !== "error" ? project.repos : [];
  const repo = (kind === "prs" ? pr.repo : runs.repo) ?? (project && project !== "error" ? project.fallback : undefined);
  const [workflows, setWorkflows] = React.useState<Workflow[] | "signedOut" | "error">();

  const update = (next: PrWidgetSettings | RunsWidgetSettings) => {
    if (kind === "prs") setPr(next as PrWidgetSettings);
    else setRuns(next as RunsWidgetSettings);
    onChange(serializeSettings(next));
  };
  // A widget saved without a repo shows the first connected one; write it down so the preview and the saved settings agree.
  React.useEffect(() => { if (repo && !(kind === "prs" ? pr.repo : runs.repo)) update(kind === "prs" ? { ...pr, repo } : { ...runs, repo }); }, [repo]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (kind !== "runs" || !repo) return;
    let dead = false;
    setWorkflows(undefined);
    (async () => {
      if (!(await getTokens())) return !dead && setWorkflows("signedOut");
      try {
        const list = await listWorkflows(repo);
        if (!dead) setWorkflows(list);
      } catch (e) {
        if (!dead) setWorkflows(e instanceof GhError && e.kind === "auth" ? "signedOut" : "error");
      }
    })();
    return () => { dead = true; };
  }, [kind, repo]);

  if (project === "error") return <div className="gh-widget-config"><ProjectNotice project={project} /></div>;
  if (project && !repos.length) return <div className="gh-widget-config"><ProjectNotice project={project} /></div>;
  const repoItems = repos.map((r) => ({ id: r, text: r }));
  if (repo && !repos.includes(repo)) repoItems.unshift({ id: repo, text: `${repo} (no longer connected)` });
  return (
    <div className="gh-widget-config flex-column">
      <Picker label="Repository" items={repoItems} value={repo} disabled={!project} placeholder={project ? "Choose a repository" : "Loading"} onPick={(r) => update(kind === "prs" ? { ...pr, repo: r } : { repo: r })} />
      {kind === "prs" ? (
        <Picker label="Pull requests" items={(Object.keys(PR_FILTER_TEXT) as PrFilter[]).map((f) => ({ id: f, text: PR_FILTER_TEXT[f] }))} value={pr.filter} onPick={(f) => update({ ...pr, repo, filter: f as PrFilter })} />
      ) : (
        <>
          <Picker
            label="Workflow"
            items={[{ id: "", text: "All workflows" }, ...(Array.isArray(workflows) ? workflows.map((w) => ({ id: String(w.id), text: w.disabled ? `${w.name} (disabled)` : w.name })) : [])]}
            value={runs.workflowId ? String(runs.workflowId) : ""}
            disabled={!Array.isArray(workflows)}
            placeholder={workflows === undefined ? "Loading" : "All workflows"}
            onPick={(id) => update({ repo, workflowId: id ? Number(id) : undefined })}
          />
          {workflows === "signedOut" && <div className="secondary-text body-s">Sign in to GitHub in the Pull requests hub to choose a workflow.</div>}
          {workflows === "error" && <div className="secondary-text body-s">Could not load the workflows from GitHub.</div>}
        </>
      )}
    </div>
  );
}

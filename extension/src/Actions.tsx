// The "Actions" hub (ACT-1..4, 13, 16): landing tabs (Recent | All | Runs), a workflow's runs, Run workflow.
// Routing: the page reads useHashExtras().actions (lib/actionsHash.ts); with `run` set it renders <RunPage> from ./ActionsRun.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Dropdown, DropdownFilterBarItem } from "azure-devops-ui/Dropdown";
import { FilterBar } from "azure-devops-ui/FilterBar";
import { FormItem } from "azure-devops-ui/FormItem";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Icon } from "azure-devops-ui/Icon";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Panel } from "azure-devops-ui/Panel";
import { ContentSize } from "azure-devops-ui/Callout";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { ColumnMore, Table, ITableColumn, SimpleTableCell, TableColumnLayout, TwoLineTableCell } from "azure-devops-ui/Table";
import type { IMenuProps } from "azure-devops-ui/Menu";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { TextFilterBarItem } from "azure-devops-ui/TextFilterBarItem";
import { TextField } from "azure-devops-ui/TextField";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { Filter, FILTER_CHANGE_EVENT } from "azure-devops-ui/Utilities/Filter";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import type { HubProps } from "./RepoHub";
import { PersonLine, RepoHubPage, skeletonRows, titleSwitcher } from "./RepoHub";
import { ErrorView } from "./Browser";
import { RelDate } from "./RelDate";
import { DeleteRunDialog, RunStatusIcon, StatusBadgeDialog, writeError, type DeleteTarget } from "./ActionsUi";
import { RunPage } from "./ActionsRun";
import { EnvironmentsTab, isEnvironmentPage } from "./ActionsEnvironments";
import { LibraryTab } from "./ActionsLibrary";
import { gotoHash, openHub, patchHash, useHashExtras } from "./hostNav";
import { applyEditFlag } from "./lib/editHash";
import { serialize } from "./lib/browseState";
import { GhError, listBranches } from "./githubBrowse";
import { dispatchWorkflow, getDispatchInputs, getRepoAccess, getScheduleCrons, listEnvironments, listRuns, listWorkflows, setWorkflowEnabled, useCanWriteActions } from "./actionsApi";
import { nextScheduledRuns, timeUntil, type ScheduledRun } from "./lib/cron";
import { fullDateTime } from "./lib/dateFormat";
import { MenuItemType } from "azure-devops-ui/Menu";
import { applyActions, RUN_STATUS_FILTERS, serializeActions, type ActTab, type ActionsHashState, type RunStatusFilter } from "./lib/actionsHash";
import {
  elapsedMs,
  formatDuration,
  inputsBody,
  validateInputs,
  type DispatchInput,
  type RunFilters,
  type Workflow,
  type WorkflowRun,
} from "./lib/workflows";
import "./browser.css";

type Goto = (s: Omit<ActionsHashState, "repo">, replace?: boolean) => void;

/** The Files hub at a workflow file with its editor open (lib/editHash.ts). */
const editWorkflowHash = (repo: string, branch: string, path: string) => applyEditFlag(serialize({ repo, ref: branch, path }), true);

const TABS: { id: ActTab; name: string }[] = [
  { id: "recent", name: "Recent" },
  { id: "all", name: "All" },
  { id: "runs", name: "Runs" },
  { id: "environments", name: "Environments" },
  { id: "library", name: "Library" },
];
const DEBOUNCE_MS = 300;
const POLL_MS = 10_000;
const isActive = (r: WorkflowRun) => r.state === "queued" || r.state === "waiting" || r.state === "inProgress";

// ---------- loading ----------

type Load<T> = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; v: T };

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): [Load<T>, () => void] {
  const [load, setLoad] = React.useState<Load<T>>({ t: "loading" });
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "loading" });
    fn().then((v) => !dead && setLoad({ t: "ready", v }), (err) => !dead && setLoad({ t: "error", err }));
    return () => { dead = true; };
  }, [...deps, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return [load, () => setN((x) => x + 1)];
}

const shortSha = (s: string) => s.slice(0, 7);

/** A ticking clock while something runs, so durations count up. */
function useNow(live: boolean): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return now;
}

// ---------- tables ----------

const runHref = (repo: string, id: number) => serializeActions({ repo, run: id });
const workflowHref = (repo: string, id: number) => serializeActions({ repo, workflow: id });
const plainClick = (e: React.MouseEvent | React.KeyboardEvent, go: () => void) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || (e as React.MouseEvent).button) return;
  e.preventDefault();
  go();
};

/** Elapsed time of a run: counts up while it runs, blank while it waits. */
function runDuration(run: WorkflowRun, now: Date): number | undefined {
  if (run.state === "queued" || run.state === "waiting") return undefined;
  const start = (run.startedAt ?? run.createdAt).toISOString();
  return elapsedMs(start, run.state === "inProgress" ? null : run.updatedAt.toISOString(), now);
}

/** The row's "..." menu (native Pipelines' run menu): open on GitHub, and Delete logs / Delete run for writers. */
function runMenu(run: WorkflowRun, onDelete: ((t: DeleteTarget) => void) | undefined): IMenuProps {
  const target = (logsOnly: boolean): DeleteTarget => ({ id: run.id, runNumber: run.runNumber, title: run.title || run.name, logsOnly });
  return {
    id: `gh-act-run-menu-${run.id}`,
    items: [
      { id: "github", text: "Open on GitHub", iconProps: { iconName: "OpenInNewTab" }, href: run.htmlUrl, target: "_blank" },
      ...(onDelete ? [
        { id: "sep", itemType: MenuItemType.Divider },
        { id: "deleteLogs", text: "Delete logs", iconProps: { iconName: "Delete" }, disabled: isActive(run), onActivate: () => onDelete(target(true)) },
        { id: "delete", text: "Delete run", iconProps: { iconName: "Delete" }, disabled: isActive(run), onActivate: () => onDelete(target(false)) },
      ] : []),
    ],
  };
}

function runColumns(repo: string, open: (id: number) => void, now: Date, showWorkflow: boolean, onDelete?: (t: DeleteTarget) => void): ITableColumn<WorkflowRun>[] {
  return [
    {
      name: "", id: "status",
      width: 40,
      columnLayout: TableColumnLayout.none,
      renderCell: (_r, i, c, run) => (
        <SimpleTableCell key="status" columnIndex={i} tableColumn={c}>
          <RunStatusIcon state={run.state} />
        </SimpleTableCell>
      ),
    },
    {
      name: "Run", id: "title",
      width: -100,
      columnLayout: TableColumnLayout.twoLine,
      renderCell: (_r, i, c, run) => (
        <TwoLineTableCell
          key="title"
          columnIndex={i}
          tableColumn={c}
          line1={
            <Link className="body-l" subtle removeUnderline href={runHref(repo, run.id)} onClick={(e) => plainClick(e, () => open(run.id))}>
              {run.title || run.name}
            </Link>
          }
          line2={
            <span className="secondary-text body-s gh-act-line2">
              {showWorkflow && <>{run.name} · </>}#{run.runNumber} · {run.event} · {run.branch ?? "no branch"} · <span className="monospaced-xs">{shortSha(run.headSha)}</span>
            </span>
          }
        />
      ),
    },
    {
      name: "Triggered by", id: "actor",
      width: 170,
      columnLayout: TableColumnLayout.singleLinePrefix,
      renderCell: (_r, i, c, run) => (
        <SimpleTableCell key="actor" columnIndex={i} tableColumn={c}>
          {run.actor && <PersonLine person={run.actor} />}
        </SimpleTableCell>
      ),
    },
    {
      name: "Duration", id: "duration",
      width: 90,
      renderCell: (_r, i, c, run) => {
        const ms = runDuration(run, now);
        return (
          <SimpleTableCell key="duration" columnIndex={i} tableColumn={c}>
            <span className="secondary-text">{ms === undefined ? "" : formatDuration(ms)}</span>
          </SimpleTableCell>
        );
      },
    },
    {
      name: "", id: "time",
      width: 150,
      renderCell: (_r, i, c, run) => (
        <SimpleTableCell key="time" columnIndex={i} tableColumn={c}>
          <span className="secondary-text"><RelDate date={run.createdAt} /></span>
        </SimpleTableCell>
      ),
    },
    new ColumnMore<WorkflowRun>((run) => runMenu(run, onDelete)),
  ];
}

function RunTable({ repo, runs, open, now, showWorkflow, label, onDelete }: { repo: string; runs: WorkflowRun[] | undefined; /* undefined while loading: shimmer rows */ open: (id: number) => void; now: Date; showWorkflow: boolean; label: string; onDelete?: (t: DeleteTarget) => void }) {
  const cols = React.useMemo(() => runColumns(repo, open, now, showWorkflow, onDelete), [repo, open, now, showWorkflow, onDelete]);
  const provider = React.useMemo(() => runs ? new ArrayItemProvider(runs) : skeletonRows<WorkflowRun>(), [runs]);
  return <Table<WorkflowRun> ariaLabel={label} role="table" columns={cols} itemProvider={provider} showHeader spacerWidth={8} singleClickActivation onActivate={(_e, r) => open(r.data.id)} />;
}

interface WorkflowRow {
  wf: Workflow;
  latest?: WorkflowRun;
}

function workflowColumns(repo: string, openWf: (id: number) => void, open: (id: number) => void, recent: boolean): ITableColumn<WorkflowRow>[] {
  return [
    {
      name: "", id: "status",
      width: 40,
      columnLayout: TableColumnLayout.none,
      renderCell: (_r, i, c, row) => (
        <SimpleTableCell key="status" columnIndex={i} tableColumn={c}>
          {row.latest ? <RunStatusIcon state={row.latest.state} /> : <span className="secondary-text" aria-label="Never run">–</span>}
        </SimpleTableCell>
      ),
    },
    {
      name: "Workflow", id: "name",
      width: -40,
      columnLayout: TableColumnLayout.twoLine,
      renderCell: (_r, i, c, row) => (
        <TwoLineTableCell
          key="name"
          columnIndex={i}
          tableColumn={c}
          line1={
            <div className="flex-row flex-center">
              <Link className="body-l" subtle removeUnderline href={workflowHref(repo, row.wf.id)} onClick={(e) => plainClick(e, () => openWf(row.wf.id))}>
                {row.wf.name}
              </Link>
              {row.wf.disabled && <Pill className="gh-pr-pill" size={PillSize.compact} variant={PillVariant.standard}>Disabled</Pill>}
            </div>
          }
          line2={<span className="secondary-text body-s monospaced-xs">{row.wf.path}</span>}
        />
      ),
    },
    {
      name: "Last run", id: "latest",
      width: -60,
      columnLayout: TableColumnLayout.twoLine,
      renderCell: (_r, i, c, row) =>
        recent && row.latest ? (
          <TwoLineTableCell
            key="latest"
            columnIndex={i}
            tableColumn={c}
            line1={
              <Link className="body-m" subtle removeUnderline href={runHref(repo, row.latest.id)} onClick={(e) => plainClick(e, () => open(row.latest!.id))}>
                {row.latest.title || row.latest.name}
              </Link>
            }
            line2={
              <span className="secondary-text body-s gh-act-line2">
                #{row.latest.runNumber} · {row.latest.branch ?? "no branch"} · <span className="monospaced-xs">{shortSha(row.latest.headSha)}</span>
              </span>
            }
          />
        ) : (
          <SimpleTableCell key="latest" columnIndex={i} tableColumn={c} />
        ),
    },
    {
      name: "", id: "time",
      width: 150,
      renderCell: (_r, i, c, row) => (
        <SimpleTableCell key="time" columnIndex={i} tableColumn={c}>
          <span className="secondary-text">{recent && row.latest ? <RelDate date={row.latest.createdAt} /> : null}</span>
        </SimpleTableCell>
      ),
    },
  ];
}

function WorkflowTable({ repo, rows, openWf, open, recent }: { repo: string; rows: WorkflowRow[] | undefined; openWf: (id: number) => void; open: (id: number) => void; recent: boolean }) {
  const cols = React.useMemo(() => workflowColumns(repo, openWf, open, recent), [repo, openWf, open, recent]);
  const provider = React.useMemo(() => rows ? new ArrayItemProvider(rows) : skeletonRows<WorkflowRow>(), [rows]);
  return <Table<WorkflowRow> ariaLabel={recent ? "Recent workflows" : "All workflows"} role="table" columns={cols} itemProvider={provider} showHeader spacerWidth={8} singleClickActivation onActivate={(_e, r) => openWf(r.data.wf.id)} />;
}

// ---------- Recent and All ----------

function Landing({ repo, tab, goto, props }: { repo: string; tab: "recent" | "all"; goto: Goto; props: HubProps }) {
  // The latest 100 runs of the repository stand in for "each workflow's latest run".
  const [load, retry] = useAsync(async () => {
    const [wfs, recent] = await Promise.all([listWorkflows(repo), listRuns(repo, { perPage: 100 })]);
    const latest = new Map<number, WorkflowRun>();
    for (const r of recent.runs) if (!latest.has(r.workflowId)) latest.set(r.workflowId, r);
    return wfs.map((wf): WorkflowRow => ({ wf, latest: latest.get(wf.id) }));
  }, [repo, props.signedIn]);
  const openWf = React.useCallback((id: number) => goto({ workflow: id }), [goto]);
  const open = React.useCallback((id: number) => goto({ run: id }), [goto]);
  if (load.t === "loading") {
    return (
      <Card className="gh-pr-card bolt-table-card gh-act-listcard" contentProps={{ contentPadding: false }} titleProps={tab === "recent" ? { text: "Recently run workflows", ariaLevel: 2 } : undefined}>
        <WorkflowTable repo={repo} rows={undefined} openWf={openWf} open={open} recent={tab === "recent"} />
      </Card>
    );
  }
  if (load.t === "error") return <ErrorView err={load.err} signIn={() => void props.signIn()} busy={props.busy} retry={retry} subject="see this repository's workflows" permission="Actions" />;
  const rows = tab === "recent"
    ? load.v.filter((r) => r.latest).sort((a, b) => b.latest!.createdAt.getTime() - a.latest!.createdAt.getTime())
    : load.v.slice().sort((a, b) => a.wf.name.localeCompare(b.wf.name));
  if (!rows.length) {
    return tab === "recent" ? (
      <ZeroData iconProps={{ iconName: "Play" }} imageAltText="" primaryText="No workflow runs yet" secondaryText="Runs appear here once a workflow has run." />
    ) : (
      <ZeroData iconProps={{ iconName: "Play" }} imageAltText="" primaryText="No workflows" secondaryText="Add a workflow file under .github/workflows to get started." />
    );
  }
  return (
    <Card className="gh-pr-card bolt-table-card gh-act-listcard" contentProps={{ contentPadding: false }} titleProps={tab === "recent" ? { text: "Recently run workflows", ariaLevel: 2 } : undefined}>
      <WorkflowTable repo={repo} rows={rows} openWf={openWf} open={open} recent={tab === "recent"} />
    </Card>
  );
}

// ---------- runs, with filters ----------

const toFilterState = (f: RunFilters) => ({ branch: { value: f.branch ?? "" }, actor: { value: f.actor ?? "" }, event: { value: f.event ?? "" }, status: { value: f.status ? [f.status] : [] } });

const STATUS_ITEMS = RUN_STATUS_FILTERS.map((s) => ({ id: s, text: s.replace("_", " ").replace(/^./, (c) => c.toUpperCase()) }));

function FilterRow({ st, goto }: { st: ActionsHashState; goto: Goto }) {
  const filter = React.useMemo(() => { const f = new Filter(); f.setState(toFilterState(st), true); return f; }, []); // eslint-disable-line react-hooks/exhaustive-deps -- the hash only seeds it
  const statusSelection = React.useMemo(() => new DropdownSelection(), []);
  const latest = React.useRef(st);
  latest.current = st;
  React.useEffect(() => {
    const i = STATUS_ITEMS.findIndex((x) => x.id === st.status);
    if (i >= 0) statusSelection.select(i);
    let t: ReturnType<typeof setTimeout>;
    const onChange = () => {
      clearTimeout(t);
      const v = (k: string) => (filter.getFilterItemValue<string>(k) ?? "").trim();
      const status = (filter.getFilterItemValue<string[]>("status") ?? [])[0] as RunStatusFilter | undefined;
      t = setTimeout(() => {
        const cur = latest.current;
        goto({ tab: cur.tab, workflow: cur.workflow, branch: v("branch") || undefined, actor: v("actor") || undefined, event: v("event") || undefined, status }, true);
      }, DEBOUNCE_MS);
    };
    filter.subscribe(onChange, FILTER_CHANGE_EVENT);
    return () => { clearTimeout(t); filter.unsubscribe(onChange, FILTER_CHANGE_EVENT); };
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <FilterBar filter={filter} searchRoleAriaLabel="Filter runs">
      <TextFilterBarItem filterItemKey="branch" placeholder="Branch" ariaLabel="Branch" />
      <TextFilterBarItem filterItemKey="actor" placeholder="Actor" ariaLabel="Actor login" />
      <TextFilterBarItem filterItemKey="event" placeholder="Event" ariaLabel="Event, for example push" />
      <DropdownFilterBarItem filterItemKey="status" placeholder="Status" items={STATUS_ITEMS} selection={statusSelection} enforceSingleSelect showFilterBox={false} ariaLabel="Status" />
    </FilterBar>
  );
}

type RunsState = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; runs: WorkflowRun[]; pages: number; next?: number };

function RunsList({ repo, workflowId, filters, goto, props, tick, showWorkflow }: { repo: string; workflowId?: number; filters: RunFilters; goto: Goto; props: HubProps; tick: number; showWorkflow: boolean }) {
  const key = `${repo}|${workflowId ?? ""}|${JSON.stringify(filters)}`;
  const [s, setS] = React.useState<RunsState>({ t: "loading" });
  const [more, setMore] = React.useState(false);
  const [n, setN] = React.useState(0);
  const query = (page: number) => listRuns(repo, { workflowId, page, ...filters });
  React.useEffect(() => {
    let dead = false;
    setS((o) => (o.t === "ready" && tick > 0 ? o : { t: "loading" })); // a refresh after Run workflow keeps the rows on screen
    query(1).then((r) => !dead && setS({ t: "ready", runs: r.runs, pages: 1, next: r.next }), (err) => !dead && setS({ t: "error", err }));
    return () => { dead = true; };
  }, [key, props.signedIn, tick, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const runs = s.t === "ready" ? s.runs : [];
  const live = runs.some(isActive);
  const pages = s.t === "ready" ? s.pages : 1;
  // Poll every 10s while a visible run is queued, waiting or in progress; re-reads every page shown so far.
  React.useEffect(() => {
    if (!live) return;
    let dead = false;
    const t = setInterval(async () => {
      try {
        const all: WorkflowRun[] = [];
        let next: number | undefined;
        for (let p = 1; p <= pages; p++) {
          const r = await query(p);
          all.push(...r.runs.filter((x) => !all.some((y) => y.id === x.id)));
          next = r.next;
        }
        if (!dead) setS((o) => (o.t === "ready" && o.pages === pages ? { t: "ready", runs: all, pages, next } : o));
      } catch { /* the next tick tries again */ }
    }, POLL_MS);
    return () => { dead = true; clearInterval(t); };
  }, [live, pages, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = useNow(runs.some((r) => r.state === "inProgress"));
  const open = React.useCallback((id: number) => goto({ run: id }), [goto]);
  const canWrite = useCanWriteActions(repo);
  const [deleting, setDeleting] = React.useState<DeleteTarget>();
  const onDelete = React.useMemo(() => (canWrite ? (t: DeleteTarget) => setDeleting(t) : undefined), [canWrite]);
  const onDeleted = () => {
    const t = deleting!;
    setDeleting(undefined);
    if (!t.logsOnly) setS((o) => (o.t === "ready" ? { ...o, runs: o.runs.filter((r) => r.id !== t.id) } : o));
  };
  const dialog = deleting && <DeleteRunDialog repo={repo} target={deleting} onClose={() => setDeleting(undefined)} onDeleted={onDeleted} />;
  const loadMore = async () => {
    if (s.t !== "ready" || !s.next) return;
    const page = s.next;
    setMore(true);
    try {
      const r = await query(page);
      setS((o) => (o.t === "ready" ? { t: "ready", runs: [...o.runs, ...r.runs.filter((x) => !o.runs.some((y) => y.id === x.id))], pages: page, next: r.next } : o));
    } catch (err) {
      setS({ t: "error", err });
    }
    setMore(false);
  };
  const filtered = Object.values(filters).some(Boolean);
  if (s.t === "loading") {
    return (
      <Card className="gh-pr-card bolt-table-card" contentProps={{ contentPadding: false }}>
        <RunTable repo={repo} runs={undefined} open={open} now={now} showWorkflow={showWorkflow} label="Loading workflow runs" />
      </Card>
    );
  }
  if (s.t === "error") return <ErrorView err={s.err} signIn={() => void props.signIn()} busy={props.busy} retry={() => setN((x) => x + 1)} subject="see this repository's workflow runs" permission="Actions" />;
  if (!s.runs.length) {
    return filtered
      ? <ZeroData iconProps={{ iconName: "Filter" }} imageAltText="" primaryText="No matching runs" secondaryText="Clear or change the filters to see more." />
      : <ZeroData iconProps={{ iconName: "Play" }} imageAltText="" primaryText="No runs yet" secondaryText="Runs appear here when the workflow is triggered." />;
  }
  return (
    <>
      <Card className="gh-pr-card bolt-table-card" contentProps={{ contentPadding: false }}>
        <RunTable repo={repo} runs={s.runs} open={open} now={now} showWorkflow={showWorkflow} label="Workflow runs" onDelete={onDelete} />
      </Card>
      {dialog}
      {s.next && (
        <div className="gh-act-more flex-row justify-center">
          <Button text={more ? "Loading" : "Load more"} disabled={more} onClick={() => void loadMore()} />
        </div>
      )}
    </>
  );
}

// ---------- Run workflow (REQ-13) ----------

interface DispatchInfo {
  defaultBranch: string;
  canWrite: boolean;
  inputs: DispatchInput[] | null;
}

function useDispatchInfo(repo: string, wf: Workflow | undefined): DispatchInfo | undefined {
  const [info, setInfo] = React.useState<DispatchInfo>();
  const id = wf?.id;
  React.useEffect(() => {
    if (!wf) return;
    let dead = false;
    setInfo(undefined);
    (async () => {
      const a = await getRepoAccess(repo);
      const inputs = a.canWrite && !wf.disabled ? await getDispatchInputs(repo, a.defaultBranch, wf.path) : null;
      if (!dead) setInfo({ ...a, inputs });
    })().catch(() => !dead && setInfo({ defaultBranch: "main", canWrite: false, inputs: null }));
    return () => { dead = true; };
  }, [repo, id, wf?.disabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return info;
}

const initialValue = (i: DispatchInput) => i.default ?? (i.type === "boolean" ? "false" : i.type === "choice" ? i.options?.[0] ?? "" : "");

function RunWorkflowPanel({ repo, wf, info, onClose, onQueued }: { repo: string; wf: Workflow; info: DispatchInfo; onClose: () => void; onQueued: () => void }) {
  const inputs = info.inputs ?? [];
  const [branches, setBranches] = React.useState<string[]>([info.defaultBranch]);
  const [envs, setEnvs] = React.useState<string[] | undefined>();
  const [ref, setRef] = React.useState(info.defaultBranch);
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(inputs.map((i) => [i.key, initialValue(i)])));
  const [tried, setTried] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  React.useEffect(() => {
    let dead = false;
    listBranches(repo).then((b) => !dead && setBranches([info.defaultBranch, ...b.filter((x) => x !== info.defaultBranch)]), () => {});
    if (inputs.some((i) => i.type === "environment")) listEnvironments(repo).then((e) => !dead && setEnvs(e));
    return () => { dead = true; };
  }, [repo]); // eslint-disable-line react-hooks/exhaustive-deps
  const errors = validateInputs(inputs, values);
  const set = (k: string, v: string) => setValues((o) => ({ ...o, [k]: v }));
  const submit = async () => {
    setTried(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError(undefined);
    try {
      await dispatchWorkflow(repo, wf.id, ref, inputsBody(inputs, values));
      onQueued();
    } catch (e) {
      setError(e instanceof GhError ? e.apiMessage ?? e.detail ?? `GitHub refused the request (${e.status})` : "The workflow could not be started.");
      setBusy(false);
    }
  };
  const dropdown = (label: string, items: string[], value: string, onPick: (v: string) => void) => {
    const sel = new DropdownSelection();
    const idx = items.indexOf(value);
    if (idx >= 0) sel.select(idx);
    return <Dropdown ariaLabel={label} placeholder={value || "Choose"} showFilterBox={items.length > 8} items={items.map((x) => ({ id: x, text: x }))} selection={sel} onSelect={(_e, i) => onPick(i.id)} disabled={busy} />;
  };
  return (
    <Panel
      titleProps={{ text: "Run workflow" }}
      description={wf.name}
      size={ContentSize.Medium}
      onDismiss={onClose}
      showSeparator
      footerButtonProps={[
        { text: "Cancel", onClick: onClose, disabled: busy },
        { text: busy ? "Running" : "Run", primary: true, onClick: () => void submit(), disabled: busy },
      ]}
    >
      <div className="gh-act-dispatch flex-column">
        {error && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setError(undefined)}>{error}</MessageCard>}
        <FormItem label="Use workflow from" message="Branch the workflow runs against.">
          {dropdown("Branch", branches, ref, setRef)}
        </FormItem>
        {inputs.map((i) => {
          const err = tried ? errors[i.key] : undefined;
          const v = values[i.key] ?? "";
          let field: React.ReactNode;
          if (i.type === "choice") field = dropdown(i.key, i.options ?? [], v, (x) => set(i.key, x));
          else if (i.type === "boolean") field = <Checkbox label={i.key} checked={v === "true"} onChange={(_e, c) => set(i.key, c ? "true" : "false")} disabled={busy} />;
          else if (i.type === "environment" && envs?.length) field = dropdown(i.key, envs, v, (x) => set(i.key, x));
          else field = <TextField ariaLabel={i.key} value={v} onChange={(_e, t) => set(i.key, t)} disabled={busy} placeholder={i.type === "number" ? "Number" : undefined} />;
          return (
            <FormItem key={i.key} label={i.type === "boolean" ? undefined : i.key} required={i.required} error={!!err} message={err ?? i.description}>
              {field}
            </FormItem>
          );
        })}
      </div>
    </Panel>
  );
}

// ---------- the pages ----------

// ---------- Scheduled runs (native: the pipeline's "Scheduled runs") ----------

type ScheduleLoad = { t: "loading" } | { t: "error"; message: string } | { t: "ready"; crons: string[]; runs: ScheduledRun[]; errors: { cron: string; message: string }[] };

const scheduleColumns: ITableColumn<ScheduledRun>[] = [
  {
    name: "Scheduled time", id: "at",
    width: -42,
    renderCell: (_r, i, c, run) => (
      <SimpleTableCell key="at" columnIndex={i} tableColumn={c}>
        <span className="flex-row flex-center"><Icon iconName="Clock" className="gh-act-sched-icon" />{run.at.toLocaleDateString(undefined, { weekday: "short" })} {fullDateTime(run.at)}</span>
      </SimpleTableCell>
    ),
  },
  {
    name: "", id: "in",
    width: -18,
    renderCell: (_r, i, c, run) => (
      <SimpleTableCell key="in" columnIndex={i} tableColumn={c}>
        <span className="secondary-text">{timeUntil(run.at, new Date())}</span>
      </SimpleTableCell>
    ),
  },
  {
    name: "Schedule", id: "cron",
    width: -40,
    renderCell: (_r, i, c, run) => (
      <SimpleTableCell key="cron" columnIndex={i} tableColumn={c}>
        <span className="monospaced-xs text-ellipsis" title={`${run.cron} (UTC)`}>{run.cron}</span>
      </SimpleTableCell>
    ),
  },
];

/** The next ten runs from the workflow's `on.schedule` crons (UTC on GitHub, shown in local time). Scheduled runs use the default branch's file. */
function ScheduledRunsPanel({ repo, wf, branch, onClose }: { repo: string; wf: Workflow; branch: string; onClose: () => void }) {
  const [load, setLoad] = React.useState<ScheduleLoad>({ t: "loading" });
  React.useEffect(() => {
    let dead = false;
    getScheduleCrons(repo, branch, wf.path).then(
      (crons) => !dead && setLoad({ t: "ready", crons, ...nextScheduledRuns(crons, new Date(), 10) }),
      (e) => !dead && setLoad({ t: "error", message: e instanceof GhError ? `The workflow file could not be read (${e.status}).` : "The workflow file could not be read or is not valid YAML." })
    );
    return () => { dead = true; };
  }, [repo, branch, wf.path]);
  const provider = React.useMemo(() => (load.t === "ready" ? new ArrayItemProvider(load.runs) : skeletonRows<ScheduledRun>(5)), [load]);
  return (
    <Panel titleProps={{ text: "Scheduled runs" }} description={`${wf.name} · ${branch}`} size={ContentSize.Medium} onDismiss={onClose} showSeparator footerButtonProps={[{ text: "Close", onClick: onClose }]}>
      <div className="gh-act-dispatch flex-column">
        {wf.disabled && <MessageCard severity={MessageCardSeverity.Warning}>This workflow is disabled, so these runs will not happen until it is enabled.</MessageCard>}
        {load.t === "error" && <MessageCard severity={MessageCardSeverity.Error}>{load.message}</MessageCard>}
        {load.t === "ready" && load.errors.map((e) => <MessageCard key={e.cron} severity={MessageCardSeverity.Warning}>The schedule "{e.cron}" is not valid: {e.message}.</MessageCard>)}
        {load.t === "ready" && !load.crons.length ? (
          <ZeroData iconProps={{ iconName: "Clock" }} imageAltText="" primaryText="No scheduled runs" secondaryText="This workflow has no schedule trigger (on: schedule) on its default branch." />
        ) : load.t !== "error" && (load.t === "loading" || load.runs.length > 0) ? (
          <>
            <span className="secondary-text body-s">Times are in your local time zone. GitHub runs schedules in UTC and may start them a few minutes late when it is busy.</span>
            <Card className="gh-pr-card bolt-table-card" contentProps={{ contentPadding: false }}>
              <Table<ScheduledRun> ariaLabel="Upcoming scheduled runs" role="table" columns={scheduleColumns} itemProvider={provider} showHeader spacerWidth={8} />
            </Card>
          </>
        ) : load.t === "ready" && !load.errors.length ? (
          <ZeroData iconProps={{ iconName: "Clock" }} imageAltText="" primaryText="No upcoming runs" secondaryText="The schedule names a date that never comes." />
        ) : null}
      </div>
    </Panel>
  );
}

function WorkflowPage({ repo, st, goto, props }: { repo: string; st: ActionsHashState; goto: Goto; props: HubProps }) {
  const [wfs] = useAsync(() => listWorkflows(repo), [repo, props.signedIn]);
  const loaded = wfs.t === "ready" ? wfs.v.find((w) => w.id === st.workflow) : undefined;
  // Enable/disable flips the workflow in place rather than reloading the list (and the header) from scratch.
  const [enabled, setEnabled] = React.useState<boolean>();
  const wf = React.useMemo(() => (loaded && enabled !== undefined ? { ...loaded, disabled: !enabled, state: enabled ? "active" : "disabled_manually" } : loaded), [loaded, enabled]);
  const info = useDispatchInfo(repo, wf);
  const [toggling, setToggling] = React.useState(false);
  const [failure, setFailure] = React.useState<string>();
  const [schedules, setSchedules] = React.useState(false);
  const [badge, setBadge] = React.useState(false);
  const toggle = async (on: boolean) => {
    if (!wf) return;
    setToggling(true);
    setFailure(undefined);
    try {
      await setWorkflowEnabled(repo, wf.id, on);
      setEnabled(on);
    } catch (e) {
      setFailure(writeError(e, on ? "enable the workflow" : "disable the workflow"));
    }
    setToggling(false);
  };
  const [panel, setPanel] = React.useState(false);
  const [queued, setQueued] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const onQueued = () => {
    setPanel(false);
    setQueued(true);
    // GitHub creates the run asynchronously: look again a couple of times.
    timers.current = [1500, 5000].map((ms) => setTimeout(() => setRefresh((x) => x + 1), ms));
  };
  const filters: RunFilters = { branch: st.branch, status: st.status, actor: st.actor, event: st.event };
  return (
    <>
    <Header
      className="gh-hub-header gh-act-header"
      title={<>{wf?.name ?? (wfs.t === "ready" ? `Workflow ${st.workflow}` : "")}{wf?.disabled && <Pill className="gh-pr-pill gh-act-pill" size={PillSize.compact} variant={PillVariant.standard}>Disabled</Pill>}</>}
      titleSize={TitleSize.Large}
      titleAriaLevel={1}
      backButtonProps={{ ariaLabel: "All workflows", onClick: () => goto({}) }}
      commandBarItems={[
        // Native Pipelines: "Edit" beside "Run pipeline" opens the YAML editor. Ours is the Files hub's editor, on the default branch.
        ...(wf && info?.canWrite ? [{ id: "edit", text: "Edit", important: true, iconProps: { iconName: "Edit" }, onActivate: () => void openHub("files", editWorkflowHash(repo, info.defaultBranch, wf.path)) }] : []),
        ...(info?.inputs && !wf?.disabled ? [{ id: "run", text: "Run workflow", isPrimary: true, important: true, iconProps: { iconName: "Play" }, onActivate: () => setPanel(true) }] : []),
        ...(wf ? [{ id: "gh", text: "Open on GitHub", iconProps: { iconName: "OpenInNewTab" }, href: wf.htmlUrl, target: "_blank", important: true }] : []),
        // Native Pipelines keeps Disable/Enable and Scheduled runs in the pipeline's "..." menu.
        ...(wf ? [{
          id: "more", ariaLabel: "More actions", important: true, iconProps: { iconName: "More" },
          subMenuProps: {
            id: "gh-act-wf-more",
            items: [
              { id: "schedules", text: "Scheduled runs", iconProps: { iconName: "Clock" }, disabled: !info, onActivate: () => setSchedules(true) },
              { id: "badge", text: "Status badge", iconProps: { iconName: "Ribbon" }, disabled: !info, onActivate: () => setBadge(true) },
              ...(info?.canWrite ? [
                { id: "sep", itemType: MenuItemType.Divider },
                wf.disabled
                  ? { id: "enable", text: "Enable", iconProps: { iconName: "Play" }, disabled: toggling, onActivate: () => void toggle(true) }
                  : { id: "disable", text: "Disable", iconProps: { iconName: "Blocked" }, disabled: toggling, onActivate: () => void toggle(false) },
              ] : []),
            ],
          },
        }] : []),
      ]}
    />
    <div className="page-content page-content-top gh-pr-body flex-column">
      {failure && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setFailure(undefined)}>{failure}</MessageCard>}
      {wf?.disabled && (info?.canWrite ? (
        <MessageCard severity={MessageCardSeverity.Info} buttonProps={[{ text: toggling ? "Enabling" : "Enable", primary: true, disabled: toggling, onClick: () => void toggle(true) }]}>
          This workflow is disabled, so it does not run on its triggers or schedule and cannot be started here.
        </MessageCard>
      ) : (
        <MessageCard severity={MessageCardSeverity.Info}>This workflow is disabled, so it cannot be started here. Someone with write access can enable it.</MessageCard>
      ))}
      {queued && <MessageCard severity={MessageCardSeverity.Info} onDismiss={() => setQueued(false)}>Run queued. It will appear in the list in a moment.</MessageCard>}
      <FilterRow st={st} goto={goto} />
      <RunsList repo={repo} workflowId={st.workflow} filters={filters} goto={goto} props={props} tick={refresh} showWorkflow={false} />
      {panel && wf && info?.inputs && <RunWorkflowPanel repo={repo} wf={wf} info={info} onClose={() => setPanel(false)} onQueued={onQueued} />}
      {badge && wf && info && <StatusBadgeDialog repo={repo} path={wf.path} name={wf.name} defaultBranch={info.defaultBranch} onClose={() => setBadge(false)} />}
      {schedules && wf && info && <ScheduledRunsPanel repo={repo} wf={wf} branch={info.defaultBranch} onClose={() => setSchedules(false)} />}
    </div>
    </>
  );
}

function ActionsPage({ repo, props }: { repo: string; props: HubProps }) {
  const { actions } = useHashExtras(); // BrowseState drops view=actions, so the page is routed on its own parse of the hash
  const st: ActionsHashState = actions && actions.repo === repo ? actions : { repo };
  const goto = React.useCallback<Goto>((s, replace) => (replace ? patchHash((h) => applyActions(h, s)) : gotoHash(serializeActions({ repo, ...s }))), [repo]);
  if (st.run) {
    return <RunPage repo={repo} state={st} go={goto} signedIn={props.signedIn} signIn={() => void props.signIn()} busy={props.busy} />;
  }
  const tab: ActTab = st.tab ?? "recent";
  if (st.workflow) return <WorkflowPage key={`${repo}/${st.workflow}`} repo={repo} st={st} goto={goto} props={props} />;
  if (isEnvironmentPage(st)) return <EnvironmentsTab repo={repo} env={st.env} go={goto} props={props} />;
  return (
    <>
      <Header
        className="gh-hub-header gh-act-header"
        title="Actions"
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        commandBarItems={[
          { id: "gh", text: "Open on GitHub", iconProps: { iconName: "OpenInNewTab" }, href: `https://github.com/${repo}/actions`, target: "_blank", important: true },
          ...props.commandBarItems.map((c) => ({ ...c, important: false })),
        ]}
      >
        {titleSwitcher(repo, props.openSwitch, (r) => gotoHash(serializeActions({ repo: r, tab: st.workflow ? undefined : tab })))}
      </Header>
      {(
        <>
          <TabBar ariaLabel="Actions" selectedTabId={tab} onSelectedTabChanged={(id) => goto({ tab: id as ActTab })} tabSize={TabSize.Tall} disableSticky>
            {TABS.map((t) => <Tab key={t.id} id={t.id} name={t.name} />)}
          </TabBar>
          <div className="page-content page-content-top gh-pr-body flex-column">
            {tab === "runs" ? (
              <>
                <FilterRow st={st} goto={goto} />
                <RunsList key={repo} repo={repo} filters={{ branch: st.branch, status: st.status, actor: st.actor, event: st.event }} goto={goto} props={props} tick={0} showWorkflow />
              </>
            ) : tab === "environments" ? (
              <EnvironmentsTab repo={repo} go={goto} props={props} />
            ) : tab === "library" ? (
              <LibraryTab key={repo} repo={repo} props={props} />
            ) : (
              <Landing key={`${repo}/${tab}`} repo={repo} tab={tab} goto={goto} props={props} />
            )}
          </div>
        </>
      )}
    </>
  );
}

export function ActionsHub(props: HubProps) {
  return (
    <RepoHubPage state={props.state} go={props.go}>
      {(repo) => <ActionsPage repo={repo} props={props} />}
    </RepoHubPage>
  );
}

// A workflow run (ACT-5..12, 14, 15, 17): summary, job graph, artifacts, annotations, re-run/cancel/review, live refresh, and the job log view.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { FormItem } from "azure-devops-ui/FormItem";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Icon } from "azure-devops-ui/Icon";
import { Tab, TabBar } from "azure-devops-ui/Tabs";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { PersonHover } from "./HoverCard";
import { Link } from "azure-devops-ui/Link";
import { MenuButton, MenuItemType, MoreButton } from "azure-devops-ui/Menu";
import { ITableColumn, SimpleTableCell, Table, TwoLineTableCell } from "azure-devops-ui/Table";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Panel } from "azure-devops-ui/Panel";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Status, Statuses, StatusSize } from "azure-devops-ui/Status";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { ContentSize } from "azure-devops-ui/Callout";
import type { ActionsHashState, RunTab } from "./lib/actionsHash";
import { TestsTab } from "./ActionsTests";
import { parseWorkflowJobs, jobGraph, formatDuration, type Annotation, type Artifact, type Job, type JobGroup, type PendingDeployment, type RunState, type WorkflowRun, type WorkflowJobDef } from "./lib/workflows";
import { formatBytes } from "./lib/releases";
import {
  cancelRun, downloadArtifact, getRun, getWorkflowYaml, listArtifacts, listJobAnnotations, listJobs, listPendingDeployments, rerunAll, rerunFailed, rerunJob, reviewDeployments, useCanWriteActions,
} from "./actionsApi";
import { ErrorView } from "./Browser";
import { Loading } from "./RepoHub";
import { commitDateText } from "./lib/dateText";
import { openInHub, useHubHref } from "./repoHref";
import { GhError } from "./githubBrowse";
import { LogView } from "./ActionsLog";
import { DeleteRunDialog, RunStatusIcon, RUN_STATE_TEXT, type DeleteTarget } from "./ActionsUi";
import "./actionsRun.css";

export interface RunPageProps {
  repo: string;
  /** The parsed hash; `run` is set. */
  state: ActionsHashState;
  /** Navigate within the Actions hub (writes the hash with applyActions/serializeActions). */
  go: (s: Omit<ActionsHashState, "repo">, replace?: boolean) => void;
  signedIn: boolean;
  signIn: () => void;
  busy: boolean;
}

// ---------- shared bits ----------

export const STATE_TEXT = RUN_STATE_TEXT;
export const StateIcon = ({ state, size = StatusSize.m }: { state: RunState; size?: StatusSize }) => <RunStatusIcon state={state} size={size} />;

export const isActive = (s: RunState) => s === "queued" || s === "waiting" || s === "inProgress";

/** A job or step's duration so far: to its end, or to `now` while it runs. undefined before it starts. */
export function spanMs(start: Date | undefined, end: Date | undefined, now: number): number | undefined {
  return start ? Math.max(0, (end ? end.getTime() : now) - start.getTime()) : undefined;
}
/** A job's duration; blank while it waits (GitHub stamps queued jobs with a start time). */
export const jobMs = (j: Job, now: number) => (j.state === "queued" || j.state === "waiting" ? undefined : spanMs(j.startedAt, j.completedAt, now));
export const dur = (ms: number | undefined) => (ms === undefined ? "" : formatDuration(ms));

function groupMs(all: Job[], now: number): number | undefined {
  const jobs = all.filter((j) => j.state !== "queued" && j.state !== "waiting");
  const starts = jobs.map((j) => j.startedAt?.getTime()).filter((x): x is number => x !== undefined);
  if (!starts.length) return undefined;
  const ends = jobs.map((j) => j.completedAt?.getTime()).filter((x): x is number => x !== undefined);
  const end = jobs.some((j) => !j.completedAt) ? now : Math.max(...ends);
  return Math.max(0, end - Math.min(...starts));
}

/** A clock that ticks each second while `on`, so running durations move. */
export function useNow(on: boolean): number {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return on ? now : Date.now();
}

// ---------- data: the run and its jobs, polled while anything is running (ACT-15) ----------

interface RunData { run?: WorkflowRun; latestAttempt: number; jobs?: Job[]; pending: PendingDeployment[]; artifacts: Artifact[]; err?: unknown }
const POLL_MS = 5000;

function useRunData(repo: string, runId: number, attempt: number | undefined) {
  const [d, setD] = React.useState<RunData>({ latestAttempt: 1, pending: [], artifacts: [] });
  const gen = React.useRef(0);
  const load = React.useCallback(async (quiet: boolean) => {
    const g = gen.current;
    try {
      const [run, latest, jobs] = await Promise.all([getRun(repo, runId, attempt), attempt ? getRun(repo, runId) : undefined, listJobs(repo, runId, attempt)]);
      const waiting = run.state === "waiting" || jobs.some((j) => j.state === "waiting");
      const [pending, artifacts] = await Promise.all([waiting && !attempt ? listPendingDeployments(repo, runId) : [], listArtifacts(repo, runId).catch(() => [] as Artifact[])]);
      if (g === gen.current) setD({ run, latestAttempt: (latest ?? run).attempt, jobs, pending, artifacts });
    } catch (err) {
      if (g === gen.current) setD((p) => (quiet && p.run ? p : { ...p, err }));
    }
  }, [repo, runId, attempt]);
  React.useEffect(() => {
    gen.current++;
    setD({ latestAttempt: 1, pending: [], artifacts: [] });
    void load(false);
    return () => { gen.current++; };
  }, [load]);
  const active = !!d.run && (isActive(d.run.state) || !!d.jobs?.some((j) => isActive(j.state)));
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(t);
  }, [active, load]);
  return { ...d, active, reload: React.useCallback(() => load(false), [load]), quietReload: React.useCallback(() => load(true), [load]) };
}

/** The workflow's jobs from its file at the run's commit: undefined while loading, null when unavailable. */
function useWorkflowDefs(repo: string, run: WorkflowRun | undefined): WorkflowJobDef[] | null | undefined {
  const [defs, setDefs] = React.useState<WorkflowJobDef[] | null | undefined>();
  const key = run ? `${run.headSha}:${run.path}` : "";
  React.useEffect(() => {
    if (!run) return;
    let dead = false;
    setDefs(undefined);
    void getWorkflowYaml(repo, run.headSha, run.path).then((text) => {
      let out: WorkflowJobDef[] | null = null;
      try { out = text ? parseWorkflowJobs(text) : null; } catch { out = null; }
      if (!dead) setDefs(out);
    });
    return () => { dead = true; };
  }, [repo, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return defs;
}

type JobNote = Annotation & { job: Job };
/** Annotations of finished jobs, fetched once per job (ACT-11). ponytail: at most 40 jobs, six requests at a time. */
function useAnnotations(repo: string, jobs: Job[] | undefined): JobNote[] {
  const cache = React.useRef(new Map<number, Annotation[]>());
  const [, bump] = React.useState(0);
  const key = jobs?.map((j) => `${j.id}${j.status === "completed" ? "c" : ""}`).join(",") ?? "";
  React.useEffect(() => {
    if (!jobs) return;
    const todo = jobs.filter((j) => j.status === "completed" && !cache.current.has(j.id)).slice(0, 40);
    if (!todo.length) return;
    let dead = false;
    void (async () => {
      for (let i = 0; i < todo.length; i += 6) {
        await Promise.all(todo.slice(i, i + 6).map((j) => listJobAnnotations(repo, j.id).then((a) => cache.current.set(j.id, a), () => cache.current.set(j.id, []))));
        if (dead) return;
        bump((n) => n + 1);
      }
    })();
    return () => { dead = true; };
  }, [repo, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (jobs ?? []).flatMap((j) => (cache.current.get(j.id) ?? []).map((a) => ({ ...a, job: j })));
}

// ---------- the page ----------

export function RunPage(props: RunPageProps) {
  const { repo, state, go } = props;
  const runId = state.run!;
  const data = useRunData(repo, runId, state.attempt);
  const canWrite = useCanWriteActions(repo);
  const now = useNow(data.active);
  const { run, jobs } = data;

  if (data.err && !run) return <div className="page-content"><ErrorView err={data.err} signIn={props.signIn} busy={props.busy} retry={() => void data.reload()} subject="see this run" permission="Actions" back={() => go({})} /></div>;
  if (!run || !jobs) return <Loading label="Loading run" />;
  if (state.job) return <LogView {...props} run={run} jobs={jobs} jobId={state.job} now={now} canWrite={canWrite && run.attempt === data.latestAttempt} onRerun={(j) => rerunJob(repo, j.id).then(() => void data.reload())} />;
  return <Summary {...props} data={data} canWrite={canWrite} now={now} />;
}

function Summary({ repo, state, go, data, canWrite, now }: RunPageProps & { data: ReturnType<typeof useRunData>; canWrite: boolean; now: number }) {
  const run = data.run!;
  const jobs = data.jobs!;
  const href = useHubHref();
  const defs = useWorkflowDefs(repo, run);
  const notes = useAnnotations(repo, jobs);
  // Native keeps the run page's tab in the URL; so do we (actRunTab), so a link can open the Tests tab.
  const page: "summary" | RunTab = state.runTab ?? "summary";
  const setPage = (p: "summary" | RunTab) => go({ run: run.id, attempt: state.attempt, runTab: p === "summary" ? undefined : p }, true);
  const [tab, setTab] = React.useState<"stages" | "jobs">("stages");
  const [failure, setFailure] = React.useState<string>();
  const [reviewing, setReviewing] = React.useState(false);
  const [deleting, setDeleting] = React.useState<DeleteTarget>();
  const latest = run.attempt === data.latestAttempt;
  const failed = jobs.some((j) => j.state === "failed");
  const approvable = data.pending.filter((p) => p.canApprove);
  const write = canWrite && latest;
  const total = run.state === "queued" ? undefined : spanMs(run.startedAt ?? run.createdAt, isActive(run.state) ? undefined : run.updatedAt, now);

  // Runs a write, then refreshes now and again shortly (GitHub takes a moment to flip the status).
  const act = async (what: string, fn: () => Promise<void>) => {
    setFailure(undefined);
    try {
      await fn();
      void data.reload();
      setTimeout(() => void data.quietReload(), 1500);
      setTimeout(() => void data.quietReload(), 4000);
    } catch (e) {
      const d = e instanceof GhError ? e.detail ?? e.apiMessage ?? (e.kind === "access" ? "GitHub refused it (the app may lack Actions write permission)" : "") : "";
      setFailure(`Could not ${what}${d ? `: ${d}` : "."}`);
    }
  };

  // Native: one primary button and a More menu.
  const rerunItem = failed
    ? { id: "rerunFailed", text: "Re-run failed jobs", iconProps: { iconName: "Refresh" }, onActivate: () => void act("re-run the failed jobs", () => rerunFailed(repo, run.id)) }
    : { id: "rerun", text: "Re-run all jobs", iconProps: { iconName: "Refresh" }, onActivate: () => void act("re-run the jobs", () => rerunAll(repo, run.id)) };
  const primary = approvable.length
    ? { id: "review", text: "Review deployments", isPrimary: true, important: true, iconProps: { iconName: "Completed" }, onActivate: () => setReviewing(true) }
    : write ? { ...rerunItem, isPrimary: true, important: true, disabled: isActive(run.state) } : undefined;
  const more = [
    ...(write && primary?.id !== "review" && failed ? [{ id: "rerun", text: "Re-run all jobs", iconProps: { iconName: "Refresh" }, disabled: isActive(run.state), onActivate: () => void act("re-run the jobs", () => rerunAll(repo, run.id)) }] : []),
    ...(write && primary?.id === "review" ? [{ ...rerunItem, disabled: isActive(run.state) }] : []),
    ...(write && isActive(run.state) ? [{ id: "cancel", text: "Cancel run", iconProps: { iconName: "Cancel" }, onActivate: () => void act("cancel the run", () => cancelRun(repo, run.id)) }] : []),
    { id: "github", text: "Open on GitHub", iconProps: { iconName: "OpenInNewTab" }, onActivate: () => void window.open(run.htmlUrl, "_blank", "noopener,noreferrer") },
    // Native Pipelines: "Delete" on a run. GitHub refuses to delete a run (or its logs) while it is still going.
    ...(canWrite ? [
      { id: "sep", itemType: MenuItemType.Divider },
      { id: "deleteLogs", text: "Delete logs", iconProps: { iconName: "Delete" }, disabled: isActive(run.state), onActivate: () => setDeleting({ id: run.id, runNumber: run.runNumber, title: run.title, logsOnly: true }) },
      { id: "delete", text: "Delete run", iconProps: { iconName: "Delete" }, disabled: isActive(run.state), onActivate: () => setDeleting({ id: run.id, runNumber: run.runNumber, title: run.title, logsOnly: false }) },
    ] : []),
  ];
  const items = [
    ...(primary ? [primary] : []),
    { id: "more", ariaLabel: "More", important: true, iconProps: { iconName: "More" }, subMenuProps: { id: "gh-act-more", items: more } },
  ];

  const commit = { repo, commit: run.headSha };
  const wfFile = { repo, ref: run.headSha, path: run.path };
  const errorCount = notes.filter((n) => n.level === "failure").length;
  const warnCount = notes.filter((n) => n.level === "warning").length;
  const groups = React.useMemo(() => (defs === undefined ? [] : jobGraph(jobs, defs).filter((c) => c.length)), [jobs, defs]);
  const openJob = (j: Job) => go({ run: run.id, attempt: state.attempt, job: j.id });

  return (
    <div className="page-content gh-act-run">
      <Header
        className="gh-hub-header gh-act-header gh-act-subheader"
        title={`#${run.runNumber} • ${run.title}`}
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        titleIconProps={{ render: () => <StateIcon state={run.state} size={StatusSize.m} /> }}
        description={<span className="flex-row flex-center gh-act-pipeline"><Icon iconName="Rocket" />{run.name}</span>}
        commandBarItems={items}
      />
      <TabBar ariaLabel="Run" selectedTabId={page === "artifacts" && !data.artifacts.length ? "summary" : page} onSelectedTabChanged={(id) => setPage(id as "summary" | RunTab)} className="gh-act-pagetabs" disableSticky>
        <Tab id="summary" name="Summary" />
        <Tab id="tests" name="Tests" />
        {data.artifacts.length > 0 && <Tab id="artifacts" name="Artifacts" badgeCount={data.artifacts.length} />}
      </TabBar>
      <div className="gh-act-body flex-column">
        {failure && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setFailure(undefined)}>{failure}</MessageCard>}
        {!latest && <MessageCard severity={MessageCardSeverity.Info} buttonProps={[{ text: "Go to the latest attempt", onClick: () => go({ run: run.id }) }]}>You are looking at attempt {run.attempt} of {data.latestAttempt}.</MessageCard>}
        {data.pending.length > 0 && <MessageCard severity={MessageCardSeverity.Warning}>Waiting for review: {data.pending.map((p) => p.environmentName).join(", ")}.</MessageCard>}

        {page === "tests" ? <TestsTab repo={repo} runId={run.id} artifacts={data.artifacts} active={isActive(run.state)} />
        : page === "artifacts" && data.artifacts.length > 0 ? <Artifacts repo={repo} artifacts={data.artifacts} /> : <>
        <Card className="gh-act-card gh-act-summary">
          <div className="gh-act-sum-top flex-row flex-center">
            <h2 className="gh-act-sum-title flex-row flex-center flex-grow">
              <span>{triggerText(run.event)}</span>
              {run.actor && <><span className="gh-act-sum-by">by</span><PersonHover repo={repo} login={run.actor.login} name={run.actor.name} avatarUrl={run.actor.avatarUrl}><VssPersona imageUrl={run.actor.avatarUrl} displayName={run.actor.name} size="small" suppressPersonaCard showInitialsOnImageError /><span className="text-ellipsis">{run.actor.name}</span></PersonHover></>}
            </h2>
            {data.latestAttempt > 1 && (
              <MenuButton
                ariaLabel="Choose an attempt"
                text={`Attempt ${run.attempt}${latest ? " (latest)" : ""}`}
                contextualMenuProps={{ menuProps: { id: "gh-act-attempts", items: Array.from({ length: data.latestAttempt }, (_, i) => data.latestAttempt - i).map((n) => ({ id: `a${n}`, text: `Attempt ${n}${n === data.latestAttempt ? " (latest)" : ""}`, onActivate: () => go({ run: run.id, attempt: n === data.latestAttempt ? undefined : n }) })) } }}
              />
            )}
            <Button text="View changes" href={href("commits", commit)} onClick={(e) => openInHub("commits", commit)(e)} />
            <Button text="Workflow file" href={href("files", wfFile)} onClick={(e) => openInHub("files", wfFile)(e)} />
          </div>
          <div className="gh-act-sum-meta flex-row flex-center">
            <span className="flex-row flex-center"><Icon iconName="Calendar" />{commitDateText(run.createdAt)}</span>
            <span className="flex-row flex-center"><Icon iconName="Clock" />{dur(total) || "–"}</span>
          </div>
          <div className="gh-act-sum-cols">
            <section aria-label="Repository and version">
              <h3 className="secondary-text">Repository and version</h3>
              <div className="flex-row flex-center"><Icon iconName="GitLogo" /><span className="text-ellipsis">{repo.split("/").pop()}</span></div>
              <div className="flex-row flex-center gh-act-sum-ver">
                {run.branch && <span className="flex-row flex-center"><Icon iconName="BranchFork2" /><span className="text-ellipsis">{run.branch}</span></span>}
                <span className="flex-row flex-center"><Icon iconName="BranchCommit" /><Link subtle removeUnderline href={href("commits", commit)} onClick={openInHub("commits", commit)} ariaLabel={`Commit ${run.headSha.slice(0, 8)}`}>{run.headSha.slice(0, 8)}</Link></span>
              </div>
            </section>
            <section aria-label="Related">
              <h3 className="secondary-text">Related</h3>
              {run.prNumbers.length ? run.prNumbers.map((n) => {
                const pr = { repo, view: "prs", pr: n } as const;
                return <div key={n} className="flex-row flex-center"><Icon iconName="BranchPullRequest" /><Link subtle removeUnderline href={href("prs", pr)} onClick={openInHub("prs", pr)}>#{n}</Link></div>;
              }) : <div className="flex-row flex-center"><Icon iconName="BranchPullRequest" />No pull requests</div>}
              {data.artifacts.length > 0 && (
                <div className="flex-row flex-center"><Icon iconName="Package" /><Link subtle removeUnderline href="#" onClick={(e) => { e.preventDefault(); setPage("artifacts"); }}>{data.artifacts.length} published</Link></div>
              )}
            </section>
            <section aria-label="Checks">
              <h3 className="secondary-text">Checks</h3>
              <div className="flex-row flex-center">
                <Status {...(errorCount ? Statuses.Failed : warnCount ? Statuses.Warning : Statuses.Success)} size={StatusSize.s} ariaLabel="" />
                <span>{errorCount || warnCount ? [errorCount && plural(errorCount, "error"), warnCount && plural(warnCount, "warning")].filter(Boolean).join(", ") : "No errors or warnings"}</span>
              </div>
            </section>
          </div>
        </Card>

        <Annotations notes={notes} repo={repo} sha={run.headSha} open={openJob} />

        <Card className="gh-act-card gh-act-stagecard">
          <TabBar ariaLabel="Stages and jobs" selectedTabId={tab} onSelectedTabChanged={(id) => setTab(id as "stages" | "jobs")} className="gh-act-innertabs" disableSticky>
            <Tab id="stages" name="Stages" />
            <Tab id="jobs" name="Jobs" />
          </TabBar>
          {tab === "stages" ? (
            defs === undefined ? <Loading label="Loading the stages" /> : (
              <StageGraph groups={groups} notes={notes} artifactCount={data.artifacts.length} now={now} canRerun={write} open={openJob} rerun={(js) => void act("re-run the stage", async () => { for (const j of js) await rerunJob(repo, j.id); })} />
            )
          ) : (
            <JobsTable jobs={jobs} now={now} canRerun={write && !isActive(run.state)} open={openJob} rerun={(j) => void act(`re-run ${j.name}`, () => rerunJob(repo, j.id))} />
          )}
        </Card>
        </>}
      </div>
      {deleting && (
        <DeleteRunDialog
          repo={repo}
          target={deleting}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            const logsOnly = deleting.logsOnly;
            setDeleting(undefined);
            if (logsOnly) void data.reload();
            else go({ workflow: run.workflowId }); // back to the workflow's runs, which no longer list it
          }}
        />
      )}
      {reviewing && <ReviewPanel repo={repo} runId={run.id} pending={approvable} close={() => setReviewing(false)} done={() => { setReviewing(false); void data.reload(); setTimeout(() => void data.quietReload(), 1500); }} />}
    </div>
  );
}

// ---------- stages and jobs (ACT-5, 6) ----------

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** Native's trigger heading for a run's event. */
export function triggerText(event: string): string {
  const t: Record<string, string> = { push: "Push", pull_request: "Pull request", pull_request_target: "Pull request", workflow_dispatch: "Manual run", schedule: "Scheduled", release: "Release", workflow_run: "Triggered by another workflow", merge_group: "Merge queue" };
  return t[event] ?? event;
}
const JOB_STATUS_TEXT: Record<RunState, string> = { ...STATE_TEXT, succeeded: "Success", inProgress: "Running" };

function progressText(g: JobGroup): string {
  const done = g.jobs.filter((j) => j.status === "completed").length;
  if (done === g.jobs.length) return `${plural(done, "job")} completed`;
  if (done > 0) return `${done} of ${g.jobs.length} jobs completed`;
  return g.state === "inProgress" ? "Running" : STATE_TEXT[g.state];
}

/** Each job group is a native "stage card"; columns and connector lines as before (GitHub has no stages). */
function StageGraph({ groups, notes, artifactCount, now, canRerun, open, rerun }: { groups: JobGroup[][]; notes: JobNote[]; artifactCount: number; now: number; canRerun: boolean; open: (j: Job) => void; rerun: (js: Job[]) => void }) {
  const box = React.useRef<HTMLDivElement>(null);
  const cards = React.useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = React.useState<{ d: string; w: number; h: number }>({ d: "", w: 0, h: 0 });
  const measure = React.useCallback(() => {
    const b = box.current;
    if (!b) return;
    const o = b.getBoundingClientRect();
    const rect = (k: string) => { const r = cards.current.get(k)?.getBoundingClientRect(); return r && { l: r.left - o.left, r: r.right - o.left, m: r.top - o.top + 21 }; };
    let d = "";
    for (const g of groups.flat()) {
      const to = rect(g.key);
      for (const n of g.needs) {
        const from = rect(n);
        if (from && to) d += `M${from.r},${from.m} C${from.r + 24},${from.m} ${to.l - 24},${to.m} ${to.l},${to.m} `;
      }
    }
    setLines((p) => (p.d === d && p.w === o.width && p.h === o.height ? p : { d, w: o.width, h: o.height }));
  }, [groups]);
  React.useLayoutEffect(() => { measure(); }); // after every render: card heights change with progress
  React.useEffect(() => {
    if (!box.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [measure]);
  if (!groups.length) return <div className="secondary-text gh-act-empty">No jobs have started yet.</div>;
  return (
    <div className="gh-act-graph-wrap">
      <div className="gh-act-graph" ref={box} role="group" aria-label="Stage graph">
        <svg className="gh-act-lines" width={lines.w} height={lines.h} aria-hidden="true"><path d={lines.d} fill="none" /></svg>
        {groups.map((col, i) => (
          <div className="gh-act-col" key={i}>
            {col.map((g) => {
              const finished = g.jobs.every((j) => j.status === "completed");
              const mine = notes.filter((n) => g.jobs.some((j) => j.id === n.job.id));
              const errs = mine.filter((n) => n.level === "failure").length;
              const warns = mine.filter((n) => n.level === "warning").length;
              const info = [errs && plural(errs, "error"), warns && plural(warns, "warning")].filter(Boolean).join(" · ");
              const arts = i === groups.length - 1 && artifactCount > 0;
              const failedJobs = g.jobs.filter((j) => j.state === "failed");
              return (
                <section key={g.key} className="gh-act-stage" aria-label={`${g.title}, ${STATE_TEXT[g.state]}`} ref={(el) => { if (el) cards.current.set(g.key, el); else cards.current.delete(g.key); }}>
                  <div className="gh-act-stage-primary">
                    <div className="gh-act-stage-title flex-row flex-center"><StateIcon state={g.state} size={StatusSize.m} /><h3 className="text-ellipsis">{g.title}</h3></div>
                    <div className="gh-act-stage-progress secondary-text flex-row"><span className="flex-grow">{progressText(g)}</span><span>{dur(groupMs(g.jobs, now))}</span></div>
                    {arts && <div className="gh-act-stage-info flex-row flex-center"><Icon iconName="Package" />{plural(artifactCount, "artifact")}</div>}
                    {info && <div className="gh-act-stage-info flex-row flex-center"><Icon iconName={errs ? "ErrorBadge" : "Warning"} />{info}</div>}
                  </div>
                  <StageJobs group={g} now={now} open={open} />
                  {canRerun && finished && (
                    <div className="gh-act-stage-foot"><Button text="Re-run stage" ariaLabel={`Re-run stage ${g.title}`} onClick={() => rerun(failedJobs.length ? failedJobs : g.jobs)} /></div>
                  )}
                </section>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A job's label in its group: a matrix variant drops the group's title. */
const jobLabel = (g: JobGroup, j: Job) => (g.jobs.length > 1 ? j.name.slice(g.title.length).trim().replace(/^\((.*)\)$/, "$1") || j.name : j.name);

function StageJobs({ group, now, open }: { group: JobGroup; now: number; open: (j: Job) => void }) {
  const provider = React.useMemo(() => new ArrayItemProvider(group.jobs), [group.jobs]);
  const cols = React.useMemo<ITableColumn<Job>[]>(() => [
    { id: "name", width: -100, renderCell: (_r, i, c, j) => (
      <SimpleTableCell key="name" columnIndex={i} tableColumn={c}><StateIcon state={j.state} size={StatusSize.m} /><span className="gh-act-title text-ellipsis">{jobLabel(group, j)}</span></SimpleTableCell>
    ) },
    { id: "dur", width: 60, renderCell: (_r, i, c, j) => (
      <SimpleTableCell key="dur" columnIndex={i} tableColumn={c}><span className="secondary-text">{dur(jobMs(j, now))}</span></SimpleTableCell>
    ) },
  ], [group, now]);
  return <Table<Job> ariaLabel={`Jobs in ${group.title}`} role="table" className="gh-act-stage-jobs" columns={cols} itemProvider={provider} showHeader={false} showLines={false} singleClickActivation onActivate={(_e, r) => open(r.data)} />;
}

function JobsTable({ jobs, now, canRerun, open, rerun }: { jobs: Job[]; now: number; canRerun: boolean; open: (j: Job) => void; rerun: (j: Job) => void }) {
  const provider = React.useMemo(() => new ArrayItemProvider(jobs), [jobs]);
  const cols = React.useMemo<ITableColumn<Job>[]>(() => [
    { id: "name", name: "Name", width: -60, renderCell: (_r, i, c, j) => (
      <SimpleTableCell key="name" columnIndex={i} tableColumn={c}><StateIcon state={j.state} size={StatusSize.m} /><Link className="bolt-table-link text-ellipsis" subtle removeUnderline href="#" onClick={(e) => { e.preventDefault(); open(j); }}>{j.name}</Link></SimpleTableCell>
    ) },
    { id: "status", name: "Status", width: -20, renderCell: (_r, i, c, j) => <SimpleTableCell key="status" columnIndex={i} tableColumn={c}>{JOB_STATUS_TEXT[j.state]}</SimpleTableCell> },
    { id: "dur", name: "Duration", width: -20, renderCell: (_r, i, c, j) => (
      <SimpleTableCell key="dur" columnIndex={i} tableColumn={c}><Icon iconName="Clock" /><span className="secondary-text">{dur(jobMs(j, now)) || "–"}</span></SimpleTableCell>
    ) },
    { id: "more", width: 48, renderCell: (_r, i, c, j) => (
      <SimpleTableCell key="more" columnIndex={i} tableColumn={c}>
        {canRerun && j.status === "completed" && <MoreButton ariaLabel={`Actions for ${j.name}`} contextualMenuProps={{ menuProps: { id: `gh-act-job-${j.id}`, items: [{ id: "rerun", text: "Re-run job", iconProps: { iconName: "Refresh" }, onActivate: () => rerun(j) }] } }} />}
      </SimpleTableCell>
    ) },
  ], [now, canRerun, open, rerun]);
  if (!jobs.length) return <div className="secondary-text gh-act-empty">No jobs have started yet.</div>;
  return <Table<Job> ariaLabel="Jobs" role="table" className="gh-act-jobtable" columns={cols} itemProvider={provider} showHeader spacerWidth={8} />;
}

// ---------- artifacts (ACT-10) ----------

function Artifacts({ repo, artifacts }: { repo: string; artifacts: Artifact[] }) {
  const [busy, setBusy] = React.useState<number>();
  const [failed, setFailed] = React.useState<string>();
  const download = React.useCallback(async (a: Artifact) => {
    setBusy(a.id);
    setFailed(undefined);
    try {
      const url = URL.createObjectURL(await downloadArtifact(repo, a.id));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${a.name}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setFailed(`Could not download ${a.name}.`);
    } finally {
      setBusy(undefined);
    }
  }, [repo]);
  const provider = React.useMemo(() => new ArrayItemProvider(artifacts), [artifacts]);
  const cols = React.useMemo<ITableColumn<Artifact>[]>(() => [
    { id: "name", name: "Name", width: -60, renderCell: (_r, i, c, a) => (
      <SimpleTableCell key="name" columnIndex={i} tableColumn={c}><Icon iconName="Package" /><span className="text-ellipsis">{a.name}</span>{a.expired && <Pill className="gh-act-pill" size={PillSize.compact} variant={PillVariant.outlined}>Expired</Pill>}</SimpleTableCell>
    ) },
    { id: "size", name: "Size", width: -20, renderCell: (_r, i, c, a) => <SimpleTableCell key="size" columnIndex={i} tableColumn={c}>{formatBytes(a.sizeInBytes)}</SimpleTableCell> },
    { id: "dl", width: -20, renderCell: (_r, i, c, a) => (
      <SimpleTableCell key="dl" columnIndex={i} tableColumn={c}>
        {a.expired ? <span className="secondary-text">No longer available</span> : <Button subtle iconProps={{ iconName: "Download" }} text="Download" ariaLabel={`Download ${a.name}`} disabled={busy === a.id} onClick={() => void download(a)} />}
      </SimpleTableCell>
    ) },
  ], [busy, download]);
  return (
    <Card className="gh-act-card" titleProps={{ text: `Artifacts (${artifacts.length})` }}>
      {failed && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setFailed(undefined)}>{failed}</MessageCard>}
      <Table<Artifact> ariaLabel="Artifacts" role="table" className="gh-act-jobtable" columns={cols} itemProvider={provider} showHeader spacerWidth={8} />
    </Card>
  );
}

// ---------- annotations (ACT-11) ----------

const LEVELS: { level: Annotation["level"]; label: string; status: typeof Statuses.Success }[] = [
  { level: "failure", label: "Errors", status: Statuses.Failed },
  { level: "warning", label: "Warnings", status: Statuses.Warning },
  { level: "notice", label: "Notices", status: Statuses.Information },
];

/** Native: a card whose header is a tab per level with a count; the rows are status icon, message, then "job · file:line". */
function Annotations({ notes, repo, sha, open }: { notes: JobNote[]; repo: string; sha: string; open: (j: Job) => void }) {
  const href = useHubHref();
  const [picked, setPicked] = React.useState<Annotation["level"]>("failure");
  const present = LEVELS.filter((l) => notes.some((n) => n.level === l.level));
  const sel = present.find((l) => l.level === picked) ?? present[0];
  const shown = sel ? notes.filter((n) => n.level === sel.level) : [];
  const rows = React.useMemo(() => new ArrayItemProvider(shown), [notes, sel?.level]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = React.useMemo<ITableColumn<JobNote>[]>(() => [
    { id: "note", width: -100, renderCell: (_r, i, c, n) => {
      const file = { repo, ref: sha, path: n.path };
      return (
        <TwoLineTableCell
          key="note"
          columnIndex={i}
          tableColumn={c}
          iconProps={{ render: () => <Status {...sel!.status} size={StatusSize.m} ariaLabel={sel!.label} /> }}
          line1={<span className="gh-act-note-msg">{n.title && <strong>{n.title}: </strong>}{n.message}</span>}
          line2={
            <span className="secondary-text body-s">
              <Link subtle href="#" onClick={(e) => { e.preventDefault(); open(n.job); }}>{n.job.name}</Link>
              {" · "}
              <Link subtle href={href("files", file)} onClick={openInHub("files", file)}>{n.path}:{n.startLine}{n.endLine !== n.startLine ? `-${n.endLine}` : ""}</Link>
            </span>
          }
        />
      );
    } },
  ], [repo, sha, sel?.level, open, href]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sel) return null;
  return (
    <Card className="gh-act-card gh-act-notescard">
      <TabBar ariaLabel="Annotation levels" selectedTabId={sel.level} onSelectedTabChanged={(id) => setPicked(id as Annotation["level"])} className="gh-act-innertabs" disableSticky>
        {present.map((l) => <Tab key={l.level} id={l.level} name={l.label} badgeCount={notes.filter((n) => n.level === l.level).length} />)}
      </TabBar>
      <Table<JobNote> ariaLabel={`${sel.label}, ${shown.length}`} role="table" className="gh-act-jobtable" columns={cols} itemProvider={rows} showHeader={false} spacerWidth={8} />
    </Card>
  );
}

// ---------- review pending deployments (ACT-14) ----------

function ReviewPanel({ repo, runId, pending, close, done }: { repo: string; runId: number; pending: PendingDeployment[]; close: () => void; done: () => void }) {
  const [picked, setPicked] = React.useState<Set<number>>(() => new Set(pending.map((p) => p.environmentId)));
  const [comment, setComment] = React.useState("");
  const [envsLabel, setEnvsLabel] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string>();
  const submit = async (state: "approved" | "rejected") => {
    setBusy(true);
    setErr(undefined);
    try {
      await reviewDeployments(repo, runId, [...picked], state, comment);
      done();
    } catch (e) {
      setErr(`Could not ${state === "approved" ? "approve" : "reject"} the deployment${e instanceof GhError && (e.detail ?? e.apiMessage) ? `: ${e.detail ?? e.apiMessage}` : "."}`);
      setBusy(false);
    }
  };
  const none = picked.size === 0 || busy;
  return (
    <Panel
      titleProps={{ text: "Review pending deployments" }}
      description="Choose the environments, then approve or reject. The jobs waiting on them continue or stop."
      size={ContentSize.Medium}
      onDismiss={close}
      showSeparator
      footerButtonProps={[
        { text: "Cancel", onClick: close },
        { text: "Reject", onClick: () => void submit("rejected"), disabled: none, danger: true },
        { text: "Approve", onClick: () => void submit("approved"), disabled: none, primary: true },
      ]}
    >
      <div className="gh-act-review flex-column">
        {err && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setErr(undefined)}>{err}</MessageCard>}
        <FormItem label="Environments" emitGeneratedLabelId={setEnvsLabel}>
          <div className="gh-act-envs flex-column" role="group" aria-labelledby={envsLabel}>
            {pending.map((p) => (
              <Checkbox key={p.environmentId} label={p.environmentName} checked={picked.has(p.environmentId)} onChange={(_e, c) => setPicked((s) => { const n = new Set(s); c ? n.add(p.environmentId) : n.delete(p.environmentId); return n; })} />
            ))}
          </div>
        </FormItem>
        <FormItem label="Comment (optional)">
          <TextField className="gh-act-comment" multiline rows={4} width={TextFieldWidth.auto} value={comment} onChange={(_e, t) => setComment(t)} />
        </FormItem>
      </div>
    </Panel>
  );
}

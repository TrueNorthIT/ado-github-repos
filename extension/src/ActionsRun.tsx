// A workflow run (ACT-5..12, 14, 15, 17): summary, job graph, artifacts, annotations, re-run/cancel/review, live refresh, and the job log view.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { MenuButton, MoreButton } from "azure-devops-ui/Menu";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Panel } from "azure-devops-ui/Panel";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Status, Statuses, StatusSize } from "azure-devops-ui/Status";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { ContentSize } from "azure-devops-ui/Callout";
import type { ActionsHashState } from "./lib/actionsHash";
import { parseWorkflowJobs, jobGraph, formatDuration, type Annotation, type Artifact, type Job, type JobGroup, type PendingDeployment, type RunState, type WorkflowRun, type WorkflowJobDef } from "./lib/workflows";
import { formatBytes } from "./lib/releases";
import {
  cancelRun, downloadArtifact, getRun, getWorkflowYaml, listArtifacts, listJobAnnotations, listJobs, listPendingDeployments, rerunAll, rerunFailed, rerunJob, reviewDeployments, useCanWriteActions,
} from "./actionsApi";
import { ErrorView } from "./Browser";
import { Loading, PersonLine } from "./RepoHub";
import { RelDate } from "./RelDate";
import { openInHub, useHubHref } from "./repoHref";
import { GhError } from "./githubBrowse";
import { LogView } from "./ActionsLog";
import { RunStatusIcon, RUN_STATE_TEXT } from "./ActionsUi";
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
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [failure, setFailure] = React.useState<string>();
  const [reviewing, setReviewing] = React.useState(false);
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

  const items = [
    ...(approvable.length ? [{ id: "review", text: "Review deployments", isPrimary: true, important: true, iconProps: { iconName: "Completed" }, onActivate: () => setReviewing(true) }] : []),
    ...(write ? [
      { id: "rerun", text: "Re-run all jobs", important: true, iconProps: { iconName: "Refresh" }, disabled: isActive(run.state), onActivate: () => void act("re-run the jobs", () => rerunAll(repo, run.id)) },
      ...(failed ? [{ id: "rerunFailed", text: "Re-run failed jobs", important: true, iconProps: { iconName: "Refresh" }, disabled: isActive(run.state), onActivate: () => void act("re-run the failed jobs", () => rerunFailed(repo, run.id)) }] : []),
      ...(isActive(run.state) ? [{ id: "cancel", text: "Cancel run", important: true, iconProps: { iconName: "Cancel" }, onActivate: () => void act("cancel the run", () => cancelRun(repo, run.id)) }] : []),
    ] : []),
    { id: "github", text: "Open on GitHub", important: true, iconProps: { iconName: "OpenInNewTab" }, onActivate: () => void window.open(run.htmlUrl, "_blank", "noopener,noreferrer") },
  ];

  const commit = { repo, commit: run.headSha };
  const groups = React.useMemo(() => (defs === undefined ? [] : jobGraph(jobs, defs).filter((c) => c.length)), [jobs, defs]);
  const openJob = (j: Job) => go({ run: run.id, attempt: state.attempt, job: j.id });

  return (
    <div className="page-content gh-act-run">
      <Header
        className="gh-hub-header"
        title={`#${run.runNumber} · ${run.title}`}
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        titleIconProps={{ render: () => <StateIcon state={run.state} size={StatusSize.l} /> }}
        description={`${run.name} · ${STATE_TEXT[run.state]}`}
        backButtonProps={{ ariaLabel: "Back to the workflow's runs", onClick: () => go({ workflow: run.workflowId }) }}
        commandBarItems={items}
      />
      <div className="gh-act-body flex-column">
        {failure && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setFailure(undefined)}>{failure}</MessageCard>}
        {!latest && <MessageCard severity={MessageCardSeverity.Info} buttonProps={[{ text: "Go to the latest attempt", onClick: () => go({ run: run.id }) }]}>You are looking at attempt {run.attempt} of {data.latestAttempt}.</MessageCard>}
        {data.pending.length > 0 && <MessageCard severity={MessageCardSeverity.Warning}>Waiting for review: {data.pending.map((p) => p.environmentName).join(", ")}.</MessageCard>}

        <Card className="gh-act-card" titleProps={{ text: "Summary" }}>
          <dl className="gh-act-facts-grid">
            <dt>Workflow</dt><dd>{run.name}</dd>
            <dt>Trigger</dt><dd>{run.event}</dd>
            {run.actor && <><dt>Actor</dt><dd><PersonLine person={run.actor} /></dd></>}
            <dt>Branch</dt><dd>{run.branch ? <Pill size={PillSize.compact} variant={PillVariant.outlined}>{run.branch}</Pill> : "–"}</dd>
            <dt>Commit</dt>
            <dd><Link className="gh-sha-link monospaced-xs" href={href("commits", commit)} onClick={openInHub("commits", commit)} ariaLabel={`Commit ${run.headSha.slice(0, 8)}`}>{run.headSha.slice(0, 8)}</Link></dd>
            {run.prNumbers.length > 0 && <><dt>Pull requests</dt><dd>{run.prNumbers.map((n) => <Link key={n} className="gh-act-prlink" href={href("prs", { repo, view: "prs", pr: n })} onClick={openInHub("prs", { repo, view: "prs", pr: n })}>#{n}</Link>)}</dd></>}
            <dt>Duration</dt><dd>{dur(total) || "–"}</dd>
            <dt>Created</dt><dd><RelDate date={run.createdAt} /></dd>
            {data.latestAttempt > 1 && (
              <>
                <dt>Attempt</dt>
                <dd>
                  <MenuButton
                    ariaLabel="Choose an attempt"
                    text={`Attempt ${run.attempt}${latest ? " (latest)" : ""}`}
                    contextualMenuProps={{ menuProps: { id: "gh-act-attempts", items: Array.from({ length: data.latestAttempt }, (_, i) => data.latestAttempt - i).map((n) => ({ id: `a${n}`, text: `Attempt ${n}${n === data.latestAttempt ? " (latest)" : ""}`, onActivate: () => go({ run: run.id, attempt: n === data.latestAttempt ? undefined : n }) })) } }}
                  />
                </dd>
              </>
            )}
          </dl>
        </Card>

        <Card className="gh-act-card" titleProps={{ text: "Jobs" }}>
          <div className="gh-act-cardbody">
          <div className="gh-act-graph-wrap">
            {defs === undefined ? <Loading label="Loading the job graph" /> : (
              <JobGraph groups={groups} now={now} expanded={expanded} toggle={(k) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })} open={openJob} />
            )}
          </div>
          <JobsTable jobs={jobs} now={now} canRerun={write && !isActive(run.state)} open={openJob} rerun={(j) => void act(`re-run ${j.name}`, () => rerunJob(repo, j.id))} />
          </div>
        </Card>

        <Artifacts repo={repo} artifacts={data.artifacts} />
        <Annotations notes={notes} repo={repo} sha={run.headSha} open={openJob} />
      </div>
      {reviewing && <ReviewPanel repo={repo} runId={run.id} pending={approvable} close={() => setReviewing(false)} done={() => { setReviewing(false); void data.reload(); setTimeout(() => void data.quietReload(), 1500); }} />}
    </div>
  );
}

// ---------- the jobs graph (ACT-5, 6) ----------

function JobGraph({ groups, now, expanded, toggle, open }: { groups: JobGroup[][]; now: number; expanded: Set<string>; toggle: (key: string) => void; open: (j: Job) => void }) {
  const box = React.useRef<HTMLDivElement>(null);
  const cards = React.useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = React.useState<{ d: string; w: number; h: number }>({ d: "", w: 0, h: 0 });
  const measure = React.useCallback(() => {
    const b = box.current;
    if (!b) return;
    const o = b.getBoundingClientRect();
    const rect = (k: string) => { const r = cards.current.get(k)?.getBoundingClientRect(); return r && { l: r.left - o.left, r: r.right - o.left, m: r.top - o.top + Math.min(r.height / 2, 22) }; };
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
  React.useLayoutEffect(() => { measure(); }); // after every render: expanding a matrix moves the cards
  React.useEffect(() => {
    if (!box.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [measure]);
  if (!groups.length) return <div className="secondary-text gh-act-empty">No jobs have started yet.</div>;
  return (
    <div className="gh-act-graph" ref={box} role="group" aria-label="Job graph">
      <svg className="gh-act-lines" width={lines.w} height={lines.h} aria-hidden="true"><path d={lines.d} fill="none" /></svg>
      {groups.map((col, i) => (
        <div className="gh-act-col" key={i}>
          {col.map((g) => (
            <div key={g.key} className={`gh-act-node gh-act-${g.state}`} ref={(el) => { if (el) cards.current.set(g.key, el); else cards.current.delete(g.key); }}>
              {g.jobs.length === 1 ? (
                <button type="button" className="gh-act-cardbtn" onClick={() => open(g.jobs[0])} aria-label={`${g.jobs[0].name}, ${STATE_TEXT[g.state]}`}>
                  <StateIcon state={g.state} />
                  <span className="gh-act-title text-ellipsis">{g.jobs[0].name}</span>
                  <span className="gh-act-dur secondary-text">{dur(groupMs(g.jobs, now))}</span>
                </button>
              ) : (
                <>
                  <button type="button" className="gh-act-cardbtn" aria-expanded={expanded.has(g.key)} onClick={() => toggle(g.key)}>
                    <StateIcon state={g.state} />
                    <span className="gh-act-title text-ellipsis">{g.title}</span>
                    <span className="gh-act-count secondary-text">{g.jobs.length} jobs</span>
                    <span className="gh-act-dur secondary-text">{dur(groupMs(g.jobs, now))}</span>
                  </button>
                  {expanded.has(g.key) && (
                    <ul className="gh-act-matrix">
                      {g.jobs.map((j) => (
                        <li key={j.id}>
                          <button type="button" className="gh-act-cardbtn" onClick={() => open(j)} aria-label={`${j.name}, ${STATE_TEXT[j.state]}`}>
                            <StateIcon state={j.state} />
                            <span className="gh-act-title text-ellipsis">{j.name.slice(g.title.length).trim() || j.name}</span>
                            <span className="gh-act-dur secondary-text">{dur(jobMs(j, now))}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function JobsTable({ jobs, now, canRerun, open, rerun }: { jobs: Job[]; now: number; canRerun: boolean; open: (j: Job) => void; rerun: (j: Job) => void }) {
  if (!jobs.length) return null;
  return (
    <table className="gh-act-jobs">
      <caption className="gh-visually-hidden">Jobs</caption>
      <thead><tr><th scope="col">Job</th><th scope="col">Status</th><th scope="col">Duration</th><th scope="col">Runner</th><th scope="col"><span className="gh-visually-hidden">Actions</span></th></tr></thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id}>
            <td><span className="flex-row flex-center gh-act-jobname"><StateIcon state={j.state} /><Link className="bolt-table-link text-ellipsis" href="#" onClick={(e) => { e.preventDefault(); open(j); }}>{j.name}</Link></span></td>
            <td>{STATE_TEXT[j.state]}</td>
            <td>{dur(jobMs(j, now)) || "–"}</td>
            <td className="text-ellipsis">{j.runnerName || "–"}</td>
            <td className="gh-act-rowmenu">
              {canRerun && j.status === "completed" && (
                <MoreButton ariaLabel={`Actions for ${j.name}`} contextualMenuProps={{ menuProps: { id: `gh-act-job-${j.id}`, items: [{ id: "rerun", text: "Re-run job", iconProps: { iconName: "Refresh" }, onActivate: () => rerun(j) }] } }} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- artifacts (ACT-10) ----------

function Artifacts({ repo, artifacts }: { repo: string; artifacts: Artifact[] }) {
  const [busy, setBusy] = React.useState<number>();
  const [failed, setFailed] = React.useState<string>();
  if (!artifacts.length) return null;
  const download = async (a: Artifact) => {
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
  };
  return (
    <Card className="gh-act-card" titleProps={{ text: `Artifacts (${artifacts.length})` }}>
      {failed && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setFailed(undefined)}>{failed}</MessageCard>}
      <table className="gh-act-jobs">
        <caption className="gh-visually-hidden">Artifacts</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Size</th><th scope="col"><span className="gh-visually-hidden">Download</span></th></tr></thead>
        <tbody>
          {artifacts.map((a) => (
            <tr key={a.id}>
              <td>{a.name}{a.expired && <Pill className="gh-act-pill" size={PillSize.compact} variant={PillVariant.outlined}>Expired</Pill>}</td>
              <td>{formatBytes(a.sizeInBytes)}</td>
              <td>{a.expired ? <span className="secondary-text">No longer available</span> : <Button subtle iconProps={{ iconName: "Download" }} text="Download" ariaLabel={`Download ${a.name}`} disabled={busy === a.id} onClick={() => void download(a)} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ---------- annotations (ACT-11) ----------

const LEVELS: { level: Annotation["level"]; label: string; status: typeof Statuses.Success }[] = [
  { level: "failure", label: "Failures", status: Statuses.Failed },
  { level: "warning", label: "Warnings", status: Statuses.Warning },
  { level: "notice", label: "Notices", status: Statuses.Information },
];

function Annotations({ notes, repo, sha, open }: { notes: JobNote[]; repo: string; sha: string; open: (j: Job) => void }) {
  const href = useHubHref();
  if (!notes.length) return null;
  return (
    <Card className="gh-act-card" titleProps={{ text: `Annotations (${notes.length})` }}>
      {LEVELS.map(({ level, label, status }) => {
        const list = notes.filter((n) => n.level === level);
        if (!list.length) return null;
        return (
          <section key={level} className="gh-act-notes" aria-label={`${label}, ${list.length}`}>
            <h3 className="gh-act-notes-h flex-row flex-center"><Status {...status} size={StatusSize.m} ariaLabel="" />{label} ({list.length})</h3>
            <ul>
              {list.map((n, i) => {
                const file = { repo, ref: sha, path: n.path };
                return (
                  <li key={i}>
                    <div className="gh-act-note-msg">{n.title && <strong>{n.title}: </strong>}{n.message}</div>
                    <div className="secondary-text body-s">
                      <Link href={href("files", file)} onClick={openInHub("files", file)}>{n.path}:{n.startLine}{n.endLine !== n.startLine ? `-${n.endLine}` : ""}</Link>
                      {" · "}
                      <Link href="#" onClick={(e) => { e.preventDefault(); open(n.job); }}>{n.job.name}</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </Card>
  );
}

// ---------- review pending deployments (ACT-14) ----------

function ReviewPanel({ repo, runId, pending, close, done }: { repo: string; runId: number; pending: PendingDeployment[]; close: () => void; done: () => void }) {
  const [picked, setPicked] = React.useState<Set<number>>(() => new Set(pending.map((p) => p.environmentId)));
  const [comment, setComment] = React.useState("");
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
        <fieldset className="gh-act-envs">
          <legend className="font-weight-semibold">Environments</legend>
          {pending.map((p) => (
            <Checkbox key={p.environmentId} label={p.environmentName} checked={picked.has(p.environmentId)} onChange={(_e, c) => setPicked((s) => { const n = new Set(s); c ? n.add(p.environmentId) : n.delete(p.environmentId); return n; })} />
          ))}
        </fieldset>
        <label className="font-weight-semibold" htmlFor="gh-act-review-comment">Comment (optional)</label>
        <TextField inputId="gh-act-review-comment" ariaLabel="Comment" multiline rows={4} width={TextFieldWidth.auto} value={comment} onChange={(_e, t) => setComment(t)} />
      </div>
    </Panel>
  );
}

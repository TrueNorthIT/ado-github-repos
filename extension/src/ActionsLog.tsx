// The job log view (ACT-7, 8, 9, 17): native's master/detail. The run's jobs and the open job's steps in a Tree on the left, the log in a read-only Monaco on the right.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { ListSelection } from "azure-devops-ui/List";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { MoreButton } from "azure-devops-ui/Menu";
import { SingleLayerMasterPanel, SingleLayerMasterPanelHeader } from "azure-devops-ui/MasterDetails";
import { StatusSize } from "azure-devops-ui/Status";
import { ExpandableTreeCell, ITreeColumn, Tree } from "azure-devops-ui/TreeEx";
import { ITreeItem, TreeItemProvider } from "azure-devops-ui/Utilities/TreeItemProvider";
import { worstState, type Job, type JobStep, type RunState, type WorkflowRun } from "./lib/workflows";
import { foldRanges, parseLog, stepRanges, logCounts } from "./lib/workflowLog";
import { buildLogDoc } from "./lib/logDoc";
import { getJobLog } from "./actionsApi";
import { useQuery } from "@tanstack/react-query";
import { loadMonaco } from "./Browser";
import { Loading } from "./RepoHub";
import { StateIcon, STATE_TEXT, dur, isActive, spanMs, useNow, type RunPageProps } from "./ActionsRun";
import "./actionsRun.css";

type Viewer = ReturnType<typeof import("./monacoChunk").createLogViewer>;

interface Props extends RunPageProps {
  run: WorkflowRun;
  jobs: Job[];
  jobId: number;
  now: number;
  canWrite: boolean;
  onRerun: (j: Job) => Promise<unknown>;
}

const blobUrl = (text: string) => URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));

type Node = { kind: "group" } | { kind: "job"; job: Job } | { kind: "step"; job: Job; step: JobStep };

/** A duration that ticks by itself while it runs, so the tree's memoised rows need not re-render every second. */
function Elapsed({ start, end, hide, running }: { start?: Date; end?: Date; hide?: boolean; running: boolean }) {
  const now = useNow(running);
  return <span className="secondary-text gh-act-treecell-time">{hide ? "" : dur(spanMs(start, end, now))}</span>;
}

const jobsKey = (jobs: Job[]) => jobs.map((j) => `${j.id}${j.state}${j.completedAt?.getTime() ?? ""}${j.steps.map((s) => `${s.state}${s.completedAt?.getTime() ?? ""}`).join("")}`).join("|");

export function LogView({ repo, state, go, run, jobs, jobId, canWrite, onRerun }: Props) {
  const job = jobs.find((j) => j.id === jobId);
  const finished = job?.status === "completed";
  const [showTs, setShowTs] = React.useState(false);
  const [viewerFailed, setViewerFailed] = React.useState(false);
  const [rerunFailed, setRerunFailed] = React.useState(false);
  const [step, setStep] = React.useState<number>();
  const [expanded, setExpanded] = React.useState(() => new Set([jobId]));
  const box = React.useRef<HTMLDivElement>(null);
  const viewer = React.useRef<Viewer>();
  const [ready, setReady] = React.useState(0);
  const errIdx = React.useRef(-1);
  const clicked = React.useRef(0);

  // Opening another job expands it (the others keep whatever the viewer chose) and clears the step.
  React.useEffect(() => { setStep(undefined); setExpanded((s) => (s.has(jobId) ? s : new Set(s).add(jobId))); }, [jobId]);

  // Fetch the log once the job has finished (the log is not available while it runs). A finished job's log never changes, so going back to
  // a job shows it at once; it is not persisted, and leaves memory five minutes after the last job view that used it.
  const log = useQuery({ queryKey: ["actions", "log", repo, jobId], queryFn: () => getJobLog(repo, jobId), enabled: finished, staleTime: Infinity, cacheTime: 5 * 60_000 });
  const text = finished ? log.data : undefined;
  const parsed = React.useMemo(() => {
    if (text === undefined) return undefined;
    const lines = parseLog(text);
    return { lines, folds: foldRanges(lines), counts: logCounts(lines), levels: lines.filter((l) => l.kind === "error" || l.kind === "warning").map((l) => ({ line: l.n, kind: l.kind as "error" | "warning" })) };
  }, [text]);
  const ranges = React.useMemo(() => (parsed && job ? stepRanges(parsed.lines, job.steps) : new Map<number, [number, number]>()), [parsed, job?.steps]); // eslint-disable-line react-hooks/exhaustive-deps
  const doc = React.useMemo(() => (parsed ? { ...buildLogDoc(parsed.lines, showTs), folds: parsed.folds, levels: parsed.levels } : undefined), [parsed, showTs]);

  // The editor lives while a log is shown.
  const shown = text !== undefined;
  React.useEffect(() => {
    if (!shown) return;
    let dead = false;
    let v: Viewer | undefined;
    loadMonaco().then(
      (m) => {
        if (dead || !box.current) return;
        v = m.createLogViewer(box.current, `Log of ${job?.name ?? "job"}`, (n: number) => { clicked.current = n; v?.reveal(n, true, false); go({ ...state, line: n }, true); });
        viewer.current = v;
        setReady((r) => r + 1);
      },
      () => !dead && setViewerFailed(true)
    );
    return () => { dead = true; v?.dispose(); viewer.current = undefined; };
  }, [shown, jobId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (doc && viewer.current) viewer.current.setDoc(doc); }, [doc, ready]);
  // actLine: scroll to and highlight it on load, and when the hash changes it from elsewhere (a click on a line number already shows it).
  React.useEffect(() => {
    if (!doc || !viewer.current || !state.line || state.line === clicked.current) return;
    viewer.current.reveal(state.line, true);
  }, [doc, ready, state.line]);

  const counts = parsed?.counts;
  const errors = React.useMemo(() => (parsed ? parsed.levels.filter((l) => l.kind === "error").map((l) => l.line) : []), [parsed]);
  const nextError = () => {
    if (!errors.length) return;
    errIdx.current = (errIdx.current + 1) % errors.length;
    viewer.current?.reveal(errors[errIdx.current], true);
  };
  const countText = counts ? [counts.errors && `${counts.errors} ${counts.errors === 1 ? "error" : "errors"}`, counts.warnings && `${counts.warnings} ${counts.warnings === 1 ? "warning" : "warnings"}`].filter(Boolean).join(" · ") : "";

  const download = () => {
    if (text === undefined) return;
    const url = blobUrl(text);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${job?.name ?? "log"}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const raw = () => {
    if (text === undefined) return;
    const url = blobUrl(text);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const back = () => go({ run: run.id, attempt: state.attempt });

  const selectStep = (n: number) => {
    setStep(n);
    const r = ranges.get(n);
    if (r) viewer.current?.reveal(r[0], false);
  };

  // ---- the tree: a "Jobs" group, each job expandable to its steps ----
  const selectedId = step !== undefined ? `s${jobId}-${step}` : `j${jobId}`;
  const provider = React.useMemo(
    () => new TreeItemProvider<Node>([{
      id: "root", data: { kind: "group" }, expanded: true,
      childItems: jobs.map((j): ITreeItem<Node> => ({
        id: `j${j.id}`, data: { kind: "job", job: j }, expanded: expanded.has(j.id),
        childItems: j.steps.map((s): ITreeItem<Node> => ({ id: `s${j.id}-${s.number}`, data: { kind: "step", job: j, step: s } })),
      })),
    }]),
    [jobs, expanded]
  );
  const selection = React.useMemo(() => new ListSelection({ selectOnFocus: false }), []);
  const current = React.useRef(selectedId);
  current.current = selectedId;
  const highlight = React.useCallback(() => {
    const i = provider.value.findIndex((x) => x.underlyingItem.id === current.current);
    selection.clear();
    if (i >= 0) selection.select(i);
  }, [provider, selection]);
  React.useEffect(highlight, [highlight, selectedId]);
  const columns = React.useMemo<ITreeColumn<Node>[]>(() => [{
    id: "name",
    width: -1,
    renderCell: (_r, columnIndex, treeColumn, treeItem) => {
      const n = treeItem.underlyingItem.data;
      const icon = (st: RunState) => <StateIcon state={st} size={StatusSize.m} />;
      return (
        <ExpandableTreeCell key="name" columnIndex={columnIndex} treeColumn={treeColumn} treeItem={treeItem}>
          {n.kind === "group" ? <>{icon(worstState(jobs.map((j) => j.state)))}<span className="gh-act-treecell-group secondary-text font-weight-semibold">Jobs</span></>
            : n.kind === "job" ? <>{icon(n.job.state)}<span className="text-ellipsis">{n.job.name}</span><Elapsed start={n.job.startedAt} end={n.job.completedAt} hide={n.job.state === "queued" || n.job.state === "waiting"} running={n.job.status === "in_progress"} /></>
            : <>{icon(n.step.state)}<span className="text-ellipsis">{n.step.name}</span><Elapsed start={n.step.startedAt} end={n.step.completedAt} running={n.step.status === "in_progress"} /></>}
        </ExpandableTreeCell>
      );
    },
  }], [jobs]);

  if (!job) return <div className="page-content"><MessageCard severity={MessageCardSeverity.Warning} buttonProps={[{ text: "Back to the run", onClick: back }]}>This job is not part of this run attempt.</MessageCard></div>;

  const menu = [
    { id: "ts", text: showTs ? "Hide timestamps" : "Show timestamps", iconProps: { iconName: "Clock" }, disabled: !shown, onActivate: () => setShowTs((v) => !v) },
    { id: "download", text: "Download logs", iconProps: { iconName: "Download" }, disabled: !shown, onActivate: download },
    { id: "raw", text: "View raw log", iconProps: { iconName: "OpenInNewTab" }, disabled: !shown, onActivate: raw },
    ...(canWrite && finished ? [{ id: "rerun", text: "Re-run job", iconProps: { iconName: "Refresh" }, onActivate: () => { setRerunFailed(false); onRerun(job).catch(() => setRerunFailed(true)); } }] : []),
    { id: "github", text: "View on GitHub", iconProps: { iconName: "OpenInNewTab" }, onActivate: () => void window.open(job.htmlUrl, "_blank", "noopener,noreferrer") },
  ];

  return (
    <div className="gh-act-logpage flex-row">
      <SingleLayerMasterPanel
        className="gh-act-master"
        renderHeader={() => <SingleLayerMasterPanelHeader title={`Jobs in run #${run.runNumber}`} subTitle={run.name} titleAriaLevel={1} onBackButtonClick={back} />}
        renderContent={() => (
          <Tree<Node>
            key={jobsKey(jobs)}
            ariaLabel="Jobs and steps"
            className="gh-act-jobtree"
            columns={columns}
            itemProvider={provider as any}
            selection={selection}
            onToggle={(_e, ex) => {
              const n = (ex.underlyingItem as ITreeItem<Node>).data;
              if (n.kind === "job") setExpanded((s) => { const x = new Set(s); x.has(n.job.id) ? x.delete(n.job.id) : x.add(n.job.id); return x; });
            }}
            onActivate={(_e, row) => {
              const n = row.data.underlyingItem.data;
              if (n.kind === "job") { if (n.job.id !== jobId) go({ run: run.id, attempt: state.attempt, job: n.job.id }); }
              else if (n.kind === "step" && n.job.id === jobId && (ranges.has(n.step.number) || !finished)) selectStep(n.step.number);
              else if (n.kind === "step" && n.job.id !== jobId) go({ run: run.id, attempt: state.attempt, job: n.job.id });
            }}
            singleClickActivation
            showHeader={false}
            showLines={false}
            scrollable
            role="tree"
          />
        )}
      />
      <div className="gh-act-logpane">
        <div className="gh-act-loghead flex-row flex-center">
          <StateIcon state={job.state} size={StatusSize.l} />
          <h1 className="gh-act-logtitle text-ellipsis flex-grow">{job.name}</h1>
          {shown && errors.length > 0 && <Button subtle iconProps={{ iconName: "ChevronDown" }} text={countText} ariaLabel={`${countText}. Go to the next error`} onClick={nextError} />}
          <Button subtle iconProps={{ iconName: "Search" }} ariaLabel="Find" tooltipProps={{ text: "Find" }} disabled={!shown || viewerFailed} onClick={() => viewer.current?.find()} />
          <MoreButton ariaLabel="More actions" contextualMenuProps={{ menuProps: { id: "gh-act-logmore", items: menu } }} />
        </div>
        {rerunFailed && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setRerunFailed(false)}>Could not re-run this job.</MessageCard>}
        {!finished ? (
          <div className="gh-act-logwait secondary-text">
            {isActive(job.state) ? "The log appears when the job finishes." : `This job is ${STATE_TEXT[job.state].toLowerCase()}.`}
            <br />The steps on the left update as it runs.
          </div>
        ) : finished && log.isError ? (
          <MessageCard severity={MessageCardSeverity.Error} buttonProps={[{ text: "Try again", onClick: () => void log.refetch() }]}>Could not load the log. Logs are deleted after the repository's retention period.</MessageCard>
        ) : text === undefined ? (
          <Loading label="Loading the log" />
        ) : viewerFailed ? (
          <MessageCard severity={MessageCardSeverity.Error}>The log viewer could not load. Use Download logs or View raw log instead.</MessageCard>
        ) : (
          <div className="gh-act-editor" ref={box} />
        )}
      </div>
    </div>
  );
}

// The job log view (ACT-7, 8, 9, 17): the run's jobs and the open job's steps on the left, the log in a read-only Monaco on the right.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { StatusSize } from "azure-devops-ui/Status";
import type { Job, WorkflowRun } from "./lib/workflows";
import { foldRanges, parseLog, stepRanges, logCounts } from "./lib/workflowLog";
import { buildLogDoc } from "./lib/logDoc";
import { getJobLog } from "./actionsApi";
import { loadMonaco } from "./Browser";
import { watchTheme } from "./theme";
import { Loading } from "./RepoHub";
import { StateIcon, STATE_TEXT, dur, isActive, jobMs, spanMs, type RunPageProps } from "./ActionsRun";
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

export function LogView({ repo, state, go, run, jobs, jobId, now, canWrite, onRerun }: Props) {
  const job = jobs.find((j) => j.id === jobId);
  const finished = job?.status === "completed";
  const [log, setLog] = React.useState<{ id: number; text?: string; err?: boolean }>({ id: 0 });
  const [tries, setTries] = React.useState(0);
  const [showTs, setShowTs] = React.useState(false);
  const [dark, setDark] = React.useState(false);
  const [viewerFailed, setViewerFailed] = React.useState(false);
  const [rerunFailed, setRerunFailed] = React.useState(false);
  const [step, setStep] = React.useState<number>();
  const box = React.useRef<HTMLDivElement>(null);
  const viewer = React.useRef<Viewer>();
  const [ready, setReady] = React.useState(0);
  const errIdx = React.useRef(-1);
  const clicked = React.useRef(0);

  React.useEffect(() => watchTheme(setDark), []);

  // Fetch the log once the job has finished (the log is not available while it runs).
  React.useEffect(() => {
    if (!finished) return;
    let dead = false;
    setLog({ id: jobId });
    getJobLog(repo, jobId).then((text) => !dead && setLog({ id: jobId, text }), () => !dead && setLog({ id: jobId, err: true }));
    return () => { dead = true; };
  }, [repo, jobId, finished, tries]);

  const text = log.id === jobId ? log.text : undefined;
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
        v = m.createLogViewer(box.current, dark, `Log of ${job?.name ?? "job"}`, (n: number) => { clicked.current = n; v?.reveal(n, true, false); go({ ...state, line: n }, true); });
        viewer.current = v;
        setReady((r) => r + 1);
      },
      () => !dead && setViewerFailed(true)
    );
    return () => { dead = true; v?.dispose(); viewer.current = undefined; };
  }, [shown, jobId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { viewer.current?.setTheme(dark); }, [dark, ready]);
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

  if (!job) return <div className="page-content"><MessageCard severity={MessageCardSeverity.Warning} buttonProps={[{ text: "Back to the run", onClick: back }]}>This job is not part of this run attempt.</MessageCard></div>;

  const selectStep = (n: number) => {
    setStep(n);
    const r = ranges.get(n);
    if (r) viewer.current?.reveal(r[0], false);
  };

  const items = canWrite && finished ? [{ id: "rerun", text: "Re-run job", important: true, iconProps: { iconName: "Refresh" }, onActivate: () => { setRerunFailed(false); onRerun(job).catch(() => setRerunFailed(true)); } }] : [];

  return (
    <div className="page-content gh-act-logpage">
      <Header
        className="gh-hub-header gh-act-header gh-act-subheader"
        title={job.name}
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        titleIconProps={{ render: () => <StateIcon state={job.state} size={StatusSize.l} /> }}
        description={`#${run.runNumber} · ${run.title}`}
        backButtonProps={{ ariaLabel: "Back to the run", onClick: back }}
        commandBarItems={items}
      />
      {rerunFailed && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => setRerunFailed(false)}>Could not re-run this job.</MessageCard>}
      <div className="gh-act-log">
        <nav className="gh-act-steps" aria-label="Jobs and steps">
          {jobs.map((j) => (
            <div key={j.id}>
              <button type="button" className={`gh-act-stepbtn gh-act-jobbtn${j.id === jobId ? " selected" : ""}`} aria-current={j.id === jobId ? "true" : undefined} onClick={() => j.id !== jobId && go({ run: run.id, attempt: state.attempt, job: j.id })}>
                <StateIcon state={j.state} />
                <span className="text-ellipsis">{j.name}</span>
                <span className="gh-act-dur secondary-text">{dur(jobMs(j, now))}</span>
              </button>
              {j.id === jobId && (
                <ul className="gh-act-steplist">
                  {j.steps.map((s) => (
                    <li key={s.number}>
                      <button type="button" className={`gh-act-stepbtn${step === s.number ? " selected" : ""}`} disabled={!ranges.has(s.number) && finished} onClick={() => selectStep(s.number)} title={ranges.has(s.number) ? undefined : "No log lines for this step"}>
                        <StateIcon state={s.state} />
                        <span className="text-ellipsis">{s.name}</span>
                        <span className="gh-act-dur secondary-text">{dur(spanMs(s.startedAt, s.completedAt, now))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </nav>
        <div className="gh-act-logpane">
          <div className="gh-act-logbar flex-row flex-center">
            <Checkbox label="Show timestamps" checked={showTs} onChange={(_e, c) => setShowTs(c)} disabled={!shown} />
            <span className="flex-grow" />
            {shown && (
              <Button subtle disabled={!errors.length} iconProps={{ iconName: "ChevronDown" }} text={countText || "No errors or warnings"} ariaLabel={errors.length ? `${countText}. Go to the next error` : "No errors or warnings"} onClick={nextError} />
            )}
            <Button subtle iconProps={{ iconName: "Download" }} text="Download log" disabled={!shown} onClick={download} />
            <Button subtle iconProps={{ iconName: "OpenInNewTab" }} text="View raw" disabled={!shown} onClick={raw} />
          </div>
          {!finished ? (
            <div className="gh-act-logwait secondary-text">
              {isActive(job.state) ? "The log appears when the job finishes." : `This job is ${STATE_TEXT[job.state].toLowerCase()}.`}
              <br />The steps on the left update as it runs.
            </div>
          ) : log.err ? (
            <MessageCard severity={MessageCardSeverity.Error} buttonProps={[{ text: "Try again", onClick: () => setTries((t) => t + 1) }]}>Could not load the log. Logs are deleted after the repository's retention period.</MessageCard>
          ) : text === undefined ? (
            <Loading label="Loading the log" />
          ) : viewerFailed ? (
            <MessageCard severity={MessageCardSeverity.Error}>The log viewer could not load. Use Download log or View raw instead.</MessageCard>
          ) : (
            <div className="gh-act-editor" ref={box} />
          )}
        </div>
      </div>
    </div>
  );
}

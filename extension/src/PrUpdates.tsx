// The Updates tab of the PR page (VW-1): the pushes to the head branch, newest first. Tick two updates to compare them (one tick shows that update's own changes).
import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import type { PrPageData } from "./lib/prModel";
import { compareUpdates, type PrUpdate } from "./lib/prUpdates";
import { applyDiffHash, resolveSideBySide, storedSideBySide } from "./lib/diffPrefs";
import type { PrFile } from "./lib/prFiles";
import { ErrorView } from "./Browser";
import { FilesView } from "./PrFiles";
import { FilesBar } from "./PrFilesBar";
import { RelDate } from "./RelDate";
import { getRangeFiles, getUpdates, invalidatePr } from "./githubBrowse";
import { patchHash, useHashExtras } from "./hostNav";
import { usePrefs } from "./prefs";

const short = (oid: string) => oid.slice(0, 7);
const SHOWN_COMMITS = 3;

function UpdateRow({ u, checked, toggle }: { u: PrUpdate; checked: boolean; toggle: (v: boolean) => void }) {
  return (
    <li className="gh-update flex-row">
      <Checkbox className="gh-update-check" checked={checked} onChange={(_e, v) => toggle(v)} ariaLabel={`Select update ${u.index}`} />
      <div className="gh-update-main flex-column flex-grow">
        <div className="flex-row flex-center">
          <span className="font-weight-semibold body-m">Update {u.index}</span>
          {u.forced && <Pill className="gh-update-forced" size={PillSize.compact} variant={PillVariant.colored} color={{ red: 202, green: 80, blue: 16 }}>Forced</Pill>}
          <span className="monospaced-xs secondary-text gh-update-head">{short(u.headOid)}</span>
          <span className="flex-grow" />
          <RelDate className="secondary-text body-s" date={u.at} />
        </div>
        {u.commits.length ? (
          <ul className="gh-update-commits secondary-text body-s">
            {u.commits.slice(0, SHOWN_COMMITS).map((c) => (
              <li key={c.oid} className="text-ellipsis"><span className="monospaced-xs">{short(c.oid)}</span> {c.title}</li>
            ))}
            {u.commits.length > SHOWN_COMMITS && <li>and {u.commits.length - SHOWN_COMMITS} more {u.commits.length - SHOWN_COMMITS === 1 ? "commit" : "commits"}</li>}
          </ul>
        ) : (
          <span className="secondary-text body-s">Force-pushed to {short(u.headOid)}. GitHub no longer lists the commits this push replaced.</span>
        )}
      </div>
    </li>
  );
}

type Files = { t: "idle" } | { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; files: PrFile[] };

function Compare({ repo, updates, picked, dark, signedIn, signIn, busy }: { repo: string; updates: PrUpdate[]; picked: number[]; dark: boolean; signedIn: boolean; signIn: () => void; busy: boolean }) {
  const [a, b] = picked.length === 1 ? [picked[0] - 1, picked[0]] : [picked[0], picked[1]];
  const cmp = React.useMemo(() => {
    try { return compareUpdates(repo, updates, a, b); } catch (e) { return e as Error; }
  }, [repo, updates, a, b]);
  const [files, setFiles] = React.useState<Files>({ t: "idle" });
  const [reload, setReload] = React.useState(0);
  const path = cmp instanceof Error ? undefined : cmp.path;
  React.useEffect(() => {
    if (!path) return;
    let dead = false;
    setFiles({ t: "loading" });
    getRangeFiles(path).then((f) => !dead && setFiles({ t: "ready", files: f }), (err) => !dead && setFiles({ t: "error", err }));
    return () => { dead = true; };
  }, [path, signedIn, reload]);
  const [prefs, setPrefs] = usePrefs();
  const { diff } = useHashExtras();
  const sideBySide = resolveSideBySide(diff.sideBySide, storedSideBySide(prefs));
  const ignoreWhitespace = !!diff.ignoreWhitespace;
  const [selected, setSelected] = React.useState<string | undefined>();
  const title = a === 0 ? `Changes in update ${b}` : `Changes from update ${a} to update ${b}`;
  const bar = (shown: number) => (
    <FilesBar
      count={files.t === "ready" ? files.files.length : 0} shown={shown}
      sideBySide={sideBySide} setSideBySide={(v) => setPrefs((p) => ({ ...p, prSideBySide: v }))}
      ignoreWhitespace={ignoreWhitespace} setIgnoreWhitespace={(v) => patchHash((h) => applyDiffHash(h, { ...diff, ignoreWhitespace: v }))}
    />
  );
  if (cmp instanceof Error) return <MessageCard severity={MessageCardSeverity.Warning}>{cmp.message}</MessageCard>;
  return (
    <section className="gh-update-compare" aria-label={title}>
      <h2 className="gh-update-compare-title body-l font-weight-semibold">{title}</h2>
      {files.t === "loading" && <div className="gh-pr-loading flex-row justify-center"><Spinner size={SpinnerSize.large} ariaLabel="Loading changed files" /></div>}
      {files.t === "error" && <ErrorView err={files.err} signIn={signIn} busy={busy} retry={() => { invalidatePr(); setReload((r) => r + 1); }} subject="compare these updates" permission="Contents" />}
      {files.t === "ready" && !files.files.length && <ZeroData iconProps={{ iconName: "Page" }} imageAltText="" primaryText="No file changes" secondaryText="These two updates have the same contents." />}
      {files.t === "ready" && files.files.length > 0 && (
        <FilesView
          key={cmp.path}
          files={files.files} repo={repo} ctx={{ baseSha: cmp.base, headSha: cmp.head }} selected={selected} select={setSelected} dark={dark}
          sideBySide={sideBySide} ignoreWhitespace={ignoreWhitespace} treeFilter bar={({ shown }) => bar(shown)}
        />
      )}
    </section>
  );
}

type Load = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; updates: PrUpdate[] };

export function PrUpdatesTab({ repo, number, pr: _pr, dark, signedIn, signIn, busy }: { repo: string; number: number; pr: PrPageData; dark: boolean; signedIn: boolean; signIn: () => void; busy: boolean }) {
  const [load, setLoad] = React.useState<Load>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  const [picked, setPicked] = React.useState<number[]>([]);
  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "loading" });
    getUpdates(repo, number).then((updates) => !dead && setLoad({ t: "ready", updates }), (err) => !dead && setLoad({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, number, signedIn, reload]);
  // Two at most: ticking a third replaces the older tick. Sorted, so the pair is always (older, newer).
  const toggle = (index: number, on: boolean) => setPicked((p) => (on ? [...p.filter((i) => i !== index), index].slice(-2) : p.filter((i) => i !== index)).sort((x, y) => x - y));

  if (load.t === "loading") return <div className="page-content page-content-top gh-pr-loading flex-row justify-center"><Spinner size={SpinnerSize.large} ariaLabel="Loading updates" /></div>;
  if (load.t === "error")
    return <div className="page-content page-content-top"><ErrorView err={load.err} signIn={signIn} busy={busy} retry={() => { invalidatePr(); setReload((r) => r + 1); }} subject="see this pull request's updates" permission="Pull requests" /></div>;
  const newest = [...load.updates].reverse();
  if (!newest.length) return <div className="page-content page-content-top"><ZeroData iconProps={{ iconName: "BranchPullRequest" }} imageAltText="" primaryText="No updates" secondaryText="This pull request has no commits yet." /></div>;
  return (
    <div className="page-content page-content-top gh-updates flex-column">
      <Card className="gh-pr-card gh-updates-card" titleProps={{ text: "Updates", ariaLevel: 2 }} headerCommandBarItems={picked.length ? [{ id: "clear", text: "Clear selection", iconProps: { iconName: "Cancel" }, important: true, onActivate: () => setPicked([]) }] : undefined}>
        <div className="gh-updates-body flex-column flex-grow">
        <p className="secondary-text body-s gh-updates-hint">Tick one update to see its changes, or two to compare them.</p>
        <ul className="gh-updates-list" aria-label="Updates, newest first">
          {newest.map((u) => <UpdateRow key={u.index} u={u} checked={picked.includes(u.index)} toggle={(v) => toggle(u.index, v)} />)}
        </ul>
        </div>
      </Card>
      {picked.length > 0 && <Compare repo={repo} updates={load.updates} picked={picked} dark={dark} signedIn={signedIn} signIn={signIn} busy={busy} />}
    </div>
  );
}

// The Files page's History, Blame and Compare tabs for a file or folder. The logic is in lib/blame.ts, lib/fileTabs.ts and the commit list helpers.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { blameBlocks, lineCountOf, type BlameBlock } from "./lib/blame";
import type { CommitRow } from "./lib/commitsQuery";
import { monacoLanguage } from "./lib/fileKind";
import { GhError, getBlame, getBranchNames, getRaw, invalidateRefs, listCommits } from "./githubBrowse";
import { ErrorView, hubClick, loadMonaco } from "./Browser";
import { CommitTable } from "./Commits";
import { BranchBar, Loading, PersonLine } from "./RepoHub";
import { RelDate } from "./RelDate";
import { openInHub, useHubHref } from "./repoHref";
import "./browser.css";

interface TabProps {
  repo: string;
  /** The ref as the hash carries it (absent for the default branch) and the resolved ref name. */
  urlRef?: string;
  refName: string;
  path: string;
  signedIn: boolean;
  signIn: () => void;
  busy: boolean;
}

// ---------- History ----------

/** The commits that touched the path on the current branch, in the Commits page's table; a row opens the commit in the Commits hub. */
export function HistoryTab({ repo, urlRef, refName, path, signedIn, signIn, busy }: TabProps) {
  const href = useHubHref();
  const [rows, setRows] = React.useState<CommitRow[]>([]);
  const [next, setNext] = React.useState<{ more: boolean; cursor: string | null }>({ more: false, cursor: null });
  const [load, setLoad] = React.useState<{ t: "loading" } | { t: "error"; err: unknown } | { t: "ready" }>({ t: "loading" });
  const [more, setMore] = React.useState(false);
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "loading" });
    setRows([]);
    listCommits(repo, refName, undefined, path).then(
      (p) => { if (dead) return; setRows(p.rows); setNext({ more: p.hasNextPage, cursor: p.endCursor }); setLoad({ t: "ready" }); },
      (err) => !dead && setLoad({ t: "error", err })
    );
    return () => { dead = true; };
  }, [repo, refName, path, signedIn, reload]);

  const loadMore = () => {
    if (!next.cursor) return;
    setMore(true);
    listCommits(repo, refName, next.cursor, path).then(
      (p) => { setRows((r) => [...r, ...p.rows]); setNext({ more: p.hasNextPage, cursor: p.endCursor }); setMore(false); },
      (err) => { setMore(false); setLoad({ t: "error", err }); }
    );
  };

  const commitState = React.useCallback((sha: string) => ({ repo, ref: urlRef, commit: sha }), [repo, urlRef]);
  const open = React.useCallback((sha: string) => void openInHub("commits", commitState(sha))(), [commitState]);
  const commitHref = React.useCallback((sha: string) => href("commits", commitState(sha)), [href, commitState]);
  const openPr = React.useCallback((n: number) => void openInHub("prs", { repo, view: "prs", pr: n })(), [repo]);
  const prHref = React.useCallback((n: number) => href("prs", { repo, view: "prs", pr: n }), [href, repo]);

  if (load.t === "error") return <ErrorView err={load.err} signIn={signIn} busy={busy} retry={() => { invalidateRefs(); setReload((n) => n + 1); }} subject="see this repository's history" permission="Contents" />;
  if (load.t === "loading") return <Loading label="Loading history" />;
  if (!rows.length) return <ZeroData iconProps={{ iconName: "History" }} imageAltText="" primaryText="No history" secondaryText={`No commits on ${refName} touched ${path || "this repository"}.`} />;
  return (
    <>
      <Card className="gh-pr-card gh-commits-card bolt-table-card" contentProps={{ contentPadding: false }}>
        <CommitTable rows={rows} label={`History of ${path || repo} on ${refName}`} commitHref={commitHref} open={open} prHref={prHref} openPr={openPr} />
      </Card>
      {next.more && (
        <div className="gh-load-more flex-row justify-center">
          {more ? <Spinner size={SpinnerSize.medium} ariaLabel="Loading more commits" /> : <Button text="Load more" onClick={loadMore} />}
        </div>
      )}
    </>
  );
}

// ---------- Blame ----------

const LINE = 16; // Monaco's line height in createViewer; the gutter rows are drawn to match
const decode = (b: ArrayBuffer) => new TextDecoder().decode(b);
const stripFinalNewline = (t: string) => t.replace(/(\r\n|\r|\n)$/, "");

function BlameGutterBlock({ block, commitHref, open }: { block: BlameBlock; commitHref: (sha: string) => string; open: (sha: string) => void }) {
  const lines = block.endLine - block.startLine + 1;
  const c = block.commit;
  const style = { height: lines * LINE };
  if (!c) return <div className="gh-blame-block gh-blame-none" style={style} />;
  const when = new Date(c.committedDate);
  return (
    <div className={`gh-blame-block gh-heat-${block.heat}`} style={style} title={`${c.messageHeadline}\n${c.author.name}`}>
      <div className="gh-blame-row flex-row flex-center">
        <Link className="gh-blame-sha monospaced-xs" href={commitHref(c.oid)} onClick={hubClick(() => open(c.oid))} ariaLabel={`Commit ${c.abbreviatedOid}: ${c.messageHeadline}`}>{c.abbreviatedOid}</Link>
        <PersonLine person={c.author} className="gh-blame-author" />
        <span className="gh-blame-date secondary-text"><RelDate date={when} /></span>
        {lines === 1 && <span className="gh-blame-msg secondary-text text-ellipsis">{c.messageHeadline}</span>}
      </div>
      {lines > 1 && <div className="gh-blame-row gh-blame-msg-row text-ellipsis">{c.messageHeadline}</div>}
    </div>
  );
}

/** Blame as native draws it: a gutter block per run of lines from one commit (short sha, author, date, message, linked to the commit, tinted by age) beside the read-only file in Monaco.
 *  The editor is laid out at its full height (16px a line, no inner scroll) so the page scrolls and the gutter rows line up with the lines. */
export function BlameTab({ repo, urlRef, refName, path, dark, signedIn, signIn, busy }: TabProps & { dark: boolean }) {
  const href = useHubHref();
  const [data, setData] = React.useState<{ t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; text: string; blocks: BlameBlock[] }>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  const darkRef = React.useRef(dark);
  darkRef.current = dark;

  React.useEffect(() => {
    let dead = false;
    setData({ t: "loading" });
    Promise.all([getRaw(repo, refName, path), getBlame(repo, refName, path)]).then(
      ([raw, ranges]) => {
        if (dead) return;
        const text = stripFinalNewline(decode(raw));
        setData({ t: "ready", text, blocks: blameBlocks(ranges, lineCountOf(text)) });
      },
      (err) => !dead && setData({ t: "error", err })
    );
    return () => { dead = true; };
  }, [repo, refName, path, signedIn, reload]);

  const text = data.t === "ready" ? data.text : undefined;
  React.useEffect(() => {
    if (text === undefined) return;
    let dead = false;
    let editor: { dispose(): void } | undefined;
    loadMonaco().then(
      (m) => {
        if (dead || !box.current) return;
        const ed = m.createViewer(box.current, text, monacoLanguage(path), darkRef.current, path);
        ed.updateOptions({ scrollbar: { vertical: "hidden", handleMouseWheel: false, alwaysConsumeMouseWheel: false } });
        editor = ed;
      },
      () => !dead && setFailed(true)
    );
    return () => { dead = true; editor?.dispose(); };
  }, [text, path]);
  React.useEffect(() => { if (text !== undefined) void loadMonaco().then((m) => m.setTheme(dark)); }, [dark, text]);

  const commitHref = React.useCallback((sha: string) => href("commits", { repo, ref: urlRef, commit: sha }), [href, repo, urlRef]);
  const open = React.useCallback((sha: string) => void openInHub("commits", { repo, ref: urlRef, commit: sha })(), [repo, urlRef]);

  if (data.t === "error") return <ErrorView err={data.err} signIn={signIn} busy={busy} retry={() => { invalidateRefs(); setReload((n) => n + 1); }} subject="see this file's blame" permission="Contents" />;
  if (data.t === "loading") return <Loading label="Loading blame" />;
  const lines = lineCountOf(data.text);
  // Without Monaco (it failed to load) a plain table still gives line numbers beside the same gutter.
  return (
    <Card className="no-padding gh-blame-card" contentProps={{ contentPadding: false }}>
      <div className="gh-blame flex-row" role="group" aria-label={`Blame of ${path}`}>
        <div className="gh-blame-gutter flex-noshrink">
          {data.blocks.map((b) => <BlameGutterBlock key={b.startLine} block={b} commitHref={commitHref} open={open} />)}
        </div>
        {failed ? (
          <pre className="gh-plain gh-blame-code flex-grow" style={{ lineHeight: `${LINE}px`, padding: 0 }}>{data.text}</pre>
        ) : (
          <div ref={box} className="gh-blame-code flex-grow" style={{ height: lines * LINE + 12 }} />
        )}
      </div>
    </Card>
  );
}

// ---------- Compare ----------

type Side = { ok: true; text: string } | { ok: false; missing: true };
const fetchSide = (repo: string, ref: string, path: string): Promise<Side> =>
  getRaw(repo, ref, path).then(
    (b): Side => ({ ok: true, text: decode(b) }),
    (e): Side => { if (e instanceof GhError && e.status === 404) return { ok: false, missing: true }; throw e; }
  );

/** This file on the current branch against another ref (default: the repo's default branch) in the diff editor: the other ref is the original, this branch the modified side. */
export function CompareTab({ repo, refName, path, against, setAgainst, defaultBranch, dark, signedIn, signIn, busy }: TabProps & { against: string; setAgainst: (ref: string) => void; defaultBranch?: string; dark: boolean }) {
  const [data, setData] = React.useState<{ t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; original: string; modified: string; missingOn?: string; noRef?: boolean }>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
  const [height, setHeight] = React.useState(0);
  const box = React.useRef<HTMLDivElement>(null);
  const darkRef = React.useRef(dark);
  darkRef.current = dark;

  React.useEffect(() => {
    let dead = false;
    setData({ t: "loading" });
    Promise.all([fetchSide(repo, against, path), fetchSide(repo, refName, path)]).then(
      async ([o, m]) => {
        if (dead) return;
        const missingOn = !o.ok ? against : !m.ok ? refName : undefined;
        // A 404 also means the ref itself is gone (seen live: a mistyped `against` read as "file does not exist on it").
        // ponytail: getBranchNames reads the first 100 branches only, so a full page proves nothing; page it if that matters.
        const names = missingOn ? await getBranchNames(repo).catch(() => [missingOn]) : [];
        const noRef = !!missingOn && names.length < 100 && !names.includes(missingOn);
        if (dead) return;
        setData({ t: "ready", original: o.ok ? o.text : "", modified: m.ok ? m.text : "", missingOn, noRef });
      },
      (err) => !dead && setData({ t: "error", err })
    );
    return () => { dead = true; };
  }, [repo, refName, against, path, signedIn, reload]);

  const same = data.t === "ready" && !data.missingOn && data.original === data.modified;
  const ready = data.t === "ready" && !same ? data : undefined;
  React.useEffect(() => {
    if (!ready) return;
    let dead = false;
    let handle: { dispose(): void } | undefined;
    setHeight(0);
    loadMonaco().then(
      (m) => {
        if (dead || !box.current) return;
        const d = m.createDiff(box.current, ready.original, ready.modified, monacoLanguage(path), darkRef.current, `${path}: ${against} compared with ${refName}`);
        const ed = d.editor as any; // getContentHeight / onDidContentSizeChange exist on the diff widget but not in its typings
        const sync = () => setHeight(ed.getContentHeight());
        ed.onDidContentSizeChange(sync);
        sync();
        handle = d;
      },
      () => !dead && setFailed(true)
    );
    return () => { dead = true; handle?.dispose(); };
  }, [ready, path, against, refName]);
  React.useEffect(() => { if (ready) void loadMonaco().then((m) => m.setTheme(dark)); }, [dark, ready]);

  return (
    <>
      <div className="gh-compare-bar flex-row flex-center">
        <span className="gh-compare-label body-m">Compare with</span>
        <BranchBar repo={repo} current={against} defaultBranch={defaultBranch} onPick={setAgainst} />
      </div>
      {data.t === "error" ? (
        <ErrorView err={data.err} signIn={signIn} busy={busy} retry={() => { invalidateRefs(); setReload((n) => n + 1); }} subject="compare this file" permission="Contents" />
      ) : data.t === "loading" ? (
        <Loading label="Loading both versions" />
      ) : same ? (
        <ZeroData iconProps={{ iconName: "Accept" }} imageAltText="" primaryText="No differences" secondaryText={`${path} is the same on ${refName} and ${against}.`} />
      ) : (
        <>
          {data.missingOn && <MessageCard severity={data.noRef ? MessageCardSeverity.Warning : MessageCardSeverity.Info}>{data.noRef ? `There is no branch called ${data.missingOn}. Pick another one to compare with.` : `${path} does not exist on ${data.missingOn}.`}</MessageCard>}
          {failed ? (
            <MessageCard severity={MessageCardSeverity.Error}>Could not load the diff editor.</MessageCard>
          ) : (
            <Card className="no-padding gh-compare-card" contentProps={{ contentPadding: false }}>
              <div ref={box} className="gh-pr-diff-editor" style={{ height: height || 80 }} />
            </Card>
          )}
        </>
      )}
    </>
  );
}

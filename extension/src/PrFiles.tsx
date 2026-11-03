// The Files tab of the PR page (PR-8): a resizable file tree, and one Card per file with Monaco's inline diff editor.
import * as React from "react";
import * as ReactDOM from "react-dom";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Link } from "azure-devops-ui/Link";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { ListSelection } from "azure-devops-ui/List";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { Splitter, SplitterElementPosition } from "azure-devops-ui/Splitter";
import { Tree, ExpandableTreeCell, ITreeColumn } from "azure-devops-ui/TreeEx";
import { ITreeItem, TreeItemProvider } from "azure-devops-ui/Utilities/TreeItemProvider";
import type { PrPageData } from "./lib/prModel";
import { buildFileTree, type PrFile, type PrTreeNode } from "./lib/prFiles";
import { classifyFile, monacoLanguage } from "./lib/fileKind";
import { ErrorView, loadMonaco } from "./Browser";
import { FileIcon } from "./fileIcons";
import { getAnnotations, getPrFiles, getRaw, invalidatePr } from "./githubBrowse";
import { openInRepos, useRepoHref } from "./repoHref";
import { InlineThreads } from "./Feed";
import { ComposerRoot, SuggestionBar } from "./ReviewUi";
import { fileTarget, isCommentable, toThreadTarget, type LineTarget } from "./lib/newThread";
import { AnnotationZone } from "./AnnotationZone";
import { mapAnnotations, type AnnotationAnchor } from "./lib/annotations";
import { useFeed } from "./feedStore";
import { threadsByFile, type InlineAnchor } from "./lib/inlineThreads";
import type { ThreadItem } from "./lib/feedModel";
import type { LineSpan, ZoneTarget } from "./monacoChunk";
import "./browser.css";

/** Cards past this many start collapsed (their diffs are only fetched when opened). */
const OPEN_CARDS = 20;
const MAX_BYTES = 1048576;
const NO_ANCHORS: InlineAnchor[] = [];
const NO_IDS: string[] = [];
const NO_FILE_THREADS = new Map<string, string[]>();
const NO_COUNTS = new Map<string, number>();
const NO_THREADS = new Map<string, InlineAnchor[]>();

/** CI-1: the head commit's check annotations placed on the PR's files. `urls` maps a check name to its details page. */
export interface AnnotationsInfo {
  byFile: Map<string, AnnotationAnchor[]>;
  urls: Map<string, string>;
}
const NO_ANNOTATIONS: AnnotationAnchor[] = [];
const NO_ANN_COUNTS = new Map<string, number>();
const NO_URLS = new Map<string, string>();

/** What a diff needs of its source: the pull request, or a commit against one parent (no base for an initial commit). */
export interface DiffCtx {
  baseSha: string | null;
  headSha: string;
  /** Only for pull requests: the inline review threads belong to a PR number and base branch. */
  number?: number;
  baseRef?: string;
}

// ---------- one side of a diff ----------

type Side = { ok: true; text: string } | { ok: false; why: string };
// ponytail: unbounded and never refetched; a PR's contents at a sha don't change. Add eviction if a 3000-file PR bites.
const sides = new Map<string, Promise<Side>>();

function fetchSide(repo: string, sha: string, path: string): Promise<Side> {
  const key = `${repo}@${sha}:${path}`;
  let p = sides.get(key);
  if (!p) {
    p = getRaw(repo, sha, path).then((buf): Side => {
      if (buf.byteLength > MAX_BYTES) return { ok: false, why: "larger than 1 MB" };
      if (new Uint8Array(buf, 0, Math.min(buf.byteLength, 8000)).includes(0)) return { ok: false, why: "a binary file" };
      try {
        return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(buf) };
      } catch {
        return { ok: false, why: "a binary file" };
      }
    });
    sides.set(key, p);
    p.catch(() => sides.delete(key));
  }
  return p;
}

// ---------- the diff body of a card ----------

/** True once the element has come near the viewport (and stays true). */
function useSeen(ref: React.RefObject<HTMLElement>) {
  const [seen, setSeen] = React.useState(typeof IntersectionObserver === "undefined");
  React.useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setSeen(true), io.disconnect()), { rootMargin: "400px 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, ref]);
  return seen;
}

type Body = { t: "wait" } | { t: "cant"; why: string } | { t: "error" } | { t: "diff"; original: string; modified: string; whole?: "added" | "removed" };

export function DiffBody({ file, repo, pr, dark, anchors, annotations = NO_ANNOTATIONS, annotationUrls = NO_URLS, sideBySide = false, commenting = false }: { file: PrFile; repo: string; pr: DiffCtx; dark: boolean; anchors: InlineAnchor[]; annotations?: AnnotationAnchor[]; annotationUrls?: Map<string, string>; sideBySide?: boolean; commenting?: boolean }) {
  const { baseSha, headSha } = pr;
  const root = React.useRef<HTMLDivElement>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const seen = useSeen(root);
  const [body, setBody] = React.useState<Body>({ t: "wait" });
  const [height, setHeight] = React.useState(0);
  const darkRef = React.useRef(dark);
  darkRef.current = dark;
  const sideRef = React.useRef(sideBySide);
  sideRef.current = sideBySide;
  const handle = React.useRef<{ dispose(): void; setTheme?: never } | null>(null);
  const [target, setTarget] = React.useState<ZoneTarget | null>(null);
  // CM-1: the comment being written under a line or range (one at a time per file), and the gutter that opens it.
  const [composer, setComposer] = React.useState<LineTarget | null>(null);
  const gutter = React.useRef<{ highlight(span: LineSpan | null): void } | null>(null);

  // Fetch both sides once the card is near the screen. Contents are fetched here, on the main thread; the Monaco worker gets text only.
  React.useEffect(() => {
    if (!seen) return;
    let dead = false;
    const kind = classifyFile(file.path, 0);
    if (kind === "binary" || kind === "image") return setBody({ t: "cant", why: `${file.path.split("/").pop()} is a binary file.` });
    const added = file.changeType === "ADDED";
    const deleted = file.changeType === "DELETED";
    Promise.all([
      added || !baseSha ? ({ ok: true, text: "" } as Side) : fetchSide(repo, baseSha, file.previousPath ?? file.path),
      deleted ? ({ ok: true, text: "" } as Side) : fetchSide(repo, headSha, file.path),
    ]).then(
      ([o, m]) => {
        if (dead) return;
        const bad = !o.ok ? o : !m.ok ? m : undefined;
        setBody(bad ? { t: "cant", why: `${file.path.split("/").pop()} is ${bad.why}.` } : { t: "diff", original: (o as { text: string }).text, modified: (m as { text: string }).text, whole: added ? "added" : deleted ? "removed" : undefined });
      },
      () => !dead && setBody({ t: "error" })
    );
    return () => { dead = true; };
  }, [seen, file, repo, baseSha, headSha]);

  // Create the editor when the text is ready; dispose it (and its models) on unmount.
  React.useEffect(() => {
    if (body.t !== "diff") return;
    let dead = false;
    loadMonaco().then(
      (m) => {
        if (dead || !box.current) return;
        const lang = monacoLanguage(file.path);
        const d = body.whole ? m.createWholeFile(box.current, body.whole === "added" ? body.modified : body.original, lang, darkRef.current, file.path, body.whole) : m.createDiff(box.current, body.original, body.modified, lang, darkRef.current, file.path, sideRef.current);
        const ed = d.editor as any; // getContentHeight / onDidContentSizeChange exist on the diff widget but not in its typings
        const sync = () => setHeight(ed.getContentHeight());
        ed.onDidContentSizeChange(sync);
        sync();
        handle.current = d;
        setTarget(body.whole ? { kind: "whole", editor: d.editor as any, side: body.whole === "removed" ? "LEFT" : "RIGHT" } : { kind: "diff", editor: d.editor as any });
      },
      () => !dead && setBody({ t: "error" })
    );
    return () => {
      dead = true;
      handle.current?.dispose();
      handle.current = null;
      setTarget(null);
    };
  }, [body, file.path]);

  // Review threads go under their lines as view zones (AF-6). Created when the editor mounts, and again only when the set of anchors changes.
  const anchorKey = JSON.stringify(anchors);
  const annotationKey = JSON.stringify(annotations);
  React.useEffect(() => {
    if (!target || (!anchors.length && !annotations.length)) return;
    let dead = false;
    let undo: (() => void) | undefined;
    const whole = body.t === "diff" ? body.whole : undefined;
    void loadMonaco().then((m) => {
      if (dead) return;
      const nodes: HTMLElement[] = [];
      const plans = anchors
        .filter((a) => !whole || a.side === (whole === "removed" ? "LEFT" : "RIGHT"))
        .map((a) => {
          const node = document.createElement("div");
          node.className = "gh-zone";
          ReactDOM.render(<InlineThreads repo={repo} number={pr.number!} baseRef={pr.baseRef!} ids={a.threadIds} />, node);
          nodes.push(node);
          return { side: a.side, line: a.line, node };
        });
      // Annotations describe the head commit, so they sit on the RIGHT side, added after the threads so they follow them on a shared line.
      if (whole !== "removed") {
        for (const a of annotations) {
          const node = document.createElement("div");
          node.className = "gh-zone";
          ReactDOM.render(<AnnotationZone anchor={a} urls={annotationUrls} />, node);
          nodes.push(node);
          plans.push({ side: "RIGHT", line: a.line, node });
        }
      }
      const remove = m.placeZones(target, plans);
      undo = () => { nodes.forEach((n) => ReactDOM.unmountComponentAtNode(n)); remove(); };
    });
    return () => { dead = true; undo?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anchorKey and annotationKey stand for anchors and annotations
  }, [target, anchorKey, annotationKey, repo, pr.number, pr.baseRef]);
  // The gutter "+": plain click, drag or Shift-click pick lines the patch allows, and open a composer under them.
  const commentable = commenting && !!file.patch && pr.number !== undefined;
  React.useEffect(() => {
    if (!target || !commentable) return;
    let dead = false;
    let off: (() => void) | undefined;
    void loadMonaco().then((m) => {
      if (dead) return;
      const line = (side: "LEFT" | "RIGHT", n: number): LineTarget => ({ subjectType: "LINE", path: file.path, line: n, side });
      const g = m.enableLineComments(target, {
        allow: (side, n) => isCommentable(file.patch, line(side, n)),
        onSelect: (span) => {
          const editor = span.side === "LEFT" ? ("original" as const) : ("modified" as const);
          const t = toThreadTarget(file.path, { start: { line: span.startLine, editor }, end: { line: span.endLine, editor } });
          if (isCommentable(file.patch, t)) setComposer(t);
          else g.highlight(null);
        },
      });
      gutter.current = g;
      off = g.dispose;
    });
    return () => { dead = true; gutter.current = null; off?.(); };
  }, [target, commentable, file.patch, file.path]);
  React.useEffect(() => {
    gutter.current?.highlight(composer ? { side: composer.side, startLine: composer.startLine ?? composer.line, endLine: composer.line } : null);
  }, [composer, target, commentable]);
  // The composer is a view zone like the threads, so it grows with its content and scrolls with the code.
  const composerKey = composer && `${composer.side}:${composer.startLine ?? composer.line}-${composer.line}`;
  React.useEffect(() => {
    if (!target || !composer) return;
    let dead = false;
    let undo: (() => void) | undefined;
    const node = document.createElement("div");
    node.className = "gh-zone";
    const text = body.t === "diff" ? body.modified.split(String.fromCharCode(10)) : [];
    const original = composer.side === "RIGHT" && text.length ? text.slice((composer.startLine ?? composer.line) - 1, composer.line) : undefined;
    ReactDOM.render(<ComposerRoot repo={repo} number={pr.number!} target={composer} originalLines={original?.length ? original : undefined} onClose={() => setComposer(null)} />, node);
    void loadMonaco().then((m) => {
      if (dead) return;
      const remove = m.placeZones(target, [{ side: composer.side, line: composer.line, node }]);
      undo = () => { ReactDOM.unmountComponentAtNode(node); remove(); };
    });
    return () => { dead = true; if (undo) undo(); else ReactDOM.unmountComponentAtNode(node); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- composerKey stands for composer
  }, [target, composerKey, repo, pr.number]);
  React.useEffect(() => { void loadMonaco().then((m) => handle.current && m.setTheme(dark)); }, [dark]);
  // Flip the layout in place: no refetch, and the editor keeps its collapsed regions.
  React.useEffect(() => { if (target?.kind === "diff") target.editor.updateOptions({ renderSideBySide: sideBySide }); }, [target, sideBySide]);

  return (
    <div ref={root} className="gh-pr-diff">
      {body.t === "wait" && <div className="gh-pr-diff-note flex-row justify-center"><Spinner size={SpinnerSize.small} ariaLabel="Loading diff" /></div>}
      {body.t === "cant" && <div className="gh-pr-diff-note secondary-text" role="status">Can't preview: {body.why}</div>}
      {body.t === "error" && <div className="gh-pr-diff-note secondary-text" role="status">Could not load this file's contents.</div>}
      {body.t === "diff" && <div ref={box} className="gh-pr-diff-editor" style={{ height: height || 80 }} />}
    </div>
  );
}

// ---------- a file's card ----------

const annotationTotal = (anchors: AnnotationAnchor[]) => anchors.reduce((n, a) => n + a.annotations.length, 0);
const annotationLabel = (n: number) => `${n} check ${n === 1 ? "annotation" : "annotations"}`;
function AnnotationBadge({ count }: { count: number }) {
  return count ? <Pill className="gh-annotation-count" size={PillSize.compact} ariaLabel={annotationLabel(count)}>{annotationLabel(count)}</Pill> : null;
}

export function FileCard({ file, repo, pr, collapsed, toggle, dark, anchors, annotations = NO_ANNOTATIONS, annotationUrls, sideBySide, commenting = false, fileThreadIds = NO_IDS }: { file: PrFile; repo: string; pr: DiffCtx; collapsed: boolean; toggle: () => void; dark: boolean; anchors: InlineAnchor[]; annotations?: AnnotationAnchor[]; annotationUrls?: Map<string, string>; sideBySide?: boolean; commenting?: boolean; fileThreadIds?: string[] }) {
  const href = useRepoHref();
  const [fileComment, setFileComment] = React.useState(false);
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  const view = { repo, ref: (file.changeType === "DELETED" ? pr.baseSha : pr.headSha) ?? pr.headSha, path: file.path };
  return (
    <Card
      className="gh-pr-card gh-pr-file"
      collapsible
      collapsed={collapsed}
      onCollapseClick={toggle}
      titleProps={{ text: file.path }} /* the chevron's accessible name */
      contentProps={{ contentPadding: false }}
      renderHeader={() => (
        <div className="bolt-card-header bolt-card-header-collapsible bolt-card-expandable-header gh-pr-file-header flex-row flex-center">
          <span className="gh-entry-icon"><FileIcon name={name} kind="file" /></span>
          <div className="flex-column flex-grow gh-pr-file-text">
            <div className="flex-row flex-baseline">
              <span className="gh-pr-file-name body-m">{name}</span>
              <span className="gh-pr-stat body-s"><span className="gh-pr-del">-{file.deletions}</span><span className="gh-pr-add">+{file.additions}</span></span>
              <AnnotationBadge count={annotationTotal(annotations)} />
            </div>
            <span className="secondary-text body-s text-ellipsis">/{file.path}{file.previousPath ? ` (renamed from /${file.previousPath})` : ""}</span>
          </div>
          {commenting && pr.number !== undefined && <Button subtle iconProps={{ iconName: "CommentAdd" }} text="Comment on file" ariaLabel={`Comment on ${file.path}`} ariaExpanded={fileComment} onClick={() => setFileComment(true)} />}
          <Button text="View" ariaLabel={`View ${file.path}`} href={href(view)} onClick={openInRepos(view)} />
        </div>
      )}
    >
      {(fileThreadIds.length > 0 || fileComment) && pr.number !== undefined && (
        <div className="gh-pr-file-comments">
          {fileThreadIds.length > 0 && <InlineThreads repo={repo} number={pr.number} baseRef={pr.baseRef!} ids={fileThreadIds} />}
          {fileComment && <ComposerRoot repo={repo} number={pr.number} target={fileTarget(file.path)} onClose={() => setFileComment(false)} />}
        </div>
      )}
      <DiffBody file={file} repo={repo} pr={pr} dark={dark} anchors={anchors} annotations={annotations} annotationUrls={annotationUrls} sideBySide={sideBySide} commenting={commenting} />
    </Card>
  );
}

// ---------- the tree ----------

const toItem = (n: PrTreeNode): ITreeItem<PrTreeNode> =>
  n.kind === "folder" ? { id: n.path, data: n, expanded: true, childItems: n.children.map(toItem) } : { id: n.path, data: n };

export function FileTree({ nodes, selected, select, threadCounts = NO_COUNTS, annotationCounts = NO_ANN_COUNTS }: { nodes: PrTreeNode[]; selected?: string; select: (path: string) => void; threadCounts?: Map<string, number>; annotationCounts?: Map<string, number> }) {
  const provider = React.useMemo(() => new TreeItemProvider<PrTreeNode>(nodes.map(toItem)), [nodes]);
  const selection = React.useMemo(() => new ListSelection({ selectOnFocus: false }), []);
  const current = React.useRef(selected);
  current.current = selected;
  const highlight = React.useCallback(() => {
    const i = provider.value.findIndex((x) => x.underlyingItem.id === current.current);
    selection.clear();
    if (i >= 0) selection.select(i);
  }, [provider, selection]);
  React.useEffect(highlight, [highlight, selected]);

  const columns = React.useMemo<ITreeColumn<PrTreeNode>[]>(
    () => [
      {
        id: "name",
        width: -1,
        renderCell: (_r, columnIndex, treeColumn, treeItem) => {
          const n = treeItem.underlyingItem.data;
          return (
            <ExpandableTreeCell key="name" columnIndex={columnIndex} treeColumn={treeColumn} treeItem={treeItem}>
              <span className="gh-entry-icon"><FileIcon name={n.name} kind={n.kind} /></span>
              <Link className="bolt-table-link text-ellipsis" subtle removeUnderline role="presentation" excludeTabStop>{n.name}</Link>
              {n.kind === "file" && threadCounts.has(n.path) && <Pill className="gh-tree-count" size={PillSize.compact} ariaLabel={`${threadCounts.get(n.path)} comment ${threadCounts.get(n.path) === 1 ? "thread" : "threads"}`}>{threadCounts.get(n.path)}</Pill>}
              {n.kind === "file" && annotationCounts.has(n.path) && <Pill className="gh-tree-count" size={PillSize.compact} variant={PillVariant.outlined} ariaLabel={annotationLabel(annotationCounts.get(n.path)!)}>{annotationCounts.get(n.path)}</Pill>}
            </ExpandableTreeCell>
          );
        },
      },
    ],
    [threadCounts, annotationCounts]
  );
  return (
    <Tree<PrTreeNode>
      key={[...threadCounts, ...annotationCounts].join() /* rows are memoised: remount when the badges change */}
      ariaLabel="Changed files"
      className="gh-tree"
      columns={columns}
      itemProvider={provider as any}
      selection={selection}
      onToggle={(_e, ex) => { provider.toggle(ex.underlyingItem as ITreeItem<PrTreeNode>); highlight(); }}
      onActivate={(_e, row) => {
        const n = row.data.underlyingItem.data;
        if (n.kind === "file") select(n.path);
        else { provider.toggle(row.data.underlyingItem); highlight(); }
      }}
      singleClickActivation
      showHeader={false}
      showLines={false}
      scrollable
      role="tree"
    />
  );
}

// ---------- the tab ----------

/** The tree and the cards, with `bar` above them. Shared by the PR Files tab and commit detail. `treeHeader` sits above the tree (native's repo name row). */
export function FilesView({ files, repo, ctx, selected, select, dark, sideBySide, anchors = NO_THREADS, threadCounts = NO_COUNTS, annotations, bar, treeHeader, commenting = false, fileThreads = NO_FILE_THREADS }: { files: PrFile[]; repo: string; ctx: DiffCtx; selected?: string; select: (path: string) => void; dark: boolean; sideBySide?: boolean; anchors?: Map<string, InlineAnchor[]>; threadCounts?: Map<string, number>; annotations?: AnnotationsInfo; bar: React.ReactNode; treeHeader?: React.ReactNode; commenting?: boolean; fileThreads?: Map<string, string[]> }) {
  const nodes = React.useMemo(() => buildFileTree(files), [files]);
  const [collapsed, setCollapsed] = React.useState(() => new Set(files.slice(OPEN_CARDS).map((f) => f.path)));
  const els = React.useRef(new Map<string, HTMLElement>());
  const annotationCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const [path, list] of annotations?.byFile ?? []) m.set(path, annotationTotal(list));
    return m;
  }, [annotations]);

  // A selected file (tree click or hash) opens its card and scrolls to it.
  React.useEffect(() => {
    if (!selected || !files.some((f) => f.path === selected)) return;
    setCollapsed((c) => { if (!c.has(selected)) return c; const n = new Set(c); n.delete(selected); return n; });
    requestAnimationFrame(() => els.current.get(selected)?.scrollIntoView({ block: "start" }));
  }, [selected, files]);

  return (
    <div className="gh-pr-files flex-column">
      {bar}
      <div className="gh-shell gh-pr-files-shell">
        <Splitter
          className="bolt-page-grey"
          fixedElement={SplitterElementPosition.Near}
          initialFixedSize={280}
          minFixedSize={160}
          maxFixedSize={600}
          nearElementClassName="gh-left"
          farElementClassName="gh-right"
          onRenderNearElement={() => (
            <nav className="gh-left-inner flex-column" aria-label="Changed files">
              {treeHeader}
              <div className="gh-tree-wrap"><FileTree nodes={nodes} selected={selected} select={select} threadCounts={threadCounts} annotationCounts={annotationCounts} /></div>
            </nav>
          )}
          onRenderFarElement={() => (
            <div className="gh-pr-cards">
              {files.map((f) => (
                <div key={f.path} className="gh-pr-file-wrap" ref={(el) => { if (el) els.current.set(f.path, el); else els.current.delete(f.path); }}>
                  <FileCard
                    file={f}
                    repo={repo}
                    pr={ctx}
                    dark={dark}
                    sideBySide={sideBySide}
                    commenting={commenting}
                    fileThreadIds={fileThreads.get(f.path)}
                    anchors={anchors.get(f.path) ?? NO_ANCHORS}
                    annotations={annotations?.byFile.get(f.path)}
                    annotationUrls={annotations?.urls}
                    collapsed={collapsed.has(f.path)}
                    toggle={() => setCollapsed((c) => { const n = new Set(c); n.has(f.path) ? n.delete(f.path) : n.add(f.path); return n; })}
                  />
                </div>
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}

function Loaded({ files, repo, pr, selected, select, dark }: { files: PrFile[]; repo: string; pr: PrPageData; selected?: string; select: (path: string) => void; dark: boolean }) {
  const feed = useFeed(repo, pr.number);
  const threads = React.useMemo(() => feed.items.filter((i): i is ThreadItem => i.kind === "thread"), [feed.items]);
  const anchors = React.useMemo(() => threadsByFile(threads), [threads]);
  const threadCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const t of threads) m.set(t.path, (m.get(t.path) ?? 0) + 1);
    return m;
  }, [threads]);
  const fileThreads = React.useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of threads) if (t.subjectType === "FILE") m.set(t.path, [...(m.get(t.path) ?? []), t.id]);
    return m;
  }, [threads]);
  // CI-1: the annotations arrive after the diff; if they can't be read (no Checks permission, say) the diff simply has none.
  const [contexts, setContexts] = React.useState<Awaited<ReturnType<typeof getAnnotations>>>([]);
  React.useEffect(() => {
    let dead = false;
    getAnnotations(repo, pr.number).then((c) => !dead && setContexts(c), () => {});
    return () => { dead = true; };
  }, [repo, pr.number]);
  const annotations = React.useMemo<AnnotationsInfo>(() => {
    const urls = new Map<string, string>();
    for (const c of contexts) if (c.__typename === "CheckRun" && c.detailsUrl) urls.set(c.name, c.detailsUrl);
    return { byFile: mapAnnotations(contexts, files.map((f) => f.path)).byFile, urls };
  }, [contexts, files]);
  return (
    <FilesView
      files={files} repo={repo} ctx={pr} selected={selected} select={select} dark={dark} anchors={anchors} threadCounts={threadCounts} annotations={annotations}
      commenting={feed.status === "ready" && !!feed.viewer.login} fileThreads={fileThreads}
      bar={<><div className="gh-pr-files-bar flex-row flex-center body-m">{files.length} changed {files.length === 1 ? "file" : "files"}</div><SuggestionBar store={feed} /></>}
    />
  );
}

type Load = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; files: PrFile[] };

export function PrFilesTab({ repo, number, pr, selected, select, dark, signedIn, signIn, busy }: { repo: string; number: number; pr: PrPageData; selected?: string; select: (path: string) => void; dark: boolean; signedIn: boolean; signIn: () => void; busy: boolean }) {
  const [load, setLoad] = React.useState<Load>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "loading" });
    getPrFiles(repo, number).then((files) => !dead && setLoad({ t: "ready", files }), (err) => !dead && setLoad({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, number, signedIn, reload]);
  if (load.t === "loading") return <div className="page-content page-content-top gh-pr-loading flex-row justify-center"><Spinner size={SpinnerSize.large} ariaLabel="Loading changed files" /></div>;
  if (load.t === "error")
    return (
      <div className="page-content page-content-top">
        <ErrorView err={load.err} signIn={signIn} busy={busy} retry={() => { invalidatePr(); setReload((r) => r + 1); }} subject="see this pull request's files" permission="Pull requests" />
      </div>
    );
  return <Loaded files={load.files} repo={repo} pr={pr} selected={selected} select={select} dark={dark} />;
}

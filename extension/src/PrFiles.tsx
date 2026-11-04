// The Files tab of the PR page (PR-8): a resizable file tree, and one Card per file with Monaco's inline diff editor.
import * as React from "react";
import * as ReactDOM from "react-dom";
import { Button } from "azure-devops-ui/Button";
import { ButtonGroup } from "azure-devops-ui/ButtonGroup";
import { Card } from "azure-devops-ui/Card";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Link } from "azure-devops-ui/Link";
import { MoreButton } from "azure-devops-ui/Menu";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { ListSelection } from "azure-devops-ui/List";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { Splitter, SplitterElementPosition } from "azure-devops-ui/Splitter";
import { Tree, ExpandableTreeCell, ITreeColumn } from "azure-devops-ui/TreeEx";
import { ITreeItem, TreeItemProvider } from "azure-devops-ui/Utilities/TreeItemProvider";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { ZeroData } from "azure-devops-ui/ZeroData";
import type { PrPageData } from "./lib/prModel";
import { resolveRange, type ChangesFrom, type RangeContext } from "./lib/commitRange";
import { applyDiffHash, resolveSideBySide, storedSideBySide } from "./lib/diffPrefs";
import { withViewed } from "./lib/viewedFiles";
import { usePrefs } from "./prefs";
import { patchHash, useHashExtras } from "./hostNav";
import { FilesBar } from "./PrFilesBar";
import { buildFileTree, type PrFile, type PrTreeNode } from "./lib/prFiles";
import { monacoLanguage } from "./lib/fileKind";
import { BINARY_NOTICE, MAX_DIFF_BYTES, diffNotice, diffViews, renderedSides, richKind, toggleRenderedSide, type DiffView, type RenderedSide } from "./lib/richDiff";
import { changedSinceViewed, CHANGED_SINCE_VIEWED, isCollapsedByDefault, viewedProgress, type ViewedState } from "./lib/viewedFiles";
import { EMPTY_FILE_FILTER, filterFiles, type FileFilter } from "./lib/fileFilter";
import { whitespaceNotice } from "./lib/diffPrefs";
import { githubDevFileUrl } from "./lib/githubDev";
import { ImageDiff, RenderedMarkdown } from "./PrRichDiff";
import { TreeFilter } from "./PrFilesBar";
import { ErrorView, loadMonaco } from "./Browser";
import { FileIcon } from "./fileIcons";
import { getAnnotations, getPrFiles, getRaw, getRangeContext, getRangeFiles, getViewedStates, invalidatePr, setFileViewed } from "./githubBrowse";
import { openInRepos, useRepoHref } from "./repoHref";
import { InlineThreads } from "./Feed";
import { ComposerRoot, SuggestionBar } from "./ReviewUi";
import { fileTarget, isCommentable, toThreadTarget, type LineTarget } from "./lib/newThread";
import { AnnotationZone } from "./AnnotationZone";
import { ContextRow } from "./ContextRow";
import { mapAnnotations, type AnnotationAnchor } from "./lib/annotations";
import { useFeed } from "./feedStore";
import { threadRanges, threadsByFile, type InlineAnchor, type ThreadRange } from "./lib/inlineThreads";
import type { ThreadItem } from "./lib/feedModel";
import type { LineSpan, ZoneTarget } from "./monacoChunk";
import "./browser.css";

/** Cards past this many start collapsed (their diffs are only fetched when opened). */
const OPEN_CARDS = 20;
const NO_ANCHORS: InlineAnchor[] = [];
const NO_IDS: string[] = [];
const NO_FILE_THREADS = new Map<string, string[]>();
const NO_COUNTS = new Map<string, number>();
const NO_THREADS = new Map<string, InlineAnchor[]>();
const NO_RANGES: ThreadRange[] = [];
const NO_RANGE_MAP = new Map<string, ThreadRange[]>();

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
      if (buf.byteLength > MAX_DIFF_BYTES) return { ok: false, why: BINARY_NOTICE };
      if (new Uint8Array(buf, 0, Math.min(buf.byteLength, 8000)).includes(0)) return { ok: false, why: BINARY_NOTICE };
      try {
        return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(buf) };
      } catch {
        return { ok: false, why: BINARY_NOTICE };
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

/** VW-12: a diff's collapsed unchanged regions, for the card's Expand all / Collapse menu item. */
export interface ContextCtl {
  expandAll(): void;
  collapse(): void;
  anyHidden: boolean;
  anyRegions: boolean;
}

type Body = { t: "wait" } | { t: "cant"; why: string } | { t: "error" } | { t: "diff"; original: string; modified: string; whole?: "added" | "removed" };

export function DiffBody({ file, repo, pr, dark, anchors, annotations = NO_ANNOTATIONS, annotationUrls = NO_URLS, sideBySide = false, commenting = false, ignoreWhitespace = false, onContext, ranges = NO_RANGES }: { file: PrFile; repo: string; pr: DiffCtx; dark: boolean; anchors: InlineAnchor[]; /** CM-6: lines covered by multi-line threads. */ ranges?: ThreadRange[]; annotations?: AnnotationAnchor[]; annotationUrls?: Map<string, string>; sideBySide?: boolean; commenting?: boolean; ignoreWhitespace?: boolean; onContext?: (c: ContextCtl | null) => void }) {
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
    // VW-11: GitHub sends no patch for binary and very large diffs, and a known binary type needs no fetch.
    const notice = diffNotice({ path: file.path, patch: file.patch, additions: file.additions, deletions: file.deletions });
    if (notice) return setBody({ t: "cant", why: notice });
    const added = file.changeType === "ADDED";
    const deleted = file.changeType === "DELETED";
    Promise.all([
      added || !baseSha ? ({ ok: true, text: "" } as Side) : fetchSide(repo, baseSha, file.previousPath ?? file.path),
      deleted ? ({ ok: true, text: "" } as Side) : fetchSide(repo, headSha, file.path),
    ]).then(
      ([o, m]) => {
        if (dead) return;
        const bad = !o.ok ? o : !m.ok ? m : undefined;
        setBody(bad ? { t: "cant", why: bad.why } : { t: "diff", original: (o as { text: string }).text, modified: (m as { text: string }).text, whole: added ? "added" : deleted ? "removed" : undefined });
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
  // CM-6: the lines each multi-line thread covers, marked in the gutter (the thread sits under the last of them).
  const threadRangeKey = JSON.stringify(ranges);
  React.useEffect(() => {
    if (!target || !ranges.length) return;
    let dead = false;
    let undo: (() => void) | undefined;
    void loadMonaco().then((m) => { if (!dead) undo = m.markThreadRanges(target, ranges.map((r) => ({ side: r.side, startLine: r.startLine, endLine: r.endLine }))); });
    return () => { dead = true; undo?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- threadRangeKey stands for ranges
  }, [target, threadRangeKey]);
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
  // VW-12: collapse the unchanged regions, with an expand row in each.
  const onContextRef = React.useRef(onContext);
  onContextRef.current = onContext;
  React.useEffect(() => {
    if (target?.kind !== "diff") return;
    let dead = false;
    let ctl: { expandAll(): void; collapse(): void; dispose(): void } | undefined;
    const api = { expandAll: () => ctl?.expandAll(), collapse: () => ctl?.collapse() };
    void loadMonaco().then((m) => {
      if (dead) return;
      ctl = m.enableContextExpansion(
        target.editor,
        (node, row) => ReactDOM.render(<ContextRow row={row} />, node),
        (node) => ReactDOM.unmountComponentAtNode(node),
        (anyHidden, anyRegions) => onContextRef.current?.({ ...api, anyHidden, anyRegions })
      );
    });
    return () => { dead = true; ctl?.dispose(); onContextRef.current?.(null); };
  }, [target]);
  React.useEffect(() => { void loadMonaco().then((m) => handle.current && m.setTheme(dark)); }, [dark]);
  // Flip the layout in place: no refetch, and the editor keeps its collapsed regions.
  React.useEffect(() => { if (target?.kind === "diff") target.editor.updateOptions({ renderSideBySide: sideBySide }); }, [target, sideBySide]);
  // VW-4: Monaco's own option does the work, in place.
  React.useEffect(() => { if (target?.kind === "diff") target.editor.updateOptions({ ignoreTrimWhitespace: ignoreWhitespace }); }, [target, ignoreWhitespace]);

  return (
    <div ref={root} className="gh-pr-diff">
      {body.t === "wait" && <div className="gh-pr-diff-note flex-row justify-center"><Spinner size={SpinnerSize.small} ariaLabel="Loading diff" /></div>}
      {body.t === "cant" && <div className="gh-pr-diff-note secondary-text" role="status">{body.why}</div>}
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

/** VW-3: the viewed state of a file and the way to change it. `state` is undefined while it loads. */
export interface ViewedCtl {
  state: ViewedState | undefined;
  onChange: (viewed: boolean) => void;
}

/** VW-11: the Source / Rendered toggle of a file that has a rendered view. A ButtonGroup of two subtle Buttons. */
function ViewToggle({ views, view, setView, name }: { views: DiffView[]; view: DiffView; setView: (v: DiffView) => void; name: string }) {
  return (
    <ButtonGroup className="gh-view-toggle">
      {views.map((v) => <Button key={v} subtle={v !== view} primary={v === view} text={v === "source" ? "Source" : "Rendered"} ariaPressed={v === view} ariaLabel={`${v === "source" ? "Source" : "Rendered"} view of ${name}`} onClick={() => setView(v)} />)}
    </ButtonGroup>
  );
}

export function FileCard({ file, repo, pr, collapsed, toggle, dark, anchors, annotations = NO_ANNOTATIONS, annotationUrls, sideBySide, commenting = false, fileThreadIds = NO_IDS, viewed, ignoreWhitespace = false, ranges }: { file: PrFile; repo: string; pr: DiffCtx; collapsed: boolean; ranges?: ThreadRange[]; toggle: () => void; dark: boolean; anchors: InlineAnchor[]; annotations?: AnnotationAnchor[]; annotationUrls?: Map<string, string>; sideBySide?: boolean; commenting?: boolean; fileThreadIds?: string[]; viewed?: ViewedCtl; ignoreWhitespace?: boolean }) {
  const href = useRepoHref();
  const [fileComment, setFileComment] = React.useState(false);
  const kind = richKind(file.path);
  const views = kind ? diffViews(kind) : null;
  const [view, setView] = React.useState<DiffView>(views?.default ?? "source");
  const [side, setSide] = React.useState<RenderedSide>("after");
  const [context, setContext] = React.useState<ContextCtl | null>(null);
  const ws = whitespaceNotice(file.patch, ignoreWhitespace);
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  const target = { repo, ref: (file.changeType === "DELETED" ? pr.baseSha : pr.headSha) ?? pr.headSha, path: file.path };
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
              {changedSinceViewed(viewed?.state) && <Pill className="gh-changed-since" size={PillSize.compact} variant={PillVariant.colored} color={{ red: 202, green: 80, blue: 16 }}>{CHANGED_SINCE_VIEWED}</Pill>}
              {ws && <Pill className="gh-ws-only" size={PillSize.compact} variant={PillVariant.outlined}>{ws}</Pill>}
            </div>
            <span className="secondary-text body-s text-ellipsis">/{file.path}{file.previousPath ? ` (renamed from /${file.previousPath})` : ""}</span>
          </div>
          {views && views.views.length > 1 && <ViewToggle views={views.views} view={view} setView={setView} name={name} />}
          {kind === "markdown" && view === "rendered" && renderedSides(file.changeType).length > 1 && <Button subtle iconProps={{ iconName: "Switch" }} text={side === "after" ? "After" : "Before"} ariaLabel={`Showing the ${side} version; switch`} onClick={() => setSide((x) => toggleRenderedSide(file.changeType, x))} />}
          {viewed && <Checkbox className="gh-viewed" label="Viewed" ariaLabel={`Viewed: ${file.path}`} checked={viewed.state === "VIEWED"} onChange={(_e, v) => viewed.onChange(v)} />}
          {commenting && pr.number !== undefined && <Button subtle iconProps={{ iconName: "CommentAdd" }} text="Comment on file" ariaLabel={`Comment on ${file.path}`} ariaExpanded={fileComment} onClick={() => setFileComment(true)} />}
          <Button subtle iconProps={{ iconName: "OpenInNewTab" }} text="github.dev" tooltipProps={{ text: "Open this file in github.dev" }} ariaLabel={`Open ${file.path} in github.dev`} href={githubDevFileUrl(repo, target.ref, file.path)} target="_blank" rel="noopener noreferrer" />
          <Button text="View" ariaLabel={`View ${file.path}`} href={href(target)} onClick={openInRepos(target)} />
          {context?.anyRegions && !collapsed && (
            <MoreButton
              className="gh-pr-file-more"
              ariaLabel={`More actions for ${file.path}`}
              contextualMenuProps={{
                menuProps: {
                  id: `gh-file-menu-${file.path}`,
                  items: [context.anyHidden
                    ? { id: "expand", text: "Expand all lines", iconProps: { iconName: "ChevronUnfold10" }, onActivate: () => context.expandAll() }
                    : { id: "collapse", text: "Collapse unchanged lines", iconProps: { iconName: "ChevronFold10" }, onActivate: () => context.collapse() }],
                },
              }}
            />
          )}
        </div>
      )}
    >
      {(fileThreadIds.length > 0 || fileComment) && pr.number !== undefined && (
        <div className="gh-pr-file-comments">
          {fileThreadIds.length > 0 && <InlineThreads repo={repo} number={pr.number} baseRef={pr.baseRef!} ids={fileThreadIds} />}
          {fileComment && <ComposerRoot repo={repo} number={pr.number} target={fileTarget(file.path)} onClose={() => setFileComment(false)} />}
        </div>
      )}
      {kind === "image" || (kind === "svg" && view === "rendered") ? <ImageDiff file={file} repo={repo} pr={pr} />
        : kind === "markdown" && view === "rendered" ? <RenderedMarkdown file={file} repo={repo} pr={pr} side={toggleRenderedSide(file.changeType, side)} />
        : <DiffBody file={file} repo={repo} pr={pr} dark={dark} anchors={anchors} annotations={annotations} annotationUrls={annotationUrls} sideBySide={sideBySide} commenting={commenting} ignoreWhitespace={ignoreWhitespace} onContext={setContext} ranges={ranges} />}
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
export interface ViewedFilesCtl {
  states: Record<string, ViewedState>;
  onChange: (path: string, viewed: boolean) => void;
}

export function FilesView({ files: all, repo, ctx, selected, select, dark, sideBySide, anchors = NO_THREADS, threadCounts = NO_COUNTS, annotations, bar, treeHeader, commenting = false, fileThreads = NO_FILE_THREADS, viewed, ignoreWhitespace = false, treeFilter = false, ranges = NO_RANGE_MAP }: { /** CM-6: multi-line thread ranges per path. */ ranges?: Map<string, ThreadRange[]>; files: PrFile[]; repo: string; ctx: DiffCtx; selected?: string; select: (path: string) => void; dark: boolean; sideBySide?: boolean; anchors?: Map<string, InlineAnchor[]>; threadCounts?: Map<string, number>; annotations?: AnnotationsInfo; bar: React.ReactNode | ((p: { shown: number; progress?: ReturnType<typeof viewedProgress> }) => React.ReactNode); treeHeader?: React.ReactNode; commenting?: boolean; fileThreads?: Map<string, string[]>; viewed?: ViewedFilesCtl; ignoreWhitespace?: boolean; /** VW-5: a filter box and menu over the tree. */ treeFilter?: boolean }) {
  const [filter, setFilter] = React.useState<FileFilter>(EMPTY_FILE_FILTER);
  const files = React.useMemo(() => (treeFilter ? filterFiles(all, filter) : all), [all, filter, treeFilter]);
  const nodes = React.useMemo(() => buildFileTree(files), [files]);
  const [collapsed, setCollapsed] = React.useState(() => new Set(all.slice(OPEN_CARDS).map((f) => f.path)));
  // VW-3: files already viewed start collapsed, once their states have arrived.
  const appliedViewed = React.useRef(false);
  React.useEffect(() => {
    if (!viewed || appliedViewed.current) return;
    appliedViewed.current = true;
    setCollapsed((c) => {
      const n = new Set(c);
      for (const f of all) if (isCollapsedByDefault(viewed.states[f.path]) && f.path !== selected) n.add(f.path);
      return n;
    });
  }, [viewed, all, selected]);
  const progress = React.useMemo(() => (viewed ? viewedProgress(all.map((f) => f.path), viewed.states) : undefined), [viewed, all]);
  const setViewed = (path: string, v: boolean) => {
    // GitHub collapses a file when it is ticked as viewed and opens it again when it is unticked.
    setCollapsed((c) => { const n = new Set(c); v ? n.add(path) : n.delete(path); return n; });
    viewed?.onChange(path, v);
  };
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
      {typeof bar === "function" ? bar({ shown: files.length, progress }) : bar}
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
              {treeFilter && <TreeFilter files={all} filter={filter} onChange={setFilter} />}
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
                    ranges={ranges.get(f.path)}
                    annotations={annotations?.byFile.get(f.path)}
                    annotationUrls={annotations?.urls}
                    ignoreWhitespace={ignoreWhitespace}
                    viewed={viewed && { state: viewed.states[f.path], onChange: (v) => setViewed(f.path, v) }}
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

interface LoadedProps {
  files: PrFile[];
  repo: string;
  /** What the diffs compare: the PR itself, or (VW-6) another range of it, which has no threads, annotations or viewed state. */
  ctx: DiffCtx;
  whole: boolean;
  selected?: string;
  select: (path: string) => void;
  dark: boolean;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  viewed?: ViewedFilesCtl;
  bar: (p: { shown: number; progress?: ReturnType<typeof viewedProgress> }) => React.ReactNode;
}

function Loaded({ files, repo, ctx, whole, selected, select, dark, sideBySide, ignoreWhitespace, viewed, bar }: LoadedProps) {
  const number = ctx.number ?? 0;
  const feed = useFeed(repo, number);
  const threads = React.useMemo(() => (whole ? feed.items.filter((i): i is ThreadItem => i.kind === "thread") : []), [feed.items, whole]);
  const anchors = React.useMemo(() => threadsByFile(threads), [threads]);
  const ranges = React.useMemo(() => threadRanges(threads), [threads]);
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
    if (!whole) return;
    let dead = false;
    getAnnotations(repo, number).then((c) => !dead && setContexts(c), () => {});
    return () => { dead = true; };
  }, [repo, number, whole]);
  const annotations = React.useMemo<AnnotationsInfo>(() => {
    const urls = new Map<string, string>();
    for (const c of contexts) if (c.__typename === "CheckRun" && c.detailsUrl) urls.set(c.name, c.detailsUrl);
    return { byFile: mapAnnotations(whole ? contexts : [], files.map((f) => f.path)).byFile, urls };
  }, [contexts, files, whole]);
  return (
    <FilesView
      files={files} repo={repo} ctx={ctx} selected={selected} select={select} dark={dark} sideBySide={sideBySide} ignoreWhitespace={ignoreWhitespace} anchors={anchors} ranges={ranges} threadCounts={threadCounts} annotations={annotations}
      commenting={whole && feed.status === "ready" && !!feed.viewer.login} fileThreads={fileThreads} viewed={viewed} treeFilter
      bar={({ shown, progress }) => <>{bar({ shown, progress })}{whole && <SuggestionBar store={feed} />}</>}
    />
  );
}

type Load = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; files: PrFile[] };

export function PrFilesTab({ repo, number, pr, selected, select, dark, signedIn, signIn, busy }: { repo: string; number: number; pr: PrPageData; selected?: string; select: (path: string) => void; dark: boolean; signedIn: boolean; signIn: () => void; busy: boolean }) {
  const [load, setLoad] = React.useState<Load>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  const [prefs, setPrefs] = usePrefs();
  const { diff } = useHashExtras();
  // VW-2: the hash override, then the stored per-user default, then inline.
  const sideBySide = resolveSideBySide(diff.sideBySide, storedSideBySide(prefs));
  const ignoreWhitespace = !!diff.ignoreWhitespace;
  const setSideBySide = (v: boolean) => {
    setPrefs((p) => ({ ...p, prSideBySide: v }));
    if (diff.sideBySide !== undefined) patchHash((h) => applyDiffHash(h, { ...diff, sideBySide: v })); // a hash override would otherwise beat the choice
  };
  const setIgnoreWhitespace = (v: boolean) => patchHash((h) => applyDiffHash(h, { ...diff, ignoreWhitespace: v }));

  // VW-6: "Show changes from". The commits arrive on their own; until then the PR's own diff is all there is.
  const [changes, setChanges] = React.useState<ChangesFrom>({ kind: "all" });
  const [rangeCtx, setRangeCtx] = React.useState<RangeContext | undefined>();
  React.useEffect(() => {
    let dead = false;
    getRangeContext(repo, number).then((c) => !dead && setRangeCtx(c), () => {});
    return () => { dead = true; };
  }, [repo, number, signedIn, reload]);
  const range = React.useMemo(() => {
    if (changes.kind === "all" || !rangeCtx) return null;
    try { return resolveRange(repo, changes, rangeCtx); } catch { return null; }
  }, [changes, rangeCtx, repo]);
  const whole = changes.kind === "all" || !range;
  const rangeKey = whole ? "all" : range!.path;
  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "loading" });
    (whole ? getPrFiles(repo, number) : getRangeFiles(range!.path)).then((files) => !dead && setLoad({ t: "ready", files }), (err) => !dead && setLoad({ t: "error", err }));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rangeKey stands for range
  }, [repo, number, signedIn, reload, rangeKey]);

  // VW-3: viewed states are the signed-in viewer's, and only mean something for the PR's own diff.
  const [viewedData, setViewedData] = React.useState<{ pullRequestId: string; states: Record<string, ViewedState> } | undefined>();
  const [viewedError, setViewedError] = React.useState(false);
  React.useEffect(() => {
    if (!signedIn) return setViewedData(undefined);
    let dead = false;
    getViewedStates(repo, number).then((d) => !dead && setViewedData(d.pullRequestId ? d : undefined), () => !dead && setViewedData(undefined));
    return () => { dead = true; };
  }, [repo, number, signedIn, reload]);
  const viewed = React.useMemo<ViewedFilesCtl | undefined>(() => {
    if (!viewedData || !whole) return undefined;
    return {
      states: viewedData.states,
      onChange: (path, v) => {
        const was = viewedData.states[path];
        setViewedError(false);
        setViewedData((d) => d && { ...d, states: withViewed(d.states, path, v) });
        setFileViewed(viewedData.pullRequestId, path, v).catch(() => {
          setViewedData((d) => d && { ...d, states: { ...d.states, [path]: was ?? "UNVIEWED" } });
          setViewedError(true);
        });
      },
    };
  }, [viewedData, whole]);

  const ctx: DiffCtx = whole ? { baseSha: pr.baseSha, headSha: pr.headSha, number: pr.number, baseRef: pr.baseRef } : { baseSha: range!.base, headSha: range!.head };
  const total = load.t === "ready" ? load.files.length : 0;
  const bar = (p: { shown: number; progress?: ReturnType<typeof viewedProgress> }) => (
    <>
      <FilesBar
        count={total} shown={load.t === "ready" ? p.shown : 0}
        range={rangeCtx && rangeCtx.commits.length ? { ctx: rangeCtx, value: changes, onChange: setChanges } : undefined}
        sideBySide={sideBySide} setSideBySide={setSideBySide} ignoreWhitespace={ignoreWhitespace} setIgnoreWhitespace={setIgnoreWhitespace} progress={p.progress}
      />
      {viewedError && <MessageCard className="gh-viewed-error" severity={MessageCardSeverity.Error} onDismiss={() => setViewedError(false)}>GitHub did not accept that change to the viewed state. It has been put back.</MessageCard>}
    </>
  );
  if (load.t === "loading") return <div className="gh-pr-files flex-column">{bar({ shown: 0 })}<div className="page-content page-content-top gh-pr-loading flex-row justify-center"><Spinner size={SpinnerSize.large} ariaLabel="Loading changed files" /></div></div>;
  if (load.t === "error")
    return (
      <div className="page-content page-content-top">
        <ErrorView err={load.err} signIn={signIn} busy={busy} retry={() => { invalidatePr(); setReload((r) => r + 1); }} subject="see this pull request's files" permission="Pull requests" />
      </div>
    );
  if (!load.files.length)
    return <div className="gh-pr-files flex-column">{bar({ shown: 0 })}<ZeroData iconProps={{ iconName: "Page" }} imageAltText="" primaryText="No files changed" secondaryText={whole ? "This pull request does not change any files." : "Nothing changed in this range."} /></div>;
  return <Loaded key={rangeKey} files={load.files} repo={repo} ctx={ctx} whole={whole} selected={selected} select={select} dark={dark} sideBySide={sideBySide} ignoreWhitespace={ignoreWhitespace} viewed={viewed} bar={bar} />;
}

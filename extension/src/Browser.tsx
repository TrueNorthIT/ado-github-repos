import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { Button } from "azure-devops-ui/Button";
import { ButtonGroup } from "azure-devops-ui/ButtonGroup";
import { Dropdown, DropdownExpandableButton } from "azure-devops-ui/Dropdown";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Page } from "azure-devops-ui/Page";
import { Surface, SurfaceBackground } from "azure-devops-ui/Surface";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { MoreButton, type IMenuItem } from "azure-devops-ui/Menu";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { Splitter, SplitterElementPosition } from "azure-devops-ui/Splitter";
import { skeletonRows } from "./RepoHub"; // a cycle with RepoHub (which imports this file), harmless: only used at render time
import { Table, ITableColumn, SimpleTableCell, TableColumnLayout, ColumnSorting, SortOrder } from "azure-devops-ui/Table";
import { RelDate } from "./RelDate";
import { LatestRelease } from "./LatestRelease";
import { Tooltip } from "azure-devops-ui/TooltipEx";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { Tree, ExpandableTreeCell, ITreeColumn } from "azure-devops-ui/TreeEx";
import { ITreeItem, TreeItemProvider } from "azure-devops-ui/Utilities/TreeItemProvider";
import { ListSelection } from "azure-devops-ui/List";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { BrowseState, parse, serialize } from "./lib/browseState";
import { breadcrumbs, findReadme, needsFolderFetch, type GitTree, type TreeEntry } from "./lib/tree";
import { filterBranches, pathAfterSwitch } from "./lib/branchSwitch";
import { classifyFile, monacoLanguage, type FileKind } from "./lib/fileKind";
import { sortListing } from "./lib/listing";
import { commitUrl, type CommitInfo } from "./lib/commits";
import { githubUrl } from "./lib/githubUrl";
import { prepareMarkdownHtml, type PreparedMarkdown } from "./lib/markdown";
import { watchTheme } from "./theme";
import { loadProject } from "./connections";
import { mergeRows } from "./lib/rows";
import { isGitHubDotCom, parseRepoUrl } from "./lib/repoUrl";
import { GhError, findEntry, getBlob, getRaw, getRenderedMarkdown, getCommits, getRepo, getTree, getViewerLogin, getWriteContext, listBranches, listDir, pathExistsOn, renderMarkdown } from "./githubBrowse";
import { IconSize } from "azure-devops-ui/Icon";
import { FileIcon, RepoIcon } from "./fileIcons";
import { FindBox, type Crumb } from "./FindBox";
import { CodeSearchBox } from "./CodeSearchBox";
import { BlameTab, CompareTab, HistoryTab } from "./FileTabs";
import { applyAgainst, resolveTab, tabsFor, type FileTab } from "./lib/fileTabs";
import { compareBaseFor } from "./lib/compareHash";
import { openHub, patchHash, repoHubHref, useHashExtras } from "./hostNav";
import { applyEditFlag } from "./lib/editHash";
import { EditPane, WriteDialogs, type WriteDialog } from "./FileWrites";
import { decodeForEdit, treeLookup, validatePath, type CommitPlan, type WriteContext } from "./lib/fileCommit";
import { branchRowNewPrHash } from "./lib/newPrHash";
import { useRefWrites } from "./refWrites";
import { usePrefs } from "./prefs";
import { Toast } from "azure-devops-ui/Toast";
import { CloneButton } from "./CloneButton";
import { archiveUrl, cloneUrls, type CloneUrls } from "./lib/cloneUrls";
import { copyLinkText, selectionLines, withLines, type LineRange } from "./lib/lineHash";
import "./browser.css";

const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const hashFor = (s: BrowseState) => serialize(s);

/** Plain left-clicks navigate in the hub; modified clicks keep the link's normal behaviour. */
export const hubClick = (go: () => void) => (e?: React.MouseEvent | React.KeyboardEvent) => {
  if (e && (("button" in e && e.button !== 0) || e.ctrlKey || e.metaKey || e.shiftKey)) return;
  e?.preventDefault();
  go();
};

// ---------- errors (B-11) ----------

/** `subject` / `permission` reword the sign-in and no-access messages for other pages (the PR list); `back` is left out to hide "Back to repositories". */
export function ErrorView({ err, signIn, busy, retry, back, subject = "browse this repository", permission = "Contents" }: { err: unknown; signIn: () => void; busy: boolean; retry: () => void; back?: () => void; subject?: string; permission?: string }) {
  const kind = err instanceof GhError ? err.kind : "other";
  if (kind === "auth")
    return (
      <MessageCard severity={MessageCardSeverity.Info} buttonProps={[{ text: "Sign in with GitHub", onClick: signIn, primary: true, disabled: busy }]}>
        Sign in with GitHub to {subject}.
      </MessageCard>
    );
  if (kind === "access")
    return (
      <MessageCard severity={MessageCardSeverity.Error} buttonProps={[...(back ? [{ text: "Back to repositories", onClick: back }] : []), { text: "Sign in again", onClick: signIn, disabled: busy }]}>
        You don't have access, or the GitHub App lacks {permission} permission. Sign out and sign in again after the app is updated.
      </MessageCard>
    );
  if (kind === "rateLimit") {
    const at = (err as GhError).resetAt;
    return (
      <MessageCard severity={MessageCardSeverity.Warning} buttonProps={[{ text: "Try again", onClick: retry }]}>
        GitHub's rate limit has been reached{at ? `. It resets at ${at.toLocaleTimeString()}` : ""}.
      </MessageCard>
    );
  }
  return (
    <MessageCard severity={MessageCardSeverity.Error} buttonProps={[{ text: "Try again", onClick: retry }, ...(back ? [{ text: "Back to repositories", onClick: back }] : [])]}>
      Could not load this from GitHub.
    </MessageCard>
  );
}

// ---------- rendered markdown with authenticated images ----------

export function Markdown({ prepared, repo, refName, go }: { prepared: PreparedMarkdown; repo: string; refName: string; go: (s: BrowseState) => void }) {
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const urls: string[] = [];
    let dead = false;
    const imgs = Array.from(box.current?.querySelectorAll<HTMLImageElement>("img[data-repo-path]") ?? []);
    // ponytail: at most 50 unique repo images per document, so a hostile README can't spend the hourly GitHub quota; the rest keep their alt text. Raise it if real READMEs hit it.
    prepared.images.slice(0, 50).forEach(async (path) => {
      try {
        const blob = await getBlob(repo, refName, path);
        if (dead) return;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const mine = imgs.filter((i) => i.getAttribute("data-repo-path") === path);
        // An SVG blob URL opened in a new tab would run its script on our origin, so drop it once every <img> using it has loaded.
        let left = mine.length;
        const done = () => --left === 0 && URL.revokeObjectURL(url);
        mine.forEach((img) => {
          if (blob.type === "image/svg+xml") img.onload = img.onerror = done;
          img.src = url;
        });
      } catch {
        /* leave the alt text */
      }
    });
    return () => {
      dead = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [prepared, repo, refName]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!a || !href?.startsWith("#") || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    if (href.startsWith("#repo=")) return go(parse(href));
    let id: string;
    try {
      id = decodeURIComponent(href.slice(1)); // in-page anchor; GitHub prefixes heading ids
    } catch {
      return; // malformed fragment such as "#%"
    }
    (box.current?.querySelector(`[id="user-content-${CSS.escape(id)}"], [id="${CSS.escape(id)}"]`) as HTMLElement | null)?.scrollIntoView();
  };

  // prepared.html has been through prepareMarkdownHtml (DOMPurify + link/image rewriting); nothing else goes in here.
  return <div ref={box} className="gh-markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: prepared.html }} />;
}

// ---------- code (B-5) ----------

// Monaco's JS is a lazy chunk, and esbuild doesn't link a lazy chunk's CSS into the page, so add monaco.css (next to hub.html) once.
let monacoReady: Promise<typeof import("./monacoChunk")> | undefined;
export function loadMonaco() {
  return (monacoReady ??= (async () => {
    const css = new Promise<void>((done) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("monaco.css", document.baseURI).href;
      link.onload = link.onerror = () => done();
      document.head.appendChild(link);
    });
    const [m] = await Promise.all([import("./monacoChunk"), css]);
    return m;
  })().catch((e) => ((monacoReady = undefined), Promise.reject(e))));
}

/** `lines` (from a link) are tinted and scrolled to; `onSelect` hears each selection the user makes, for "Copy link to lines". */
function CodeView({ text, name, dark, lines, onSelect }: { text: string; name: string; dark: boolean; lines?: LineRange | null; onSelect?: (r: LineRange) => void }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [failed, setFailed] = React.useState(false);
  const [ready, setReady] = React.useState(0);
  const editor = React.useRef<ReturnType<typeof import("./monacoChunk")["createViewer"]> | null>(null);
  const select = React.useRef(onSelect);
  select.current = onSelect;
  React.useEffect(() => {
    let dead = false;
    let sub: { dispose(): void } | undefined;
    loadMonaco()
      .then((m) => {
        if (dead || !box.current) return;
        const ed = (editor.current = m.createViewer(box.current, text, monacoLanguage(name), dark, name));
        sub = m.onUserSelection(ed, (s) => select.current?.(selectionLines(s)));
        setReady((n) => n + 1);
      })
      .catch(() => !dead && setFailed(true));
    return () => {
      dead = true;
      sub?.dispose();
      editor.current?.dispose();
      editor.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theme changes are handled below without recreating the editor
  }, [text, name]);
  React.useEffect(() => {
    if (editor.current) void loadMonaco().then((m) => m.setTheme(dark));
  }, [dark]);
  const [from, to] = [lines?.line ?? 0, lines?.lineEnd ?? 0];
  React.useEffect(() => {
    const ed = editor.current;
    if (!ed || !from) return;
    let clear: (() => void) | undefined;
    void loadMonaco().then((m) => { if (editor.current === ed) clear = m.highlightLines(ed, from, to); });
    return () => clear?.();
  }, [ready, from, to]);
  // If Monaco can't load, still show the text rather than nothing.
  return failed ? <pre className="gh-plain">{text}</pre> : <div ref={box} className="gh-code" />;
}

// ---------- the pieces of the file view ----------

const CardFill = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <Card className={`no-padding gh-card-fill ${className ?? ""}`} contentProps={{ contentPadding: false }}>{children}</Card>
);

function CantPreview({ why, repo, refName, path, name, onDownload }: { why: string; repo: string; refName: string; path: string; name: string; onDownload: () => void }) {
  return (
    <div className="gh-cant-preview">
      <div role="status">
        <h3 className="gh-h3">Can't preview {name}</h3>
        <p>{why}</p>
      </div>
      <ButtonGroup>
        <Button text="Download" iconProps={{ iconName: "Download" }} primary onClick={onDownload} />
        <Button text="Open on GitHub" iconProps={{ iconName: "OpenInNewTab" }} onClick={() => window.open(githubUrl(repo, refName, path, true), "_blank", "noopener")} />
      </ButtonGroup>
    </div>
  );
}

function ImageView({ repo, refName, path }: { repo: string; refName: string; path: string }) {
  const [src, setSrc] = React.useState<{ url: string; svg: boolean }>();
  const [bad, setBad] = React.useState(false);
  React.useEffect(() => {
    let url: string | undefined;
    let dead = false;
    setSrc(undefined);
    setBad(false);
    getBlob(repo, refName, path)
      .then((b) => !dead && (url = URL.createObjectURL(b)) && setSrc({ url, svg: b.type === "image/svg+xml" }))
      .catch(() => !dead && setBad(true));
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [repo, refName, path]);
  if (bad) return <MessageCard severity={MessageCardSeverity.Error}>Could not load this image.</MessageCard>;
  // Revoke an SVG's blob URL once drawn, so "Open image in new tab" can't run its script on our origin.
  return src ? (
    <img className="gh-image" src={src.url} alt={baseOf(path)} onLoad={src.svg ? () => URL.revokeObjectURL(src.url) : undefined} />
  ) : (
    <Spinner size={SpinnerSize.large} ariaLabel="Loading image" />
  );
}

type FileData = { entry: TreeEntry; kind: FileKind; text?: string; md?: PreparedMarkdown };

function FileView({ f, repo, refName, dark, go, tab, lines, onSelect }: { f: FileData; repo: string; refName: string; dark: boolean; go: (s: BrowseState) => void; tab: string; lines?: LineRange | null; onSelect?: (r: LineRange) => void }) {
  // A markdown file's Contents tab shows its source, which the rendered-HTML fetch doesn't have.
  const source = f.kind === "markdown" && tab === "contents";
  const [rawText, setRawText] = React.useState<string>();
  React.useEffect(() => setRawText(undefined), [f.entry.path, refName]);
  React.useEffect(() => {
    if (!source || rawText !== undefined) return;
    let dead = false;
    getRaw(repo, refName, f.entry.path).then((b) => !dead && setRawText(new TextDecoder().decode(b)), () => !dead && setRawText("Could not load the raw text."));
    return () => {
      dead = true;
    };
  }, [source, rawText, repo, refName, f.entry.path]);

  const download = async () => {
    const url = URL.createObjectURL(await getBlob(repo, refName, f.entry.path));
    const a = document.createElement("a");
    a.href = url;
    a.download = f.entry.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const cant = (why: string) => <CardFill><CantPreview why={why} repo={repo} refName={refName} path={f.entry.path} name={f.entry.name} onDownload={download} /></CardFill>;

  if (f.kind === "image") return <CardFill className="gh-card-image"><ImageView repo={repo} refName={refName} path={f.entry.path} /></CardFill>;
  if (f.kind === "binary") return cant("This is a binary file.");
  if (f.kind === "tooLarge") return cant("This file is too large to preview.");
  if (f.kind === "markdown" && !source) return <Card className="no-padding gh-readme" contentProps={{ contentPadding: false }}><Markdown prepared={f.md!} repo={repo} refName={refName} go={go} /></Card>;
  if (f.kind === "markdown")
    return <CardFill>{rawText === undefined ? <Spinner size={SpinnerSize.large} ariaLabel="Loading" /> : <CodeView text={rawText} name={f.entry.name} dark={dark} lines={lines} onSelect={onSelect} />}</CardFill>;
  return <CardFill><CodeView text={f.text ?? ""} name={f.entry.name} dark={dark} lines={lines} onSelect={onSelect} /></CardFill>;
}

// ---------- listing ----------

/** `entries` undefined while the folder loads: shimmer rows in the same columns. */
function Listing({ entries, go, repo, refName, folder, menu }: { entries: TreeEntry[] | undefined; go: (path: string) => void; repo: string; refName: string; folder: string; menu: (e: TreeEntry) => IMenuItem[] }) {
  // Names show at once; commit info fills in after. A failed lookup just leaves those cells blank.
  const [commits, setCommits] = React.useState<Record<string, CommitInfo>>({});
  React.useEffect(() => {
    let dead = false;
    setCommits({});
    if (!entries) return;
    getCommits(repo, refName, folder, entries).then((c) => !dead && setCommits(c), () => {});
    return () => { dead = true; };
  }, [entries, repo, refName, folder]);
  const [dir, setDir] = React.useState<"asc" | "desc">("asc");
  const sorted = React.useMemo(() => entries ? new ArrayItemProvider(sortListing(entries, dir)) : skeletonRows<TreeEntry>(), [entries, dir, commits]); // a new provider when commits arrive makes Table redraw its cells
  const sorting = React.useMemo(() => new ColumnSorting<TreeEntry>((_i, order) => setDir(order === SortOrder.descending ? "desc" : "asc")), []);
  const columns = React.useMemo<ITableColumn<TreeEntry>[]>(
    () => [
      {
        id: "name",
        name: "Name",
        width: -35,
        columnLayout: TableColumnLayout.singleLinePrefix,
        sortProps: { ariaLabelAscending: "Sorted A to Z", ariaLabelDescending: "Sorted Z to A", sortOrder: dir === "asc" ? SortOrder.ascending : SortOrder.descending },
        renderCell: (_r, columnIndex, tableColumn, e) => (
          <SimpleTableCell key="name" columnIndex={columnIndex} tableColumn={tableColumn}>
            <span className="gh-entry-icon"><FileIcon name={e.name} kind={e.kind} /></span>
            {e.kind === "submodule" ? (
              <span className="gh-submodule">{e.name} <span className="secondary-text">(submodule)</span></span>
            ) : (
              <Link className="bolt-table-link" subtle removeUnderline href={hashFor({ repo, ref: refName, path: e.path })} onClick={hubClick(() => go(e.path))}>{e.name}</Link>
            )}
          </SimpleTableCell>
        ),
      },
      {
        id: "changed",
        name: "Last change",
        width: -20,
        renderCell: (_r, columnIndex, tableColumn, e) => {
          const c = commits[e.path];
          return <SimpleTableCell key="changed" columnIndex={columnIndex} tableColumn={tableColumn}>{c && <RelDate date={c.date} />}</SimpleTableCell>;
        },
      },
      {
        id: "commits",
        name: "Commits",
        width: -45,
        renderCell: (_r, columnIndex, tableColumn, e) => {
          const c = commits[e.path];
          return (
            <SimpleTableCell key="commits" columnIndex={columnIndex} tableColumn={tableColumn}>
              {c && (
                <div className="gh-commit">
                  <Link className="gh-commit-sha" subtle href={commitUrl(repo, c.sha)} target="_blank" rel="noopener noreferrer">{c.shortSha}</Link>
                  <Tooltip text={c.headline} overflowOnly><span className="gh-commit-msg">{c.headline}</span></Tooltip>
                  {c.author && <span className="gh-commit-author secondary-text">{c.author}</span>}
                </div>
              )}
            </SimpleTableCell>
          );
        },
      },
      {
        id: "more",
        name: "",
        width: 40,
        columnLayout: TableColumnLayout.none,
        renderCell: (_r, columnIndex, tableColumn, e) => {
          const items = menu(e);
          return (
            <SimpleTableCell key="more" columnIndex={columnIndex} tableColumn={tableColumn}>
              {items.length > 0 && <MoreButton ariaLabel={`Actions for ${e.name}`} contextualMenuProps={{ menuProps: { id: `gh-entry-menu-${e.path}`, items } }} />}
            </SimpleTableCell>
          );
        },
      },
    ],
    [go, repo, refName, dir, commits, menu]
  );
  if (entries && !entries.length) return <ZeroData iconProps={{ iconName: "FabricFolder" }} imageAltText="" primaryText="This folder is empty" />;
  return (
    <Card className="bolt-table-card" contentProps={{ contentPadding: false }}>
      <Table<TreeEntry> ariaLabel={entries ? "Folder contents" : "Loading folder contents"} columns={columns} itemProvider={sorted} behaviors={[sorting]} role="table" />
    </Card>
  );
}

function Readme({ entries, repo, refName, go }: { entries: TreeEntry[]; repo: string; refName: string; go: (s: BrowseState) => void }) {
  const readme = findReadme(entries);
  const [prepared, setPrepared] = React.useState<PreparedMarkdown>();
  React.useEffect(() => {
    setPrepared(undefined);
    if (!readme) return;
    let dead = false;
    getRenderedMarkdown(repo, refName, readme.path)
      .then((html) => !dead && setPrepared(prepareMarkdownHtml(html, { owner: repo.split("/")[0], name: repo.split("/")[1], ref: refName, dir: dirOf(readme.path) })))
      .catch(() => {}); // a README that won't load is not worth an error banner
    return () => {
      dead = true;
    };
  }, [readme?.path, repo, refName]);
  if (!readme || !prepared) return null;
  return (
    <Card className="no-padding gh-readme" contentProps={{ contentPadding: false }}>
      <Markdown prepared={prepared} repo={repo} refName={refName} go={go} />
    </Card>
  );
}

// ---------- tree (left) ----------

function FolderTree({ repo, tree, folder, current, go, onEntries }: { repo: string; tree: GitTree; folder: string; current: string; go: (path: string) => void; onEntries: (e: TreeEntry[]) => void }) {
  const provider = React.useMemo(() => new TreeItemProvider<TreeEntry>(), [tree]);
  const selection = React.useMemo(() => new ListSelection({ selectOnFocus: false }), [tree]);
  // Per-provider bookkeeping: which folders' children are already in the provider.
  const known = React.useMemo(() => ({ items: new Map<string, ITreeItem<TreeEntry>>(), loading: new Map<string, Promise<void>>() }), [tree]);
  const currentRef = React.useRef(current);
  currentRef.current = current;

  // Which folders have anything in them, so an empty folder shows no expander. A truncated tree can't say, so every folder is expandable.
  const nonEmpty = React.useMemo(() => new Set(tree.tree.map((i) => dirOf(i.path))), [tree]);

  const highlight = React.useCallback(() => {
    const i = provider.value.findIndex((x) => x.underlyingItem.id === currentRef.current);
    selection.clear();
    if (i >= 0) selection.select(i);
  }, [provider, selection]);

  const fetchKids = React.useCallback(
    async (path: string) => {
      const kids = await listDir(repo, tree, path);
      onEntries(kids);
      const nodes: ITreeItem<TreeEntry>[] = kids.map((e) => {
        const expandable = e.kind === "folder" && (needsFolderFetch(tree, e.path) || nonEmpty.has(e.path));
        // Tree only treats a row as expandable-while-empty when its data says `folder`.
        const it: ITreeItem<TreeEntry> = { id: e.path, data: { ...e, folder: e.kind === "folder" } as TreeEntry, childItems: expandable ? [] : undefined };
        known.items.set(e.path, it);
        return it;
      });
      provider.splice(path ? known.items.get(path) : undefined, undefined, [{ items: nodes }]);
    },
    [provider, known, repo, tree, nonEmpty, onEntries]
  );
  const load = React.useCallback(
    (path: string) => {
      let p = known.loading.get(path);
      if (!p) known.loading.set(path, (p = fetchKids(path).catch((e) => (known.loading.delete(path), Promise.reject(e))))); // a failure can be retried
      return p;
    },
    [known, fetchKids]
  );

  // Load the root, then open the folders down to the current one.
  React.useEffect(() => {
    let dead = false;
    (async () => {
      try {
        await load("");
        for (const c of breadcrumbs(folder)) {
          if (dead) return;
          await load(c.path);
          const it = known.items.get(c.path);
          if (it && !it.expanded) provider.expand(it);
        }
        if (!dead) highlight();
      } catch {
        /* the content pane reports errors; the tree just stays shallow */
      }
    })();
    return () => {
      dead = true;
    };
  }, [provider, known, folder, current, load, highlight]);

  const columns = React.useMemo<ITreeColumn<TreeEntry>[]>(
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
            </ExpandableTreeCell>
          );
        },
      },
    ],
    []
  );

  const onToggle = async (_e: React.SyntheticEvent, ex: { underlyingItem: ITreeItem<TreeEntry> }) => {
    const it = ex.underlyingItem;
    if (!it.expanded) {
      try {
        await load(it.data.path);
      } catch {
        return;
      }
    }
    provider.toggle(it);
    highlight();
  };

  return (
    <Tree<TreeEntry>
      ariaLabel="Files"
      className="gh-tree"
      columns={columns}
      // the provider's observable typing is narrower than Tree's prop type
      itemProvider={provider as any}
      selection={selection}
      onToggle={onToggle}
      onActivate={(_e, row) => {
        const n = row.data.underlyingItem.data;
        if (n.kind !== "submodule") go(n.path);
        // The row is selected on click, before go() runs; if the unsaved-edit guard keeps you where you are, put the
        // highlight back on the open file (seen live in 0.32.1: Keep editing left the clicked file highlighted).
        setTimeout(highlight, 0);
      }}
      singleClickActivation
      showHeader={false}
      showLines={false}
      scrollable
      role="tree"
    />
  );
}

// ---------- branch picker ----------

export function BranchPicker({ refName, items, loading, onOpen, setQuery, onSelect }: { refName: string; items: { id: string; text: string }[]; loading: boolean; onOpen: () => void; setQuery: (q: string) => void; onSelect: (b: string) => void }) {
  return (
    <Dropdown
      ariaLabel={`Branch: ${refName}`}
      className="gh-branch"
      minCalloutWidth={280}
      placeholder={refName || "Branch"}
      items={items}
      showFilterBox
      filterByText={false}
      filterPlaceholderText="Find a branch"
      noItemsText={loading ? "Loading branches" : "No branches"}
      filteredNoResultsText="No matching branches"
      onFilterTextChanged={(_e, v) => setQuery(v)}
      onExpand={onOpen}
      onCollapse={() => setQuery("")}
      onSelect={(_e, item) => onSelect(item.id)}
      renderExpandable={(p) => <DropdownExpandableButton {...p} subtle iconProps={{ iconName: "BranchFork2", size: IconSize.medium }} />}
    />
  );
}

// ---------- repo switcher (left pane header) ----------

/** The project's connected github.com repos as "owner/name", from the same (cached) load as the list view. */
export function useConnectedRepos(current: string): string[] | undefined {
  const [repos, setRepos] = React.useState<string[]>();
  React.useEffect(() => {
    let dead = false;
    loadProject().then(
      (p) => !dead && setRepos(mergeRows(p.connections).rows.filter((r) => { const ref = parseRepoUrl(r.url); return ref && isGitHubDotCom(ref); }).map((r) => r.label)),
      () => !dead && setRepos([])
    );
    return () => { dead = true; };
  }, []);
  return repos && (repos.some((r) => r.toLowerCase() === current.toLowerCase()) ? repos : [current, ...repos]);
}

/** `compact` is the page-header form: a normal subtle button with a repo icon instead of the left pane's 17px title. */
export function RepoSwitcher({ repo, openTick, onPick, compact }: { repo: string; openTick: number; onPick: (r: string) => void; compact?: boolean }) {
  const repos = useConnectedRepos(repo);
  const dd = React.useRef<Dropdown>(null);
  // The header breadcrumb asks for the switcher through the hash (see hostNav); each request bumps openTick.
  React.useEffect(() => { if (openTick) dd.current?.expand(); }, [openTick]);
  return (
    <Dropdown
      ref={dd}
      ariaLabel={`Repository: ${repo}. Switch repository`}
      className={compact ? "gh-repo-switch gh-repo-switch-compact" : "gh-repo-switch flex-grow"}
      minCalloutWidth={280}
      placeholder={repo}
      items={(repos ?? []).map((r) => ({ id: r, text: r }))}
      showFilterBox
      filterPlaceholderText="Find a repository"
      noItemsText={repos ? "No repositories" : "Loading repositories"}
      filteredNoResultsText="No matching repositories"
      onSelect={(_e, item) => item.id !== repo && onPick(item.id)}
      renderExpandable={(p) => <DropdownExpandableButton {...p} subtle iconProps={compact ? { iconName: "Code" } : undefined} />}
    />
  );
}

// ---------- the browser ----------

type Ctx = { ref: string; defaultBranch: string; tree: GitTree; write: WriteContext | null; clone: CloneUrls };

/** The Edit pane's Preview tab: GitHub renders the unsaved text (POST /markdown), through the same sanitiser and renderer as the Preview tab. */
function MarkdownPreview({ text, repo, refName, dir, go }: { text: string; repo: string; refName: string; dir: string; go: (s: BrowseState) => void }) {
  const [prepared, setPrepared] = React.useState<PreparedMarkdown | null>();
  React.useEffect(() => {
    let dead = false;
    setPrepared(undefined);
    renderMarkdown(repo, text).then(
      (html) => !dead && setPrepared(prepareMarkdownHtml(html, { owner: repo.split("/")[0], name: repo.split("/")[1], ref: refName, dir })),
      () => !dead && setPrepared(null)
    );
    return () => { dead = true; };
  }, [text, repo, refName, dir]);
  if (prepared === null) return <MessageCard severity={MessageCardSeverity.Error}>Could not render the preview.</MessageCard>;
  if (!prepared) return <Spinner size={SpinnerSize.large} ariaLabel="Rendering preview" />;
  if (!text.trim()) return <ZeroData iconProps={{ iconName: "Preview" }} imageAltText="" primaryText="Nothing to preview" />;
  return (
    <Card className="no-padding gh-readme gh-edit-preview" contentProps={{ contentPadding: false }}>
      <Markdown prepared={prepared} repo={repo} refName={refName} go={go} />
    </Card>
  );
}
type View =
  | { t: "loading" }
  | { t: "error"; err: unknown }
  | { t: "missing" }
  | { t: "folder"; entries: TreeEntry[] }
  | { t: "submodule"; entry: TreeEntry }
  | { t: "file"; f: FileData };

export interface BrowserProps {
  state: BrowseState & { repo: string };
  go: (s: BrowseState) => void;
  /** Bumped each time the header breadcrumb asks for the repo switcher. */
  openSwitch: number;
  signedIn: boolean;
  signIn: () => Promise<void>;
  busy: boolean;
  commandBarItems: { id: string; text: string; iconProps?: { iconName: string }; isPrimary?: boolean; disabled?: boolean; onActivate: () => void }[];
}

const TAB_NAMES: Record<FileTab, string> = { contents: "Contents", preview: "Preview", history: "History", compare: "Compare", blame: "Blame" };

const WIDTH_KEY = "gh.leftPaneWidth";
const readWidth = () => {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n >= 200 && n <= 700 ? n : 300;
  } catch {
    return 300;
  }
};

export function RepoBrowser({ state, go, openSwitch, signedIn, signIn, busy, commandBarItems }: BrowserProps) {
  const { repo } = state;
  const path = state.path ?? "";
  const [reload, setReload] = React.useState(0);
  const [ctx, setCtx] = React.useState<Ctx | null>(null);
  const [ctxErr, setCtxErr] = React.useState<unknown>(null);
  const [view, setView] = React.useState<View>({ t: "loading" });
  const [dark, setDark] = React.useState(false);
  const [branches, setBranches] = React.useState<string[] | undefined>();
  const [query, setQuery] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const [leftWidth] = React.useState(readWidth);
  // Web edits (Edit, New file, Upload, Rename, Delete): see FileWrites.tsx.
  const writes = useRefWrites();
  const [dialog, setDialog] = React.useState<WriteDialog | null>(null);
  const [editing, setEditing] = React.useState<{ kind: "edit"; path: string; initial: string; bom: boolean } | { kind: "new"; dir: string } | null>(null);
  const [newPath, setNewPath] = React.useState("");
  const [loadingEdit, setLoadingEdit] = React.useState(false);
  const [committed, setCommitted] = React.useState<string | null>(null);
  const [login, setLogin] = React.useState("");
  const [sel, setSel] = React.useState<LineRange | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const flash = (m: string) => { clearTimeout(toastTimer.current); setToast(m); toastTimer.current = setTimeout(() => setToast(null), 3000); };
  React.useEffect(() => () => clearTimeout(toastTimer.current), []);
  const editText = React.useRef("");
  // In a truncated tree only the folders fetched so far are known; the finder searches those.
  const seen = React.useRef(new Set<string>());
  const [seenCount, setSeenCount] = React.useState(0);
  const noteEntries = React.useCallback((es: TreeEntry[]) => {
    const before = seen.current.size;
    es.forEach((e) => seen.current.add(e.path));
    if (seen.current.size !== before) setSeenCount(seen.current.size);
  }, []);

  React.useEffect(() => watchTheme(setDark), []);

  // Repo, ref and tree.
  React.useEffect(() => {
    let dead = false;
    setCtx(null);
    setCtxErr(null);
    setBranches(undefined);
    seen.current = new Set();
    setSeenCount(0);
    (async () => {
      try {
        const info = await getRepo(repo);
        const ref = state.ref ?? info.defaultBranch;
        // The head is read with the tree: a web edit commits against the head the page was loaded at. A failed lookup just means no edit actions.
        const [tree, write] = await Promise.all([getTree(repo, ref), getWriteContext(repo, ref).catch(() => null)]);
        if (!dead) setCtx({ ref, defaultBranch: info.defaultBranch, tree, write, clone: cloneUrls(repo, info) });
      } catch (e) {
        if (!dead) setCtxErr(e);
      }
    })();
    return () => {
      dead = true;
    };
  }, [repo, state.ref, signedIn, reload]);

  // What is at the path.
  React.useEffect(() => {
    if (!ctx) return;
    let dead = false;
    setView({ t: "loading" });
    (async () => {
      try {
        const { tree, ref } = ctx;
        if (path === "") return !dead && setView({ t: "folder", entries: await listDir(repo, tree, "") });
        const entry = await findEntry(repo, tree, path);
        if (dead) return;
        if (!entry) return setView({ t: "missing" });
        if (entry.kind === "folder") {
          const entries = await listDir(repo, tree, path);
          noteEntries(entries);
          return !dead && setView({ t: "folder", entries });
        }
        if (entry.kind === "submodule") return setView({ t: "submodule", entry });
        let kind = classifyFile(entry.name, entry.size ?? 0);
        const f: FileData = { entry, kind };
        if (kind === "markdown") {
          f.md = prepareMarkdownHtml(await getRenderedMarkdown(repo, ref, path), { owner: repo.split("/")[0], name: repo.split("/")[1], ref, dir: dirOf(path) });
        } else if (kind === "text") {
          const bytes = await getRaw(repo, ref, path);
          kind = f.kind = classifyFile(entry.name, entry.size ?? bytes.byteLength, new Uint8Array(bytes, 0, Math.min(8000, bytes.byteLength)));
          if (kind === "text") f.text = new TextDecoder().decode(bytes);
        }
        if (!dead) setView({ t: "file", f });
      } catch (e) {
        if (!dead) setView({ t: "error", err: e });
      }
    })();
    return () => {
      dead = true;
    };
  }, [ctx, path, repo, reload, noteEntries]);

  const refName = ctx?.ref ?? state.ref ?? "";
  const nav = React.useCallback((p: string) => go({ repo, ref: state.ref, path: p }), [go, repo, state.ref]);
  const toList = () => go({ view: "repos" });
  const isFile = view.t === "file";
  const err = ctxErr ?? (view.t === "error" ? view.err : null);

  // Leaving the path or branch drops an edit in progress; the page asks first when the editor is dirty (EditPane.cancel) and the browser asks when the page closes.
  const lastWhere = React.useRef(`${refName}:${path}`);
  React.useEffect(() => {
    const where = `${refName}:${path}`;
    if (lastWhere.current !== where) { lastWhere.current = where; setEditing(null); setSel(null); }
  }, [refName, path]);
  const cancelEdit = React.useCallback(() => setEditing(null), []);
  const write = ctx?.write;
  const canEdit = !!write?.canWrite && !!write.headOid;
  const lookup = React.useMemo(() => (ctx ? treeLookup(ctx.tree) : () => undefined), [ctx]);

  const openWrite = (d: WriteDialog) => {
    writes.clearError();
    openBranches();
    void getViewerLogin().then(setLogin, () => {});
    // After the ⋯ menu has closed and handed focus back to its button, or the dialog's autofocus would be undone by it.
    setTimeout(() => setDialog(d), 50);
  };
  const startNew = (dir: string) => { setCommitted(null); setNewPath(dir ? `${dir}/` : ""); editText.current = ""; setEditing({ kind: "new", dir }); };
  const startEdit = async () => {
    if (!ctx || view.t !== "file") return;
    setCommitted(null);
    setNotice(null);
    setLoadingEdit(true);
    try {
      const d = decodeForEdit(new Uint8Array(await getRaw(repo, ctx.ref, path)));
      if (d.ok) setEditing({ kind: "edit", path, initial: d.text, bom: d.bom });
      else setNotice("This file is not UTF-8 text, so it can't be edited here.");
    } catch {
      setNotice("Could not load the file for editing.");
    } finally {
      setLoadingEdit(false);
    }
  };
  const afterWrite = (plan: CommitPlan, goto?: string) => {
    setDialog(null);
    setEditing(null);
    if (plan.openPr) return void openHub("prs", branchRowNewPrHash(repo, plan.branch));
    setCommitted(`Committed to ${plan.branch}.`);
    setReload((n) => n + 1);
    if (goto !== undefined && goto !== path) nav(goto);
  };
  /** The ⋯ items of a folder (New file here, Upload here) or a file (Rename, Delete); none without push access to a branch. */
  const entryMenu = React.useCallback(
    (e: { path: string; kind: "file" | "folder" | "submodule" }): IMenuItem[] =>
      !canEdit || e.kind === "submodule" ? []
      : e.kind === "folder" ? [
        { id: "new", text: "New file here", iconProps: { iconName: "Add" }, disabled: writes.busy, onActivate: () => startNew(e.path) },
        { id: "upload", text: "Upload files here", iconProps: { iconName: "Upload" }, disabled: writes.busy, onActivate: () => openWrite({ kind: "upload", dir: e.path }) },
        ...(e.path ? [{ id: "deleteFolder", text: "Delete folder", iconProps: { iconName: "Delete" }, disabled: writes.busy, onActivate: () => openWrite({ kind: "deleteFolder", path: e.path }) }] : []),
      ] : [
        { id: "rename", text: "Rename", iconProps: { iconName: "Rename" }, disabled: writes.busy, onActivate: () => openWrite({ kind: "rename", path: e.path }) },
        { id: "delete", text: "Delete", iconProps: { iconName: "Delete" }, disabled: writes.busy, onActivate: () => openWrite({ kind: "delete", path: e.path }) },
      ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startNew and openWrite only use setters and refs
    [canEdit, writes.busy, repo]
  );

  const doSignIn = async () => {
    await signIn();
    setReload((n) => n + 1);
  };

  const openBranches = () => {
    if (!branches) listBranches(repo).then(setBranches, () => setBranches([]));
  };
  const switchBranch = async (next: string) => {
    if (!ctx || next === ctx.ref) return;
    setNotice(null);
    try {
      const t = await getTree(repo, next);
      const keep = needsFolderFetch(t, path) ? ((await pathExistsOn(repo, t, path)) ? path : "") : pathAfterSwitch(path, t);
      go({ repo, ref: next === ctx.defaultBranch ? undefined : next, path: keep, tab: keep === path ? state.tab : undefined });
    } catch {
      setNotice(`Could not switch to ${next}.`);
    }
  };

  const items = (filterBranches(branches ?? [], query, ctx?.defaultBranch) as string[]).map((b) => ({ id: b, text: b }));
  const crumbs: Crumb[] = breadcrumbs(path).map((c, i, all) => ({
    text: c.name,
    ...(i < all.length - 1 ? { href: hashFor({ repo, ref: state.ref, path: c.path }), onClick: hubClick(() => nav(c.path)) } : {}),
  }));
  const truncated = !!ctx && needsFolderFetch(ctx.tree, "");
  const allPaths = React.useMemo(
    () => (!ctx ? [] : truncated ? [...seen.current] : ctx.tree.tree.map((i) => i.path)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seenCount stands for the contents of the ref'd set
    [ctx, truncated, seenCount]
  );

  const isMd = classifyFile(baseOf(path), 0) === "markdown";
  // Folders get Contents and History; files add Compare and Blame. Until the path resolves, the root is a folder and anything else a file.
  const kind = view.t === "folder" || (view.t === "loading" && path === "") ? "folder" : "file";
  const hasTabs = view.t === "file" || view.t === "folder" || view.t === "loading";
  const tab = resolveTab(state.tab, kind, isMd && kind === "file");
  const { against, lines, edit: editAsked } = useHashExtras();
  const [prefs] = usePrefs();
  const compareWith = against ?? compareBaseFor(prefs.compareBase?.[repo], ctx?.defaultBranch, refName) ?? ctx?.defaultBranch ?? refName;
  const tabProps = { repo, urlRef: state.ref, refName, path, signedIn, signIn: () => void doSignIn(), busy };
  const showable = view.t === "file" && (view.f.kind === "text" || view.f.kind === "markdown"); // Blame and Compare need text
  // A selection in the Contents view, else the lines the page was opened at, give "Copy link to lines".
  const linkLines = view.t === "file" && tab === "contents" && showable ? sel ?? lines : null;
  const copyLink = async (r: LineRange | null) => {
    try {
      const p = await loadProject();
      await navigator.clipboard.writeText(withLines(repoHubHref(p.ctx, { repo, ref: state.ref, path, tab: r && isMd ? "contents" : state.tab }), r));
      flash("Link copied to the clipboard.");
    } catch {
      flash("Could not copy the link.");
    }
  };
  const downloadZip = () => window.open(archiveUrl(repo, refName), "_blank", "noopener");
  const zipItem: IMenuItem = { id: "zip", text: "Download repository as zip", iconProps: { iconName: "ZipFolder" }, disabled: !refName, onActivate: () => { downloadZip(); } };
  const hereItems = view.t === "file" || view.t === "folder" ? [
    ...(view.t === "file" ? [{ id: "link", text: copyLinkText(linkLines), iconProps: { iconName: "Link" }, onActivate: () => { void copyLink(linkLines); } }] : [zipItem]),
    ...entryMenu({ path, kind: view.t }),
  ] : [];
  const editable = canEdit && view.t === "file" && tab === "contents" && (view.f.kind === "text" || view.f.kind === "markdown") && !editing;
  // A link with edit=true (the Actions hub's "Edit" on a workflow) opens the file straight in the editor once it has loaded, then drops the key.
  React.useEffect(() => {
    if (!editAsked || !ctx || view.t === "loading") return;
    patchHash((h) => applyEditFlag(h, false));
    if (editable) void startEdit();
    else if (view.t === "file" && !editing) setNotice(canEdit ? "This file can't be edited here." : `You can't edit files on ${refName} here: your GitHub sign-in has no write access to it.`);
  }, [editAsked, ctx, view.t]); // eslint-disable-line react-hooks/exhaustive-deps
  const headerItems = editing ? [] : [
    ...(ctx ? [{ id: "clone", text: "Clone", important: true, renderButton: () => <CloneButton key="clone" urls={ctx.clone} /> }] : []),
    ...(editable ? [{ id: "edit", text: "Edit", important: true, iconProps: { iconName: "Edit" }, disabled: loadingEdit || writes.busy, onActivate: () => void startEdit() }] : []),
    ...(hereItems.length ? [{ id: "more", important: true, text: "More actions", renderButton: () => <MoreButton key="more" ariaLabel={`Actions for ${baseOf(path) || "the repository root"}`} contextualMenuProps={{ menuProps: { id: "gh-files-menu", items: hereItems } }} /> }] : []),
  ];
  const newProblem = editing?.kind === "new" ? validatePath(newPath, lookup) : null;
  const menuItems = [
    { id: "gh", text: "Open on GitHub", iconProps: { iconName: "OpenInNewTab" }, onActivate: () => { window.open(githubUrl(repo, refName || "HEAD", path, isFile), "_blank", "noopener"); } },
    { id: "zip", text: "Download as zip", iconProps: { iconName: "ZipFolder" }, disabled: !refName, onActivate: () => { downloadZip(); } },
    { id: "list", text: "All repositories", iconProps: { iconName: "Back" }, onActivate: toList },
    ...commandBarItems.map((c) => ({ id: c.id, text: c.text, iconProps: c.iconProps, disabled: c.disabled, onActivate: c.onActivate })),
  ];

  return (
    <Surface background={SurfaceBackground.neutral}>
      <div className="gh-shell">
        <Splitter
          className="bolt-page-grey"
          fixedElement={SplitterElementPosition.Near}
          initialFixedSize={leftWidth}
          minFixedSize={200}
          maxFixedSize={700}
          onFixedSizeChanged={(w) => {
            try {
              localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
            } catch {
              /* not remembered; still works */
            }
          }}
          nearElementClassName="gh-left"
          farElementClassName="gh-right"
          onRenderNearElement={() => (
            <nav className="gh-left-inner flex-column" aria-label="Repository files">
              <div className="repos-file-explorer-header flex-row flex-center body-xl">
                <RepoIcon />
                <RepoSwitcher repo={repo} openTick={openSwitch} onPick={(r) => go({ repo: r })} />
                <MoreButton ariaLabel="Repository actions" contextualMenuProps={{ menuProps: { id: "gh-repo-menu", items: menuItems } }} />
              </div>
              <LatestRelease repo={repo} signedIn={signedIn} />
              <div className="gh-tree-wrap">
                {ctx && <FolderTree repo={repo} tree={ctx.tree} folder={isFile ? dirOf(path) : path} current={path} go={nav} onEntries={noteEntries} />}
              </div>
            </nav>
          )}
          onRenderFarElement={() => (
            <Page className="gh-page flex-grow">
              <div className="gh-topbar flex-row flex-center flex-noshrink">
                <BranchPicker refName={refName} items={items} loading={!branches} onOpen={openBranches} setQuery={setQuery} onSelect={(b) => void switchBranch(b)} />
                {ctx && <FindBox crumbs={crumbs} paths={allPaths} partial={truncated} onPick={nav} />}
                {!ctx && !err && <Spinner size={SpinnerSize.medium} ariaLabel="Loading repository" />}
                {!ctx && <div className="flex-grow" />}
                <CodeSearchBox state={state} />
              </div>
              {err ? (
                <div className="page-content page-content-top">
                  <ErrorView err={err} signIn={doSignIn} busy={busy} retry={() => setReload((n) => n + 1)} back={toList} />
                </div>
              ) : (
                ctx && (
                  <>
                    {/* In azure-devops-ui 2.281 the 21px/600 title (class title-m) is TitleSize.Large; TitleSize.Medium renders 17px/400. */}
                    <Header className="repos-files-header" title={path === "" ? "Files" : baseOf(path)} titleSize={TitleSize.Large} titleAriaLevel={1} commandBarItems={headerItems} />
                    <TabBar
                      ariaLabel="View"
                      selectedTabId={tab}
                      onSelectedTabChanged={(id) => go({ repo, ref: state.ref, path, tab: id })}
                      tabSize={TabSize.Tall}
                      disableSticky
                    >
                      {(hasTabs ? tabsFor(kind, isMd && kind === "file") : (["contents"] as FileTab[])).map((t) => <Tab key={t} id={t} name={TAB_NAMES[t]} />)}
                    </TabBar>
                    <div className="page-content page-content-top gh-body flex-column">
                      {notice && <MessageCard severity={MessageCardSeverity.Warning} onDismiss={() => setNotice(null)}>{notice}</MessageCard>}
                      {committed && <MessageCard severity={MessageCardSeverity.Info} onDismiss={() => setCommitted(null)}>{committed}</MessageCard>}
                      {writes.error && !dialog && <MessageCard severity={MessageCardSeverity.Error} onDismiss={writes.clearError}>{writes.error}</MessageCard>}
                      {editing && (
                        <EditPane
                          key={editing.kind === "edit" ? editing.path : `new:${editing.dir}`}
                          loadMonaco={loadMonaco}
                          name={editing.kind === "edit" ? baseOf(editing.path) : null}
                          dir={editing.kind === "new" ? editing.dir : ""}
                          initial={editing.kind === "edit" ? editing.initial : ""}
                          dark={dark}
                          path={newPath}
                          setPath={setNewPath}
                          pathProblem={newProblem}
                          busy={writes.busy}
                          target={editing.kind === "edit" ? editing.path : newPath || "the new file"}
                          setText={(t) => { editText.current = t; }}
                          cancel={cancelEdit}
                          renderPreview={classifyFile(baseOf(editing.kind === "edit" ? editing.path : newPath.trim()), 0) === "markdown" ? (t) => <MarkdownPreview text={t} repo={repo} refName={ctx.ref} dir={dirOf(editing.kind === "edit" ? editing.path : newPath.trim())} go={go} /> : undefined}
                          commit={() => openWrite(editing.kind === "edit" ? { kind: "edit", path: editing.path, text: editText.current, original: editing.initial, bom: editing.bom } : { kind: "new", path: newPath, text: editText.current })}
                        />
                      )}
                      {view.t === "loading" && (kind === "folder" && tab !== "history" ? <Listing entries={undefined} go={nav} repo={repo} refName={refName} folder={path} menu={entryMenu} /> : <Spinner size={SpinnerSize.large} ariaLabel="Loading" />)}
                      {view.t === "missing" && (
                        <MessageCard severity={MessageCardSeverity.Warning} buttonProps={[{ text: "Go to the repository root", onClick: () => nav("") }]}>
                          This path doesn't exist on {ctx.ref}.
                        </MessageCard>
                      )}
                      {view.t === "submodule" && <MessageCard severity={MessageCardSeverity.Info}>{view.entry.name} is a submodule, which can't be opened here.</MessageCard>}
                      {view.t === "folder" && tab === "history" && <HistoryTab {...tabProps} />}
                      {view.t === "folder" && tab !== "history" && !editing && (
                        <>
                          <Listing entries={view.entries} go={nav} repo={repo} refName={ctx.ref} folder={path} menu={entryMenu} />
                          <Readme entries={view.entries} repo={repo} refName={ctx.ref} go={go} />
                        </>
                      )}
                      {view.t === "file" && tab === "history" && <HistoryTab {...tabProps} />}
                      {view.t === "file" && (tab === "blame" || tab === "compare") && !showable && <MessageCard severity={MessageCardSeverity.Info}>{tab === "blame" ? "Blame" : "Compare"} is only available for text files.</MessageCard>}
                      {view.t === "file" && tab === "blame" && showable && <BlameTab {...tabProps} dark={dark} />}
                      {view.t === "file" && tab === "compare" && showable && (
                        <CompareTab {...tabProps} dark={dark} against={compareWith} defaultBranch={ctx.defaultBranch} setAgainst={(r) => patchHash((h) => applyAgainst(h, r))} />
                      )}
                      {view.t === "file" && (tab === "contents" || tab === "preview") && !editing && <FileView f={view.f} repo={repo} refName={ctx.ref} dark={dark} go={go} tab={tab} lines={lines} onSelect={setSel} />}
                    </div>
                  </>
                )
              )}
            </Page>
          )}
        />
      </div>
      {toast && <Toast message={toast} />}
      {dialog && ctx?.write && (
        <WriteDialogs
          dialog={dialog}
          repo={repo}
          branch={ctx.ref}
          write={ctx.write}
          tree={ctx.tree}
          branches={branches}
          viewerLogin={login}
          writes={writes}
          close={() => { if (!writes.busy) { setDialog(null); writes.clearError(); } }}
          done={afterWrite}
          reload={() => { setDialog(null); setEditing(null); writes.clearError(); setReload((n) => n + 1); }}
        />
      )}
    </Surface>
  );
}

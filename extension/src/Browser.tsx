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
import { MoreButton } from "azure-devops-ui/Menu";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { Splitter, SplitterElementPosition } from "azure-devops-ui/Splitter";
import { Table, ITableColumn, SimpleTableCell, ColumnSorting, SortOrder } from "azure-devops-ui/Table";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { Tree, ExpandableTreeCell, ITreeColumn } from "azure-devops-ui/TreeEx";
import { ITreeItem, TreeItemProvider } from "azure-devops-ui/Utilities/TreeItemProvider";
import { ListSelection } from "azure-devops-ui/List";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { BrowseState, parse, serialize } from "./lib/browseState";
import { breadcrumbs, findReadme, needsFolderFetch, type GitTree, type TreeEntry } from "./lib/tree";
import { filterBranches, pathAfterSwitch } from "./lib/branchSwitch";
import { classifyFile, monacoLanguage, type FileKind } from "./lib/fileKind";
import { formatSize, sortListing } from "./lib/listing";
import { githubUrl } from "./lib/githubUrl";
import { prepareMarkdownHtml, type PreparedMarkdown } from "./lib/markdown";
import { watchTheme } from "./theme";
import { loadProject } from "./connections";
import { mergeRows } from "./lib/rows";
import { isGitHubDotCom, parseRepoUrl } from "./lib/repoUrl";
import { GhError, findEntry, getBlob, getRaw, getRenderedMarkdown, getRepo, getTree, listBranches, listDir, pathExistsOn } from "./githubBrowse";
import { IconSize } from "azure-devops-ui/Icon";
import { FileIcon, RepoIcon } from "./fileIcons";
import { FindBox, type Crumb } from "./FindBox";
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

function ErrorView({ err, signIn, busy, retry, back }: { err: unknown; signIn: () => void; busy: boolean; retry: () => void; back: () => void }) {
  const kind = err instanceof GhError ? err.kind : "other";
  if (kind === "auth")
    return (
      <MessageCard severity={MessageCardSeverity.Info} buttonProps={[{ text: "Sign in with GitHub", onClick: signIn, primary: true, disabled: busy }]}>
        Sign in with GitHub to browse this repository.
      </MessageCard>
    );
  if (kind === "access")
    return (
      <MessageCard severity={MessageCardSeverity.Error} buttonProps={[{ text: "Back to repositories", onClick: back }, { text: "Sign in again", onClick: signIn, disabled: busy }]}>
        You don't have access, or the GitHub App lacks Contents permission. Sign out and sign in again after the app is updated.
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
    <MessageCard severity={MessageCardSeverity.Error} buttonProps={[{ text: "Try again", onClick: retry }, { text: "Back to repositories", onClick: back }]}>
      Could not load this from GitHub.
    </MessageCard>
  );
}

// ---------- rendered markdown with authenticated images ----------

function Markdown({ prepared, repo, refName, go }: { prepared: PreparedMarkdown; repo: string; refName: string; go: (s: BrowseState) => void }) {
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
function loadMonaco() {
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

function CodeView({ text, name, dark }: { text: string; name: string; dark: boolean }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [failed, setFailed] = React.useState(false);
  const editor = React.useRef<{ dispose(): void } | null>(null);
  React.useEffect(() => {
    let dead = false;
    loadMonaco()
      .then((m) => {
        if (dead || !box.current) return;
        editor.current = m.createViewer(box.current, text, monacoLanguage(name), dark, name);
      })
      .catch(() => !dead && setFailed(true));
    return () => {
      dead = true;
      editor.current?.dispose();
      editor.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theme changes are handled below without recreating the editor
  }, [text, name]);
  React.useEffect(() => {
    if (editor.current) void loadMonaco().then((m) => m.setTheme(dark));
  }, [dark]);
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
        <Button text="Open on GitHub" iconProps={{ iconName: "OpenInNewWindow" }} onClick={() => window.open(githubUrl(repo, refName, path, true), "_blank", "noopener")} />
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

function FileView({ f, repo, refName, dark, go, tab }: { f: FileData; repo: string; refName: string; dark: boolean; go: (s: BrowseState) => void; tab: string }) {
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
    return <CardFill>{rawText === undefined ? <Spinner size={SpinnerSize.large} ariaLabel="Loading" /> : <CodeView text={rawText} name={f.entry.name} dark={dark} />}</CardFill>;
  return <CardFill><CodeView text={f.text ?? ""} name={f.entry.name} dark={dark} /></CardFill>;
}

// ---------- listing ----------

function Listing({ entries, go, repo, refName }: { entries: TreeEntry[]; go: (path: string) => void; repo: string; refName: string }) {
  const [dir, setDir] = React.useState<"asc" | "desc">("asc");
  const sorted = React.useMemo(() => new ArrayItemProvider(sortListing(entries, dir)), [entries, dir]);
  const sorting = React.useMemo(() => new ColumnSorting<TreeEntry>((_i, order) => setDir(order === SortOrder.descending ? "desc" : "asc")), []);
  const columns = React.useMemo<ITableColumn<TreeEntry>[]>(
    () => [
      {
        id: "name",
        name: "Name",
        width: -100,
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
        id: "size",
        name: "Size",
        width: 120,
        renderCell: (_r, columnIndex, tableColumn, e) => (
          <SimpleTableCell key="size" columnIndex={columnIndex} tableColumn={tableColumn}>{e.kind === "file" ? formatSize(e.size) : ""}</SimpleTableCell>
        ),
      },
    ],
    [go, repo, refName, dir]
  );
  if (!entries.length) return <ZeroData iconProps={{ iconName: "FabricFolder" }} imageAltText="" primaryText="This folder is empty" />;
  return (
    <Card className="bolt-table-card" contentProps={{ contentPadding: false }}>
      <Table<TreeEntry> ariaLabel="Folder contents" columns={columns} itemProvider={sorted} behaviors={[sorting]} role="table" />
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

function BranchPicker({ refName, items, loading, onOpen, setQuery, onSelect }: { refName: string; items: { id: string; text: string }[]; loading: boolean; onOpen: () => void; setQuery: (q: string) => void; onSelect: (b: string) => void }) {
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
function useConnectedRepos(current: string): string[] | undefined {
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

function RepoSwitcher({ repo, openTick, onPick }: { repo: string; openTick: number; onPick: (r: string) => void }) {
  const repos = useConnectedRepos(repo);
  const dd = React.useRef<Dropdown>(null);
  // The header breadcrumb asks for the switcher through the hash (see hostNav); each request bumps openTick.
  React.useEffect(() => { if (openTick) dd.current?.expand(); }, [openTick]);
  return (
    <Dropdown
      ref={dd}
      ariaLabel={`Repository: ${repo}. Switch repository`}
      className="gh-repo-switch flex-grow"
      minCalloutWidth={280}
      placeholder={repo}
      items={(repos ?? []).map((r) => ({ id: r, text: r }))}
      showFilterBox
      filterPlaceholderText="Find a repository"
      noItemsText={repos ? "No repositories" : "Loading repositories"}
      filteredNoResultsText="No matching repositories"
      onSelect={(_e, item) => item.id !== repo && onPick(item.id)}
      renderExpandable={(p) => <DropdownExpandableButton {...p} subtle />}
    />
  );
}

// ---------- the browser ----------

type Ctx = { ref: string; defaultBranch: string; tree: GitTree };
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
        const tree = await getTree(repo, ref);
        if (!dead) setCtx({ ref, defaultBranch: info.defaultBranch, tree });
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
  const toList = () => go({});
  const isFile = view.t === "file";
  const err = ctxErr ?? (view.t === "error" ? view.err : null);

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
  const tab = isMd && state.tab !== "contents" ? "preview" : "contents";
  const menuItems = [
    { id: "gh", text: "Open on GitHub", iconProps: { iconName: "OpenInNewWindow" }, onActivate: () => { window.open(githubUrl(repo, refName || "HEAD", path, isFile), "_blank", "noopener"); } },
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
              </div>
              {err ? (
                <div className="page-content page-content-top">
                  <ErrorView err={err} signIn={doSignIn} busy={busy} retry={() => setReload((n) => n + 1)} back={toList} />
                </div>
              ) : (
                ctx && (
                  <>
                    {/* In azure-devops-ui 2.281 the 21px/600 title (class title-m) is TitleSize.Large; TitleSize.Medium renders 17px/400. */}
                    <Header className="repos-files-header" title={path === "" ? "Files" : baseOf(path)} titleSize={TitleSize.Large} titleAriaLevel={1} />
                    <TabBar
                      ariaLabel="View"
                      selectedTabId={tab}
                      onSelectedTabChanged={(id) => go({ repo, ref: state.ref, path, tab: id })}
                      tabSize={TabSize.Tall}
                      disableSticky
                    >
                      <Tab id="contents" name="Contents" />
                      {isMd && <Tab id="preview" name="Preview" />}
                    </TabBar>
                    <div className="page-content page-content-top gh-body flex-column">
                      {notice && <MessageCard severity={MessageCardSeverity.Warning} onDismiss={() => setNotice(null)}>{notice}</MessageCard>}
                      {view.t === "loading" && <Spinner size={SpinnerSize.large} ariaLabel="Loading" />}
                      {view.t === "missing" && (
                        <MessageCard severity={MessageCardSeverity.Warning} buttonProps={[{ text: "Go to the repository root", onClick: () => nav("") }]}>
                          This path doesn't exist on {ctx.ref}.
                        </MessageCard>
                      )}
                      {view.t === "submodule" && <MessageCard severity={MessageCardSeverity.Info}>{view.entry.name} is a submodule, which can't be opened here.</MessageCard>}
                      {view.t === "folder" && (
                        <>
                          <Listing entries={view.entries} go={nav} repo={repo} refName={ctx.ref} />
                          <Readme entries={view.entries} repo={repo} refName={ctx.ref} go={go} />
                        </>
                      )}
                      {view.t === "file" && <FileView f={view.f} repo={repo} refName={ctx.ref} dark={dark} go={go} tab={tab} />}
                    </div>
                  </>
                )
              )}
            </Page>
          )}
        />
      </div>
    </Surface>
  );
}

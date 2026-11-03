// The "Commits" hub: the commit list with its graph (C-1, C-2), and commit detail (CommitDetail.tsx) when `commit` is in the hash.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { FilterBar } from "azure-devops-ui/FilterBar";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { Table, ITableColumn, SimpleTableCell, TableColumnLayout, TwoLineTableCell } from "azure-devops-ui/Table";
import { MoreButton, type IMenuItem } from "azure-devops-ui/Menu";
import { TextField } from "azure-devops-ui/TextField";
import { KeywordFilterBarItem, TextFilterBarItem } from "azure-devops-ui/TextFilterBarItem";
import { Filter, FILTER_CHANGE_EVENT } from "azure-devops-ui/Utilities/Filter";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { computeGraph, type GraphLayout, type GraphRow } from "./lib/commitGraph";
import { isShaPrefix, type CommitRow } from "./lib/commitsQuery";
import { applyCommitFilters, formatDayText, hasServerFilters, matchesKeyword, noMatchText, normalizeCommitFilters, parseDayText, type CommitFilters } from "./lib/commitsRest";
import { patchHash, useHashExtras } from "./hostNav";
import { ErrorView, hubClick } from "./Browser";
import { CommitDetailPage } from "./CommitDetail";
import { useCommitActions } from "./CommitActions";
import { GraphCell, graphWidth } from "./CommitGraph";
import { BranchBar, CheckStatusCell, CommitTime, HubProps, PersonLine, PrCell, RepoHubPage, skeletonRows, titleSwitcher, useDefaultBranch } from "./RepoHub";
import { findCommit, invalidateRefs, listCommitsRest } from "./githubBrowse";
import { openInHub, useHubHref } from "./repoHref";
import { usePrefs } from "./prefs";
import { SignaturePill } from "./Signature";
import "./browser.css";

// ---------- the table (also the Pushes page's expanded commits) ----------

export interface CommitTableProps {
  /** undefined while loading: the table shows shimmer rows. */
  rows: CommitRow[] | undefined;
  /** Lane layout of `rows`; omit for no Graph column. */
  graph?: GraphLayout;
  label: string;
  /** A commit's link target and what activating it does. */
  commitHref: (sha: string) => string;
  open: (sha: string) => void;
  prHref: (n: number) => string;
  openPr: (n: number) => void;
  showHeader?: boolean;
  /** The ⋯ items of a commit; leave out for no actions column. */
  menu?: (sha: string) => IMenuItem[];
}

function columns(p: CommitTableProps): ITableColumn<CommitRow>[] {
  const byIndex = new Map<string, GraphRow>(p.graph?.rows.map((r) => [r.sha, r]));
  const lanes = p.graph?.maxLanes ?? 0;
  const cols: ITableColumn<CommitRow>[] = [];
  if (p.graph)
    cols.push({
      id: "graph",
      name: "Graph",
      width: graphWidth(lanes),
      columnLayout: TableColumnLayout.none,
      renderCell: (_r, columnIndex, tableColumn, row) => (
        <SimpleTableCell key="graph" columnIndex={columnIndex} tableColumn={tableColumn} className="gh-graph-cell">
          {byIndex.has(row.sha) && <GraphCell row={byIndex.get(row.sha)!} lanes={lanes} />}
        </SimpleTableCell>
      ),
    });
  cols.push(
    {
      id: "commit",
      name: "Commit",
      width: -100,
      columnLayout: TableColumnLayout.twoLine,
      renderCell: (_r, columnIndex, tableColumn, row) => (
        <TwoLineTableCell
          key="commit"
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          line1={
            <Link className="gh-commit-title commit-title font-weight-semibold text-ellipsis" subtle removeUnderline href={p.commitHref(row.sha)} onClick={hubClick(() => p.open(row.sha)) /* the Table does not activate rows for clicks on links */}>
              {row.title}
            </Link>
          }
          line2={
            <span className="gh-commit-line2 flex-row flex-center">
              <span className="monospaced-xs secondary-text gh-commit-sha">{row.shortSha}</span>
              <PersonLine person={row.author} className="secondary-text body-s" />
              <span className="secondary-text body-s"><CommitTime date={row.date} /></span>
              <SignaturePill signature={row.signature} />
            </span>
          }
        />
      ),
    },
    {
      id: "pr",
      name: "Pull Request",
      width: 120,
      renderCell: (_r, columnIndex, tableColumn, row) => (
        <SimpleTableCell key="pr" columnIndex={columnIndex} tableColumn={tableColumn}>
          <PrCell number={row.prNumber} href={row.prNumber ? p.prHref(row.prNumber) : undefined} onOpen={p.openPr} />
        </SimpleTableCell>
      ),
    },
    {
      id: "status",
      name: "Status",
      width: 140,
      renderCell: (_r, columnIndex, tableColumn, row) => (
        <SimpleTableCell key="status" columnIndex={columnIndex} tableColumn={tableColumn}>
          <CheckStatusCell status={row.status} />
        </SimpleTableCell>
      ),
    }
  );
  if (p.menu) {
    const menu = p.menu;
    cols.push({
      id: "more",
      name: "",
      width: 40,
      columnLayout: TableColumnLayout.none,
      renderCell: (_r, columnIndex, tableColumn, row) => (
        <SimpleTableCell key="more" columnIndex={columnIndex} tableColumn={tableColumn}>
          <MoreButton ariaLabel={`Actions for commit ${row.shortSha}`} contextualMenuProps={{ menuProps: { id: `gh-commit-menu-${row.sha}`, items: menu(row.sha) } }} />
        </SimpleTableCell>
      ),
    });
  }
  return cols;
}

export function CommitTable(p: CommitTableProps) {
  const cols = React.useMemo(() => columns(p), [p.graph, p.commitHref, p.open, p.prHref, p.openPr, p.menu]); // eslint-disable-line react-hooks/exhaustive-deps
  const provider = React.useMemo(() => p.rows ? new ArrayItemProvider(p.rows) : skeletonRows<CommitRow>(), [p.rows]);
  return (
    <Table<CommitRow>
      className="gh-commit-table"
      ariaLabel={p.label}
      role="table"
      columns={cols}
      itemProvider={provider}
      showHeader={p.showHeader !== false}
      spacerWidth={8}
      singleClickActivation
      onActivate={(_e, r) => p.open(r.data.sha)}
    />
  );
}

// ---------- the list ----------

type Load = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready" };

function CommitList({ repo, props }: { repo: string; props: HubProps }) {
  const { state, go, openSwitch, signedIn } = props;
  const { defaultBranch, err: repoErr } = useDefaultBranch(repo);
  const ref = state.ref ?? defaultBranch;
  const href = useHubHref();
  const [prefs, setPrefs] = usePrefs();
  const [rows, setRows] = React.useState<CommitRow[]>([]);
  const [next, setNext] = React.useState<{ more: boolean; cursor: string | null }>({ more: false, cursor: null });
  const [load, setLoad] = React.useState<Load>({ t: "loading" });
  const [more, setMore] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const { commitFilters: fromHash } = useHashExtras();
  const [filterOpen, setFilterOpen] = React.useState(() => Object.keys(fromHash).length > 0);
  const [keyword, setKeyword] = React.useState(fromHash.text ?? "");
  // Author, dates and path are asked of GitHub (REST /commits author, since, until, path); the keyword narrows the loaded rows.
  const [server, setServer] = React.useState<CommitFilters>(() => ({ ...fromHash, text: undefined }));
  const [badDate, setBadDate] = React.useState(false);
  const [idText, setIdText] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const filter = React.useMemo(() => {
    const f = new Filter();
    f.setState({ keyword: { value: fromHash.text ?? "" }, author: { value: fromHash.author ?? "" }, from: { value: formatDayText(fromHash.from) }, to: { value: formatDayText(fromHash.to) }, path: { value: fromHash.path ?? "" } }, true);
    return f;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- the hash only seeds it
  const actions = useCommitActions(repo, signedIn);

  React.useEffect(() => {
    // The keyword applies at once; the server-side filters wait for typing to pause. A date that does not parse is left out (and said so).
    let t: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      const v = (k: string) => (filter.getFilterItemValue<string>(k) ?? "").trim();
      setKeyword(v("keyword"));
      clearTimeout(t);
      t = setTimeout(() => {
        const from = parseDayText(v("from"));
        const to = parseDayText(v("to"));
        setBadDate(from === null || to === null);
        const next = normalizeCommitFilters({ author: v("author"), from: from || undefined, to: to || undefined, path: v("path") });
        setServer((s) => (JSON.stringify(s) === JSON.stringify(next) ? s : next));
        patchHash((h) => applyCommitFilters(h, { ...next, text: v("keyword") })); // kept in the hash, so a reload or a link keeps them
      }, 400);
    };
    filter.subscribe(onChange, FILTER_CHANGE_EVENT);
    return () => { clearTimeout(t); filter.unsubscribe(onChange, FILTER_CHANGE_EVENT); };
  }, [filter]);

  // First page, again whenever the repo, branch, sign-in or a server-side filter changes.
  const serverKey = JSON.stringify(normalizeCommitFilters(server));
  React.useEffect(() => {
    if (!ref) return;
    let dead = false;
    setLoad({ t: "loading" });
    setRows([]);
    listCommitsRest(repo, ref, server, 1).then(
      (p) => { if (dead) return; setRows(p.rows); setNext({ more: p.hasNextPage, cursor: p.endCursor }); setLoad({ t: "ready" }); },
      (err) => !dead && setLoad({ t: "error", err })
    );
    return () => { dead = true; };
  }, [repo, ref, signedIn, reload, serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = () => {
    if (!ref || !next.cursor) return;
    setMore(true);
    listCommitsRest(repo, ref, server, Number(next.cursor)).then(
      (p) => { setRows((r) => [...r, ...p.rows]); setNext({ more: p.hasNextPage, cursor: p.endCursor }); setMore(false); },
      (err) => { setMore(false); setLoad({ t: "error", err }); }
    );
  };

  const openCommit = React.useCallback((sha: string) => go({ repo, ref: state.ref, commit: sha }), [go, repo, state.ref]);
  const openPr = React.useCallback((n: number) => void openInHub("prs", { repo, view: "prs", pr: n })(), [repo]);
  const commitHref = React.useCallback((sha: string) => href("commits", { repo, ref: state.ref, commit: sha }), [href, repo, state.ref]);
  const prHref = React.useCallback((n: number) => href("prs", { repo, view: "prs", pr: n }), [href, repo]);

  const filtered = React.useMemo(() => (keyword ? rows.filter((r) => matchesKeyword(r, keyword)) : rows), [rows, keyword]);
  const filtering = !!keyword || hasServerFilters(server);
  // The graph needs every row in order, so it hides while a filter drops some (author, date and path filters skip commits too).
  const graph = React.useMemo(() => (prefs.graph && !filtering ? computeGraph(rows) : undefined), [prefs.graph, filtering, rows]);
  const clearFilters = () => ["keyword", "author", "from", "to", "path"].forEach((k) => filter.setFilterItemState(k, { value: "" }));

  const search = async () => {
    const t = idText.trim();
    setNotice(null);
    if (!t) return;
    if (!isShaPrefix(t)) return setNotice("Enter 4 to 40 hexadecimal characters of a commit ID.");
    try {
      const c = await findCommit(repo, t);
      if (c) go({ repo, ref: state.ref, commit: c.sha });
      else setNotice(`No commit starts with ${t}.`);
    } catch (e) {
      setLoad({ t: "error", err: e });
    }
  };

  const doSignIn = () => { void props.signIn(); };
  const retry = () => { invalidateRefs(); setReload((n) => n + 1); };
  const error = repoErr ?? (load.t === "error" ? load.err : null);
  const pick = (r: string) => go({ repo: r });

  return (
    <>
      <Header
        className="repos-files-header"
        title="Commits"
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        commandBarItems={[
          { id: "filter", text: "Filter", important: true, renderButton: () => <Button key="filter" className="gh-cmd-icon" subtle iconProps={{ iconName: "Filter" }} ariaLabel="Filter commits" ariaPressed={filterOpen} tooltipProps={{ text: "Filter" }} onClick={() => setFilterOpen((o) => !o)} /> },
          { id: "graph", text: prefs.graph ? "On" : "Off", important: true, renderButton: () => <Button key="graph" className="gh-graph-toggle" subtle iconProps={{ iconName: "BranchCommit" }} text={prefs.graph ? "On" : "Off"} ariaLabel={`Graph: ${prefs.graph ? "on" : "off"}. Toggle the commit graph`} ariaPressed={prefs.graph} tooltipProps={{ text: "Show the commit graph" }} onClick={() => setPrefs((p) => ({ ...p, graph: !p.graph }))} /> },
          {
            id: "commitid", text: "Commit ID", important: true,
            renderButton: () => (
              <TextField
                key="commitid"
                className="gh-commit-id"
                value={idText}
                onChange={(_e, v) => setIdText(v)}
                onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
                placeholder="Commit ID"
                ariaLabel="Commit ID. Press Enter to open that commit"
                suffixIconProps={{ iconName: "Search" }}
              />
            ),
          },
        ]}
      >
        {titleSwitcher(repo, openSwitch, pick)}
        {defaultBranch && ref && <BranchBar inTitle repo={repo} current={ref} defaultBranch={defaultBranch} onPick={(b) => go({ repo, ref: b === defaultBranch ? undefined : b })} />}
      </Header>
      <div className="page-content page-content-top gh-pr-body flex-column">
        {notice && <MessageCard severity={MessageCardSeverity.Warning} onDismiss={() => setNotice(null)}>{notice}</MessageCard>}
        {actions.ui}
        {filterOpen && (
          <FilterBar filter={filter} onDismissClicked={() => { setFilterOpen(false); clearFilters(); }} searchRoleAriaLabel="Filter commits">
            <KeywordFilterBarItem filterItemKey="keyword" placeholder="Message (loaded commits)" />
            <TextFilterBarItem filterItemKey="author" placeholder="Author (GitHub username or email)" ariaLabel="Author" />
            <TextFilterBarItem filterItemKey="from" placeholder="From date (dd/mm/yyyy)" ariaLabel="From date, as dd/mm/yyyy" maxTextLength={10} />
            <TextFilterBarItem filterItemKey="to" placeholder="To date (dd/mm/yyyy)" ariaLabel="To date, as dd/mm/yyyy" maxTextLength={10} />
            <TextFilterBarItem filterItemKey="path" placeholder="Path (file or folder)" ariaLabel="Path" />
          </FilterBar>
        )}
        {filterOpen && badDate && <MessageCard severity={MessageCardSeverity.Warning}>Enter dates as dd/mm/yyyy, for example 03/11/2026. A date that isn't valid is ignored.</MessageCard>}
        {error ? (
          <ErrorView err={error} signIn={doSignIn} busy={props.busy} retry={retry} subject="see this repository's commits" permission="Contents" />
        ) : load.t === "loading" || !ref ? (
          <Card className="gh-pr-card gh-commits-card bolt-table-card" contentProps={{ contentPadding: false }}>
            <CommitTable rows={undefined} label="Loading commits" commitHref={commitHref} open={openCommit} prHref={prHref} openPr={openPr} menu={actions.menu} />
          </Card>
        ) : !filtered.length ? (
          <ZeroData
            iconProps={{ iconName: filtering ? "Filter" : "BranchCommit" }}
            imageAltText=""
            primaryText={filtering ? "No commits match" : "No commits"}
            secondaryText={filtering ? noMatchText(ref, server, keyword) : undefined}
            actionText={filtering ? "Clear filters" : undefined}
            onActionClick={filtering ? clearFilters : undefined}
          />
        ) : (
          <>
            <Card className="gh-pr-card gh-commits-card bolt-table-card" contentProps={{ contentPadding: false }}>
              <CommitTable rows={filtered} graph={graph} label={`Commits on ${ref}`} commitHref={commitHref} open={openCommit} prHref={prHref} openPr={openPr} menu={actions.menu} />
            </Card>
            {next.more && (
              <div className="gh-load-more flex-row justify-center">
                {more ? <Spinner size={SpinnerSize.medium} ariaLabel="Loading more commits" /> : <Button text="Load more" onClick={loadMore} />}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export function CommitsHub(props: HubProps) {
  return (
    <RepoHubPage state={props.state} go={props.go}>
      {(repo) => (props.state.commit ? <CommitDetailPage key={`${repo}@${props.state.commit}`} repo={repo} props={props} /> : <CommitList repo={repo} props={props} />)}
    </RepoHubPage>
  );
}


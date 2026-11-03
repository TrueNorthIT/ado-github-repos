// The "Pull requests" hub: the PR list (PR-1 to PR-4); the PR page itself is PrPage.tsx.
import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { Button } from "azure-devops-ui/Button";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Page } from "azure-devops-ui/Page";
import { Surface, SurfaceBackground } from "azure-devops-ui/Surface";
import { Link } from "azure-devops-ui/Link";
import { Icon, IconSize } from "azure-devops-ui/Icon";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { Table, ITableColumn, SimpleTableCell, TwoLineTableCell, renderEmptyCell } from "azure-devops-ui/Table";
import { Ago } from "azure-devops-ui/Ago";
import { AgoFormat } from "azure-devops-ui/Utilities/Date";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { FilterBar } from "azure-devops-ui/FilterBar";
import { KeywordFilterBarItem } from "azure-devops-ui/TextFilterBarItem";
import { Filter, FILTER_CHANGE_EVENT } from "azure-devops-ui/Utilities/Filter";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { parseColor } from "azure-devops-ui/Utilities/Color";
import { BrowseState, serialize } from "./lib/browseState";
import type { PrTab } from "./lib/prQuery";
import type { PrListRow } from "./lib/prModel";
import { loadProject } from "./connections";
import { mergeRows } from "./lib/rows";
import { isGitHubDotCom, parseRepoUrl } from "./lib/repoUrl";
import { invalidatePrs, listPrs, type PrListResult } from "./githubBrowse";
import { ErrorView, RepoSwitcher } from "./Browser";
import { useDefaultRepo } from "./RepoHub";
import { PrPage } from "./PrPage";
import "./browser.css";

const TABS: { id: PrTab; name: string }[] = [
  { id: "mine", name: "Mine" },
  { id: "active", name: "Active" },
  { id: "completed", name: "Completed" },
  { id: "abandoned", name: "Abandoned" },
];
const DEBOUNCE_MS = 300;

// ---------- one row ----------

function Labels({ row }: { row: PrListRow }) {
  return (
    <>
      {row.isDraft && row.status === "draft" && <Pill className="gh-pr-pill" size={PillSize.compact} variant={PillVariant.standard}>Draft</Pill>}
      {row.labels.map((l) => {
        const color = parseColor(`#${l.color}`); // GitHub sends hex without "#"; an odd value falls back to the default pill
        return <Pill key={l.name} className="gh-pr-pill" size={PillSize.compact} variant={color ? PillVariant.colored : PillVariant.standard} color={color}>{l.name}</Pill>;
      })}
    </>
  );
}

function columns(repo: string, open: (n: number) => void): ITableColumn<PrListRow>[] {
  return [
    {
      id: "avatar",
      width: 48,
      renderCell: (_r, columnIndex, tableColumn, row) => (
        <SimpleTableCell key="avatar" columnIndex={columnIndex} tableColumn={tableColumn}>
          <VssPersona imageUrl={row.avatarUrl} displayName={row.authorName ?? row.authorLogin} size="medium" suppressPersonaCard showInitialsOnImageError />
        </SimpleTableCell>
      ),
    },
    {
      id: "title",
      width: -100,
      renderCell: (_r, columnIndex, tableColumn, row) => (
        <TwoLineTableCell
          key="title"
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          line1={
            <div className="flex-row flex-center gh-pr-line1">
              <Link className="gh-pr-title body-l" subtle removeUnderline href={serialize({ repo, view: "prs", pr: row.number })} onClick={(e) => { e.preventDefault(); open(row.number); } /* the Table does not activate rows for clicks on links (seen live in 0.15.0) */}>
                {row.title}
              </Link>
              <Labels row={row} />
            </div>
          }
          line2={
            <span className="secondary-text body-s gh-pr-line2">
              {row.authorName ?? row.authorLogin} request #{row.number} into <Icon iconName="OpenSource" size={IconSize.small} className="gh-pr-branch-icon" />
              <span className="monospaced-xs gh-pr-branch">{row.baseRef}</span>
            </span>
          }
        />
      ),
    },
    {
      id: "comments",
      width: 80,
      renderCell: (_r, columnIndex, tableColumn, { comments: c }) => (
        <SimpleTableCell key="comments" columnIndex={columnIndex} tableColumn={tableColumn}>
          <span className={`gh-pr-comments flex-row flex-center${c.active ? " has-active-comments" : " secondary-text"}`} aria-label={c.threaded ? `${c.resolved} of ${c.total} comment threads resolved` : `${c.total} comments`}>
            <Icon iconName={c.active ? "ChatWarning" : "Comment"} size={IconSize.small} />
            <span className="gh-pr-comment-count">{c.threaded ? `${c.resolved} / ${c.total}` : c.total}</span>
          </span>
        </SimpleTableCell>
      ),
    },
    {
      id: "status",
      width: 190,
      renderCell: (_r, columnIndex, tableColumn, row) => (
        <SimpleTableCell key="status" columnIndex={columnIndex} tableColumn={tableColumn}>
          <span className="secondary-text">{row.dateVerb} <Ago date={row.date} format={AgoFormat.Compact} /></span>
        </SimpleTableCell>
      ),
    },
    { id: "side", width: 42, renderCell: renderEmptyCell },
  ];
}

function PrTable({ rows, repo, open, label }: { rows: PrListRow[]; repo: string; open: (n: number) => void; label: string }) {
  const cols = React.useMemo(() => columns(repo, open), [repo, open]);
  const provider = React.useMemo(() => new ArrayItemProvider(rows), [rows]);
  return (
    <Table<PrListRow>
      ariaLabel={label}
      role="table"
      columns={cols}
      itemProvider={provider}
      showHeader={false}
      spacerWidth={8}
      singleClickActivation
      onActivate={(_e, r) => open(r.data.number)}
    />
  );
}

// ---------- loading a tab ----------

type Load = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; data: PrListResult };

function useList(repo: string, tab: PrTab, filter: string, cursor: string | null, reload: number, signedIn: boolean): Load {
  const [load, setLoad] = React.useState<Load>({ t: "loading" });
  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "loading" });
    listPrs(repo, tab, filter, cursor).then(
      (data) => !dead && setLoad({ t: "ready", data }),
      (err) => !dead && setLoad({ t: "error", err })
    );
    return () => { dead = true; };
  }, [repo, tab, filter, cursor, reload, signedIn]);
  return load;
}

interface TabProps {
  repo: string;
  open: (n: number) => void;
  signedIn: boolean;
  signIn: () => void;
  busy: boolean;
  filterOpen: boolean;
  closeFilter: () => void;
}

const retry = (bump: () => void) => () => { invalidatePrs(); bump(); };

const Loading = () => <div className="gh-pr-loading flex-row flex-center justify-center"><Spinner size={SpinnerSize.large} ariaLabel="Loading pull requests" /></div>;
const Empty = () => <ZeroData iconProps={{ iconName: "BranchPullRequest" }} imageAltText="" primaryText="No pull requests" />;
const Failed = ({ load, p, bump }: { load: Extract<Load, { t: "error" }>; p: TabProps; bump: () => void }) => (
  <ErrorView err={load.err} signIn={p.signIn} busy={p.busy} retry={retry(bump)} subject="see this repository's pull requests" permission="Pull requests" />
);

// ---------- Active / Completed / Abandoned ----------

/** Previous / next page buttons, shown inside the filter bar like native's pager. A class: FilterBar clones its children with a ref. */
class Pager extends React.Component<{ filterItemKey: string; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void }> {
  focus() {}
  render() {
    return (
      <div className="gh-pr-pager flex-row flex-center">
        <Button className="filter-bar-button" subtle iconProps={{ iconName: "ChevronLeftMed" }} ariaLabel="Previous page" disabled={!this.props.hasPrev} onClick={this.props.onPrev} />
        <Button className="filter-bar-button" subtle iconProps={{ iconName: "ChevronRightMed" }} ariaLabel="Next page" disabled={!this.props.hasNext} onClick={this.props.onNext} />
      </div>
    );
  }
}

function StateList(p: TabProps & { tab: Exclude<PrTab, "mine"> }) {
  const filter = React.useMemo(() => new Filter(), []);
  const [keyword, setKeyword] = React.useState("");
  const [cursors, setCursors] = React.useState<(string | null)[]>([null]); // the cursor behind each page seen so far; the last is current
  const [reload, setReload] = React.useState(0);
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onChange = () => {
      clearTimeout(t);
      const v = filter.getFilterItemValue<string>("keyword") ?? "";
      t = setTimeout(() => { setKeyword(v.trim()); setCursors([null]); }, DEBOUNCE_MS);
    };
    filter.subscribe(onChange, FILTER_CHANGE_EVENT);
    return () => { clearTimeout(t); filter.unsubscribe(onChange, FILTER_CHANGE_EVENT); };
  }, [filter]);
  const load = useList(p.repo, p.tab, keyword, cursors[cursors.length - 1], reload, p.signedIn);
  const data = load.t === "ready" ? load.data : undefined;
  return (
    <>
      {p.filterOpen && (
        <FilterBar filter={filter} onDismissClicked={p.closeFilter} searchRoleAriaLabel="Filter pull requests">
          <KeywordFilterBarItem filterItemKey="keyword" placeholder="Pull Request ID or title" />
          <Pager
            filterItemKey="pager"
            hasPrev={cursors.length > 1}
            hasNext={!!data?.hasNextPage}
            onPrev={() => setCursors((c) => c.slice(0, -1))}
            onNext={() => data?.endCursor && setCursors((c) => [...c, data.endCursor])}
          />
        </FilterBar>
      )}
      {load.t === "loading" && <Loading />}
      {load.t === "error" && <Failed load={load} p={p} bump={() => setReload((n) => n + 1)} />}
      {data && !data.rows.length && <Empty />}
      {data && data.rows.length > 0 && (
        <Card className="gh-pr-card bolt-table-card" contentProps={{ contentPadding: false }}>
          <PrTable rows={data.rows} repo={p.repo} open={p.open} label={`${p.tab} pull requests`} />
        </Card>
      )}
    </>
  );
}

// ---------- Mine ----------

function Section({ title, rows, p }: { title: string; rows: PrListRow[]; p: TabProps }) {
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <Card
      className="gh-pr-card gh-pr-section bolt-table-card"
      collapsible
      collapsed={collapsed}
      onCollapseClick={() => setCollapsed((c) => !c)}
      headerClassName="no-v-padding"
      contentProps={{ contentPadding: false }}
      renderHeader={() => (
        <div className="bolt-card-header bolt-card-header-collapsible bolt-card-expandable-header gh-pr-section-header flex-row flex-center">
          <Header className="gh-pr-section-title" title={title} titleSize={TitleSize.Medium} titleAriaLevel={2} />
          <Pill containsCount size={PillSize.regular} variant={PillVariant.standard} ariaLabel={`${rows.length} pull requests`}>{rows.length}</Pill>
        </div>
      )}
    >
      {rows.length ? <PrTable rows={rows} repo={p.repo} open={p.open} label={title} /> : <div className="gh-pr-section-empty secondary-text">No pull requests</div>}
    </Card>
  );
}

function MineList(p: TabProps) {
  const [reload, setReload] = React.useState(0);
  const load = useList(p.repo, "mine", "", null, reload, p.signedIn);
  const mine = load.t === "ready" ? load.data.mine : undefined;
  return (
    <>
      {load.t === "loading" && <Loading />}
      {load.t === "error" && <Failed load={load} p={p} bump={() => setReload((n) => n + 1)} />}
      {mine && !mine.created.length && !mine.reviewRequested.length && <Empty />}
      {mine && (mine.created.length > 0 || mine.reviewRequested.length > 0) && (
        <>
          <Section title="Created by me" rows={mine.created} p={p} />
          <Section title="Review requested" rows={mine.reviewRequested} p={p} />
        </>
      )}
    </>
  );
}

// ---------- the hub ----------

export interface PrHubProps {
  state: BrowseState;
  go: (s: BrowseState, replace?: boolean) => void;
  /** Bumped each time the header breadcrumb asks for the repo switcher. */
  openSwitch: number;
  signedIn: boolean;
  signIn: () => Promise<void>;
  busy: boolean;
  commandBarItems: { id: string; text: string; iconProps?: { iconName: string }; disabled?: boolean; onActivate: () => void }[];
}

export function PullRequestsHub({ state, go, openSwitch, signedIn, signIn, busy, commandBarItems }: PrHubProps) {
  const fallback = useDefaultRepo(!state.repo);
  const repo = state.repo ?? fallback.repo;
  // Fill the default repo into the hash (no history entry) so the header breadcrumb and a reload agree with the page.
  React.useEffect(() => { if (!state.repo && fallback.repo) go({ repo: fallback.repo, view: "prs", prTab: state.prTab }, true); }, [state.repo, fallback.repo]); // eslint-disable-line react-hooks/exhaustive-deps
  const tab: PrTab = state.prTab ?? "mine";
  const [filterOpen, setFilterOpen] = React.useState(true);
  const goPr = React.useCallback((s: BrowseState) => go({ ...s, view: "prs" }), [go]);
  const open = React.useCallback((n: number) => repo && goPr({ repo, prTab: tab, pr: n }), [goPr, repo, tab]);
  const doSignIn = () => { void signIn(); };

  const switcher = (to: (r: string) => BrowseState) => ({
    id: "repo", text: repo ?? "", important: true,
    renderButton: () => <RepoSwitcher compact repo={repo!} openTick={openSwitch} onPick={(r) => goPr(to(r))} />,
  });
  const openOnGitHub = (href: string) => ({ id: "gh", text: "Open on GitHub", iconProps: { iconName: "OpenInNewTab" }, href, target: "_blank", important: true });
  const extra = commandBarItems.map((c) => ({ ...c, important: false }));

  let body: React.ReactNode;
  if (!repo) {
    body = fallback.none ? (
      <ZeroData iconProps={{ iconName: "PlugConnected" }} imageAltText="No GitHub connections" primaryText="No GitHub repositories" secondaryText="Connect GitHub repositories to this project in Project settings." />
    ) : (
      <Loading />
    );
  } else if (state.pr) {
    body = (
      <PrPage
        repo={repo}
        state={{ ...state, pr: state.pr }}
        listTab={tab}
        go={go}
        signedIn={signedIn}
        signIn={doSignIn}
        busy={busy}
        commandBarItems={(url) => [openOnGitHub(url), ...extra] /* no repo switcher: a PR belongs to one repo */}
      />
    );
  } else {
    const p: TabProps = { repo, open, signedIn, signIn: doSignIn, busy, filterOpen, closeFilter: () => setFilterOpen(false) };
    body = (
      <>
        <Header className="gh-hub-header" title="Pull requests" titleSize={TitleSize.Large} titleAriaLevel={1} commandBarItems={[switcher((r) => ({ repo: r, prTab: tab })), openOnGitHub(`https://github.com/${repo}/pulls`), ...extra]} />
        <TabBar
          ariaLabel="Pull request lists"
          selectedTabId={tab}
          onSelectedTabChanged={(id) => goPr({ repo, prTab: id as PrTab })}
          tabSize={TabSize.Tall}
          disableSticky
          renderAdditionalContent={() =>
            tab === "mine" ? undefined : (
              <Button className="gh-pr-filter-toggle" subtle iconProps={{ iconName: "Filter" }} ariaLabel="Filter" ariaPressed={filterOpen} tooltipProps={{ text: "Filter" }} onClick={() => setFilterOpen((o) => !o)} />
            )
          }
        >
          {TABS.map((t) => <Tab key={t.id} id={t.id} name={t.name} />)}
        </TabBar>
        <div className="page-content page-content-top gh-pr-body flex-column">
          {tab === "mine" ? <MineList {...p} /> : <StateList key={`${repo}/${tab}`} {...p} tab={tab} />}
        </div>
      </>
    );
  }
  return (
    <Surface background={SurfaceBackground.neutral}>
      <Page className="gh-page flex-grow">
        {body}
      </Page>
    </Surface>
  );
}

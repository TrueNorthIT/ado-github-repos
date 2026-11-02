// The pull request page (PR-5 to PR-9): header, then Overview / Files / Commits.
import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { ClipboardButton } from "azure-devops-ui/Components/ClipboardButton/ClipboardButton";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Icon } from "azure-devops-ui/Icon";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { Status, Statuses, StatusSize } from "azure-devops-ui/Status";
import { Table, ITableColumn, TwoLineTableCell } from "azure-devops-ui/Table";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { Ago } from "azure-devops-ui/Ago";
import { AgoFormat } from "azure-devops-ui/Utilities/Date";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { parseColor } from "azure-devops-ui/Utilities/Color";
import { BrowseState, type PrPage as PrPageId } from "./lib/browseState";
import type { ChecksSummary, Mergeable, PrPageData, PrReviewer, PrStatus, ReviewState } from "./lib/prModel";
import { commitUrl } from "./lib/commits";
import { prepareMarkdownHtml } from "./lib/markdown";
import type { WorkItemRef } from "./lib/workItems";
import { PermissionError } from "./connections";
import { getPr, invalidatePr } from "./githubBrowse";
import { fetchWorkItems, type WorkItemsResult } from "./workItemsApi";
import { openRepoHub } from "./hostNav";
import { openInRepos, useRepoHref } from "./repoHref";
import { watchTheme } from "./theme";
import { ErrorView, Markdown } from "./Browser";
import { PrFilesTab } from "./PrFiles";
import { ActivityFeed } from "./Feed";
import { feedStore } from "./feedStore";
import { actionStore, useActions, type ActionStore } from "./actionStore";
import { PoliciesCard, PrActionDialogs, prCommandItems, type Ui } from "./PrActions";
import "./browser.css";

const PAGES: { id: PrPageId; name: string }[] = [
  { id: "overview", name: "Overview" },
  { id: "files", name: "Files" },
  { id: "commits", name: "Commits" },
];

// ---------- header (PR-5) ----------

// Active is native's rgb(0,120,212) with white text; the others are native-like.
const STATUS: Record<PrStatus, { text: string; color?: { red: number; green: number; blue: number } }> = {
  active: { text: "Active", color: { red: 0, green: 120, blue: 212 } },
  draft: { text: "Draft" },
  completed: { text: "Completed", color: { red: 16, green: 124, blue: 16 } },
  abandoned: { text: "Abandoned", color: { red: 96, green: 94, blue: 92 } },
};

function Meta({ pr, repo, status }: { pr: PrPageData; repo: string; status?: PrStatus }) {
  const href = useRepoHref();
  const s = STATUS[status ?? pr.status];
  const branch = (ref: string) => <Link className="gh-pr-branch-link" href={href({ repo, ref })} onClick={openInRepos({ repo, ref })}>{ref}</Link>;
  return (
    <div className="gh-pr-meta flex-row flex-center">
      <Pill size={PillSize.regular} variant={s.color ? PillVariant.colored : PillVariant.standard} color={s.color}>{s.text}</Pill>
      <span className="secondary-text">#{pr.number}</span>
      <VssPersona imageUrl={pr.avatarUrl} displayName={pr.authorName ?? pr.authorLogin} size="small" suppressPersonaCard showInitialsOnImageError />
      <span className="gh-pr-meta-text">
        <span className="secondary-text">{pr.authorName ?? pr.authorLogin} proposes to merge </span>
        {branch(pr.headRef)}
        <ClipboardButton className="gh-pr-copy" getContent={() => pr.headRef} ariaLabel={`Copy branch name ${pr.headRef}`} showCopiedTooltip subtle />
        <span className="secondary-text"> into </span>
        {branch(pr.baseRef)}
        <span className="secondary-text"> {pr.commentsResolved} comments resolved</span>
      </span>
    </div>
  );
}

// ---------- Overview (PR-6) ----------

const CHECKS: Record<ChecksSummary, { icon: React.ReactNode; text: string }> = {
  SUCCESS: { icon: <Status {...Statuses.Success} size={StatusSize.s} ariaLabel="Success" />, text: "All checks have passed" },
  FAILURE: { icon: <Status {...Statuses.Failed} size={StatusSize.s} ariaLabel="Failed" />, text: "Some checks have failed" },
  PENDING: { icon: <Status {...Statuses.Running} size={StatusSize.s} ariaLabel="Running" />, text: "Checks are still running" },
  NONE: { icon: <Icon iconName="Info" className="secondary-text" />, text: "No checks reported" },
};
const MERGE: Record<Mergeable, { status: typeof Statuses.Success; text: string }> = {
  MERGEABLE: { status: Statuses.Success, text: "No merge conflicts" },
  CONFLICTING: { status: Statuses.Failed, text: "This branch has merge conflicts" },
  UNKNOWN: { status: Statuses.Warning, text: "Merge status unknown" },
};

function MergeCard({ pr }: { pr: PrPageData }) {
  // Mergeability only means something while the PR is open; GitHub reports UNKNOWN once it is merged or closed.
  const m =
    pr.status === "completed" ? { status: Statuses.Success, text: `Merged into ${pr.baseRef}` }
    : pr.status === "abandoned" ? { status: Statuses.Canceled, text: "Closed without merging" }
    : MERGE[pr.mergeable];
  const c = CHECKS[pr.checks];
  return (
    <Card className="gh-pr-card gh-pr-merge bolt-card-no-vertical-padding">
      <div className="flex-row flex-center gh-pr-merge-row">
        <Status {...m.status} size={StatusSize.l} ariaLabel={m.text} />
        <div className="flex-column">
          <span className="body-m">{m.text}</span>
          <span className="secondary-text body-s flex-row flex-center gh-pr-checks">{c.icon}{c.text}</span>
        </div>
      </div>
    </Card>
  );
}

function Description({ pr, repo }: { pr: PrPageData; repo: string }) {
  const [owner, name] = repo.split("/");
  // GitHub's bodyHTML goes through the same sanitiser as the README; repo-relative images are fetched with the token by Markdown.
  const prepared = React.useMemo(() => (pr.bodyHtml.trim() ? prepareMarkdownHtml(pr.bodyHtml, { owner, name, ref: pr.baseRef, dir: "" }) : null), [pr.bodyHtml, owner, name, pr.baseRef]);
  const go = React.useCallback((s: BrowseState) => void openRepoHub(s), []);
  return (
    <Card className="gh-pr-card gh-pr-desc" headerClassName="gh-pr-desc-header" contentProps={{ className: "gh-pr-desc-content", contentPadding: false }} titleProps={{ text: "Description", size: TitleSize.Medium, ariaLevel: 2 }}>
      {prepared ? <Markdown prepared={prepared} repo={repo} refName={pr.baseRef} go={go} /> : <span className="secondary-text">No description</span>}
    </Card>
  );
}

/** A right-column section: native draws these straight on the page background (no card), title 17px/400 (Header, TitleSize.Medium). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="gh-pr-section">
      <Header title={title} titleSize={TitleSize.Medium} titleAriaLevel={2} />
      {children}
    </section>
  );
}
const Well = ({ children }: { children: React.ReactNode }) => <div className="gh-pr-well">{children}</div>;

const REVIEW: Record<ReviewState, { text: string; icon: React.ReactNode }> = {
  APPROVED: { text: "Approved", icon: <Status {...Statuses.Success} size={StatusSize.m} ariaLabel="Approved" /> },
  CHANGES_REQUESTED: { text: "Changes requested", icon: <Status {...Statuses.Warning} size={StatusSize.m} ariaLabel="Changes requested" /> },
  COMMENTED: { text: "Commented", icon: <Icon iconName="Comment" ariaLabel="Commented" /> },
  PENDING: { text: "Waiting", icon: <Icon iconName="Clock" ariaLabel="Waiting for review" /> },
};

function Reviewers({ list }: { list: PrReviewer[] }) {
  return (
    <Section title="Reviewers">
      {list.length ? (
        <>
        <div className="gh-pr-sublabel body-s secondary-text font-weight-semibold">Requested</div>
        <ul className="gh-pr-list">
          {list.map((r) => (
            <li key={r.login} className="flex-row flex-center">
              <VssPersona imageUrl={r.avatarUrl} displayName={r.login} size="small" suppressPersonaCard showInitialsOnImageError />
              <span className="gh-pr-grow text-ellipsis">{r.login}</span>
              <span className="secondary-text body-s">{REVIEW[r.state].text}</span>
              {REVIEW[r.state].icon}
            </li>
          ))}
        </ul>
        </>
      ) : (
        <Well>No reviewers</Well>
      )}
    </Section>
  );
}

function Labels({ pr }: { pr: PrPageData }) {
  return (
    <Section title="Tags">
      {pr.labels.length ? (
        <div className="flex-row flex-wrap gh-pr-labels">
          {pr.labels.map((l) => {
            const color = parseColor(`#${l.color}`);
            return <Pill key={l.name} className="gh-pr-pill" size={PillSize.regular} variant={color ? PillVariant.colored : PillVariant.standard} color={color}>{l.name}</Pill>;
          })}
        </div>
      ) : (
        <Well>No tags</Well>
      )}
    </Section>
  );
}

// ---------- work items (PR-7) ----------

type Wi = { t: "loading" } | { t: "denied" } | { t: "error" } | { t: "ready"; r: WorkItemsResult };

function useWorkItems(ids: number[], version = 0): Wi {
  const [wi, setWi] = React.useState<Wi>({ t: "loading" });
  const key = ids.join(",");
  React.useEffect(() => {
    if (!ids.length) return;
    let dead = false;
    setWi({ t: "loading" });
    fetchWorkItems(ids).then(
      (r) => !dead && setWi({ t: "ready", r }),
      (e) => !dead && setWi({ t: e instanceof PermissionError ? "denied" : "error" })
    );
    return () => { dead = true; };
  }, [key, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return wi;
}

function TypeIcon({ type, r }: { type?: string; r: WorkItemsResult }) {
  const t = (type && r.types[type]) || {};
  const [bad, setBad] = React.useState(false);
  const color = t.color ? `#${t.color}` : "var(--palette-neutral-30, #888)";
  return t.iconUrl && !bad
    ? <img className="gh-pr-wi-icon" src={t.iconUrl} alt="" width={16} height={16} onError={() => setBad(true)} />
    : <span className="gh-pr-wi-icon gh-pr-wi-dot" style={{ background: color }} aria-hidden="true" />;
}

function WorkItemRow({ w, r }: { w: WorkItemRef; r: WorkItemsResult }) {
  if (!w.found) return <li className="secondary-text">AB#{w.id}: not found or no access</li>;
  return (
    <li className="flex-column gh-pr-wi">
      <span className="flex-row flex-center">
        <TypeIcon type={w.type} r={r} />
        <span className="secondary-text body-s">{w.type} #{w.id}</span>
      </span>
      <Link className="gh-pr-wi-title" href={r.url(w.id)} target="_blank" rel="noopener noreferrer">{w.title ?? `#${w.id}`}</Link>
      {w.state && <span className="secondary-text body-s">{w.state}</span>}
    </li>
  );
}

/** `version` is the action store's: completing the work items refetches them. */
function WorkItems({ ids, version }: { ids: number[]; version: number }) {
  const wi = useWorkItems(ids, version);
  let body: React.ReactNode;
  if (!ids.length) body = <Well>No work items</Well>;
  else if (wi.t === "loading") body = <Spinner size={SpinnerSize.small} ariaLabel="Loading work items" />;
  else if (wi.t === "denied") body = <span className="secondary-text">Work items need the extension's work item permission.</span>;
  else if (wi.t === "error") body = <span className="secondary-text">Work items could not be loaded.</span>;
  else body = <ul className="gh-pr-list">{wi.r.items.map((w) => <WorkItemRow key={w.id} w={w} r={wi.r} />)}</ul>;
  return <Section title="Work items">{body}</Section>;
}

function Overview({ pr, repo, prTab, openFile, signIn, busy, actions }: { pr: PrPageData; repo: string; prTab: BrowseState["prTab"]; openFile: (path: string) => void; signIn: () => void; busy: boolean; actions: ActionStore }) {
  return (
    <div className="gh-pr-overview">
      <div className="gh-pr-main">
        {PoliciesCard({ store: actions }) ?? <MergeCard pr={pr} />}
        <Description pr={pr} repo={repo} />
        <ActivityFeed repo={repo} number={pr.number} baseRef={pr.baseRef} prTab={prTab} openFile={openFile} signIn={signIn} busy={busy} />
      </div>
      <div className="gh-pr-aside">
        <Reviewers list={pr.reviewers} />
        <Labels pr={pr} />
        <WorkItems ids={pr.workItemIds} version={actions.version} />
      </div>
    </div>
  );
}

// ---------- Commits (PR-9) ----------

interface CommitRow { sha: string; shortSha: string; title: string; author: string; avatar: string; date: Date }

function commitColumns(repo: string): ITableColumn<CommitRow>[] {
  return [
    {
      id: "commit",
      width: -100,
      renderCell: (_r, columnIndex, tableColumn, c) => (
        <TwoLineTableCell
          key="commit"
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          line1={<span className="gh-pr-commit-title commit-title font-weight-semibold text-ellipsis">{c.title}</span>}
          line2={
            <span className="gh-pr-commit-meta flex-row flex-center secondary-text">
              <Link className="monospaced-xs secondary-text" href={commitUrl(repo, c.sha)} target="_blank" rel="noopener noreferrer" subtle ariaLabel={`Commit ${c.shortSha} on GitHub`}>{c.shortSha}</Link>
              <VssPersona imageUrl={c.avatar} displayName={c.author} size="extra-small" suppressPersonaCard showInitialsOnImageError />
              <span>{c.author}</span>
              <Ago date={c.date} format={AgoFormat.Extended} />
            </span>
          }
        />
      ),
    },
  ];
}

function Commits({ pr, repo }: { pr: PrPageData; repo: string }) {
  const cols = React.useMemo(() => commitColumns(repo), [repo]);
  const provider = React.useMemo(() => new ArrayItemProvider<CommitRow>(pr.commits.map((c, i) => ({ ...c, avatar: pr.commitAvatars[i] ?? "" }))), [pr]);
  return (
    <Card className="gh-pr-card bolt-table-card" contentProps={{ contentPadding: false }}>
      <Table<CommitRow> ariaLabel="Commits" role="table" columns={cols} itemProvider={provider} showHeader={false} spacerWidth={8} />
    </Card>
  );
}

// ---------- the page ----------

type Load = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; pr: PrPageData };

export interface PrPageProps {
  repo: string;
  state: BrowseState & { pr: number };
  /** The list tab to return to. */
  listTab: NonNullable<BrowseState["prTab"]>;
  go: (s: BrowseState, replace?: boolean) => void;
  signedIn: boolean;
  signIn: () => void;
  busy: boolean;
  /** The first item is Open on GitHub, then the ⋯ menu's other items. PrActions turns them all into ⋯ entries. */
  commandBarItems: (url: string) => any[];
}

export function PrPage({ repo, state, listTab, go, signedIn, signIn, busy, commandBarItems }: PrPageProps) {
  const n = state.pr;
  const [load, setLoad] = React.useState<Load>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => watchTheme(setDark), []);
  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "loading" });
    getPr(repo, n).then((pr) => !dead && setLoad({ t: "ready", pr }), (err) => !dead && setLoad({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, n, signedIn, reload]);

  // A reply, resolve or comment invalidated the cached page: refetch it quietly so "x/y comments resolved" follows.
  React.useEffect(() => {
    const offs = [feedStore(repo, n), actionStore(repo, n)].map((store) => {
      let seen = store.version;
      return store.subscribe(() => {
        if (store.version === seen) return;
        seen = store.version;
        getPr(repo, n).then((fresh) => setLoad((l) => (l.t === "ready" ? { t: "ready", pr: fresh } : l)), () => {});
      });
    });
    return () => offs.forEach((off) => off());
  }, [repo, n]);

  const actions = useActions(repo, n);
  const [ui, setUi] = React.useState<Ui>({});
  const page: PrPageId = state.prPage ?? "overview";
  const list: BrowseState = { repo, view: "prs", prTab: listTab };
  const pr = load.t === "ready" ? load.pr : undefined;
  const url = pr?.url ?? `https://github.com/${repo}/pull/${n}`;
  const [openItem, ...restItems] = commandBarItems(url);
  const nav = (p: Partial<BrowseState>, replace?: boolean) => go({ repo, view: "prs", prTab: state.prTab ?? listTab, pr: n, prPage: page, ...p }, replace);

  return (
    <>
      <Header
        className="gh-pr-header"
        title={pr?.title ?? `Pull request #${n}`}
        titleSize={TitleSize.Large /* 21px; see Browser.tsx. Weight is set to native's 400 in browser.css */}
        titleAriaLevel={1}
        commandBarItems={prCommandItems(actions, url, openItem, restItems, setUi)}
        backButtonProps={{ iconProps: { iconName: "Back" }, ariaLabel: "Back to pull requests", tooltipProps: { text: "Back to pull requests" }, onClick: () => go(list) }}
      />
      <div className="gh-pr-sub">
        {pr ? <Meta pr={pr} repo={repo} status={actions.optimisticStatus} /> : <div className="gh-pr-meta" />}
      </div>
      {(actions.error || actions.notice) && (
        <div className="gh-pr-actionmsg">
          {actions.error && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => actions.dismiss()}>{actions.error}</MessageCard>}
          {actions.notice && <MessageCard severity={MessageCardSeverity.Warning} onDismiss={() => actions.dismiss()}>{actions.notice}</MessageCard>}
        </div>
      )}
      <PrActionDialogs store={actions} repo={repo} number={n} workItemIds={pr?.workItemIds ?? []} ui={ui} setUi={setUi} />
      <TabBar ariaLabel="Pull request" selectedTabId={page} onSelectedTabChanged={(id) => nav({ prPage: id as PrPageId, file: undefined })} tabSize={TabSize.Tall} disableSticky>
        {PAGES.map((p) => <Tab key={p.id} id={p.id} name={p.name} />)}
      </TabBar>
      {load.t === "loading" && <div className="page-content page-content-top gh-pr-loading flex-row justify-center"><Spinner size={SpinnerSize.large} ariaLabel="Loading pull request" /></div>}
      {load.t === "error" && (
        <div className="page-content page-content-top">
          <ErrorView err={load.err} signIn={signIn} busy={busy} retry={() => { invalidatePr(); setReload((r) => r + 1); }} subject="see this pull request" permission="Pull requests" />
        </div>
      )}
      {pr && page === "overview" && <div className="page-content page-content-top"><Overview pr={pr} repo={repo} prTab={state.prTab ?? listTab} openFile={(file) => nav({ prPage: "files", file })} signIn={signIn} busy={busy} actions={actions} /></div>}
      {pr && page === "commits" && <div className="page-content page-content-top"><Commits pr={pr} repo={repo} /></div>}
      {pr && page === "files" && <PrFilesTab repo={repo} number={n} pr={pr} selected={state.file} select={(file) => nav({ prPage: "files", file }, true)} dark={dark} signedIn={signedIn} signIn={signIn} busy={busy} />}
    </>
  );
}

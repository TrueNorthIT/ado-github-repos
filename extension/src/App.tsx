import * as React from "react";
import { Page } from "azure-devops-ui/Page";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Card } from "azure-devops-ui/Card";
import { Button } from "azure-devops-ui/Button";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { Link } from "azure-devops-ui/Link";
import { Icon } from "azure-devops-ui/Icon";
import { Table, ITableColumn, SimpleTableCell } from "azure-devops-ui/Table";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { loadProject, PermissionError, ProjectCtx } from "./connections";
import { fetchMetadata } from "./github";
import * as SDK from "azure-devops-extension-sdk";
import { RepoBrowser, hubClick } from "./Browser";
import { PullRequestsHub } from "./PullRequests";
import { connectNav, currentHub } from "./hostNav";
import { CommitsHub } from "./Commits";
import { PushesHub } from "./Pushes";
import { BranchesHub } from "./Branches";
import { TagsHub } from "./Tags";
import { Loading, useDefaultRepo } from "./RepoHub";
import { clearCache } from "./githubBrowse";
import { BrowseState, serialize } from "./lib/browseState";
import { parseRepoUrl, isGitHubDotCom } from "./lib/repoUrl";
import { getTokens, signIn, signOut } from "./auth";
import { Connection, filterRows, mergeRows, Row } from "./lib/rows";
import { relativeTime } from "./lib/tokens";

const NA = "Not available";

function cell(col: ITableColumn<Row>, rowIndex: number, columnIndex: number, text: string) {
  return <SimpleTableCell key={`c${columnIndex}`} columnIndex={columnIndex} tableColumn={col}>{text}</SimpleTableCell>;
}

const columns = (open: (repo: string) => void): ITableColumn<Row>[] => [
  {
    id: "name",
    name: "Repository",
    width: -40,
    renderCell: (rowIndex, columnIndex, tableColumn, row) => (
      <SimpleTableCell key="name" columnIndex={columnIndex} tableColumn={tableColumn}>
        {(() => {
          const ref = parseRepoUrl(row.url);
          // github.com repos open in the hub; the icon still opens GitHub itself (B-1).
          if (!ref || !isGitHubDotCom(ref)) return <Link className="bolt-table-link" subtle removeUnderline href={row.url} target="_blank" rel="noopener noreferrer">{row.label}</Link>;
          const repo = `${ref.owner}/${ref.repo}`;
          return (
            <>
              <Link className="bolt-table-link" subtle removeUnderline href={serialize({ repo })} onClick={hubClick(() => open(repo))}>{row.label}</Link>
              <a className="gh-open-ext" href={row.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${row.label} on GitHub`} title="Open on GitHub"><Icon iconName="OpenInNewTab" /></a>
            </>
          );
        })()}
      </SimpleTableCell>
    ),
  },
  { id: "description", name: "Description", width: -60, renderCell: (r, c, col, row) => cell(col, r, c, row.unavailable ? NA : row.meta?.description ?? "") },
  { id: "language", name: "Language", width: 120, renderCell: (r, c, col, row) => cell(col, r, c, row.meta?.language ?? "") },
  { id: "visibility", name: "Visibility", width: 100, renderCell: (r, c, col, row) => cell(col, r, c, row.meta ? (row.meta.private ? "Private" : "Public") : "") },
  { id: "updated", name: "Updated", width: 140, renderCell: (r, c, col, row) => cell(col, r, c, relativeTime(row.meta?.pushedAt)) },
];

type Load =
  | { state: "loading" }
  | { state: "denied" }
  | { state: "error"; message: string }
  | { state: "ready"; connections: Connection[] };

export function App() {
  const [ctx, setCtx] = React.useState<ProjectCtx | null>(null);
  const [load, setLoad] = React.useState<Load>({ state: "loading" });
  const [signedIn, setSignedIn] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [filterText, setFilterText] = React.useState("");

  // The address bar (host hash) decides between the list and the file browser.
  const [nav, setNav] = React.useState<BrowseState | null>(null);
  const goRef = React.useRef<(s: BrowseState, replace?: boolean) => void>(() => {});
  const go = React.useCallback((s: BrowseState, replace?: boolean) => goRef.current(s, replace), []);
  const [switchTick, setSwitchTick] = React.useState(0);
  React.useEffect(() => {
    connectNav((s) => {
      setNav(s);
      if (s.switch) setSwitchTick((t) => t + 1);
    }).then((g) => (goRef.current = g), () => setNav((n) => n ?? {}));
  }, []);

  // Connections, once.
  React.useEffect(() => {
    (async () => {
      try {
        const p = await loadProject();
        setCtx(p.ctx);
        setLoad({ state: "ready", connections: p.connections });
      } catch (e) {
        setLoad(e instanceof PermissionError ? { state: "denied" } : { state: "error", message: "Could not load GitHub connections." });
      }
    })();
  }, []);

  // Signed-in state from stored tokens, once.
  React.useEffect(() => {
    getTokens().then((t) => setSignedIn(!!t));
  }, []);

  const connections = load.state === "ready" ? load.connections : null;
  const urls = React.useMemo(() => (connections ?? []).flatMap((c) => c.repos.map((r) => r.gitHubRepositoryUrl ?? "")), [connections]);

  // Metadata whenever we're signed in and the repo list is known.
  const [meta, setMeta] = React.useState<Awaited<ReturnType<typeof fetchMetadata>> | undefined>();
  React.useEffect(() => {
    if (!signedIn || !connections) return setMeta(undefined);
    (async () => {
      const t = await getTokens();
      if (!t) return setSignedIn(false);
      setMeta(await fetchMetadata(urls, t.accessToken));
    })();
  }, [signedIn, connections, urls]);

  const merged = React.useMemo(() => mergeRows(connections ?? [], meta), [connections, meta]);
  const rows = filterRows(merged.rows, filterText);
  const listColumns = React.useMemo(() => columns((repo) => go({ repo })), [go]);

  const doSignIn = async () => {
    setNotice(null);
    setBusy(true);
    const r = await signIn();
    setBusy(false);
    if (r.ok) setSignedIn(true);
    else if (r.reason === "blocked") setNotice("The sign-in window was blocked. Allow pop-ups for this site, then try again.");
    else if (r.reason === "error") setNotice(`GitHub sign-in failed${r.error ? `: ${r.error}` : "."}`);
    // "closed": user cancelled; stay signed out.
  };
  const doSignOut = async () => {
    await signOut();
    clearCache();
    setSignedIn(false);
    setMeta(undefined);
  };

  const commandBarItems = signedIn
    ? [{ id: "out", text: "Sign out of GitHub", onActivate: () => { void doSignOut(); } }]
    : [{ id: "in", text: "Sign in with GitHub", iconProps: { iconName: "Contact" }, isPrimary: true, disabled: busy, onActivate: () => { void doSignIn(); } }];

  const signInOut = commandBarItems;
  // Every hub loads this page; the contribution id says which one this is.
  const hub = currentHub();
  // Files opens straight into a repo, as native does: with none in the hash, the first connected repo. The list stays one click away ("All repositories").
  const wantsDefault = hub === "files" && nav !== null && !nav.repo && nav.view !== "repos";
  const fallback = useDefaultRepo(wantsDefault);
  React.useEffect(() => { if (wantsDefault && fallback.repo) go({ repo: fallback.repo }, true); }, [wantsDefault, fallback.repo]); // eslint-disable-line react-hooks/exhaustive-deps
  if (nav === null) return <Page className="flex-grow" />;
  const hubProps = { state: nav, go, openSwitch: switchTick, signedIn, signIn: doSignIn, busy, commandBarItems: signInOut };
  if (hub === "prs") return <PullRequestsHub {...hubProps} />;
  if (hub === "commits") return <CommitsHub {...hubProps} />;
  if (hub === "pushes") return <PushesHub {...hubProps} />;
  if (hub === "branches") return <BranchesHub {...hubProps} />;
  if (hub === "tags") return <TagsHub {...hubProps} />;
  if (wantsDefault && !fallback.none) return <Page className="flex-grow"><Loading label="Opening the first repository" /></Page>;
  if (nav.repo)
    return (
      <Page className="flex-grow">
        <RepoBrowser state={{ ...nav, repo: nav.repo }} go={go} openSwitch={switchTick} signedIn={signedIn} signIn={doSignIn} busy={busy} commandBarItems={signInOut} />
      </Page>
    );

  return (
    <Page className="flex-grow">
      <Header title="GitHub Repos" titleSize={TitleSize.Large} /* 21px/600; Medium is 17px/400 in this version */ description="Repositories connected to this project" commandBarItems={commandBarItems} />
      <div className="page-content page-content-top">
        {notice && <MessageCard severity={MessageCardSeverity.Warning} onDismiss={() => setNotice(null)}>{notice}</MessageCard>}
        {load.state === "denied" && (
          <MessageCard severity={MessageCardSeverity.Error}>
            You don't have permission to read this project's GitHub connections. Ask a project administrator.
          </MessageCard>
        )}
        {load.state === "error" && <MessageCard severity={MessageCardSeverity.Error}>{load.message}</MessageCard>}
        {merged.warnings.map((w) => (
          <MessageCard key={w} severity={MessageCardSeverity.Warning}>{w}</MessageCard>
        ))}
        {!signedIn && load.state === "ready" && merged.rows.length > 0 && (
          <MessageCard severity={MessageCardSeverity.Info} buttonProps={[{ text: "Sign in with GitHub", onClick: doSignIn, disabled: busy }]}>
            Sign in with GitHub to see descriptions, languages and last updated times.
          </MessageCard>
        )}
        {load.state === "ready" && merged.rows.length === 0 && ctx && (
          <ZeroData
            iconProps={{ iconName: "PlugConnected" }}
            imageAltText="No GitHub connections"
            primaryText="No GitHub connections"
            secondaryText="Connect GitHub repositories to this project in Project settings."
            actionText="Open GitHub connections settings"
            actionType={2}
            onActionClick={() => window.open(ctx.settingsUrl, "_blank", "noopener")}
          />
        )}
        {merged.rows.length > 0 && (
          <>
            <TextField
              value={filterText}
              onChange={(_e, v) => setFilterText(v)}
              placeholder="Filter repositories"
              ariaLabel="Filter repositories by name"
              prefixIconProps={{ iconName: "Search" }}
              width={TextFieldWidth.standard}
            />
            <Card className="flex-grow bolt-table-card" contentProps={{ contentPadding: false }}>
              <Table<Row> columns={listColumns} itemProvider={new ArrayItemProvider(rows)} role="table" />
            </Card>
          </>
        )}
      </div>
    </Page>
  );
}

// Actions > Environments (native ADO: Pipelines > Environments): the environments list, then one environment's deployment history.
// REST only (lib/environments.ts). Routed by the Actions hash: actTab=environments, plus actEnv for an environment.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { Table, ITableColumn, SimpleTableCell, TableColumnLayout, TwoLineTableCell } from "azure-devops-ui/Table";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import type { HubProps } from "./RepoHub";
import { PersonLine, skeletonRows } from "./RepoHub";
import { ErrorView } from "./Browser";
import { RelDate } from "./RelDate";
import { RunStatusIcon } from "./ActionsUi";
import { latestDeployment, listDeployments, listEnvironmentDetails } from "./actionsApi";
import { serializeActions, type ActionsHashState } from "./lib/actionsHash";
import { deploymentState, deploymentStateText, runIdOfStatus, type Deployment, type Environment } from "./lib/environments";

type Go = (s: Omit<ActionsHashState, "repo">, replace?: boolean) => void;

const shortSha = (s: string) => s.slice(0, 7);
const plainClick = (e: React.MouseEvent | React.KeyboardEvent, go: () => void) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || (e as React.MouseEvent).button) return;
  e.preventDefault();
  go();
};
const envHref = (repo: string, env: string) => serializeActions({ repo, tab: "environments", env });
const runHref = (repo: string, run: number) => serializeActions({ repo, run });
const lastActivity = (d: Deployment) => d.status?.createdAt ?? d.createdAt;

// ---------- the list ----------

interface EnvRow {
  env: Environment;
  latest?: Deployment;
}

function envColumns(repo: string, openEnv: (name: string) => void, openRun: (id: number) => void): ITableColumn<EnvRow>[] {
  return [
    {
      name: "", id: "status",
      width: 40,
      columnLayout: TableColumnLayout.none,
      renderCell: (_r, i, c, row) => (
        <SimpleTableCell key="status" columnIndex={i} tableColumn={c}>
          {row.latest ? <RunStatusIcon state={deploymentState(row.latest.status?.state)} /> : <span className="secondary-text" aria-label="Never deployed">–</span>}
        </SimpleTableCell>
      ),
    },
    {
      name: "Environment", id: "name",
      width: -40,
      columnLayout: TableColumnLayout.twoLine,
      renderCell: (_r, i, c, row) => (
        <TwoLineTableCell
          key="name"
          columnIndex={i}
          tableColumn={c}
          line1={<Link className="body-l" subtle removeUnderline href={envHref(repo, row.env.name)} onClick={(e) => plainClick(e, () => openEnv(row.env.name))}>{row.env.name}</Link>}
          line2={<span className="secondary-text body-s gh-act-line2">{row.env.protections.join(" · ") || "No protection rules"}</span>}
        />
      ),
    },
    {
      name: "Last deployment", id: "latest",
      width: -60,
      columnLayout: TableColumnLayout.twoLine,
      renderCell: (_r, i, c, row) => {
        const d = row.latest;
        if (!d) return <SimpleTableCell key="latest" columnIndex={i} tableColumn={c}><span className="secondary-text">Never deployed</span></SimpleTableCell>;
        const run = runIdOfStatus(d.status, repo);
        return (
          <TwoLineTableCell
            key="latest"
            columnIndex={i}
            tableColumn={c}
            line1={
              run ? (
                <Link className="body-m" subtle removeUnderline href={runHref(repo, run)} onClick={(e) => plainClick(e, () => openRun(run))}>{d.ref || shortSha(d.sha)}</Link>
              ) : <Link className="body-m" subtle removeUnderline>{d.ref || shortSha(d.sha)}</Link> /* a Link without href, so the text lines up with the linked rows */
            }
            line2={<span className="secondary-text body-s gh-act-line2">{deploymentStateText(d.status?.state)} · <span className="monospaced-xs">{shortSha(d.sha)}</span>{d.creator && <> · {d.creator.name}</>}</span>}
          />
        );
      },
    },
    {
      name: "", id: "time",
      width: 150,
      renderCell: (_r, i, c, row) => (
        <SimpleTableCell key="time" columnIndex={i} tableColumn={c}>
          <span className="secondary-text">{row.latest ? <RelDate date={lastActivity(row.latest)} /> : null}</span>
        </SimpleTableCell>
      ),
    },
  ];
}

type Load<T> = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; v: T };

function EnvironmentList({ repo, go, props }: { repo: string; go: Go; props: HubProps }) {
  const [load, setLoad] = React.useState<Load<EnvRow[]>>({ t: "loading" });
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "loading" });
    (async () => {
      const envs = await listEnvironmentDetails(repo);
      // One small read per environment for its latest deployment (repositories rarely have more than a handful).
      const latest = await Promise.all(envs.slice(0, 50).map((e) => latestDeployment(repo, e.name)));
      return envs.map((env, i): EnvRow => ({ env, latest: latest[i] }));
    })().then((v) => !dead && setLoad({ t: "ready", v }), (err) => !dead && setLoad({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, props.signedIn, n]);
  const openEnv = React.useCallback((name: string) => go({ tab: "environments", env: name }), [go]);
  const openRun = React.useCallback((id: number) => go({ run: id }), [go]);
  const cols = React.useMemo(() => envColumns(repo, openEnv, openRun), [repo, openEnv, openRun]);
  const rows = load.t === "ready" ? load.v : undefined;
  const provider = React.useMemo(() => (rows ? new ArrayItemProvider(rows) : skeletonRows<EnvRow>(4)), [rows]);
  if (load.t === "error") return <ErrorView err={load.err} signIn={() => void props.signIn()} busy={props.busy} retry={() => setN((x) => x + 1)} subject="see this repository's environments" permission="Environments" />;
  if (rows && !rows.length) {
    return <ZeroData iconProps={{ iconName: "Rocket" }} imageAltText="" primaryText="No environments" secondaryText="Environments appear here once a workflow job names one (environment:) or one is added in the repository settings." />;
  }
  return (
    <Card className="gh-pr-card bolt-table-card" contentProps={{ contentPadding: false }}>
      <Table<EnvRow> ariaLabel={rows ? "Environments" : "Loading environments"} role="table" columns={cols} itemProvider={provider} showHeader spacerWidth={8} singleClickActivation onActivate={(_e, r) => openEnv(r.data.env.name)} />
    </Card>
  );
}

// ---------- one environment ----------

function deploymentColumns(repo: string, openRun: (id: number) => void): ITableColumn<Deployment>[] {
  return [
    {
      name: "", id: "status",
      width: 40,
      columnLayout: TableColumnLayout.none,
      renderCell: (_r, i, c, d) => (
        <SimpleTableCell key="status" columnIndex={i} tableColumn={c}>
          <RunStatusIcon state={deploymentState(d.status?.state)} />
        </SimpleTableCell>
      ),
    },
    {
      name: "Deployment", id: "title",
      width: -100,
      columnLayout: TableColumnLayout.twoLine,
      renderCell: (_r, i, c, d) => {
        const run = runIdOfStatus(d.status, repo);
        const title = d.status?.description || d.description || `${d.task === "deploy" ? "Deploy" : d.task} ${d.ref || shortSha(d.sha)}`;
        return (
          <TwoLineTableCell
            key="title"
            columnIndex={i}
            tableColumn={c}
            line1={
              run ? (
                <Link className="body-l" subtle removeUnderline href={runHref(repo, run)} onClick={(e) => plainClick(e, () => openRun(run))}>{title}</Link>
              ) : <Link className="body-l" subtle removeUnderline href={d.status?.targetUrl ?? undefined} target={d.status?.targetUrl ? "_blank" : undefined}>{title}</Link>
            }
            line2={
              <span className="secondary-text body-s gh-act-line2">
                {deploymentStateText(d.status?.state)} · {d.ref || "no ref"} · <span className="monospaced-xs">{shortSha(d.sha)}</span>{d.task !== "deploy" && <> · {d.task}</>}
                {d.status?.environmentUrl && <> · <Link href={d.status.environmentUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{d.status.environmentUrl.replace(/^https?:\/\//, "")}</Link></>}
              </span>
            }
          />
        );
      },
    },
    {
      name: "Deployed by", id: "creator",
      width: 170,
      columnLayout: TableColumnLayout.singleLinePrefix,
      renderCell: (_r, i, c, d) => (
        <SimpleTableCell key="creator" columnIndex={i} tableColumn={c}>
          {d.creator && <PersonLine person={d.creator} />}
        </SimpleTableCell>
      ),
    },
    {
      name: "", id: "time",
      width: 150,
      renderCell: (_r, i, c, d) => (
        <SimpleTableCell key="time" columnIndex={i} tableColumn={c}>
          <span className="secondary-text"><RelDate date={lastActivity(d)} /></span>
        </SimpleTableCell>
      ),
    },
  ];
}

type HistoryState = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; rows: Deployment[]; next?: number };

function EnvironmentHistory({ repo, env, go, props }: { repo: string; env: string; go: Go; props: HubProps }) {
  const [s, setS] = React.useState<HistoryState>({ t: "loading" });
  const [more, setMore] = React.useState(false);
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let dead = false;
    setS({ t: "loading" });
    listDeployments(repo, env).then((r) => !dead && setS({ t: "ready", rows: r.deployments, next: r.next }), (err) => !dead && setS({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, env, props.signedIn, n]);
  const openRun = React.useCallback((id: number) => go({ run: id }), [go]);
  const cols = React.useMemo(() => deploymentColumns(repo, openRun), [repo, openRun]);
  const rows = s.t === "ready" ? s.rows : undefined;
  const provider = React.useMemo(() => (rows ? new ArrayItemProvider(rows) : skeletonRows<Deployment>()), [rows]);
  const loadMore = async () => {
    if (s.t !== "ready" || !s.next) return;
    setMore(true);
    try {
      const r = await listDeployments(repo, env, s.next);
      setS((o) => (o.t === "ready" ? { t: "ready", rows: [...o.rows, ...r.deployments.filter((x) => !o.rows.some((y) => y.id === x.id))], next: r.next } : o));
    } catch (err) {
      setS({ t: "error", err });
    }
    setMore(false);
  };
  let body: React.ReactNode;
  if (s.t === "error") body = <ErrorView err={s.err} signIn={() => void props.signIn()} busy={props.busy} retry={() => setN((x) => x + 1)} subject="see this environment's deployments" permission="Deployments" />;
  else if (rows && !rows.length) body = <ZeroData iconProps={{ iconName: "Rocket" }} imageAltText="" primaryText="No deployments yet" secondaryText={`Deployments to ${env} appear here.`} />;
  else {
    const ready = s.t === "ready" ? s : undefined;
    body = (
      <>
        <Card className="gh-pr-card bolt-table-card" contentProps={{ contentPadding: false }}>
          <Table<Deployment> ariaLabel={rows ? `Deployments to ${env}` : "Loading deployments"} role="table" columns={cols} itemProvider={provider} showHeader spacerWidth={8} />
        </Card>
        {ready?.next && (
          <div className="gh-act-more flex-row justify-center">
            <Button text={more ? "Loading" : "Load more"} disabled={more} onClick={() => void loadMore()} />
          </div>
        )}
      </>
    );
  }
  return (
    <>
      <Header
        className="gh-hub-header gh-act-header"
        title={env}
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        backButtonProps={{ ariaLabel: "All environments", onClick: () => go({ tab: "environments" }) }}
        commandBarItems={[{ id: "gh", text: "Open on GitHub", iconProps: { iconName: "OpenInNewTab" }, href: `https://github.com/${repo}/deployments/${encodeURIComponent(env)}`, target: "_blank", important: true }]}
      />
      <div className="page-content page-content-top gh-pr-body flex-column">{body}</div>
    </>
  );
}

/** The Environments tab body (the list), or, with `env`, that environment's page (which replaces the hub header). */
export function EnvironmentsTab({ repo, env, go, props }: { repo: string; env?: string; go: Go; props: HubProps }) {
  return env ? <EnvironmentHistory key={`${repo}/${env}`} repo={repo} env={env} go={go} props={props} /> : <EnvironmentList key={repo} repo={repo} go={go} props={props} />;
}

/** Whether the environments page replaces the hub's header and tabs. */
export const isEnvironmentPage = (st: ActionsHashState) => st.tab === "environments" && !!st.env;

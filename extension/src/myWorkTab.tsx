// TEST: the "GitHub" tab in Azure DevOps's My work flyout (the top bar's checklist icon), contributed to ms.vss-tfs-web.my-work-pivot
// beside ADO's own Work items / Pull requests / Favorites tabs. That tab group is undocumented; this tab exists to find out whether the
// flyout shows an extension's iframe tab at all, and what context it hands it. It lists the viewer's open pull requests across every
// repository the GitHub App can see, and links out to github.com (mapping a repository to the ADO project that connects it comes later).
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import "azure-devops-ui/Core/override.css";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Surface, SurfaceBackground } from "azure-devops-ui/Surface";
import { ITableColumn, SimpleTableCell, Table, TableColumnLayout, TwoLineTableCell } from "azure-devops-ui/Table";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { ObservableValue, type IReadonlyObservableValue } from "azure-devops-ui/Core/Observable";
import { ArrayItemProvider, type IItemProvider } from "azure-devops-ui/Utilities/Provider";
import { getTokens, signIn } from "./auth";
import { GhError, restJson } from "./githubBrowse";
import { RelDate } from "./RelDate";
import { actorName } from "./lib/botIdentity";
import "./myWorkTab.css"; // after the components, so its rules follow theirs (.bolt-link.subtle pads titles otherwise)
import { MY_WORK_SECTIONS, myWorkSearchPath, toMyWorkRows, type MyWorkRow, type MyWorkSection } from "./lib/myWork";

type Load = { t: "loading" } | { t: "signedOut" } | { t: "error"; message: string } | { t: "ready"; login: string; sections: Record<MyWorkSection, { total: number; rows: MyWorkRow[] }> };

const skeleton = new ArrayItemProvider(Array.from({ length: 3 }, () => new ObservableValue<undefined>(undefined))) as unknown as IItemProvider<MyWorkRow | IReadonlyObservableValue<MyWorkRow | undefined>>;

const columns: ITableColumn<MyWorkRow>[] = [
  {
    id: "avatar",
    width: 44,
    columnLayout: TableColumnLayout.none, // the title column's twoLinePrefix draws the avatar's shimmer
    renderCell: (_r, columnIndex, tableColumn, row) => (
      <SimpleTableCell key="avatar" columnIndex={columnIndex} tableColumn={tableColumn}>
        <VssPersona imageUrl={row.avatarUrl} displayName={actorName(row.authorLogin)} size="medium" suppressPersonaCard showInitialsOnImageError />
      </SimpleTableCell>
    ),
  },
  {
    id: "title",
    width: -100,
    columnLayout: TableColumnLayout.twoLinePrefix,
    renderCell: (_r, columnIndex, tableColumn, row) => (
      <TwoLineTableCell
        key="title"
        columnIndex={columnIndex}
        tableColumn={tableColumn}
        line1={
          <div className="flex-row flex-center gh-mw-line1">
            <Link className="gh-mw-title text-ellipsis" subtle removeUnderline href={row.url} target="_blank" rel="noopener noreferrer">{row.title}</Link>
            {row.draft && <Pill className="gh-mw-pill" size={PillSize.compact} variant={PillVariant.outlined}>Draft</Pill>}
          </div>
        }
        line2={
          <span className="secondary-text body-s text-ellipsis">
            {actorName(row.authorLogin)} request #{row.number} into {row.repo} · <RelDate date={row.updatedAt} />
          </span>
        }
      />
    ),
  },
];

function Section({ title, data }: { title: string; data?: { total: number; rows: MyWorkRow[] } }) {
  const items = React.useMemo(() => (data ? new ArrayItemProvider(data.rows) : skeleton), [data]);
  return (
    <Card className="gh-mw-card bolt-table-card" contentProps={{ contentPadding: false }} headerClassName="gh-mw-card-header" renderHeader={() => <Header title={data ? `${title} (${data.total})` : title} titleSize={TitleSize.Medium} titleAriaLevel={2} />}>
      {data && !data.rows.length ? (
        <div className="gh-mw-empty secondary-text body-m">No open pull requests</div>
      ) : (
        <Table<MyWorkRow> ariaLabel={title} columns={columns} itemProvider={items} showHeader={false} showLines singleClickActivation onActivate={(_e, r) => window.open(r.data.url, "_blank", "noopener")} />
      )}
    </Card>
  );
}

function MyWorkTab() {
  const [load, setLoad] = React.useState<Load>({ t: "loading" });
  const [busy, setBusy] = React.useState(false);
  const run = React.useCallback(async () => {
    setLoad({ t: "loading" });
    if (!(await getTokens())) return setLoad({ t: "signedOut" });
    try {
      const [me, ...found] = await Promise.all([restJson<{ login: string }>({ method: "GET", path: "/user" }), ...MY_WORK_SECTIONS.map((s) => restJson({ method: "GET", path: myWorkSearchPath(s.id) }))]);
      const sections = Object.fromEntries(MY_WORK_SECTIONS.map((s, i) => [s.id, toMyWorkRows(found[i].body)])) as Record<MyWorkSection, { total: number; rows: MyWorkRow[] }>;
      setLoad({ t: "ready", login: me.body.login, sections });
    } catch (e) {
      if (e instanceof GhError && e.kind === "auth") return setLoad({ t: "signedOut" });
      console.warn("[GitHub my work] load failed", e);
      setLoad({ t: "error", message: e instanceof GhError && e.kind === "rateLimit" ? "GitHub's search rate limit was reached. Try again in a minute." : "Could not load your GitHub pull requests." });
    }
  }, []);
  React.useEffect(() => void run(), [run]);
  React.useEffect(() => SDK.resize()); // after each render, in case the flyout sizes the frame to its content

  const doSignIn = async () => {
    setBusy(true);
    const r = await signIn();
    setBusy(false);
    if (r.ok) void run();
  };

  return (
    <Surface background={SurfaceBackground.neutral}>
      <div className="gh-mw flex-column">
        {load.t === "signedOut" ? (
          <MessageCard className="gh-mw-message" severity={MessageCardSeverity.Info} buttonProps={[{ text: "Sign in to GitHub", onClick: () => void doSignIn(), disabled: busy }]}>
            Sign in to GitHub to see the pull requests you created or were asked to review.
          </MessageCard>
        ) : load.t === "error" ? (
          <MessageCard className="gh-mw-message" severity={MessageCardSeverity.Error} buttonProps={[{ text: "Retry", onClick: () => void run() }]}>{load.message}</MessageCard>
        ) : (
          MY_WORK_SECTIONS.map((s) => <Section key={s.id} title={s.title} data={load.t === "ready" ? load.sections[s.id] : undefined} />)
        )}
        {load.t !== "signedOut" && <div className="gh-mw-footer flex-row flex-center justify-center">
          <Button subtle text="View more on GitHub" href="https://github.com/pulls" target="_blank" rel="noopener noreferrer" />
        </div>}
      </div>
    </Surface>
  );
}

SDK.init({ loaded: false, applyTheme: true }).then(() => {
  // What the flyout hands an extension tab: logged so the first live run tells us (contribution id, host, configuration keys, frame size).
  console.info("[GitHub my work] contribution", SDK.getContributionId(), "host", SDK.getHost()?.name, "config", Object.keys(SDK.getConfiguration() ?? {}), "frame", `${innerWidth}x${innerHeight}`);
  ReactDOM.render(<MyWorkTab />, document.getElementById("root"));
  void SDK.notifyLoadSucceeded();
});

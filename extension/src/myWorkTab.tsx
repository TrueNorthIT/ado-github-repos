// The "GitHub" tab in Azure DevOps's My work flyout (the top bar's checklist icon), contributed to ms.vss-tfs-web.my-work-pivot beside
// ADO's own Work items / Pull requests / Favorites tabs. That tab group is undocumented. It lists the viewer's open pull requests in
// repositories that some project in this organisation connects (Azure Boards GitHub connections), and opens each in our PR hub in that
// project; a repository connected to several projects asks which one.
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import "azure-devops-ui/Core/override.css";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Surface, SurfaceBackground } from "azure-devops-ui/Surface";
import { ITableColumn, SimpleTableCell, Table, TableColumnLayout, TwoLineTableCell } from "azure-devops-ui/Table";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { ObservableValue, type IReadonlyObservableValue } from "azure-devops-ui/Core/Observable";
import { ArrayItemProvider, type IItemProvider } from "azure-devops-ui/Utilities/Provider";
import { RelDate } from "./RelDate";
import { QueryProvider } from "./queryPersist";
import { activateRow, hostLinkClick, myPrsHubHref, prHref, titleClick, useMyPrs, useOpener, type Opener } from "./myPrsShared";
import { actorName } from "./lib/botIdentity";
import "./myWorkTab.css"; // after the components, so its rules follow theirs (.bolt-link.subtle pads titles otherwise)
import { MY_WORK_SECTIONS, type ConnectedRow } from "./lib/myWork";

const skeleton = new ArrayItemProvider(Array.from({ length: 3 }, () => new ObservableValue<undefined>(undefined))) as unknown as IItemProvider<ConnectedRow | IReadonlyObservableValue<ConnectedRow | undefined>>;

function columns(open: Opener): ITableColumn<ConnectedRow>[] {
  return [
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
              {/* The href is the first project's page, for a middle click or "open in new tab"; a plain click goes through open(). */}
              <Link className="gh-mw-title text-ellipsis" subtle removeUnderline href={prHref(row, row.projects[0])} onClick={titleClick(row, open)}>
                {row.title}
              </Link>
              {row.draft && <Pill className="gh-mw-pill" size={PillSize.compact} variant={PillVariant.outlined}>Draft</Pill>}
            </div>
          }
          line2={
            <span className="secondary-text body-s text-ellipsis">
              {actorName(row.authorLogin)} request #{row.number} into {row.repo}{row.projects.length > 1 ? ` · ${row.projects.length} projects` : ""} · <RelDate date={row.updatedAt} />
            </span>
          }
        />
      ),
    },
  ];
}

function Section({ title, rows, open }: { title: string; rows?: ConnectedRow[]; open: Opener }) {
  const items = React.useMemo(() => (rows ? new ArrayItemProvider(rows) : skeleton), [rows]);
  const cols = React.useMemo(() => columns(open), [open]);
  return (
    <Card className="gh-mw-card bolt-table-card" contentProps={{ contentPadding: false }} headerClassName="gh-mw-card-header" renderHeader={() => <Header title={rows ? `${title} (${rows.length})` : title} titleSize={TitleSize.Medium} titleAriaLevel={2} />}>
      {rows && !rows.length ? (
        <div className="gh-mw-empty secondary-text body-m">No open pull requests</div>
      ) : (
        <Table<ConnectedRow>
          ariaLabel={title}
          columns={cols}
          itemProvider={items}
          showHeader={false}
          showLines
          singleClickActivation
          onActivate={activateRow(open)}
        />
      )}
    </Card>
  );
}

function MyWorkTab() {
  const { search, projects, sections, reload, signIn, busy } = useMyPrs();
  const [open, menu] = useOpener();
  const index = projects.t === "ready" ? projects.index : undefined;

  let body: React.ReactNode;
  if (search.t === "signedOut")
    body = (
      <MessageCard className="gh-mw-message" severity={MessageCardSeverity.Info} buttonProps={[{ text: "Sign in to GitHub", onClick: () => void signIn(), disabled: busy }]}>
        Sign in to GitHub to see the pull requests you created or were asked to review.
      </MessageCard>
    );
  else if (search.t === "error") body = <MessageCard className="gh-mw-message" severity={MessageCardSeverity.Error} buttonProps={[{ text: "Retry", onClick: () => void reload() }]}>{search.message}</MessageCard>;
  else if (projects.t === "error") body = <MessageCard className="gh-mw-message" severity={MessageCardSeverity.Warning}>{projects.message}</MessageCard>;
  else if (index && !index.size)
    body = <ZeroData iconProps={{ iconName: "PlugConnected" }} imageAltText="" primaryText="No GitHub repositories" secondaryText="Pull requests show here once a project connects a GitHub repository (Project settings, GitHub connections)." />;
  else
    body = (
      <>
        {projects.t === "ready" && projects.partial && <MessageCard className="gh-mw-message" severity={MessageCardSeverity.Info}>Showing repositories connected to this project only, until an administrator approves the extension's updated permissions.</MessageCard>}
        {MY_WORK_SECTIONS.map((s) => <Section key={s.id} title={s.title} rows={sections?.[s.id]} open={open} />)}
      </>
    );

  return (
    <Surface background={SurfaceBackground.neutral}>
      <div className="gh-mw flex-column">
        <div className="gh-mw-scroll flex-column">{body}</div>
        <div className="gh-mw-footer flex-row flex-center justify-center">
          <Link className="gh-mw-more" href={myPrsHubHref()} onClick={hostLinkClick(myPrsHubHref())}>View more</Link>
        </div>
      </div>
      {menu}
    </Surface>
  );
}

/** The flyout seems to give the frame the tab's height; if it gives a small default instead, ask for a flyout-sized frame. */
function fitFrame() {
  if (innerHeight >= 400) return;
  SDK.resize(undefined, Math.max(420, Math.min(900, screen.availHeight - 260)));
}

SDK.init({ loaded: false, applyTheme: true }).then(() => {
  // What the flyout hands an extension tab: logged so a live run tells us (contribution id, host, configuration keys, frame size).
  console.info("[GitHub my work] contribution", SDK.getContributionId(), "host", SDK.getHost()?.name, "config", Object.keys(SDK.getConfiguration() ?? {}), "frame", `${innerWidth}x${innerHeight}`);
  fitFrame();
  ReactDOM.render(<QueryProvider><MyWorkTab /></QueryProvider>, document.getElementById("root"));
  void SDK.notifyLoadSucceeded();
});

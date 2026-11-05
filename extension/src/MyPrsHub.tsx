// The organisation-level "GitHub pull requests" page: a hub in ADO's Home hub group (ms.vss-tfs-web.suite-me-page-hub-group, beside
// Search's organisation-wide page), so it belongs to no project and can list pull requests from every project's GitHub repositories.
// The My work flyout's "View more" opens it. Same data as the flyout tab (myPrsShared.tsx), laid out like the PR hub's Mine tab.
import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Icon, IconSize } from "azure-devops-ui/Icon";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Page } from "azure-devops-ui/Page";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Surface, SurfaceBackground } from "azure-devops-ui/Surface";
import { ITableColumn, SimpleTableCell, Table, TableColumnLayout, TwoLineTableCell } from "azure-devops-ui/Table";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { RelDate } from "./RelDate";
import { skeletonRows } from "./RepoHub";
import { activateRow, prHref, titleClick, useMyPrs, useOpener, type Opener } from "./myPrsShared";
import { actorName } from "./lib/botIdentity";
import { MY_WORK_SECTIONS, type ConnectedRow } from "./lib/myWork";

function columns(open: Opener): ITableColumn<ConnectedRow>[] {
  return [
    {
      id: "avatar",
      width: 48,
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
            <div className="flex-row flex-center gh-pr-line1">
              <Link className="gh-pr-title body-l" subtle removeUnderline href={prHref(row, row.projects[0])} onClick={titleClick(row, open)}>{row.title}</Link>
              {row.draft && <Pill className="gh-pr-pill" size={PillSize.compact} variant={PillVariant.outlined}>Draft</Pill>}
            </div>
          }
          line2={
            <span className="secondary-text body-s gh-pr-line2">
              {actorName(row.authorLogin)} request #{row.number} into <Icon iconName="OpenSource" size={IconSize.small} className="gh-pr-branch-icon" />
              <span className="gh-pr-branch">{row.repo}</span>
            </span>
          }
        />
      ),
    },
    {
      id: "project",
      width: 220,
      renderCell: (_r, columnIndex, tableColumn, row) => (
        <SimpleTableCell key="project" columnIndex={columnIndex} tableColumn={tableColumn}>
          <span className="flex-row flex-center secondary-text text-ellipsis gh-myprs-project" title={row.projects.join(", ")}>
            <Icon iconName="ProjectCollection" size={IconSize.small} />
            <span className="text-ellipsis">{row.projects.length > 1 ? `${row.projects[0]} and ${row.projects.length - 1} more` : row.projects[0]}</span>
          </span>
        </SimpleTableCell>
      ),
    },
    {
      id: "updated",
      width: 150,
      renderCell: (_r, columnIndex, tableColumn, row) => (
        <SimpleTableCell key="updated" columnIndex={columnIndex} tableColumn={tableColumn}>
          <span className="secondary-text">Updated <RelDate date={row.updatedAt} /></span>
        </SimpleTableCell>
      ),
    },
  ];
}

/** `rows` undefined while loading: the title shows with shimmer rows. Collapsible with a count, as the PR hub's Mine sections. */
function Section({ title, rows, open }: { title: string; rows?: ConnectedRow[]; open: Opener }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const cols = React.useMemo(() => columns(open), [open]);
  const items = React.useMemo(() => (rows ? new ArrayItemProvider(rows) : skeletonRows<ConnectedRow>(3)), [rows]);
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
          {rows && <Pill containsCount size={PillSize.regular} variant={PillVariant.standard} ariaLabel={`${rows.length} pull requests`}>{rows.length}</Pill>}
        </div>
      )}
    >
      {rows && !rows.length ? (
        <div className="gh-pr-section-empty secondary-text">No pull requests</div>
      ) : (
        <Table<ConnectedRow> ariaLabel={title} role="table" columns={cols} itemProvider={items} showHeader={false} spacerWidth={8} singleClickActivation onActivate={activateRow(open)} />
      )}
    </Card>
  );
}

export function MyPrsHub() {
  const { search, projects, sections, reload, signIn, busy } = useMyPrs();
  const [open, menu] = useOpener();
  const index = projects.t === "ready" ? projects.index : undefined;

  let body: React.ReactNode;
  if (search.t === "signedOut")
    body = <ZeroData iconProps={{ iconName: "BranchPullRequest" }} imageAltText="" primaryText="Sign in to GitHub" secondaryText="Sign in to see the GitHub pull requests you created or were asked to review, across every project." actionText="Sign in with GitHub" onActionClick={() => void signIn()} />;
  else if (search.t === "error") body = <MessageCard severity={MessageCardSeverity.Error} buttonProps={[{ text: "Retry", onClick: () => reload() }]}>{search.message}</MessageCard>;
  else if (projects.t === "error") body = <MessageCard severity={MessageCardSeverity.Warning}>{projects.message}</MessageCard>;
  else if (index && !index.size)
    body = <ZeroData iconProps={{ iconName: "PlugConnected" }} imageAltText="" primaryText="No GitHub repositories" secondaryText="Pull requests show here once a project connects a GitHub repository (Project settings, GitHub connections)." />;
  else
    body = (
      <>
        {projects.t === "ready" && projects.partial && <MessageCard severity={MessageCardSeverity.Info}>Showing repositories connected to this project only, until an administrator approves the extension's updated permissions.</MessageCard>}
        {MY_WORK_SECTIONS.map((s) => <Section key={s.id} title={s.title} rows={sections?.[s.id]} open={open} />)}
      </>
    );

  return (
    <Surface background={SurfaceBackground.neutral}>
      <Page className="gh-page flex-grow">
        <Header
          className="gh-hub-header gh-myprs-header"
          title="GitHub pull requests"
          titleSize={TitleSize.Large}
          titleAriaLevel={1}
          commandBarItems={[
            { id: "refresh", text: "Refresh", iconProps: { iconName: "Refresh" }, important: true, disabled: busy || search.t === "loading", onActivate: () => reload() },
            { id: "github", text: "View on GitHub", iconProps: { iconName: "OpenInNewTab" }, important: true, href: "https://github.com/pulls", target: "_blank" },
          ]}
        />
        <div className="page-content page-content-top gh-pr-body flex-column">{body}</div>
      </Page>
      {menu}
    </Surface>
  );
}

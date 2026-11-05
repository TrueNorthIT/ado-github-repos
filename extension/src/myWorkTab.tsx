// The "GitHub" tab in Azure DevOps's My work flyout (the top bar's checklist icon), contributed to ms.vss-tfs-web.my-work-pivot beside
// ADO's own Work items / Pull requests / Favorites tabs. That tab group is undocumented. It lists the viewer's open pull requests in
// repositories that some project in this organisation connects (Azure Boards GitHub connections), and opens each in our PR hub in that
// project; a repository connected to several projects asks which one.
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import type { IHostNavigationService } from "azure-devops-extension-api/Common/CommonServices";
import "azure-devops-ui/Core/override.css";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { ContextualMenu, MenuItemType } from "azure-devops-ui/Menu";
import { Location } from "azure-devops-ui/Utilities/Position";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Surface, SurfaceBackground } from "azure-devops-ui/Surface";
import { ITableColumn, SimpleTableCell, Table, TableColumnLayout, TwoLineTableCell } from "azure-devops-ui/Table";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { ObservableValue, type IReadonlyObservableValue } from "azure-devops-ui/Core/Observable";
import { ArrayItemProvider, type IItemProvider } from "azure-devops-ui/Utilities/Provider";
import { getTokens, signIn } from "./auth";
import { GhError, restJson } from "./githubBrowse";
import { hubHref } from "./hostNav";
import { RelDate } from "./RelDate";
import { useProjectIndex } from "./myWorkProjects";
import { actorName } from "./lib/botIdentity";
import "./myWorkTab.css"; // after the components, so its rules follow theirs (.bolt-link.subtle pads titles otherwise)
import { MY_WORK_SECTIONS, myWorkSearchPath, onlyConnected, toMyWorkRows, type ConnectedRow, type MyWorkRow, type MyWorkSection } from "./lib/myWork";

const NAV_SERVICE = "ms.vss-features.host-navigation-service";

type Search = { t: "loading" } | { t: "signedOut" } | { t: "error"; message: string } | { t: "ready"; sections: Record<MyWorkSection, MyWorkRow[]> };

const skeleton = new ArrayItemProvider(Array.from({ length: 3 }, () => new ObservableValue<undefined>(undefined))) as unknown as IItemProvider<ConnectedRow | IReadonlyObservableValue<ConnectedRow | undefined>>;

const org = () => SDK.getHost().name;
/** The PR page in our Pull requests hub, in one project. */
const prHref = (row: MyWorkRow, project: string) => hubHref({ org: org(), project }, "prs", { repo: row.repo, view: "prs", pr: row.number });
const navigate = async (url: string) => (await SDK.getService<IHostNavigationService>(NAV_SERVICE)).navigate(url);

/** Opens a row: straight to its project, or a menu of projects beside `anchor` when several connect the repository. */
type Opener = (row: ConnectedRow, anchor: HTMLElement) => void;

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
              <Link className="gh-mw-title text-ellipsis" subtle removeUnderline href={prHref(row, row.projects[0])} onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) return; e.preventDefault(); e.stopPropagation(); open(row, e.currentTarget as HTMLElement); }}>
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
          onActivate={(e, r) => open(r.data, ((e.target as HTMLElement).closest(".bolt-table-row") as HTMLElement | null) ?? (e.currentTarget as HTMLElement))}
        />
      )}
    </Card>
  );
}

function MyWorkTab() {
  const projects = useProjectIndex();
  const [search, setSearch] = React.useState<Search>({ t: "loading" });
  const [busy, setBusy] = React.useState(false);
  const [menu, setMenu] = React.useState<{ row: ConnectedRow; anchor: HTMLElement }>();

  const run = React.useCallback(async () => {
    setSearch({ t: "loading" });
    if (!(await getTokens())) return setSearch({ t: "signedOut" });
    try {
      const found = await Promise.all(MY_WORK_SECTIONS.map((s) => restJson({ method: "GET", path: myWorkSearchPath(s.id) })));
      setSearch({ t: "ready", sections: Object.fromEntries(MY_WORK_SECTIONS.map((s, i) => [s.id, toMyWorkRows(found[i].body).rows])) as Record<MyWorkSection, MyWorkRow[]> });
    } catch (e) {
      if (e instanceof GhError && e.kind === "auth") return setSearch({ t: "signedOut" });
      console.warn("[GitHub my work] search failed", e);
      setSearch({ t: "error", message: e instanceof GhError && e.kind === "rateLimit" ? "GitHub's search rate limit was reached. Try again in a minute." : "Could not load your GitHub pull requests." });
    }
  }, []);
  React.useEffect(() => void run(), [run]);

  const open = React.useCallback<Opener>((row, anchor) => {
    if (row.projects.length === 1) void navigate(prHref(row, row.projects[0]));
    else setMenu({ row, anchor });
  }, []);

  const doSignIn = async () => {
    setBusy(true);
    const r = await signIn();
    setBusy(false);
    if (r.ok) void run();
  };

  const index = projects.t === "ready" ? projects.index : undefined;
  const sections = React.useMemo(
    () => (search.t === "ready" && index ? (Object.fromEntries(MY_WORK_SECTIONS.map((s) => [s.id, onlyConnected(search.sections[s.id], index)])) as Record<MyWorkSection, ConnectedRow[]>) : undefined),
    [search, index]
  );

  let body: React.ReactNode;
  if (search.t === "signedOut")
    body = (
      <MessageCard className="gh-mw-message" severity={MessageCardSeverity.Info} buttonProps={[{ text: "Sign in to GitHub", onClick: () => void doSignIn(), disabled: busy }]}>
        Sign in to GitHub to see the pull requests you created or were asked to review.
      </MessageCard>
    );
  else if (search.t === "error") body = <MessageCard className="gh-mw-message" severity={MessageCardSeverity.Error} buttonProps={[{ text: "Retry", onClick: () => void run() }]}>{search.message}</MessageCard>;
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
          <Link className="gh-mw-more" href="https://github.com/pulls" target="_blank" rel="noopener noreferrer">View more</Link>
        </div>
      </div>
      {menu && (
        <ContextualMenu
          anchorElement={menu.anchor}
          anchorOrigin={{ horizontal: Location.start, vertical: Location.end }}
          menuOrigin={{ horizontal: Location.start, vertical: Location.start }}
          onDismiss={() => setMenu(undefined)}
          menuProps={{
            id: "gh-mw-projects",
            items: [
              { id: "heading", text: "Open in project", itemType: MenuItemType.Header },
              ...menu.row.projects.map((p) => ({ id: p, text: p, iconProps: { iconName: "ProjectCollection" }, href: prHref(menu.row, p), onActivate: () => { setMenu(undefined); void navigate(prHref(menu.row, p)); return false; } })),
            ],
          }}
        />
      )}
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
  ReactDOM.render(<MyWorkTab />, document.getElementById("root"));
  void SDK.notifyLoadSucceeded();
});

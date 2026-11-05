// What the My work flyout's GitHub tab (myWorkTab.tsx) and the organisation-level "GitHub pull requests" page (MyPrsHub.tsx) share:
// the viewer's open pull requests from GitHub search, kept to repositories some project connects, and opening one in its project
// (a menu of projects when several connect the repository).
import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import type { IHostNavigationService } from "azure-devops-extension-api/Common/CommonServices";
import { ContextualMenu, MenuItemType } from "azure-devops-ui/Menu";
import { Location } from "azure-devops-ui/Utilities/Position";
import { getTokens, signIn } from "./auth";
import { GhError, restJson } from "./githubBrowse";
import { hubHref } from "./hostNav";
import { queryClient, useGh } from "./queryClient";
import { useProjectIndex, type ProjectsLoad } from "./myWorkProjects";
import { MY_WORK_SECTIONS, myWorkSearchPath, onlyConnected, toMyWorkRows, type ConnectedRow, type MyWorkRow, type MyWorkSection } from "./lib/myWork";

const NAV_SERVICE = "ms.vss-features.host-navigation-service";
/** The organisation-level page's contribution (vss-extension.json), in the Home hub group, so it belongs to no project. */
export const MY_PRS_HUB = "github-my-prs-hub";

const org = () => SDK.getHost().name;
/** A sibling contribution's full id, from this frame's own (publisher.extension.<id>). */
const siblingId = (id: string) => SDK.getContributionId().replace(/[^.]+$/, id);

/** The PR page in our Pull requests hub, in one project. */
export const prHref = (row: MyWorkRow, project: string) => hubHref({ org: org(), project }, "prs", { repo: row.repo, view: "prs", pr: row.number });
/** The organisation-level GitHub pull requests page. */
export const myPrsHubHref = () => `https://dev.azure.com/${encodeURIComponent(org())}/_apps/hub/${siblingId(MY_PRS_HUB)}`;
export const navigate = async (url: string) => (await SDK.getService<IHostNavigationService>(NAV_SERVICE)).navigate(url);

type Search = { t: "loading" } | { t: "signedOut" } | { t: "error"; message: string } | { t: "ready"; sections: Record<MyWorkSection, MyWorkRow[]> };

export interface MyPrs {
  search: Search;
  projects: ProjectsLoad;
  /** Each section's rows in connected repositories; undefined until both the search and the project index are in. */
  sections?: Record<MyWorkSection, ConnectedRow[]>;
  reload: () => void;
  signIn: () => Promise<void>;
  busy: boolean;
}

/** No GitHub sign-in: an error rather than an answer, so it is never kept between visits (only successful reads are persisted). */
class SignedOut extends Error {}

type Sections = Record<MyWorkSection, MyWorkRow[]>;

async function searchMine(): Promise<Sections> {
  if (!(await getTokens())) throw new SignedOut();
  try {
    const found = await Promise.all(MY_WORK_SECTIONS.map((s) => restJson({ method: "GET", path: myWorkSearchPath(s.id) })));
    return Object.fromEntries(MY_WORK_SECTIONS.map((s, i) => [s.id, toMyWorkRows(found[i].body).rows])) as Sections;
  } catch (e) {
    if (e instanceof GhError && e.kind === "auth") throw new SignedOut();
    console.warn("[GitHub my work] search failed", e);
    throw e;
  }
}

export function useMyPrs(): MyPrs {
  const projects = useProjectIndex();
  const [busy, setBusy] = React.useState(false);
  // Kept between visits: the flyout and the page open with the last list while GitHub is asked again.
  const load = useGh(["prs", "mine-org"], searchMine, { persist: true });
  const search: Search =
    load.t === "ready" ? { t: "ready", sections: load.v }
    : load.t === "loading" ? { t: "loading" }
    : load.err instanceof SignedOut ? { t: "signedOut" }
    : { t: "error", message: load.err instanceof GhError && load.err.kind === "rateLimit" ? "GitHub's search rate limit was reached. Try again in a minute." : "Could not load your GitHub pull requests." };
  const run = React.useCallback(() => void queryClient.refetchQueries({ queryKey: ["prs", "mine-org"] }), []);

  const doSignIn = React.useCallback(async () => {
    setBusy(true);
    const r = await signIn();
    setBusy(false);
    if (r.ok) run();
  }, [run]);

  const index = projects.t === "ready" ? projects.index : undefined;
  const sections = React.useMemo(
    () => (search.t === "ready" && index ? (Object.fromEntries(MY_WORK_SECTIONS.map((s) => [s.id, onlyConnected(search.sections[s.id], index)])) as Record<MyWorkSection, ConnectedRow[]>) : undefined),
    [search, index]
  );
  return { search, projects, sections, reload: run, signIn: doSignIn, busy };
}

/** Opens a row: straight to its project, or a menu of projects beside `anchor` when several connect the repository. */
export type Opener = (row: ConnectedRow, anchor: HTMLElement) => void;

/** The opener, and the project menu to render somewhere in the page. */
export function useOpener(): [Opener, React.ReactNode] {
  const [menu, setMenu] = React.useState<{ row: ConnectedRow; anchor: HTMLElement }>();
  const open = React.useCallback<Opener>((row, anchor) => {
    if (row.projects.length === 1) void navigate(prHref(row, row.projects[0]));
    else setMenu({ row, anchor });
  }, []);
  const element = menu ? (
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
  ) : null;
  return [open, element];
}

/** A row's title link: the first project's page as its href (middle click, "open in new tab"); a plain click goes through open(). */
export const titleClick = (row: ConnectedRow, open: Opener) => (e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || ("button" in e && e.button !== 0)) return;
  e.preventDefault();
  e.stopPropagation();
  open(row, e.currentTarget);
};

/** A plain click on a link into another page goes through the host's navigation (a frame can't move the top window itself). */
export const hostLinkClick = (url: string) => (e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  void navigate(url);
};

/** The Table's onActivate (row click or Enter): opens the row, anchoring a project menu on the row itself. */
export const activateRow = (open: Opener) => (e: React.SyntheticEvent<HTMLElement>, r: { data: ConnectedRow }) =>
  open(r.data, ((e.target as HTMLElement).closest(".bolt-table-row") as HTMLElement | null) ?? (e.currentTarget as HTMLElement));

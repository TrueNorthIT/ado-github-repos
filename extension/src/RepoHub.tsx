// Shared parts of the Repos hubs (Commits, Pushes, Branches, Tags): the page shell with the repo fallback, the repo switcher
// item, the branch picker bar, the table helpers and the person cell. Each hub is its own page (same hub.html, routed by contribution id).
import * as React from "react";
import { Page } from "azure-devops-ui/Page";
import { Surface, SurfaceBackground } from "azure-devops-ui/Surface";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { Icon, IconSize } from "azure-devops-ui/Icon";
import { Status, Statuses, StatusSize } from "azure-devops-ui/Status";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { ObservableValue, type IReadonlyObservableValue } from "azure-devops-ui/Core/Observable";
import { ArrayItemProvider, type IItemProvider } from "azure-devops-ui/Utilities/Provider";
import { BrowseState } from "./lib/browseState";
import { filterBranches } from "./lib/branchSwitch";
import { RelDate } from "./RelDate";
import type { CheckStatus, Person } from "./lib/commitsQuery";
import { loadProject } from "./connections";
import { pickDefaultRepo, recallRepo } from "./lib/lastRepo";
import { mergeRows } from "./lib/rows";
import { isGitHubDotCom, parseRepoUrl } from "./lib/repoUrl";
import { getRepo, listBranches } from "./githubBrowse";
import { BranchPicker, RepoSwitcher } from "./Browser";
import "./browser.css";

export interface HubProps {
  state: BrowseState;
  go: (s: BrowseState, replace?: boolean | "ifEmpty") => void;
  /** Bumped each time the header breadcrumb asks for the repo switcher. */
  openSwitch: number;
  signedIn: boolean;
  signIn: () => Promise<void>;
  busy: boolean;
  commandBarItems: { id: string; text: string; iconProps?: { iconName: string }; disabled?: boolean; onActivate: () => void }[];
}

/** The repo for a hub opened with no repo in the hash (the left nav carries none): the one you last had open in this project if it is
 *  still connected (lib/lastRepo.ts), otherwise the first connected github.com repo. */
export function useDefaultRepo(enabled: boolean): { repo?: string; none: boolean } {
  const [r, setR] = React.useState<{ repo?: string; none: boolean }>({ none: false });
  React.useEffect(() => {
    if (!enabled) return;
    let dead = false;
    loadProject().then(
      (p) => {
        const connected = mergeRows(p.connections).rows.filter((x) => { const ref = parseRepoUrl(x.url); return ref && isGitHubDotCom(ref); }).map((x) => x.label);
        const repo = pickDefaultRepo(connected, recallRepo(p.ctx.org, p.ctx.project));
        if (!dead) setR({ repo, none: !repo });
      },
      () => !dead && setR({ none: true })
    );
    return () => { dead = true; };
  }, [enabled]);
  return r;
}

export const Loading = ({ label = "Loading" }: { label?: string }) => (
  <div className="gh-pr-loading flex-row flex-center justify-center"><Spinner size={SpinnerSize.large} ariaLabel={label} /></div>
);

const skeletons = new Map<number, IItemProvider<unknown>>();
/**
 * The native loading state of a Table: rows whose item is an ObservableValue holding undefined render as shimmer rows, shaped by each
 * column's `columnLayout`. Pass this as the itemProvider (same Table, same columns) until the real rows arrive.
 */
export function skeletonRows<T>(n = 8): IItemProvider<T | IReadonlyObservableValue<T | undefined>> {
  let p = skeletons.get(n);
  if (!p) skeletons.set(n, (p = new ArrayItemProvider(Array.from({ length: n }, () => new ObservableValue<undefined>(undefined)))));
  return p as IItemProvider<T | IReadonlyObservableValue<T | undefined>>;
}

/** Fills the first connected repo into the hash (no history entry), then renders `children(repo)` inside the neutral page. */
export function RepoHubPage({ state, go, children }: { state: BrowseState; go: HubProps["go"]; children: (repo: string) => React.ReactNode }) {
  const fallback = useDefaultRepo(!state.repo);
  const repo = state.repo;
  React.useEffect(() => { if (!state.repo && fallback.repo) go({ repo: fallback.repo }, "ifEmpty"); }, [state.repo, fallback.repo]); // eslint-disable-line react-hooks/exhaustive-deps
  let body: React.ReactNode;
  if (repo) body = children(repo);
  else if (fallback.none) body = <ZeroData iconProps={{ iconName: "PlugConnected" }} imageAltText="No GitHub connections" primaryText="No GitHub repositories" secondaryText="Connect GitHub repositories to this project in Project settings." />;
  else body = <Loading />;
  return (
    <Surface background={SurfaceBackground.neutral}>
      <Page className="gh-page flex-grow">{body}</Page>
    </Surface>
  );
}

/** The repo switcher beside a page title: pass it as the Header's child (Header renders children in its title area; CSS lays that out as a row). */
export const titleSwitcher = (repo: string, openSwitch: number, onPick: (r: string) => void) => <RepoSwitcher compact repo={repo} openTick={openSwitch} onPick={onPick} />;

// ---------- repo facts ----------

const infos = new Map<string, Promise<{ defaultBranch: string }>>();
/** The repo's default branch (cached per repo; a failure is retried next time). */
export function useDefaultBranch(repo: string): { defaultBranch?: string; err?: unknown } {
  const [r, setR] = React.useState<{ defaultBranch?: string; err?: unknown }>({});
  React.useEffect(() => {
    let dead = false;
    setR({});
    let p = infos.get(repo);
    if (!p) infos.set(repo, (p = getRepo(repo)));
    p.then((i) => !dead && setR({ defaultBranch: i.defaultBranch }), (err) => { infos.delete(repo); if (!dead) setR({ err }); });
    return () => { dead = true; };
  }, [repo]);
  return r;
}

/** Forgets the cached default branch (after "Set as default branch"), so the next useDefaultBranch reads it again. */
export const forgetDefaultBranch = (repo: string) => void infos.delete(repo);

/** The branch picker, as on Files: loads the branch names when first opened. `onPick` gets the branch. */
/** `inTitle`: the page-header form, on the title row after the repo switcher (Commits, Pushes), instead of its own row above the header. */
export function BranchBar({ repo, current, defaultBranch, onPick, inTitle }: { repo: string; current: string; defaultBranch?: string; onPick: (branch: string) => void; inTitle?: boolean }) {
  const [branches, setBranches] = React.useState<string[] | undefined>();
  const [query, setQuery] = React.useState("");
  React.useEffect(() => setBranches(undefined), [repo]);
  const items = filterBranches(branches ?? [], query, defaultBranch).map((b) => ({ id: b, text: b }));
  return (
    <div className={inTitle ? "gh-title-branch flex-row flex-center flex-noshrink" : "gh-topbar flex-row flex-center flex-noshrink"}>
      <BranchPicker
        refName={current}
        items={items}
        loading={!branches}
        onOpen={() => { if (!branches) listBranches(repo).then(setBranches, () => setBranches([])); }}
        setQuery={setQuery}
        onSelect={onPick}
      />
    </div>
  );
}

// ---------- cells ----------

/** A 16px avatar (azure-devops-ui VssPersona) with the person's name, as in native's commit rows. */
export const PersonLine = ({ person, size = "extra-extra-small", className = "" }: { person: Person; size?: "extra-extra-small" | "small"; className?: string }) => (
  <span className={`gh-person flex-row flex-center ${className}`}>
    <VssPersona imageUrl={person.avatarUrl} displayName={person.name} size={size} suppressPersonaCard showInitialsOnImageError />
    <span className="gh-person-name text-ellipsis">{person.name}</span>
  </span>
);

/** "Today at 14:18", "6 Nov 2025 at 13:43": native's commit date (a time.bolt-time-item). */
export const CommitTime = ({ date }: { date: Date }) => (
  <RelDate className="gh-commit-date" date={date} />
);

const STATUS: Record<CheckStatus, { s: (typeof Statuses)[keyof typeof Statuses]; text: string; cls: string }> = {
  succeeded: { s: Statuses.Success, text: "succeeded", cls: "gh-status-ok" },
  failed: { s: Statuses.Failed, text: "failed", cls: "gh-status-bad" },
  running: { s: Statuses.Running, text: "running", cls: "gh-status-run" },
};

/** The check rollup as azure-devops-ui's Status icon plus its word. `compact` drops the word ("suc..." is native's own truncation, we show the icon with a title). */
export function CheckStatusCell({ status }: { status: CheckStatus | null }) {
  if (!status) return null;
  const x = STATUS[status];
  return (
    <span className={`gh-status flex-row flex-center ${x.cls}`}>
      <Status {...x.s} size={StatusSize.m} ariaLabel={x.text} />
      <span className="gh-status-text">{x.text}</span>
    </span>
  );
}

export const PrCell = ({ number, onOpen, href }: { number: number | null; onOpen: (n: number) => void; href?: string }) =>
  number === null ? null : (
    <a className="gh-pr-ref bolt-table-link font-weight-semibold font-size-mm flex-row flex-center" href={href} onClick={(e) => { if (!(e.ctrlKey || e.metaKey || e.shiftKey || e.button)) { e.preventDefault(); onOpen(number); } }}>
      <Icon iconName="BranchPullRequest" size={IconSize.small} className="gh-pr-ref-icon" />
      <span>{number}</span>
    </a>
  );

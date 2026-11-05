// The Tags page's Releases tab (REL): list, detail view, reactions, delete, and the Tags | Releases tab bar. The draft/edit form is ReleaseForm.tsx.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Icon, IconSize } from "azure-devops-ui/Icon";
import { ITableColumn, SimpleTableCell, Table } from "azure-devops-ui/Table";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { Link } from "azure-devops-ui/Link";
import { MenuButton, MoreButton } from "azure-devops-ui/Menu";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { TextField } from "azure-devops-ui/TextField";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import type { BrowseState, TagTabId } from "./lib/browseState";
import { filterByKind, filterReleases, formatBytes, kindCounts, pageReleases, RELEASE_KINDS, type ReleaseKind, releaseBadges, RELEASE_REACTIONS, sourceArchives, type Release, type ReleaseBadge, type ReleasesPage } from "./lib/releases";
import { normaliseReactions, reactionDefs, visibleReactions, toggleOptimistically, type ReactionContent, type ReactionState } from "./lib/reactions";
import { prepareMarkdownHtml } from "./lib/markdown";
import { ErrorView, Markdown } from "./Browser";
import { REACTION_LABEL } from "./CommentParts";
import { HubProps, Loading, PersonLine, titleSwitcher } from "./RepoHub";
import { ConfirmDeleteDialog } from "./RefDialogs";
import { RelDate } from "./RelDate";
import { ReleaseForm } from "./ReleaseForm";
import { deleteRelease, invalidateReleases, listAllReleases, releaseReact } from "./githubBrowse";
import { dropQueries, useGh } from "./queryClient";
import { openInHub, useHubHref } from "./repoHref";
import { useRefWrites } from "./refWrites";
import "./browser.css";

/** Tags | Releases, under the page header. Switching keeps the repo and drops the rest. */
export function TagTabs({ repo, tab, go }: { repo: string; tab: TagTabId; go: HubProps["go"] }) {
  return (
    <TabBar ariaLabel="Tags and releases" selectedTabId={tab} onSelectedTabChanged={(id) => go(id === "releases" ? { repo, tagTab: "releases" } : { repo })} tabSize={TabSize.Tall} disableSticky>
      <Tab id="tags" name="Tags" />
      <Tab id="releases" name="Releases" />
    </TabBar>
  );
}

const BADGE: Record<ReleaseBadge, { text: string; cls: string; variant: PillVariant }> = {
  latest: { text: "Latest", cls: "gh-rel-pill-latest", variant: PillVariant.colored },
  prerelease: { text: "Pre-release", cls: "gh-rel-pill-pre", variant: PillVariant.colored },
  draft: { text: "Draft", cls: "gh-rel-pill-draft", variant: PillVariant.outlined },
};

function ReleaseReactions({ release }: { release: Release }) {
  const [state, setState] = React.useState<ReactionState[]>(() => normaliseReactions(release.reactions));
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setState(normaliseReactions(release.reactions)), [release]);
  const react = async (c: ReactionContent) => {
    setBusy(true);
    setFailed(false);
    const r = await toggleOptimistically(state, c, (add) => releaseReact(release.id, c, add), setState);
    setBusy(false);
    if (!r.ok) setFailed(true);
  };
  const shown = visibleReactions(state);
  const can = release.viewerCanReact;
  if (!shown.length && !can) return null;
  const items = reactionDefs()
    .filter((d) => RELEASE_REACTIONS.includes(d.content))
    .map((d) => {
      const mine = !!state.find((r) => r.content === d.content)?.viewerHasReacted;
      return {
        id: d.content,
        text: `${d.emoji}  ${REACTION_LABEL[d.content]}`,
        ariaLabel: `${mine ? "Remove" : "Add"} ${REACTION_LABEL[d.content]} reaction`,
        secondaryText: mine ? "✓" : undefined,
        disabled: busy,
        onActivate: () => void react(d.content),
      };
    });
  return (
    <div className="gh-reactions flex-row flex-center" role="group" aria-label="Reactions">
      {shown.map((r) => (
        <Button key={r.content} className={`gh-reaction ${r.viewerHasReacted ? "gh-reaction-mine" : ""}`} ariaPressed={r.viewerHasReacted} ariaLabel={`${REACTION_LABEL[r.content]}: ${r.count}${r.viewerHasReacted ? ", including you" : ""}`} disabled={!can || busy} onClick={() => void react(r.content)}>
          <span aria-hidden="true">{r.emoji}</span>
          <span className="gh-reaction-count" aria-hidden="true">{r.count}</span>
        </Button>
      ))}
      {can && <MenuButton className="gh-reaction-add" subtle hideDropdownIcon iconProps={{ iconName: "AddReaction" }} ariaLabel="Add reaction" tooltipProps={{ text: "Add reaction" }} contextualMenuProps={{ menuProps: { id: `gh-rel-react-${release.id}`, items } }} />}
      {failed && <span className="gh-rel-error" role="alert">Could not save the reaction.</span>}
    </div>
  );
}

type AssetRow = { name: string; url: string; icon: string; size?: number; downloads?: number };

const ASSET_COLUMNS: ITableColumn<AssetRow>[] = [
  {
    id: "name", name: "Name", width: -100,
    renderCell: (_r, i, c, a) => (
      <SimpleTableCell key="name" columnIndex={i} tableColumn={c}>
        <Icon iconName={a.icon} size={IconSize.small} className="gh-rel-asset-icon" />
        <Link href={a.url} rel="noopener noreferrer">{a.name}</Link>
      </SimpleTableCell>
    ),
  },
  { id: "size", name: "Size", width: 120, renderCell: (_r, i, c, a) => <SimpleTableCell key="size" columnIndex={i} tableColumn={c}><span className="secondary-text">{a.size === undefined ? "" : formatBytes(a.size)}</span></SimpleTableCell> },
  { id: "downloads", name: "Downloads", width: 120, renderCell: (_r, i, c, a) => <SimpleTableCell key="downloads" columnIndex={i} tableColumn={c}><span className="secondary-text">{a.downloads === undefined ? "" : a.downloads}</span></SimpleTableCell> },
];

/** A release's downloads: a collapsed "Assets N" toggle over an azure-devops-ui Table (files, then the two source archives). */
function Assets({ repo, release }: { repo: string; release: Release }) {
  const [open, setOpen] = React.useState(false);
  const rows = React.useMemo<AssetRow[]>(() => [
    ...release.assets.map((a) => ({ name: a.name, url: a.downloadUrl, icon: "Package", size: a.size, downloads: a.downloadCount })),
    ...sourceArchives(repo, release.tagName).map((a) => ({ name: a.name, url: a.url, icon: "ZipFolder" })),
  ], [repo, release]);
  const provider = React.useMemo(() => new ArrayItemProvider(rows), [rows]);
  return (
    <div className="gh-rel-assets">
      <Button subtle ariaExpanded={open} iconProps={{ iconName: open ? "ChevronDown" : "ChevronRight" }} onClick={() => setOpen((o) => !o)}>
        <span className="font-weight-semibold">Assets</span>
        <Pill className="gh-rel-count" size={PillSize.compact} variant={PillVariant.standard}>{String(rows.length)}</Pill>
      </Button>
      {open && <Table<AssetRow> className="gh-rel-asset-table" ariaLabel={`Assets of ${release.name}`} role="table" columns={ASSET_COLUMNS} itemProvider={provider} containerClassName="h-scroll-hidden" />}
    </div>
  );
}

function ReleaseCard({ repo, release, props, detail, canWrite, onDelete }: { repo: string; release: Release; props: HubProps; detail?: boolean; canWrite: boolean; onDelete: (r: Release) => void }) {
  const { go } = props;
  const href = useHubHref();
  const detailState: BrowseState = { repo, tagTab: "releases", release: release.tagName };
  const prepared = React.useMemo(
    () => (release.descriptionHTML.trim() ? prepareMarkdownHtml(release.descriptionHTML, { owner: repo.split("/")[0], name: repo.split("/")[1], ref: release.tagName, dir: "" }) : null),
    [release, repo]
  );
  const when = release.publishedAt ?? release.createdAt;
  const commitState: BrowseState = { repo, commit: release.commitOid };
  const badges = releaseBadges(release);
  return (
    <Card className={`gh-pr-card gh-rel-card ${detail ? "gh-rel-detail" : ""}`}>
      <div className="gh-rel-row flex-row">
        <div className="gh-rel-side flex-column">
          <span className="flex-row flex-center gh-rel-tag"><Icon iconName="Tag" size={IconSize.small} /><span className="text-ellipsis" title={release.tagName}>{release.tagName}</span></span>
          {release.commitOid && <Link className="gh-sha-link monospaced-xs" href={href("commits", commitState)} onClick={openInHub("commits", commitState)} ariaLabel={`Commit ${release.commitOid.slice(0, 8)}`}>{release.commitOid.slice(0, 8)}</Link>}
          {release.author && <PersonLine person={release.author} />}
          <RelDate className="secondary-text body-s" date={when} />
        </div>
        <div className="gh-rel-main flex-column flex-grow">
          <div className="gh-rel-head flex-row flex-center">
            {detail ? (
              <h2 className="gh-rel-title">{release.name}</h2>
            ) : (
              <Link className="gh-rel-title" href={href("tags", detailState)} onClick={(e) => { if (e && !(e.ctrlKey || e.metaKey || e.shiftKey || (e as React.MouseEvent).button)) { e.preventDefault(); go(detailState); } }}>{release.name}</Link>
            )}
            {badges.map((b) => <Pill key={b} className={`gh-rel-pill ${BADGE[b].cls}`} size={PillSize.compact} variant={BADGE[b].variant}>{BADGE[b].text}</Pill>)}
            <span className="flex-grow" />
            {canWrite && (
              <MoreButton
                ariaLabel={`Actions for release ${release.name}`}
                contextualMenuProps={{
                  menuProps: {
                    id: `gh-rel-menu-${release.id}`,
                    items: [
                      { id: "edit", text: "Edit", iconProps: { iconName: "Edit" }, onActivate: () => go({ repo, tagTab: "releases", releaseForm: "edit", release: release.tagName }) },
                      { id: "delete", text: "Delete", iconProps: { iconName: "Delete" }, onActivate: () => onDelete(release) },
                    ],
                  },
                }}
              />
            )}
          </div>
          {prepared && <Markdown prepared={prepared} repo={repo} refName={release.tagName} go={go} />}
          <Assets repo={repo} release={release} />
          <ReleaseReactions release={release} />
        </div>
      </div>
    </Card>
  );
}

const KIND_LABEL: Record<ReleaseKind, string> = { all: "All", published: "Published", prerelease: "Pre-releases", draft: "Drafts" };
const NONE_LABEL: Record<ReleaseKind, string> = { all: "No releases match", published: "No published releases match", prerelease: "No pre-releases match", draft: "No drafts match" };

export function ReleasesTab({ repo, props }: { repo: string; props: HubProps }) {
  const { state, go, openSwitch, signedIn } = props;
  const writes = useRefWrites();
  const data = useGh<ReleasesPage>(["refs", "releases", repo], () => listAllReleases(repo), { persist: true });
  const [query, setQuery] = React.useState(state.q ?? "");
  const [del, setDel] = React.useState<Release | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => { if ((state.q ?? "") !== query.trim()) go({ ...state, q: query.trim() || undefined, relPage: undefined }, true); }, 300);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = data.t === "ready" ? data.v : undefined;
  const canWrite = !!v?.viewerCanWrite;
  const searched = React.useMemo(() => filterReleases(v?.releases ?? [], state.q ?? ""), [v, state.q]);
  const kind: ReleaseKind = state.relKind ?? "all";
  const counts = React.useMemo(() => kindCounts(searched), [searched]);
  const list = React.useMemo(() => filterByKind(searched, kind), [searched, kind]);
  const paged = pageReleases(list, state.relPage ?? 1);
  const refresh = () => (invalidateReleases(), dropQueries(["refs", "releases", repo]));
  const draft = () => go({ repo, tagTab: "releases", releaseForm: "new" });
  const back = () => go({ repo, tagTab: "releases" });
  // The form is a panel over the page: over the release being edited, else over the list (a new release's `release` is only the tag to preset).
  const detailTag = state.release && state.releaseForm !== "new" ? state.release : undefined;
  const form = state.releaseForm;
  const closeDel = () => { if (!writes.busy) { setDel(null); writes.clearError(); } };
  const doDelete = (r: Release) => void writes.run(() => deleteRelease(repo, r.databaseId), () => { setDel(null); setNotice(`Deleted release ${r.name}. The tag ${r.tagName} is still there.`); if (detailTag) back(); refresh(); });

  const draftButton = canWrite ? [{ id: "draft", text: "Draft a new release", isPrimary: true, important: true, onActivate: draft }] : [];
  const searchItem = {
    id: "search", text: "Search releases", important: true,
    renderButton: () => <TextField key="search" className="gh-ref-search" value={query} onChange={(_e, t) => setQuery(t)} placeholder="Search releases" ariaLabel="Search releases" prefixIconProps={{ iconName: "Filter" }} />,
  };

  let body: React.ReactNode;
  if (data.t === "error") {
    body = <ErrorView err={data.err} signIn={() => void props.signIn()} busy={props.busy} retry={refresh} subject="see this repository's releases" permission="Contents" />;
  } else if (!v) {
    body = <Loading label="Loading releases" />;
  } else if (detailTag) {
    const r = v.releases.find((x) => x.tagName === detailTag);
    body = (
      <>
        {r ? <ReleaseCard repo={repo} release={r} props={props} detail canWrite={canWrite} onDelete={setDel} /> : <ZeroData iconProps={{ iconName: "Tag" }} imageAltText="" primaryText="Release not found" secondaryText={`There is no release for ${detailTag}.`} />}
      </>
    );
  } else if (!v.releases.length) {
    body = (
      <Card className="gh-pr-card gh-refs-card gh-tags-empty" contentProps={{ contentPadding: false }}>
        <div className="flex-column flex-center">
          <ZeroData iconProps={{ iconName: "Tag" }} imageAltText="" primaryText="No releases yet" secondaryText="Releases package a tag with notes and downloads." />
          {canWrite && <Button primary onClick={draft}>Draft a new release</Button>}
        </div>
      </Card>
    );
  } else {
    // Drafts are only listed for writers, so their chip is too.
    const chips = RELEASE_KINDS.filter((k) => k !== "draft" || canWrite);
    const chipRow = (
      <div className="gh-rel-chips flex-row flex-center" role="group" aria-label="Show releases">
        {chips.map((k) => (
          <Button
            key={k}
            className={`gh-rel-chip ${k === kind ? "gh-rel-chip-on" : ""}`}
            subtle
            ariaPressed={k === kind}
            onClick={() => go({ ...state, relKind: k === "all" ? undefined : k, relPage: undefined })}
          >
            {KIND_LABEL[k]} <span className="gh-rel-chip-count">{counts[k]}</span>
          </Button>
        ))}
      </div>
    );
    body = !list.length ? (
      <>
        {chipRow}
        <ZeroData iconProps={{ iconName: "Tag" }} imageAltText="" primaryText={NONE_LABEL[kind]} />
      </>
    ) : (
      <>
        {chipRow}
        {paged.items.map((r) => <ReleaseCard key={r.id} repo={repo} release={r} props={props} canWrite={canWrite} onDelete={setDel} />)}
        {paged.pageCount > 1 && (
          <nav className="gh-rel-pager flex-row flex-center" aria-label="Releases pages">
            <Button disabled={paged.page <= 1} onClick={() => go({ ...state, relPage: paged.page - 1 })}>Previous</Button>
            <span className="secondary-text">Page {paged.page} of {paged.pageCount}</span>
            <Button disabled={paged.page >= paged.pageCount} onClick={() => go({ ...state, relPage: paged.page + 1 })}>Next</Button>
          </nav>
        )}
      </>
    );
  }

  return (
    <>
      <Header
        className="gh-hub-header gh-act-header"
        title="Tags & Releases"
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        // A release's own page goes back with the Header's back button, as the PR, Branch policies and alert pages do.
        backButtonProps={detailTag ? { iconProps: { iconName: "Back" }, ariaLabel: "Back to releases", tooltipProps: { text: "Back to releases" }, onClick: back } : undefined}
        commandBarItems={detailTag ? draftButton : [...draftButton, searchItem]}
      >
        {titleSwitcher(repo, openSwitch, (r) => go({ repo: r, tagTab: "releases" }))}
      </Header>
      <TagTabs repo={repo} tab="releases" go={go} />
      <div className="page-content page-content-top gh-pr-body flex-column">
        {notice && <MessageCard severity={MessageCardSeverity.Info} onDismiss={() => setNotice(null)}>{notice}</MessageCard>}
        {writes.error && !del && <MessageCard severity={MessageCardSeverity.Error} onDismiss={writes.clearError}>{writes.error}</MessageCard>}
        {body}
      </div>
      {form && (
        <ReleaseForm
          repo={repo}
          mode={form}
          tag={state.release}
          signedIn={signedIn}
          onDone={(tag) => { refresh(); go({ repo, tagTab: "releases", release: tag }); }}
          onCancel={() => go(form === "edit" && state.release ? { repo, tagTab: "releases", release: state.release } : { repo, tagTab: "releases" })}
        />
      )}
      {del && <ConfirmDeleteDialog what="release" name={del.name} busy={writes.busy} error={writes.error} clearError={writes.clearError} confirm={() => doDelete(del)} close={closeDel} />}
    </>
  );
}

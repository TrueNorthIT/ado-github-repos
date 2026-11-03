// The "Branches" hub (B-1 to B-5): branches in folders with their head commit, behind and ahead of the default branch,
// favourites, and create / delete. Behind and ahead load lazily, a few compares at a time.
import * as React from "react";
import { RelDate } from "./RelDate";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { MoreButton } from "azure-devops-ui/Menu";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { TextField } from "azure-devops-ui/TextField";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { Icon, IconSize } from "azure-devops-ui/Icon";
import type { BranchTabId } from "./lib/browseState";
import { barWidths, branchesToCompare, buildRefTree, canDeleteBranch, filterByTab, inBatches, maxDivergence, STALE_DAYS, type AheadBehind, type Branch, type RefLeaf } from "./lib/branches";
import { ErrorView } from "./Browser";
import { CheckStatusCell, HubProps, Loading, PersonLine, PrCell, RepoHubPage, switcherItem } from "./RepoHub";
import { NewBranchDialog, ConfirmDeleteDialog } from "./RefDialogs";
import { RefColumn, RefTree } from "./RefTree";
import { createBranch, deleteRef, getAheadBehind, getViewerLogin, invalidateRefs, listAllBranches, type BranchesData } from "./githubBrowse";
import { openInHub, useHubHref } from "./repoHref";
import { branchRowNewPrHash } from "./lib/newPrHash";
import { branchCompareHash, compareBaseFor, withCompareBase } from "./lib/compareHash";
import { BranchCompare } from "./BranchCompare";
import { gotoHash, useHashExtras } from "./hostNav";
import { usePrefs } from "./prefs";
import { useRefWrites } from "./refWrites";
import "./browser.css";

const TABS: { id: BranchTabId; name: string }[] = [{ id: "mine", name: "Mine" }, { id: "all", name: "All" }, { id: "stale", name: "Stale" }];
/** Compares in flight at once (GitHub's secondary rate limit prefers a trickle to a burst). */
const COMPARE_BATCH = 6;
const NO_FAVS: string[] = [];

/** The Behind | Ahead cell: both numbers, with a bar under each growing away from the divider (native's split bar). */
function BehindAhead({ value, max }: { value?: AheadBehind; max: number }) {
  if (!value) return null;
  const w = barWidths(value, max);
  return (
    <span className="gh-ba flex-row flex-center" aria-label={`${value.behind} behind, ${value.ahead} ahead`}>
      <span className="gh-ba-side gh-ba-behind"><span className="gh-ba-num">{value.behind}</span><span className="gh-ba-bar" style={{ width: `${w.behind * 100}%` }} /></span>
      <span className="gh-ba-split" aria-hidden="true" />
      <span className="gh-ba-side gh-ba-ahead"><span className="gh-ba-num">{value.ahead}</span><span className="gh-ba-bar" style={{ width: `${w.ahead * 100}%` }} /></span>
    </span>
  );
}

function BranchList({ repo, props }: { repo: string; props: HubProps }) {
  const { state, go, openSwitch, signedIn } = props;
  const href = useHubHref();
  const [prefs, setPrefs, prefsReady] = usePrefs();
  const writes = useRefWrites();
  const tab: BranchTabId = state.branchTab ?? "mine";
  const [data, setData] = React.useState<{ t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; v: BranchesData }>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  const [viewer, setViewer] = React.useState("");
  const [compares, setCompares] = React.useState<Record<string, AheadBehind>>({});
  const [query, setQuery] = React.useState(state.q ?? "");
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = React.useState<{ kind: "new"; base?: string } | { kind: "delete"; branch: Branch } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    let dead = false;
    setData({ t: "loading" });
    setCompares({});
    listAllBranches(repo).then((v) => !dead && setData({ t: "ready", v }), (err) => !dead && setData({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, signedIn, reload]);
  React.useEffect(() => { getViewerLogin().then(setViewer, () => setViewer("")); }, [signedIn]);

  // The search box owns its text; the hash follows a moment after typing (replace: no history entry per keystroke).
  React.useEffect(() => {
    const t = setTimeout(() => { if ((state.q ?? "") !== query.trim()) go({ ...state, q: query.trim() || undefined }, true); }, 300);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = data.t === "ready" ? data.v : undefined;
  const favs = prefs.favourites[repo] ?? NO_FAVS;
  const visible = React.useMemo(() => {
    if (!v) return [];
    const tabbed = filterByTab(v.branches, tab, { viewer, favourites: new Set(favs), now: new Date() });
    return tabbed;
  }, [v, tab, viewer, favs]);
  const nodes = React.useMemo(() => buildRefTree(visible, { query: state.q, pin: v?.defaultBranch ?? undefined }), [visible, state.q, v?.defaultBranch]);
  const shown = React.useMemo(() => {
    const out: Branch[] = [];
    const walk = (ns: typeof nodes) => ns.forEach((n) => (n.kind === "ref" ? out.push(n.item) : walk(n.children)));
    walk(nodes);
    return out;
  }, [nodes]);

  // Behind and ahead for what is on screen and not yet known, a batch at a time.
  const need = React.useMemo(() => (v?.defaultBranch ? branchesToCompare(shown.map((b) => b.name), v.defaultBranch).filter((n) => !(n in compares)) : []), [shown, v?.defaultBranch, compares]);
  const wanted = need.join("\n");
  React.useEffect(() => {
    if (!v?.defaultBranch || !need.length) return;
    let dead = false;
    const base = v.defaultBranch;
    (async () => {
      for (const batch of inBatches(need, COMPARE_BATCH)) {
        const got = await Promise.all(batch.map((n) => getAheadBehind(repo, base, n).then((ab) => [n, ab] as const, () => [n, null] as const)));
        if (dead) return;
        setCompares((c) => ({ ...c, ...Object.fromEntries(got.map(([n, ab]) => [n, ab ?? { ahead: 0, behind: 0 }])) }));
      }
    })();
    return () => { dead = true; };
  }, [wanted, repo]); // eslint-disable-line react-hooks/exhaustive-deps

  const max = maxDivergence(shown.map((b) => compares[b.name]));
  const refresh = () => setReload((n) => n + 1);
  const toggleFolder = React.useCallback((p: string) => setCollapsed((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; }), []);
  const toggleFav = (name: string) => setPrefs((p) => {
    const cur = p.favourites[repo] ?? [];
    return { ...p, favourites: { ...p.favourites, [repo]: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name] } };
  });
  const names = v?.branches.map((b) => b.name) ?? [];
  const def = v?.defaultBranch ?? undefined;
  // The compare branch: the user's "Set as compare branch" while it still exists, else the default branch. The Compare action compares a branch against it.
  const remembered = prefs.compareBase?.[repo];
  const compareBranch = remembered && names.includes(remembered) ? remembered : def;
  const compareHash = (b: string) => { const base = compareBaseFor(compareBranch, def, b); return base ? branchCompareHash(repo, b, base) : undefined; };
  const setCompareBranch = (b: string) => setPrefs((p) => ({ ...p, compareBase: withCompareBase(p.compareBase, repo, b === def ? null : b) }));

  const columns = React.useMemo<RefColumn<Branch>[]>(() => [
    {
      id: "commit", name: "Commit", width: 110,
      render: ({ item: b }) => (
        <Link className="gh-sha-link monospaced-xs" href={href("commits", { repo, ref: b.name === def ? undefined : b.name, commit: b.sha })} onClick={openInHub("commits", { repo, ref: b.name === def ? undefined : b.name, commit: b.sha })} ariaLabel={`Commit ${b.shortSha}`}>{b.shortSha}</Link>
      ),
    },
    { id: "author", name: "Author", width: 150, render: ({ item: b }) => <PersonLine person={b.author} /> },
    { id: "date", name: "Authored Date", width: 130, render: ({ item: b }) => <RelDate date={b.authoredDate} /> },
    { id: "ba", name: "Behind | Ahead", width: 120, render: ({ item: b }) => (b.isDefault ? null : <BehindAhead value={compares[b.name]} max={max} />) },
    { id: "status", name: "Status", width: 110, render: ({ item: b }) => <CheckStatusCell status={b.status} /> },
    { id: "pr", name: "Pull Request", width: 100, render: ({ item: b }) => <PrCell number={b.prNumber} href={b.prNumber ? href("prs", { repo, view: "prs", pr: b.prNumber }) : undefined} onOpen={(n) => void openInHub("prs", { repo, view: "prs", pr: n })()} /> },
    {
      id: "fav", name: "", width: 40,
      render: ({ item: b }) => {
        const on = favs.includes(b.name);
        return <Button subtle className="gh-fav" iconProps={{ iconName: on ? "FavoriteStarFill" : "FavoriteStar" }} ariaLabel={`${on ? "Remove" : "Add"} ${b.name} ${on ? "from" : "to"} favourites`} ariaPressed={on} tooltipProps={{ text: on ? "Remove from favourites" : "Add to favourites" }} onClick={() => toggleFav(b.name)} />;
      },
    },
    {
      id: "more", name: "", width: 40,
      render: ({ item: b }) => {
        const del = canDeleteBranch(b, def ?? null);
        return (
          <MoreButton
            ariaLabel={`Actions for ${b.name}`}
            contextualMenuProps={{
              menuProps: {
                id: `gh-branch-menu-${b.name}`,
                items: [
                  { id: "new", text: "New branch", iconProps: { iconName: "Add" }, onActivate: () => setDialog({ kind: "new", base: b.name }) },
                  { id: "pr", text: "New pull request", iconProps: { iconName: "BranchPullRequest" }, href: href("prs", branchRowNewPrHash(repo, b.name)), onActivate: openInHub("prs", branchRowNewPrHash(repo, b.name)) as any, disabled: b.isDefault },
                  { id: "delete", text: "Delete branch", iconProps: { iconName: "Delete" }, disabled: !del.ok || writes.busy, secondaryText: del.ok ? undefined : del.reason, onActivate: () => setDialog({ kind: "delete", branch: b }) },
                  { id: "history", text: "View history", iconProps: { iconName: "History" }, href: href("commits", { repo, ref: b.name === def ? undefined : b.name }), onActivate: openInHub("commits", { repo, ref: b.name === def ? undefined : b.name }) as any },
                  { id: "compare", text: "Compare", iconProps: { iconName: "BranchCompare" }, href: compareHash(b.name), onActivate: () => { const h = compareHash(b.name); if (h) gotoHash(h); }, disabled: !compareHash(b.name) },
                  { id: "setcompare", text: "Set as compare branch", iconProps: { iconName: "BranchCompare" }, disabled: b.name === compareBranch, onActivate: () => setCompareBranch(b.name) },
                  { id: "copy", text: "Copy branch name", iconProps: { iconName: "Copy" }, onActivate: () => { void navigator.clipboard?.writeText(b.name); } },
                ],
              },
            }}
          />
        );
      },
    },
  ], [compares, max, favs, def, href, repo, writes.busy, compareBranch]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameCell = React.useCallback((leaf: RefLeaf<Branch>) => {
    const b = leaf.item;
    const to = { repo, ref: b.name === def ? undefined : b.name };
    return (
      <>
        <span className="gh-entry-icon"><Icon iconName="BranchFork2" size={IconSize.small} /></span>
        <Link className="bolt-table-link text-ellipsis" subtle removeUnderline href={href("files", to)} onClick={openInHub("files", to)}>{leaf.name}</Link>
        {b.isDefault && <Pill className="gh-pr-pill" size={PillSize.compact} variant={PillVariant.standard}>Default</Pill>}
        {b.name === compareBranch && (
          <Pill className="gh-pr-pill gh-compare-pill" size={PillSize.compact} variant={PillVariant.standard} onClick={() => gotoHash(branchCompareHash(repo, def && def !== b.name ? def : b.name, b.name))} ariaLabel={`Compare against ${b.name}`}>Compare</Pill>
        )}
        {b.protected && !b.isDefault && <Icon iconName="Lock" size={IconSize.small} className="gh-branch-lock" ariaLabel="Protected" />}
      </>
    );
  }, [def, href, repo, compareBranch]);

  const create = (name: string, base: string) => {
    const from = v?.branches.find((b) => b.name === base);
    if (!v || !from) return;
    void writes.run(() => createBranch(v.repoId, name, from.sha), () => { setDialog(null); refresh(); });
  };
  const doDelete = (b: Branch) => void writes.run(() => deleteRef(b.id), () => { setDialog(null); setNotice(`Deleted branch ${b.name}.`); refresh(); });
  const closeDialog = () => { if (!writes.busy) { setDialog(null); writes.clearError(); } };

  const error = data.t === "error" ? data.err : null;
  const tabEmpty = tab === "mine" ? "You have no branches here. Star a branch to keep it on this tab." : tab === "stale" ? `No branches without a commit in ${Math.round(STALE_DAYS / 30)} months.` : "No branches.";

  return (
    <>
      <Header
        className="gh-hub-header"
        title="Branches"
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        commandBarItems={[
          switcherItem(repo, openSwitch, (r) => go({ repo: r })),
          { id: "new", text: "New branch", isPrimary: true, important: true, disabled: !v || writes.busy, onActivate: () => setDialog({ kind: "new" }) },
        ]}
      />
      <TabBar
        ariaLabel="Branch lists"
        selectedTabId={tab}
        onSelectedTabChanged={(id) => go({ repo, branchTab: id as BranchTabId, q: state.q })}
        tabSize={TabSize.Tall}
        disableSticky
        renderAdditionalContent={() => (
          <TextField className="gh-ref-search" value={query} onChange={(_e, t) => setQuery(t)} placeholder="Search branch name" ariaLabel="Search branch name" prefixIconProps={{ iconName: "Filter" }} />
        )}
      >
        {TABS.map((t) => <Tab key={t.id} id={t.id} name={t.name} />)}
      </TabBar>
      <div className="page-content page-content-top gh-pr-body flex-column">
        {notice && <MessageCard severity={MessageCardSeverity.Info} onDismiss={() => setNotice(null)}>{notice}</MessageCard>}
        {writes.error && !dialog && <MessageCard severity={MessageCardSeverity.Error} onDismiss={writes.clearError}>{writes.error}</MessageCard>}
        {error ? (
          <ErrorView err={error} signIn={() => void props.signIn()} busy={props.busy} retry={() => { invalidateRefs(); refresh(); }} subject="see this repository's branches" permission="Contents" />
        ) : data.t === "loading" || !prefsReady ? (
          <Loading label="Loading branches" />
        ) : !nodes.length ? (
          <ZeroData iconProps={{ iconName: "BranchFork2" }} imageAltText="" primaryText={state.q ? "No branches match" : tabEmpty} />
        ) : (
          <Card className="gh-pr-card gh-refs-card bolt-table-card" contentProps={{ contentPadding: false }}>
            <RefTree<Branch>
              key={`${tab}|${Object.keys(compares).length}|${favs.join()}`}
              nodes={nodes}
              columns={columns}
              name="Branch"
              nameCell={nameCell}
              collapsed={collapsed}
              toggleFolder={toggleFolder}
              label="Branches"
              onOpen={() => {}}
            />
          </Card>
        )}
      </div>
      {dialog?.kind === "new" && v && (
        <NewBranchDialog branches={names} existing={names} defaultBase={dialog.base ?? def ?? names[0]} busy={writes.busy} error={writes.error} clearError={writes.clearError} create={create} close={closeDialog} />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog what="branch" name={dialog.branch.name} busy={writes.busy} error={writes.error} clearError={writes.clearError} confirm={() => doDelete(dialog.branch)} close={closeDialog} />
      )}
    </>
  );
}

export function BranchesHub(props: HubProps) {
  const { compare } = useHashExtras(); // BrowseState drops view=compare, so the page is routed on its own parse of the hash
  return (
    <RepoHubPage state={props.state} go={props.go}>
      {(repo) => (compare && compare.repo === repo ? <BranchCompare key={repo} repo={repo} cmp={compare} props={props} /> : <BranchList repo={repo} props={props} />)}
    </RepoHubPage>
  );
}

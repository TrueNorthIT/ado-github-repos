// The "Branches" hub (B-1 to B-5): branches in folders with their head commit, behind and ahead of the default branch,
// favourites, and create / delete. Behind and ahead load lazily, a few compares at a time.
import * as React from "react";
import { RelDate } from "./RelDate";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { MenuItemType, MoreButton } from "azure-devops-ui/Menu";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { TextField } from "azure-devops-ui/TextField";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { Icon, IconSize } from "azure-devops-ui/Icon";
import type { BranchTabId } from "./lib/browseState";
import { barWidths, branchesToCompare, buildRefTree, canDeleteBranch, filterByTab, inBatches, maxDivergence, renameErrorText, renameInPrefs, STALE_DAYS, type AheadBehind, type Branch, type RefLeaf } from "./lib/branches";
import { ErrorView } from "./Browser";
import { CheckStatusCell, forgetDefaultBranch, HubProps, PersonLine, PrCell, RepoHubPage, titleSwitcher } from "./RepoHub";
import { NewBranchDialog, ConfirmDeleteDialog, RenameBranchDialog, SetDefaultBranchDialog } from "./RefDialogs";
import { RefColumn, RefTree } from "./RefTree";
import { applyRulesetPlan, createBranch, deleteRef, getAheadBehind, getIsRepoAdmin, getLockedBranches, getOwnedRuleset, getViewerLogin, GhError, invalidateRefs, listAllBranches, renameBranch, setDefaultBranch, type BranchesData } from "./githubBrowse";
import { lockPlan, policyWriteError } from "./lib/policyEdit";
import { openInHub, useHubHref } from "./repoHref";
import { serializeActions } from "./lib/actionsHash";
import { branchRowNewPrHash } from "./lib/newPrHash";
import { branchCompareHash, compareBaseFor, withCompareBase } from "./lib/compareHash";
import { BranchCompare } from "./BranchCompare";
import { BranchPolicies } from "./BranchPolicies";
import { serializePolicies } from "./lib/policyHash";
import { ForksView } from "./Forks";
import { serializeForks } from "./lib/forks";
import { gotoHash, useHashExtras } from "./hostNav";
import { usePrefs } from "./prefs";
import { RefWriteError, useRefWrites } from "./refWrites";
import "./browser.css";

const TABS: { id: BranchTabId; name: string }[] = [{ id: "mine", name: "Mine" }, { id: "all", name: "All" }, { id: "stale", name: "Stale" }];
/** Compares in flight at once (GitHub's secondary rate limit prefers a trickle to a burst). */
const COMPARE_BATCH = 6;
const NO_FAVS: string[] = [];

/** The Behind | Ahead cell: both numbers, with a bar under each growing away from the divider (native's split bar). */
export function BehindAhead({ value, max }: { value?: AheadBehind; max: number }) {
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
  const [dialog, setDialog] = React.useState<{ kind: "new"; base?: string } | { kind: "delete" | "rename" | "default"; branch: Branch } | null>(null);
  const [admin, setAdmin] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [locked, setLocked] = React.useState<ReadonlySet<string>>(() => new Set());

  React.useEffect(() => {
    let dead = false;
    setData({ t: "loading" });
    setCompares({});
    listAllBranches(repo).then((v) => !dead && setData({ t: "ready", v }), (err) => !dead && setData({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, signedIn, reload]);
  // Branches the extension's own rulesets lock (Lock branch); read for everyone, so readers see the lock too.
  React.useEffect(() => {
    let dead = false;
    getLockedBranches(repo).then((l) => !dead && setLocked(l), () => !dead && setLocked(new Set()));
    return () => { dead = true; };
  }, [repo, signedIn, reload]);
  React.useEffect(() => { getViewerLogin().then(setViewer, () => setViewer("")); }, [signedIn]);
  React.useEffect(() => {
    let dead = false;
    setAdmin(false);
    getIsRepoAdmin(repo).then((a) => !dead && setAdmin(a));
    return () => { dead = true; };
  }, [repo, signedIn]);

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
    { id: "status", name: "Status", width: 110, render: ({ item: b }) => { const h = serializeActions({ repo, tab: "runs", branch: b.name }); return b.status ? <Link subtle removeUnderline href={href("actions", h)} onClick={openInHub("actions", h)} ariaLabel={`Workflow runs on ${b.name}`}><CheckStatusCell status={b.status} /></Link> : null; } }, // REQ-16: the status opens the branch's runs in the Actions hub
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
                  { id: "rename", text: "Rename branch", iconProps: { iconName: "Rename" }, disabled: writes.busy, onActivate: () => setDialog({ kind: "rename", branch: b }) },
                  { id: "history", text: "View history", iconProps: { iconName: "History" }, href: href("commits", { repo, ref: b.name === def ? undefined : b.name }), onActivate: openInHub("commits", { repo, ref: b.name === def ? undefined : b.name }) as any },
                  { id: "compare", text: "Compare", iconProps: { iconName: "BranchCompare" }, href: compareHash(b.name), onActivate: () => { const h = compareHash(b.name); if (h) gotoHash(h); }, disabled: !compareHash(b.name) },
                  { id: "setcompare", text: "Set as compare branch", iconProps: { iconName: "BranchCompare" }, disabled: b.name === compareBranch, onActivate: () => setCompareBranch(b.name) },
                  ...(admin ? [locked.has(b.name)
                    ? { id: "unlock", text: "Unlock", iconProps: { iconName: "Unlock" }, disabled: writes.busy, onActivate: () => doLock(b, false) }
                    : { id: "lock", text: "Lock", iconProps: { iconName: "Lock" }, disabled: writes.busy, onActivate: () => doLock(b, true) }] : []),
                  ...(admin ? [{ id: "setdefault", text: "Set as default branch", iconProps: { iconName: "Home" }, disabled: b.isDefault || writes.busy, onActivate: () => setDialog({ kind: "default", branch: b }) }] : []),
                  { id: "copy", text: "Copy branch name", iconProps: { iconName: "Copy" }, onActivate: () => { void navigator.clipboard?.writeText(b.name); } },
                  { id: "divider", itemType: MenuItemType.Divider },
                  { id: "policies", text: "Branch policies", iconProps: { iconName: "Shield" }, href: serializePolicies({ repo, branch: b.name }), onActivate: () => gotoHash(serializePolicies({ repo, branch: b.name })) },
                ],
              },
            }}
          />
        );
      },
    },
  ], [compares, max, favs, def, href, repo, writes.busy, compareBranch, admin, locked]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {locked.has(b.name) ? (
          <Button subtle className="gh-branch-lock gh-branch-locked" iconProps={{ iconName: "Lock", size: IconSize.small }} ariaLabel={`${b.name} is locked. Branch policies for ${b.name}`} tooltipProps={{ text: "Locked: nobody can push to this branch" }} href={serializePolicies({ repo, branch: b.name })} onClick={(e) => { e?.preventDefault(); gotoHash(serializePolicies({ repo, branch: b.name })); }} />
        ) : b.protected && (
          <Button subtle className="gh-branch-lock" iconProps={{ iconName: "Shield", size: IconSize.small }} ariaLabel={`Branch policies for ${b.name}`} tooltipProps={{ text: "Branch policies apply" }} href={serializePolicies({ repo, branch: b.name })} onClick={(e) => { e?.preventDefault(); gotoHash(serializePolicies({ repo, branch: b.name })); }} />
        )}
      </>
    );
  }, [def, href, repo, compareBranch, locked]);

  const create = (name: string, base: string) => {
    const from = v?.branches.find((b) => b.name === base);
    if (!v || !from) return;
    void writes.run(() => createBranch(v.repoId, name, from.sha), () => { setDialog(null); refresh(); });
  };
  const doDelete = (b: Branch) => void writes.run(() => deleteRef(b.id), () => { setDialog(null); setNotice(`Deleted branch ${b.name}.`); refresh(); });
  const doRename = (b: Branch, to: string) => void writes.run(
    async () => {
      try {
        await renameBranch(repo, b.name, to);
      } catch (e) {
        const text = e instanceof GhError && e.kind !== "auth" && e.kind !== "rateLimit" ? renameErrorText(e.status, e.apiMessage, b) : null;
        throw text ? new RefWriteError(text) : e;
      }
    },
    () => { setPrefs((p) => renameInPrefs(p, repo, b.name, to)); setDialog(null); setNotice(`Renamed branch ${b.name} to ${to}.`); refresh(); }
  );
  const doSetDefault = (b: Branch) => void writes.run(() => setDefaultBranch(repo, b.name), () => { forgetDefaultBranch(repo); setDialog(null); setNotice(`${b.name} is now the default branch.`); refresh(); });
  // Lock / Unlock: the `update` rule of the extension's own ruleset for the branch (lib/policyEdit.ts), read fresh so its policies are kept.
  const doLock = (b: Branch, lock: boolean) => void writes.run(
    async () => {
      try {
        await applyRulesetPlan(lockPlan(repo, b.name, await getOwnedRuleset(repo, b.name), lock));
      } catch (e) {
        const w = e instanceof GhError && (e.kind === "access" || e.kind === "other") ? policyWriteError(e.status, e.apiMessage) : null;
        throw w ? new RefWriteError(w.text) : e;
      }
    },
    () => { setNotice(lock ? `Locked ${b.name}. Nobody can push to it until it is unlocked.` : `Unlocked ${b.name}.`); refresh(); }
  );
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
          { id: "new", text: "New branch", isPrimary: true, important: true, disabled: !v || writes.busy, onActivate: () => setDialog({ kind: "new" }) },
          { id: "forks", text: "Forks", important: false, iconProps: { iconName: "GitFork" }, onActivate: () => gotoHash(serializeForks(repo)) },
        ]}
      >
        {titleSwitcher(repo, openSwitch, (r) => go({ repo: r }))}
      </Header>
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
        ) : !nodes.length && !(data.t === "loading" || !prefsReady) ? (
          <ZeroData iconProps={{ iconName: "BranchFork2" }} imageAltText="" primaryText={state.q ? "No branches match" : tabEmpty} />
        ) : (
          <Card className="gh-pr-card gh-refs-card bolt-table-card" contentProps={{ contentPadding: false }}>
            <RefTree<Branch>
              loading={data.t === "loading" || !prefsReady}
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
      {dialog?.kind === "rename" && (
        <RenameBranchDialog from={dialog.branch.name} existing={names} busy={writes.busy} error={writes.error} clearError={writes.clearError} rename={(to) => doRename(dialog.branch, to)} close={closeDialog} />
      )}
      {dialog?.kind === "default" && (
        <SetDefaultBranchDialog branch={dialog.branch.name} current={def} busy={writes.busy} error={writes.error} clearError={writes.clearError} confirm={() => doSetDefault(dialog.branch)} close={closeDialog} />
      )}
    </>
  );
}

export function BranchesHub(props: HubProps) {
  const { compare, policies, forks } = useHashExtras(); // BrowseState drops view=compare, view=policies and view=forks, so the pages are routed on their own parse of the hash
  return (
    <RepoHubPage state={props.state} go={props.go}>
      {(repo) => (compare && compare.repo === repo ? <BranchCompare key={repo} repo={repo} cmp={compare} props={props} />
        : forks && forks.repo === repo ? <ForksView key={repo} repo={repo} props={props} />
        : policies && policies.repo === repo ? <BranchPolicies key={`${repo}|${policies.branch}`} repo={repo} branch={policies.branch} props={props} />
        : <BranchList repo={repo} props={props} />)}
    </RepoHubPage>
  );
}

// The branch comparison page (Branches hub, view=compare): ahead and behind, the commits and the changed files of base...head, and "New pull request".
// The hash is in lib/compareHash.ts, the data in lib/branchCompare.ts; the Files tab is the New pull request page's preview.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Icon, IconSize } from "azure-devops-ui/Icon";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { Dropdown, DropdownExpandableButton } from "azure-devops-ui/Dropdown";
import { ListBoxItemType, type IListBoxItem } from "azure-devops-ui/ListBox";
import { compareRefOptions, refKind, type RefKind } from "./lib/branches";
import { compareSummary, type BranchCompare as Data } from "./lib/branchCompare";
import { applyCompare, serializeCompare, type CompareHashState, type CompareTab } from "./lib/compareHash";
import { serializeNewPr } from "./lib/newPrHash";
import { ErrorView } from "./Browser";
import { CommitTable } from "./Commits";
import { FilesPreview } from "./NewPullRequest";
import { HubProps, Loading, titleSwitcher, useDefaultBranch } from "./RepoHub";
import { getBranchCompare, invalidateRefs, listBranches, listTagNames } from "./githubBrowse";
import { gotoHash, patchHash } from "./hostNav";
import { openInHub, useHubHref } from "./repoHref";
import "./browser.css";

const KIND_ICON: Record<RefKind, string> = { branch: "BranchFork2", tag: "Tag", commit: "BranchCommit" };

/** Branch and tag names for the pickers, loaded once per page; undefined while loading, [] when a list fails. */
function useRefNames(repo: string, signedIn: boolean): { branches?: string[]; tags?: string[] } {
  const [names, setNames] = React.useState<{ branches?: string[]; tags?: string[] }>({});
  React.useEffect(() => {
    let dead = false;
    setNames({});
    listBranches(repo).then((b) => !dead && setNames((n) => ({ ...n, branches: b })), () => !dead && setNames((n) => ({ ...n, branches: [] })));
    listTagNames(repo).then((t) => !dead && setNames((n) => ({ ...n, tags: t })), () => !dead && setNames((n) => ({ ...n, tags: [] })));
    return () => { dead = true; };
  }, [repo, signedIn]);
  return names;
}

/** Native's version picker: branches and tags under headings, filtered by the search box; a commit SHA typed there is offered too. */
function CompareRefPicker({ current, kind, branches, tags, defaultBranch, onPick, label }: {
  current: string; kind: RefKind; branches?: string[]; tags?: string[]; defaultBranch?: string; onPick: (ref: string) => void; label: string;
}) {
  const [query, setQuery] = React.useState("");
  const loading = !branches || !tags;
  const items = React.useMemo<IListBoxItem[]>(() => {
    const o = compareRefOptions(branches ?? [], tags ?? [], query, defaultBranch);
    return [
      ...(o.commit ? [{ id: "h-commit", text: "Commit", type: ListBoxItemType.Header }, { id: `c:${o.commit}`, text: o.commit, iconProps: { iconName: "BranchCommit" } }] : []),
      ...(o.branches.length ? [{ id: "h-branches", text: "Branches", type: ListBoxItemType.Header }, ...o.branches.map((b) => ({ id: `b:${b}`, text: b, iconProps: { iconName: "BranchFork2" } }))] : []),
      ...(o.tags.length ? [{ id: "h-tags", text: "Tags", type: ListBoxItemType.Header }, ...o.tags.map((t) => ({ id: `t:${t}`, text: t, iconProps: { iconName: "Tag" } }))] : []),
    ];
  }, [branches, tags, query, defaultBranch]);
  return (
    <div className="gh-topbar flex-row flex-center flex-noshrink">
      <Dropdown
        ariaLabel={`${label}: ${current}`}
        className="gh-branch"
        minCalloutWidth={280}
        placeholder={kind === "commit" ? current.slice(0, 8) : current}
        items={items}
        showFilterBox
        filterByText={false}
        filterPlaceholderText="Find a branch or tag, or enter a commit ID"
        noItemsText={loading ? "Loading branches and tags" : "No branches or tags"}
        filteredNoResultsText="No matching branches or tags"
        onFilterTextChanged={(_e, v) => setQuery(v)}
        onCollapse={() => setQuery("")}
        onSelect={(_e, item) => onPick(item.id.slice(2))}
        renderExpandable={(p) => <DropdownExpandableButton {...p} subtle iconProps={{ iconName: KIND_ICON[kind] }} />}
      />
    </div>
  );
}

export function BranchCompare({ repo, cmp, props }: { repo: string; cmp: CompareHashState; props: HubProps }) {
  const { base, head, tab } = cmp;
  const { go, openSwitch, signedIn } = props;
  const href = useHubHref();
  const { defaultBranch } = useDefaultBranch(repo);
  const [data, setData] = React.useState<{ t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; v: Data }>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  const names = useRefNames(repo, signedIn);
  const kindOf = (r: string) => refKind(r, names.branches ?? [], names.tags ?? []);
  // A pull request needs two branches: a tag or a commit on either side leaves "New pull request" off.
  const prOk = base !== head && kindOf(base) === "branch" && kindOf(head) === "branch";

  React.useEffect(() => {
    let dead = false;
    setData({ t: "loading" });
    getBranchCompare(repo, base, head).then((v) => !dead && setData({ t: "ready", v }), (err) => !dead && setData({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, base, head, signedIn, reload]);

  const pick = (next: { base?: string; head?: string }) => gotoHash(serializeCompare({ repo, base, head, tab, ...next }));
  const commitState = React.useCallback((sha: string) => ({ repo, ref: head, commit: sha }), [repo, head]);
  const open = React.useCallback((sha: string) => void openInHub("commits", commitState(sha))(), [commitState]);
  const commitHref = React.useCallback((sha: string) => href("commits", commitState(sha)), [href, commitState]);
  const openPr = React.useCallback((n: number) => void openInHub("prs", { repo, view: "prs", pr: n })(), [repo]);
  const prHref = React.useCallback((n: number) => href("prs", { repo, view: "prs", pr: n }), [href, repo]);
  const newPr = serializeNewPr({ repo, source: head, target: base });

  const v = data.t === "ready" ? data.v : undefined;
  const headSha = v?.commits[0]?.sha ?? head; // the newest commit, else the branch name (the contents API takes either)
  return (
    <>
      <Header
        className="gh-hub-header"
        title="Compare"
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        commandBarItems={[
          { id: "back", text: "Branches", important: true, iconProps: { iconName: "Back" }, onActivate: () => go({ repo }) },
          { id: "newpr", text: "New pull request", isPrimary: true, important: true, iconProps: { iconName: "BranchPullRequest" }, disabled: !prOk, onActivate: () => void openInHub("prs", newPr)() },
        ]}
      >
        {titleSwitcher(repo, openSwitch, (r) => go({ repo: r }))}
      </Header>
      <div className="gh-compare-pickers flex-row flex-center flex-wrap">
        <div role="group" aria-label="Base" className="flex-row flex-center">
          <span className="gh-compare-label body-m">Base</span>
          <CompareRefPicker label="Base" current={base} kind={kindOf(base)} branches={names.branches} tags={names.tags} defaultBranch={defaultBranch} onPick={(b) => pick({ base: b })} />
        </div>
        <Icon iconName="ChevronRightMed" size={IconSize.small} className="secondary-text" ariaLabel="compared with" />
        <div role="group" aria-label="Compare" className="flex-row flex-center">
          <span className="gh-compare-label body-m">Compare</span>
          <CompareRefPicker label="Compare" current={head} kind={kindOf(head)} branches={names.branches} tags={names.tags} defaultBranch={defaultBranch} onPick={(b) => pick({ head: b })} />
        </div>
      </div>
      <TabBar
        ariaLabel="Comparison"
        selectedTabId={tab}
        onSelectedTabChanged={(id) => patchHash((h) => applyCompare(h, { base, head, tab: id as CompareTab }))}
        tabSize={TabSize.Tall}
        disableSticky
      >
        <Tab id="commits" name="Commits" badgeCount={v?.total} />
        <Tab id="files" name="Files" />
      </TabBar>
      <div className="page-content page-content-top gh-pr-body flex-column">
        {data.t === "error" ? (
          <ErrorView err={data.err} signIn={() => void props.signIn()} busy={props.busy} retry={() => { invalidateRefs(); setReload((n) => n + 1); }} subject="compare these branches" permission="Contents" />
        ) : data.t === "loading" ? (
          <Loading label="Comparing branches" />
        ) : (
          <>
            <div className="gh-compare-summary body-m" role="status">{compareSummary(base, head, data.v.ahead, data.v.behind)}</div>
            {tab === "commits" ? (
              !data.v.commits.length ? (
                <ZeroData iconProps={{ iconName: "BranchCommit" }} imageAltText="" primaryText="No commits to compare" secondaryText={`${head} has nothing that ${base} does not.`} />
              ) : (
                <>
                  {data.v.total > data.v.commits.length && <MessageCard severity={MessageCardSeverity.Info}>GitHub lists at most 250 commits; showing {data.v.commits.length} of {data.v.total}.</MessageCard>}
                  <Card className="gh-pr-card gh-commits-card bolt-table-card" contentProps={{ contentPadding: false }}>
                    <CommitTable rows={data.v.commits} label={`Commits on ${head} not on ${base}`} commitHref={commitHref} open={open} prHref={prHref} openPr={openPr} />
                  </Card>
                </>
              )
            ) : !data.v.ahead ? (
              <ZeroData iconProps={{ iconName: "Page" }} imageAltText="" primaryText="No files changed" secondaryText={`${head} has no changes that ${base} does not.`} />
            ) : (
              <FilesPreview key={`${base}|${head}`} repo={repo} base={base} head={head} headOid={headSha} signIn={() => void props.signIn()} busy={props.busy} />
            )}
          </>
        )}
      </div>
    </>
  );
}

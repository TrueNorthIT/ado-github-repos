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
import { compareSummary, type BranchCompare as Data } from "./lib/branchCompare";
import { applyCompare, serializeCompare, type CompareHashState, type CompareTab } from "./lib/compareHash";
import { serializeNewPr } from "./lib/newPrHash";
import { ErrorView } from "./Browser";
import { CommitTable } from "./Commits";
import { FilesPreview } from "./NewPullRequest";
import { BranchBar, HubProps, Loading, switcherItem, useDefaultBranch } from "./RepoHub";
import { getBranchCompare, invalidateRefs } from "./githubBrowse";
import { gotoHash, patchHash } from "./hostNav";
import { openInHub, useHubHref } from "./repoHref";
import "./browser.css";

export function BranchCompare({ repo, cmp, props }: { repo: string; cmp: CompareHashState; props: HubProps }) {
  const { base, head, tab } = cmp;
  const { go, openSwitch, signedIn } = props;
  const href = useHubHref();
  const { defaultBranch } = useDefaultBranch(repo);
  const [data, setData] = React.useState<{ t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; v: Data }>({ t: "loading" });
  const [reload, setReload] = React.useState(0);

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
          switcherItem(repo, openSwitch, (r) => go({ repo: r })),
          { id: "back", text: "Branches", important: true, iconProps: { iconName: "Back" }, onActivate: () => go({ repo }) },
          { id: "newpr", text: "New pull request", isPrimary: true, important: true, iconProps: { iconName: "BranchPullRequest" }, disabled: base === head, onActivate: () => void openInHub("prs", newPr)() },
        ]}
      />
      <div className="gh-compare-pickers flex-row flex-center flex-wrap">
        <div role="group" aria-label="Base branch" className="flex-row flex-center">
          <span className="gh-compare-label body-m">Base</span>
          <BranchBar repo={repo} current={base} defaultBranch={defaultBranch} onPick={(b) => pick({ base: b })} />
        </div>
        <Icon iconName="ChevronRightMed" size={IconSize.small} className="secondary-text" ariaLabel="compared with" />
        <div role="group" aria-label="Compare branch" className="flex-row flex-center">
          <span className="gh-compare-label body-m">Compare</span>
          <BranchBar repo={repo} current={head} defaultBranch={defaultBranch} onPick={(b) => pick({ head: b })} />
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

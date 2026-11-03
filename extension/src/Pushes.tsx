// The "Pushes" hub (C-4): the latest pushes to a branch, grouped by day; expanding a push lists its commits.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { FilterBar } from "azure-devops-ui/FilterBar";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { TextFilterBarItem } from "azure-devops-ui/TextFilterBarItem";
import { Filter, FILTER_CHANGE_EVENT } from "azure-devops-ui/Utilities/Filter";
import { SimpleTableCell } from "azure-devops-ui/Table";
import { ExpandableTreeCell, ITreeColumn, Tree } from "azure-devops-ui/TreeEx";
import { ITreeItem, TreeItemProvider } from "azure-devops-ui/Utilities/TreeItemProvider";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { groupPushesByDate, pushTitle, type PushHead, type PushRow } from "./lib/pushes";
import type { CommitRow } from "./lib/commitsQuery";
import { ErrorView, hubClick } from "./Browser";
import { CommitTable } from "./Commits";
import { BranchBar, CheckStatusCell, CommitTime, HubProps, Loading, RepoHubPage, titleSwitcher, useDefaultBranch } from "./RepoHub";
import { invalidateRefs, listPushCommits, listPushes, type PushesData } from "./githubBrowse";
import { openInHub, useHubHref } from "./repoHref";
import "./browser.css";

type Load<T> = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; v: T };

/** The commits of an expanded push, in the same rows as the Commits page (no graph). */
function PushCommits({ repo, push, branch }: { repo: string; push: PushRow; branch?: string }) {
  const href = useHubHref();
  const [load, setLoad] = React.useState<Load<CommitRow[]>>({ t: "loading" });
  React.useEffect(() => {
    let dead = false;
    listPushCommits(repo, push).then((v) => !dead && setLoad({ t: "ready", v }), (err) => !dead && setLoad({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, push]);
  const openCommit = React.useCallback((sha: string) => void openInHub("commits", { repo, ref: branch, commit: sha })(), [repo, branch]);
  const openPr = React.useCallback((n: number) => void openInHub("prs", { repo, view: "prs", pr: n })(), [repo]);
  const commitHref = React.useCallback((sha: string) => href("commits", { repo, ref: branch, commit: sha }), [href, repo, branch]);
  const prHref = React.useCallback((n: number) => href("prs", { repo, view: "prs", pr: n }), [href, repo]);
  if (load.t === "loading") return <div className="gh-push-commits flex-row justify-center"><Spinner size={SpinnerSize.small} ariaLabel="Loading the commits in this push" /></div>;
  if (load.t === "error") return <div className="gh-push-commits secondary-text" role="status">Could not load this push's commits.</div>;
  if (!load.v.length) return <div className="gh-push-commits secondary-text" role="status">No commits to show for this push.</div>;
  return (
    <div className="gh-push-commits">
      <CommitTable rows={load.v} label={`Commits in push ${push.shortAfter}`} commitHref={commitHref} open={openCommit} prHref={prHref} openPr={openPr} showHeader={false} />
    </div>
  );
}

type PushNode = { kind: "push"; push: PushRow } | { kind: "commits"; push: PushRow };

/** One day's pushes as a Tree: a row per push (who pushed and what, then when), expandable to its commits. */
function PushDay({ repo, branch, pushes, heads, open, expanded, toggle, keyOf, day }: { repo: string; branch?: string; pushes: PushRow[]; heads: Record<string, PushHead>; open: (sha: string) => void; expanded: Set<string>; toggle: (key: string) => void; keyOf: (p: PushRow) => string; day: string }) {
  const href = useHubHref();
  const provider = React.useMemo(
    () => new TreeItemProvider<PushNode>(pushes.map((p): ITreeItem<PushNode> => ({
      id: keyOf(p), data: { kind: "push", push: p }, expanded: expanded.has(keyOf(p)),
      childItems: [{ id: `${keyOf(p)}/commits`, data: { kind: "commits", push: p } }],
    }))),
    [pushes, expanded, keyOf]
  );
  const columns = React.useMemo<ITreeColumn<PushNode>[]>(() => [
    {
      id: "push",
      name: "Push",
      width: -100,
      renderCell: (_r, columnIndex, treeColumn, treeItem) => {
        const n = treeItem.underlyingItem.data;
        if (n.kind === "commits") return <ExpandableTreeCell key="push" columnIndex={columnIndex} treeColumn={treeColumn} treeItem={treeItem}><PushCommits repo={repo} push={n.push} branch={branch} /></ExpandableTreeCell>;
        const push = n.push;
        const head = heads[push.after];
        const title = head ? pushTitle(push, head) : `Updated to ${push.shortAfter}`;
        return (
          <ExpandableTreeCell key="push" columnIndex={columnIndex} treeColumn={treeColumn} treeItem={treeItem}>
            <VssPersona imageUrl={push.actor.avatarUrl} displayName={push.actor.name} size="medium" suppressPersonaCard showInitialsOnImageError />
            <div className="gh-push-text flex-column flex-grow">
              <div className="gh-push-line1 flex-row flex-center">
                <Link className="gh-push-title commit-title font-weight-semibold text-ellipsis" subtle removeUnderline href={href("commits", { repo, ref: branch, commit: push.after })} onClick={hubClick(() => open(push.after))}>
                  {title}
                </Link>
                {push.forced && <Pill className="gh-pr-pill" size={PillSize.compact} variant={PillVariant.standard}>Force push</Pill>}
                {push.created && <Pill className="gh-pr-pill" size={PillSize.compact} variant={PillVariant.standard}>Branch created</Pill>}
              </div>
              <div className="gh-push-line2 flex-row flex-center secondary-text body-s">
                <span className="monospaced-xs gh-commit-sha">{push.shortAfter}</span>
                <span>{push.actor.name}</span>
              </div>
            </div>
          </ExpandableTreeCell>
        );
      },
    },
    {
      id: "when",
      name: "When",
      width: 200,
      renderCell: (_r, columnIndex, treeColumn, treeItem) => {
        const n = treeItem.underlyingItem.data;
        return (
          <SimpleTableCell key="when" columnIndex={columnIndex} tableColumn={treeColumn}>
            {n.kind === "push" && <span className="flex-row flex-center gh-push-when secondary-text body-s"><CommitTime date={n.push.date} /><CheckStatusCell status={heads[n.push.after]?.status ?? null} /></span>}
          </SimpleTableCell>
        );
      },
    },
  ], [repo, branch, heads, open, href]);
  return (
    <Tree<PushNode>
      ariaLabel={`Pushes ${day}`}
      columns={columns}
      itemProvider={provider as any}
      onToggle={(_e, ex) => { const n = (ex.underlyingItem as ITreeItem<PushNode>).data; if (n.kind === "push") toggle(keyOf(n.push)); }}
      showHeader={false}
      showLines={false}
      role="tree"
    />
  );
}

function PushList({ repo, props }: { repo: string; props: HubProps }) {
  const { state, go, openSwitch, signedIn } = props;
  const { defaultBranch, err: repoErr } = useDefaultBranch(repo);
  const ref = state.ref ?? defaultBranch;
  const [load, setLoad] = React.useState<Load<PushesData>>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [actor, setActor] = React.useState("");
  const [more, setMore] = React.useState(false);
  const filter = React.useMemo(() => new Filter(), []);
  // "Pushed by" is applied server-side (the activity API's `actor` param), so wait for typing to pause before asking.
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => { clearTimeout(t); t = setTimeout(() => setActor((filter.getFilterItemValue<string>("actor") ?? "").trim()), 400); };
    filter.subscribe(onChange, FILTER_CHANGE_EVENT);
    return () => { clearTimeout(t); filter.unsubscribe(onChange, FILTER_CHANGE_EVENT); };
  }, [filter]);
  React.useEffect(() => {
    if (!ref) return;
    let dead = false;
    setLoad({ t: "loading" });
    setExpanded(new Set());
    listPushes(repo, ref, { actor }).then((v) => !dead && setLoad({ t: "ready", v }), (err) => !dead && setLoad({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, ref, signedIn, reload, actor]);
  const loadMore = () => {
    if (!ref || load.t !== "ready" || !load.v.next) return;
    const prev = load.v;
    setMore(true);
    listPushes(repo, ref, { actor, after: prev.next }).then(
      (v) => { setLoad({ t: "ready", v: { pushes: [...prev.pushes, ...v.pushes], heads: { ...prev.heads, ...v.heads }, next: v.next } }); setMore(false); },
      (err) => { setMore(false); setLoad({ t: "error", err }); }
    );
  };
  const groups = React.useMemo(() => (load.t === "ready" ? groupPushesByDate(load.v.pushes) : []), [load]);
  const openCommit = React.useCallback((sha: string) => go({ repo, ref: state.ref, commit: sha }), [go, repo, state.ref]);
  const error = repoErr ?? (load.t === "error" ? load.err : null);
  const key = React.useCallback((p: PushRow) => `${p.before}>${p.after}@${p.date.getTime()}`, []);

  return (
    <>
      {defaultBranch && ref && <BranchBar repo={repo} current={ref} defaultBranch={defaultBranch} onPick={(b) => go({ repo, ref: b === defaultBranch ? undefined : b })} />}
      <Header className="repos-files-header" title="Pushes" titleSize={TitleSize.Large} titleAriaLevel={1} commandBarItems={[
        { id: "filter", text: "Filter", important: true, renderButton: () => <Button key="filter" className="gh-cmd-icon" subtle iconProps={{ iconName: "Filter" }} ariaLabel="Filter pushes" ariaPressed={filterOpen} tooltipProps={{ text: "Filter" }} onClick={() => setFilterOpen((o) => !o)} /> },
      ]}>
        {titleSwitcher(repo, openSwitch, (r) => go({ repo: r }))}
      </Header>
      <div className="page-content page-content-top gh-pr-body flex-column">
        {filterOpen && (
          <FilterBar filter={filter} onDismissClicked={() => { setFilterOpen(false); filter.setFilterItemState("actor", { value: "" }); }} searchRoleAriaLabel="Filter pushes">
            <TextFilterBarItem filterItemKey="actor" placeholder="Pushed by (GitHub username)" ariaLabel="Pushed by" />
          </FilterBar>
        )}
        {error ? (
          <ErrorView err={error} signIn={() => void props.signIn()} busy={props.busy} retry={() => { invalidateRefs(); setReload((n) => n + 1); }} subject="see this repository's pushes" permission="Contents" />
        ) : load.t === "loading" || !ref ? (
          <Loading label="Loading pushes" />
        ) : !groups.length ? (
          <ZeroData iconProps={{ iconName: "BranchShelveset" }} imageAltText="" primaryText="No pushes" secondaryText={actor ? `GitHub has no recorded pushes to ${ref} by ${actor}.` : `GitHub has no recorded pushes to ${ref}.`} />
        ) : (
          <Card className="gh-pr-card gh-pushes-card" contentProps={{ contentPadding: false }}>
            <div className="gh-pushes flex-column">
              {groups.map((g) => (
                <section key={g.day} aria-label={g.header}>
                  <h2 className="gh-push-day body-m font-weight-semibold">{g.header}</h2>
                  <PushDay
                    repo={repo}
                    branch={state.ref}
                    pushes={g.pushes}
                    heads={load.t === "ready" ? load.v.heads : {}}
                    open={openCommit}
                    expanded={expanded}
                    keyOf={key}
                    day={g.header}
                    toggle={(k) => setExpanded((x) => { const n = new Set(x); n.has(k) ? n.delete(k) : n.add(k); return n; })}
                  />
                </section>
              ))}
            </div>
          </Card>
        )}
        {load.t === "ready" && load.v.next && (
          <div className="gh-load-more flex-row justify-center">
            {more ? <Spinner size={SpinnerSize.medium} ariaLabel="Loading more pushes" /> : <Button text="Load more" onClick={loadMore} />}
          </div>
        )}
      </div>
    </>
  );
}

export function PushesHub(props: HubProps) {
  return (
    <RepoHubPage state={props.state} go={props.go}>
      {(repo) => <PushList repo={repo} props={props} />}
    </RepoHubPage>
  );
}

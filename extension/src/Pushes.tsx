// The "Pushes" hub (C-4): the latest pushes to a branch, grouped by day; expanding a push lists its commits.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { groupPushesByDate, pushTitle, type PushHead, type PushRow } from "./lib/pushes";
import type { CommitRow } from "./lib/commitsQuery";
import { ErrorView, hubClick } from "./Browser";
import { CommitTable } from "./Commits";
import { BranchBar, CheckStatusCell, CommitTime, HubProps, Loading, RepoHubPage, switcherItem, useDefaultBranch } from "./RepoHub";
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

function PushItem({ repo, branch, push, head, open, expanded, toggle }: { repo: string; branch?: string; push: PushRow; head?: PushHead; open: (sha: string) => void; expanded: boolean; toggle: () => void }) {
  const href = useHubHref();
  const title = head ? pushTitle(push, head) : `Updated to ${push.shortAfter}`;
  const label = `${title}${push.forced ? ", force push" : ""}`;
  return (
    <li className="gh-push" role="listitem">
      <div className="gh-push-row flex-row flex-center">
        <Button
          className="gh-push-chevron"
          subtle
          iconProps={{ iconName: expanded ? "ChevronDownMed" : "ChevronRightMed" }}
          ariaLabel={`${expanded ? "Collapse" : "Expand"} ${label}`}
          ariaExpanded={expanded}
          onClick={toggle}
        />
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
            <CommitTime date={push.date} />
            <CheckStatusCell status={head?.status ?? null} />
          </div>
        </div>
      </div>
      {expanded && <PushCommits repo={repo} push={push} branch={branch} />}
    </li>
  );
}

function PushList({ repo, props }: { repo: string; props: HubProps }) {
  const { state, go, openSwitch, signedIn } = props;
  const { defaultBranch, err: repoErr } = useDefaultBranch(repo);
  const ref = state.ref ?? defaultBranch;
  const [load, setLoad] = React.useState<Load<PushesData>>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => {
    if (!ref) return;
    let dead = false;
    setLoad({ t: "loading" });
    setExpanded(new Set());
    listPushes(repo, ref).then((v) => !dead && setLoad({ t: "ready", v }), (err) => !dead && setLoad({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, ref, signedIn, reload]);
  const groups = React.useMemo(() => (load.t === "ready" ? groupPushesByDate(load.v.pushes) : []), [load]);
  const openCommit = React.useCallback((sha: string) => go({ repo, ref: state.ref, commit: sha }), [go, repo, state.ref]);
  const error = repoErr ?? (load.t === "error" ? load.err : null);
  const key = (p: PushRow) => `${p.before}>${p.after}@${p.date.getTime()}`;

  return (
    <>
      {defaultBranch && ref && <BranchBar repo={repo} current={ref} defaultBranch={defaultBranch} onPick={(b) => go({ repo, ref: b === defaultBranch ? undefined : b })} />}
      <Header className="repos-files-header" title="Pushes" titleSize={TitleSize.Large} titleAriaLevel={1} commandBarItems={[switcherItem(repo, openSwitch, (r) => go({ repo: r }))]} />
      <div className="page-content page-content-top gh-pr-body flex-column">
        {error ? (
          <ErrorView err={error} signIn={() => void props.signIn()} busy={props.busy} retry={() => { invalidateRefs(); setReload((n) => n + 1); }} subject="see this repository's pushes" permission="Contents" />
        ) : load.t === "loading" || !ref ? (
          <Loading label="Loading pushes" />
        ) : !groups.length ? (
          <ZeroData iconProps={{ iconName: "BranchShelveset" }} imageAltText="" primaryText="No pushes" secondaryText={`GitHub has no recorded pushes to ${ref}.`} />
        ) : (
          <Card className="gh-pr-card gh-pushes-card" contentProps={{ contentPadding: false }}>
            <div className="gh-pushes flex-column">
              {groups.map((g) => (
                <section key={g.day} aria-label={g.header}>
                  <h2 className="gh-push-day body-m font-weight-semibold">{g.header}</h2>
                  <ul className="gh-push-list" role="list">
                    {g.pushes.map((p) => (
                      <PushItem
                        key={key(p)}
                        repo={repo}
                        branch={state.ref}
                        push={p}
                        head={load.t === "ready" ? load.v.heads[p.after] : undefined}
                        open={openCommit}
                        expanded={expanded.has(key(p))}
                        toggle={() => setExpanded((s) => { const n = new Set(s); n.has(key(p)) ? n.delete(key(p)) : n.add(key(p)); return n; })}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </Card>
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

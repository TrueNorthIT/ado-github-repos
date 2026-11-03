// The Branch policies page (Branches hub, view=policies): native ADO's per-branch policies page, read-only, built from the GitHub
// rules that apply to the branch (lib/branchPolicies.ts). Sections follow native's order: Branch Policies, Build Validation,
// Automatically included reviewers, then the GitHub rules ADO puts under branch security. Every toggle is disabled, as native
// shows them to a user without "Edit policies"; changes are made on GitHub ("Edit on GitHub").
import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { SimpleTableCell, Table, type ITableColumn } from "azure-devops-ui/Table";
import { Toggle } from "azure-devops-ui/Toggle";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { hasPolicies, mergeTypeName, reviewerSummary, rulesSettingsHref, sourceHref, sourceText, type CheckPolicy, type PolicySource } from "./lib/branchPolicies";
import { ErrorView } from "./Browser";
import { HubProps, Loading, titleSwitcher } from "./RepoHub";
import { getBranchPolicies, invalidateRefs, type BranchPoliciesData } from "./githubBrowse";
import "./browser.css";

/** "Ruleset 12" links, comma separated, each opening where the rule is edited on GitHub. */
function Sources({ repo, sources }: { repo: string; sources: PolicySource[] }) {
  if (!sources.length) return null;
  return (
    <div className="gh-bpol-source secondary-text body-s">
      From{" "}
      {sources.map((s, i) => (
        <React.Fragment key={i}>
          {i > 0 && ", "}
          <Link href={sourceHref(repo, s)} target="_blank" rel="noopener noreferrer" subtle>{sourceText(s)}</Link>
        </React.Fragment>
      ))}
    </div>
  );
}

/** One policy: a disabled Toggle, its name, the sentence under it and, when on, its settings. */
function PolicyRow({ title, on, description, children, na }: { title: string; on: boolean; description: string; children?: React.ReactNode; na?: boolean }) {
  return (
    <div className={`gh-bpol-row flex-row${na ? " gh-bpol-na" : ""}`}>
      <Toggle checked={on} disabled ariaLabel={`${title}: ${na ? "not available" : on ? "on" : "off"}`} className="gh-bpol-toggle" />
      <div className="gh-bpol-text flex-column">
        <div className="gh-bpol-title body-m font-weight-semibold">{title}</div>
        <div className="secondary-text body-m">{description}</div>
        {on && children && <div className="gh-bpol-detail flex-column body-m">{children}</div>}
      </div>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <div className="gh-bpol-empty secondary-text body-m">{text}</div>;

function ChecksTable({ repo, branch, checks }: { repo: string; branch: string; checks: CheckPolicy[] }) {
  const provider = React.useMemo(() => new ArrayItemProvider(checks), [checks]);
  const cols = React.useMemo<ITableColumn<CheckPolicy>[]>(() => [
    { id: "name", name: "Status check", width: -40, renderCell: (_r, i, c, x) => <SimpleTableCell key="name" columnIndex={i} tableColumn={c}><span className="text-ellipsis">{x.context}</span></SimpleTableCell> },
    { id: "req", name: "Requirement", width: -15, renderCell: (_r, i, c) => <SimpleTableCell key="req" columnIndex={i} tableColumn={c}>Required</SimpleTableCell> },
    { id: "exp", name: "Build expiration", width: -25, renderCell: (_r, i, c, x) => <SimpleTableCell key="exp" columnIndex={i} tableColumn={c}><span className="text-ellipsis">{x.strict ? `Immediately when ${branch} is updated` : x.strict === null ? "Not shown (needs admin)" : "Never"}</span></SimpleTableCell> },
    { id: "src", name: "Source", width: -20, renderCell: (_r, i, c, x) => <SimpleTableCell key="src" columnIndex={i} tableColumn={c}><Link href={sourceHref(repo, x.source)} target="_blank" rel="noopener noreferrer" subtle className="text-ellipsis">{sourceText(x.source)}</Link></SimpleTableCell> },
  ], [repo, branch]);
  return <Table<CheckPolicy> ariaLabel="Required status checks" role="table" columns={cols} itemProvider={provider} showHeader spacerWidth={8} />;
}

function PoliciesBody({ repo, branch, d }: { repo: string; branch: string; d: BranchPoliciesData }) {
  const p = d.policies;
  const r = p.reviewers;
  return (
    <>
      {d.classic === "denied" && (
        <MessageCard severity={MessageCardSeverity.Info}>
          {branch} has a classic branch protection rule. GitHub shows its settings to repository admins only, so only its required status checks are listed here; it may also require reviewers or block force pushes.
        </MessageCard>
      )}
      {!hasPolicies(p) && d.classic !== "denied" ? (
        <ZeroData iconProps={{ iconName: "Shield" }} imageAltText="" primaryText={`No policies apply to ${branch}`} secondaryText="Anyone with write access can push to this branch and merge into it. Add a ruleset on GitHub to protect it." />
      ) : (
        <>
          <Card className="gh-bpol-card" titleProps={{ text: "Branch Policies", ariaLevel: 2 }}>
            <div className="gh-bpol-list flex-column">
              <PolicyRow title="Require a minimum number of reviewers" on={!!r} description={r ? reviewerSummary(r) : "Changes can be pushed without a pull request."}>
                {r && (
                  <>
                    <div>Minimum number of reviewers: <strong>{r.count}</strong></div>
                    {r.lastPushApproval && <div>Prohibit the most recent pusher from approving their own changes</div>}
                    <div>When new changes are pushed: <strong>{r.dismissStale ? "Reset all approval votes" : "Keep existing votes"}</strong></div>
                    <Sources repo={repo} sources={r.sources} />
                  </>
                )}
              </PolicyRow>
              <PolicyRow na title="Check for linked work items" on={false} description="Not available on GitHub. Link work items by writing AB#123 in the pull request description." />
              <PolicyRow title="Check for comment resolution" on={!!p.commentResolution} description={p.commentResolution ? "All conversations must be resolved before a pull request can be completed." : "Pull requests can be completed with unresolved conversations."}>
                {p.commentResolution && <Sources repo={repo} sources={p.commentResolution} />}
              </PolicyRow>
              <PolicyRow title="Limit merge types" on={!!p.mergeTypes} description={p.mergeTypes ? "Only these merge types are allowed when completing a pull request." : "Every merge type the repository allows can be used."}>
                {p.mergeTypes && (
                  <>
                    {p.mergeTypes.methods.length > 0 && p.mergeTypes.methods.filter((m) => !p.mergeTypes!.linear || m !== "merge").map((m) => <div key={m}>{mergeTypeName(m)}</div>)}
                    {p.mergeTypes.linear && <div>Linear history: <strong>merge commits are not allowed</strong> (squash or rebase only)</div>}
                    <Sources repo={repo} sources={p.mergeTypes.sources} />
                  </>
                )}
              </PolicyRow>
            </div>
          </Card>
          <Card className="gh-bpol-card bolt-table-card" contentProps={{ contentPadding: !p.checks.length }} titleProps={{ text: "Build Validation", ariaLevel: 2 }}>
            {p.checks.length ? <ChecksTable repo={repo} branch={branch} checks={p.checks} /> : <Empty text="No status checks are required before merging." />}
          </Card>
          <Card className="gh-bpol-card" titleProps={{ text: "Automatically included reviewers", ariaLevel: 2 }}>
            {r?.codeOwners ? (
              <div className="gh-bpol-list flex-column">
                <PolicyRow title="Code owners" on description="Required. The owners in the CODEOWNERS file of the paths a pull request changes must approve it.">
                  <Sources repo={repo} sources={r.sources} />
                </PolicyRow>
              </div>
            ) : (
              <Empty text="No reviewers are added automatically." />
            )}
          </Card>
          {p.other.length > 0 && (
            <Card className="gh-bpol-card" titleProps={{ text: "Branch protection", ariaLevel: 2 }}>
              <div className="gh-bpol-list flex-column">
                {p.other.map((o) => (
                  <PolicyRow key={o.id} title={o.title} on description={o.detail ?? "On"}>
                    <Sources repo={repo} sources={o.sources} />
                  </PolicyRow>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}

export function BranchPolicies({ repo, branch, props }: { repo: string; branch: string; props: HubProps }) {
  const { go, openSwitch, signedIn } = props;
  const [data, setData] = React.useState<{ t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; v: BranchPoliciesData }>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  React.useEffect(() => {
    let dead = false;
    setData({ t: "loading" });
    getBranchPolicies(repo, branch).then((v) => !dead && setData({ t: "ready", v }), (err) => !dead && setData({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, branch, signedIn, reload]);

  return (
    <>
      <Header
        className="gh-hub-header"
        title={branch}
        titleIconProps={{ iconName: "BranchFork2" }}
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        description="Branch policies"
        backButtonProps={{ iconProps: { iconName: "Back" }, ariaLabel: "Back to branches", tooltipProps: { text: "Back to branches" }, onClick: () => go({ repo }) }}
        commandBarItems={[
          { id: "edit", text: "Edit on GitHub", important: true, iconProps: { iconName: "NavigateExternalInline" }, href: rulesSettingsHref(repo), target: "_blank" },
        ]}
      >
        {titleSwitcher(repo, openSwitch, (r) => go({ repo: r }))}
      </Header>
      <div className="page-content page-content-top gh-pr-body flex-column">
        {data.t === "error" ? (
          <ErrorView err={data.err} signIn={() => void props.signIn()} busy={props.busy} retry={() => { invalidateRefs(); setReload((n) => n + 1); }} subject="see this branch's policies" permission="Contents" />
        ) : data.t === "loading" ? (
          <Loading label="Loading branch policies" />
        ) : (
          <PoliciesBody repo={repo} branch={branch} d={data.v} />
        )}
      </div>
    </>
  );
}

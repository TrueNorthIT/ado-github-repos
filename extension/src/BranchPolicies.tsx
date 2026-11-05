// The Branch policies page (Branches hub, view=policies): native ADO's per-branch policies page, built from the GitHub rules that
// apply to the branch (lib/branchPolicies.ts). Sections follow native's order: Branch Policies, Build Validation, Automatically
// included reviewers, then the GitHub rules ADO puts under branch security.
// Readers see every toggle disabled, as native shows them to a user without "Edit policies". Repository admins edit them: the
// changes go to the one ruleset the extension owns for the branch (lib/policyEdit.ts), saved with the header's Save (Discard
// throws them away). Rules from other rulesets and classic protection stay read-only below, with "Edit on GitHub".
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Dialog } from "azure-devops-ui/Dialog";
import { FormItem } from "azure-devops-ui/FormItem";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { RadioButton, RadioButtonGroup } from "azure-devops-ui/RadioButton";
import { SimpleTableCell, Table, type ITableColumn } from "azure-devops-ui/Table";
import { TextField } from "azure-devops-ui/TextField";
import { Toggle } from "azure-devops-ui/Toggle";
import { ZeroData } from "azure-devops-ui/ZeroData";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { hasPolicies, mergeTypeName, reviewerSummary, rulesSettingsHref, sourceHref, sourceText, toPolicies, type BranchPolicies as Policies, type CheckPolicy, type PolicySource } from "./lib/branchPolicies";
import {
  addContext, changedPolicies, formErrors, formFromRules, isLocked, MAX_REVIEWERS, MERGE_METHODS, ownedRulesetName, policyWriteError, removeContext,
  rulesFromForm, savePlan, setPrPolicy, setReviewersOn, type PolicyForm, type Ruleset,
} from "./lib/policyEdit";
import { ErrorView } from "./Browser";
import { setEditGuard } from "./hostNav";
import { HubProps, Loading, titleSwitcher } from "./RepoHub";
import { useGh } from "./queryClient";
import { applyRulesetPlan, getBranchPolicies, getIsRepoAdmin, getOwnedRuleset, GhError, invalidateRefs, type BranchPoliciesData } from "./githubBrowse";
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

/** One policy: a Toggle (disabled unless onChange is given), its name, the sentence under it and, when on, its settings. */
function PolicyRow({ title, on, description, children, na, onChange, disabled }: { title: string; on: boolean; description: string; children?: React.ReactNode; na?: boolean; onChange?: (on: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`gh-bpol-row flex-row${na ? " gh-bpol-na" : ""}`}>
      <Toggle checked={on} disabled={!onChange || disabled} onChange={onChange && ((_e, v) => onChange(v))} ariaLabel={`${title}: ${na ? "not available" : on ? "on" : "off"}`} className="gh-bpol-toggle" />
      <div className="gh-bpol-text flex-column">
        <div className="gh-bpol-title body-m font-weight-semibold">{title}</div>
        <div className="secondary-text body-m">{description}</div>
        {on && children && <div className={`gh-bpol-detail flex-column body-m${onChange ? " gh-bpol-detail-edit" : ""}`}>{children}</div>}
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
    { id: "exp", name: "Build expiration", width: -25, renderCell: (_r, i, c, x) => <SimpleTableCell key="exp" columnIndex={i} tableColumn={c}><span className="text-ellipsis">{expiry(branch, x.strict)}</span></SimpleTableCell> },
    { id: "src", name: "Source", width: -20, renderCell: (_r, i, c, x) => <SimpleTableCell key="src" columnIndex={i} tableColumn={c}><Link href={sourceHref(repo, x.source)} target="_blank" rel="noopener noreferrer" subtle className="text-ellipsis">{sourceText(x.source)}</Link></SimpleTableCell> },
  ], [repo, branch]);
  return <Table<CheckPolicy> ariaLabel="Required status checks" role="table" columns={cols} itemProvider={provider} showHeader spacerWidth={8} />;
}

const expiry = (branch: string, strict: boolean | null) => (strict ? `Immediately when ${branch} is updated` : strict === null ? "Not shown (needs admin)" : "Never");

/** The read-only policies: every policy that applies (readers), or the rules that aren't the extension's own (admins, below the editor). */
function PoliciesBody({ repo, branch, p, classic, others }: { repo: string; branch: string; p: Policies; classic: BranchPoliciesData["classic"]; others?: boolean }) {
  const r = p.reviewers;
  return (
    <>
      {classic === "denied" && (
        <MessageCard severity={MessageCardSeverity.Info}>
          {branch} has a classic branch protection rule. GitHub shows its settings to repository admins only, so only its required status checks are listed here; it may also require reviewers or block force pushes.
        </MessageCard>
      )}
      {!hasPolicies(p) && classic !== "denied" ? (
        others ? null : <ZeroData iconProps={{ iconName: "Shield" }} imageAltText="" primaryText={`No policies apply to ${branch}`} secondaryText="Anyone with write access can push to this branch and merge into it. Add a ruleset on GitHub to protect it." />
      ) : (
        <>
          {(!others || r || p.commentResolution || p.mergeTypes) && (
            <Card className="gh-bpol-card" titleProps={{ text: "Branch Policies", ariaLevel: others ? 3 : 2 }}>
              <div className="gh-bpol-list flex-column">
                {(!others || r) && (
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
                )}
                {!others && <PolicyRow na title="Check for linked work items" on={false} description="Not available on GitHub. Link work items by writing AB#123 in the pull request description." />}
                {(!others || p.commentResolution) && (
                  <PolicyRow title="Check for comment resolution" on={!!p.commentResolution} description={p.commentResolution ? "All conversations must be resolved before a pull request can be completed." : "Pull requests can be completed with unresolved conversations."}>
                    {p.commentResolution && <Sources repo={repo} sources={p.commentResolution} />}
                  </PolicyRow>
                )}
                {(!others || p.mergeTypes) && (
                  <PolicyRow title="Limit merge types" on={!!p.mergeTypes} description={p.mergeTypes ? "Only these merge types are allowed when completing a pull request." : "Every merge type the repository allows can be used."}>
                    {p.mergeTypes && (
                      <>
                        {p.mergeTypes.methods.length > 0 && p.mergeTypes.methods.filter((m) => !p.mergeTypes!.linear || m !== "merge").map((m) => <div key={m}>{mergeTypeName(m)}</div>)}
                        {p.mergeTypes.linear && <div>Linear history: <strong>merge commits are not allowed</strong> (squash or rebase only)</div>}
                        <Sources repo={repo} sources={p.mergeTypes.sources} />
                      </>
                    )}
                  </PolicyRow>
                )}
              </div>
            </Card>
          )}
          {(!others || p.checks.length > 0) && (
            <Card className="gh-bpol-card bolt-table-card" contentProps={{ contentPadding: !p.checks.length }} titleProps={{ text: "Build Validation", ariaLevel: others ? 3 : 2 }}>
              {p.checks.length ? <ChecksTable repo={repo} branch={branch} checks={p.checks} /> : <Empty text="No status checks are required before merging." />}
            </Card>
          )}
          {(!others || r?.codeOwners) && (
            <Card className="gh-bpol-card" titleProps={{ text: "Automatically included reviewers", ariaLevel: others ? 3 : 2 }}>
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
          )}
          {p.other.length > 0 && (
            <Card className="gh-bpol-card" titleProps={{ text: "Branch protection", ariaLevel: others ? 3 : 2 }}>
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

/** Build validation while editing: the owned ruleset's required status checks, each removable, an add box, and "up to date" for all of them. */
function EditChecks({ branch, form, set, busy }: { branch: string; form: PolicyForm; set: (f: PolicyForm) => void; busy: boolean }) {
  const [name, setName] = React.useState("");
  const { contexts, strict } = form.checks;
  const items = React.useMemo(() => contexts.map((context) => ({ context })), [contexts]);
  const provider = React.useMemo(() => new ArrayItemProvider(items), [items]);
  const formRef = React.useRef(form);
  formRef.current = form;
  const cols = React.useMemo<ITableColumn<{ context: string }>[]>(() => [
    { id: "name", name: "Status check", width: -50, renderCell: (_r, i, c, x) => <SimpleTableCell key="name" columnIndex={i} tableColumn={c}><span className="text-ellipsis">{x.context}</span></SimpleTableCell> },
    { id: "req", name: "Requirement", width: -15, renderCell: (_r, i, c) => <SimpleTableCell key="req" columnIndex={i} tableColumn={c}>Required</SimpleTableCell> },
    { id: "exp", name: "Build expiration", width: -30, renderCell: (_r, i, c) => <SimpleTableCell key="exp" columnIndex={i} tableColumn={c}><span className="text-ellipsis">{expiry(branch, strict)}</span></SimpleTableCell> },
    {
      id: "del", name: "", width: 48,
      renderCell: (_r, i, c, x) => (
        <SimpleTableCell key="del" columnIndex={i} tableColumn={c}>
          <Button subtle iconProps={{ iconName: "Delete" }} ariaLabel={`Remove ${x.context}`} tooltipProps={{ text: "Remove" }} disabled={busy} onClick={() => set(removeContext(formRef.current, x.context))} />
        </SimpleTableCell>
      ),
    },
  ], [branch, strict, busy, set]);
  const add = () => { set(addContext(form, name)); setName(""); };
  return (
    <div className="gh-bpol-checks flex-column">
      <div className="gh-bpol-add flex-row">
        <TextField className="gh-bpol-add-name" value={name} onChange={(_e, t) => setName(t)} placeholder="Status check name, e.g. CI / build" ariaLabel="Status check name" disabled={busy}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Button text="Add status check" iconProps={{ iconName: "Add" }} onClick={add} disabled={busy || !name.trim() || contexts.includes(name.trim())} />
      </div>
      {contexts.length > 0 ? (
        <>
          <Checkbox label={`Require ${branch} to be up to date before merging (builds expire immediately when ${branch} is updated)`} checked={strict} disabled={busy} onChange={(_e, v) => set({ ...form, checks: { ...form.checks, strict: v } })} />
          <Table<{ context: string }> className="gh-bpol-checks-table" ariaLabel="Required status checks" role="table" columns={cols} itemProvider={provider} showHeader spacerWidth={8} />
        </>
      ) : (
        <Empty text="No status checks are required before merging." />
      )}
    </div>
  );
}

/** The editor: the owned ruleset's policies as native's toggles and settings. */
function EditBody({ branch, form, set, busy, locked }: { branch: string; form: PolicyForm; set: (f: PolicyForm) => void; busy: boolean; locked: boolean }) {
  const r = form.reviewers;
  const pr = "Changes must go through a pull request.";
  return (
    <>
      <Card className="gh-bpol-card" titleProps={{ text: "Branch Policies", ariaLevel: 2 }}>
        <div className="gh-bpol-list flex-column">
          <PolicyRow title="Require a minimum number of reviewers" on={r.on} disabled={busy} onChange={(v) => set(setReviewersOn(form, v))}
            description={r.on ? (r.count > 0 ? `Require ${r.count} approving review${r.count === 1 ? "" : "s"} before a pull request can be completed.` : `${pr} No approval is required.`) : "Changes can be pushed without a pull request."}>
            <FormItem label="Minimum number of reviewers" message={`0 to ${MAX_REVIEWERS}. 0 requires a pull request without an approval.`} error={r.on && !(Number.isInteger(r.count) && r.count >= 0 && r.count <= MAX_REVIEWERS)} className="gh-bpol-count">
              <TextField inputType="number" value={Number.isFinite(r.count) ? String(r.count) : ""} disabled={busy} ariaLabel="Minimum number of reviewers"
                onChange={(_e, t) => set({ ...form, reviewers: { ...r, count: t.trim() === "" ? NaN : Number(t) } })} />
            </FormItem>
            <Checkbox label="Prohibit the most recent pusher from approving their own changes" checked={r.lastPushApproval} disabled={busy} onChange={(_e, v) => set({ ...form, reviewers: { ...r, lastPushApproval: v } })} />
            <RadioButtonGroup text="When new changes are pushed" selectedButtonId={r.dismissStale ? "reset" : "keep"} onSelect={(id) => set({ ...form, reviewers: { ...r, dismissStale: id === "reset" } })}>
              <RadioButton id="keep" text="Keep existing votes" disabled={busy} />
              <RadioButton id="reset" text="Reset all approval votes" disabled={busy} />
            </RadioButtonGroup>
          </PolicyRow>
          <PolicyRow na title="Check for linked work items" on={false} description="Not available on GitHub. Link work items by writing AB#123 in the pull request description." />
          <PolicyRow title="Check for comment resolution" on={form.commentResolution} disabled={busy} onChange={(v) => set(setPrPolicy(form, "commentResolution", v))}
            description={form.commentResolution ? "All conversations must be resolved before a pull request can be completed." : `Pull requests can be completed with unresolved conversations. Turning this on also requires a pull request.`} />
          <PolicyRow title="Limit merge types" on={form.mergeTypes.on} disabled={busy} onChange={(v) => set(setPrPolicy(form, "mergeTypes", v))}
            description={form.mergeTypes.on ? "Only these merge types are allowed when completing a pull request." : "Every merge type the repository allows can be used."}>
            {MERGE_METHODS.map((m) => (
              <Checkbox key={m} label={mergeTypeName(m)} checked={form.mergeTypes.methods.includes(m)} disabled={busy}
                onChange={(_e, v) => set({ ...form, mergeTypes: { ...form.mergeTypes, methods: v ? [...form.mergeTypes.methods, m] : form.mergeTypes.methods.filter((x) => x !== m) } })} />
            ))}
            {!form.mergeTypes.methods.length && <div className="gh-bpol-error body-s">Choose at least one merge type.</div>}
          </PolicyRow>
        </div>
      </Card>
      <Card className="gh-bpol-card" titleProps={{ text: "Build Validation", ariaLevel: 2 }}>
        <EditChecks branch={branch} form={form} set={set} busy={busy} />
      </Card>
      <Card className="gh-bpol-card" titleProps={{ text: "Automatically included reviewers", ariaLevel: 2 }}>
        <div className="gh-bpol-list flex-column">
          <PolicyRow title="Code owners" on={r.codeOwners} disabled={busy} onChange={(v) => set(setPrPolicy(form, "codeOwners", v))}
            description={r.codeOwners ? "Required. The owners in the CODEOWNERS file of the paths a pull request changes must approve it." : "Code owners are not required to approve."} />
        </div>
      </Card>
      <Card className="gh-bpol-card" titleProps={{ text: "Branch protection", ariaLevel: 2 }}>
        <div className="gh-bpol-list flex-column">
          <PolicyRow title="Block force pushes" on={form.blockForcePush} disabled={busy} onChange={(v) => set({ ...form, blockForcePush: v })} description={form.blockForcePush ? "Nobody can force push to this branch or rewrite its history." : "People who can push may force push."} />
          <PolicyRow title="Restrict deletions" on={form.restrictDeletion} disabled={busy} onChange={(v) => set({ ...form, restrictDeletion: v })} description={form.restrictDeletion ? "Only people who can bypass the ruleset can delete this branch." : "People who can push may delete this branch."} />
          <PolicyRow title="Require signed commits" on={form.requireSignatures} disabled={busy} onChange={(v) => set({ ...form, requireSignatures: v })} description={form.requireSignatures ? "Every commit pushed to this branch must have a verified signature." : "Unsigned commits can be pushed."} />
          <PolicyRow title="Lock branch" on={locked} description={locked ? `Locked: nobody can push to ${branch}. Unlock it from the branch's menu on the Branches page.` : "Lock the branch from its menu on the Branches page to stop all pushes."} />
        </div>
      </Card>
    </>
  );
}

type Owned = { t: "loading" } | { t: "none" } | { t: "denied"; text: string } | { t: "ready"; rs: Ruleset | null };

/** Whether the viewer may edit, and the owned ruleset when so. Never rejects: a refusal is a value the page shows. */
async function loadOwned(repo: string, branch: string): Promise<Exclude<Owned, { t: "loading" }>> {
  if (!(await getIsRepoAdmin(repo))) return { t: "none" };
  try {
    return { t: "ready", rs: await getOwnedRuleset(repo, branch) };
  } catch (e) {
    const w = e instanceof GhError && e.kind === "access" ? policyWriteError(e.status, e.apiMessage) : null;
    return w ? { t: "denied", text: w.text } : { t: "none" };
  }
}

export function BranchPolicies({ repo, branch, props }: { repo: string; branch: string; props: HubProps }) {
  const { go, openSwitch } = props;
  const data = useGh<BranchPoliciesData>(["refs", "policies", repo, branch], () => getBranchPolicies(repo, branch), { persist: true });
  // Admins only: the extension's own ruleset for this branch, which the editor writes. Not kept between visits: the editor starts from GitHub's rules.
  const ownedLoad = useGh<Exclude<Owned, { t: "loading" }>>(["refs", "policies", "owned", repo, branch], () => loadOwned(repo, branch));
  const owned: Owned = ownedLoad.t === "ready" ? ownedLoad.v : { t: "loading" };
  const [form, setForm] = React.useState<PolicyForm | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ text: string; admin: boolean } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const ownedRs = owned.t === "ready" ? owned.rs : null;
  const saved = React.useMemo(() => formFromRules(ownedRs?.rules), [ownedRs]);
  // Seed the editor from the owned ruleset, and again when it changes on GitHub (after a save, or a refresh) unless there are unsaved edits.
  const lastSaved = React.useRef<PolicyForm | null>(null);
  const justSaved = React.useRef(false);
  React.useEffect(() => {
    if (owned.t !== "ready") return;
    const prev = lastSaved.current;
    setForm((f) => (!f || justSaved.current || (prev && JSON.stringify(f) === JSON.stringify(prev)) ? saved : f));
    lastSaved.current = saved;
    justSaved.current = false;
  }, [owned.t, saved]);
  const editing = owned.t === "ready" && !!form;
  const changes = editing ? changedPolicies(saved, form!) : [];
  const problems = editing ? formErrors(form!) : [];
  const set = React.useCallback((f: PolicyForm) => { justSaved.current = false; setForm(f); setNotice(null); }, []);

  const save = async () => {
    if (!form || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fresh = await getOwnedRuleset(repo, branch); // the latest rules, so a lock set meanwhile is kept
      await applyRulesetPlan(savePlan(repo, branch, fresh, rulesFromForm(form, fresh?.rules)));
      setNotice(`Saved: ${changes.join(", ")}.`);
      justSaved.current = true; // applyRulesetPlan dropped the cached refs, so the ruleset refetches and reseeds the editor
    } catch (e) {
      const w = e instanceof GhError && (e.kind === "access" || e.kind === "other") ? policyWriteError(e.status, e.apiMessage) : null;
      setError(w ?? { admin: false, text: e instanceof GhError && e.kind === "auth" ? "Sign in to GitHub again, then save." : "The policies couldn't be saved. Try again." });
    } finally {
      setBusy(false);
    }
  };
  const discard = () => { setForm(saved); setError(null); };

  // Unsaved edits: any navigation away (Back, the branch or repo switcher, back/forward) asks first through hostNav's guard, as the
  // Files editor and the release form do; a closing tab warns. The page's address isn't in BrowseState, so the guard asks on every navigation.
  const dirty = changes.length > 0 && !busy;
  const [leave, setLeave] = React.useState<(() => void) | null>(null);
  React.useEffect(() => {
    setEditGuard({ dirty, anyNav: true, path: "policies", ask: (proceed) => setLeave(() => proceed), discard: () => setEditGuard(null) });
    return () => setEditGuard(null);
  }, [dirty]);
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const d = data.t === "ready" ? data.v : undefined;
  const others = React.useMemo(() => {
    if (!d || !editing) return null;
    return toPolicies(d.rules.filter((r) => !ownedRs || r.ruleset_id !== ownedRs.id), d.classicState, d.branchInfo);
  }, [d, editing, ownedRs]);

  return (
    <>
      <Header
        className="gh-hub-header gh-act-header"
        title={branch}
        titleIconProps={{ iconName: "BranchFork2" }}
        titleSize={TitleSize.Large}
        titleAriaLevel={1}
        description="Branch policies"
        backButtonProps={{ iconProps: { iconName: "Back" }, ariaLabel: "Back to branches", tooltipProps: { text: "Back to branches" }, onClick: () => go({ repo }) }}
        commandBarItems={[
          ...(editing ? [
            { id: "save", text: busy ? "Saving…" : "Save", isPrimary: true, important: true, iconProps: { iconName: "Save" }, disabled: busy || !changes.length || problems.length > 0, onActivate: () => void save() },
            { id: "discard", text: "Discard", important: true, iconProps: { iconName: "Undo" }, disabled: busy || !changes.length, onActivate: discard },
          ] : []),
          { id: "edit", text: "Edit on GitHub", important: true, iconProps: { iconName: "NavigateExternalInline" }, href: rulesSettingsHref(repo), target: "_blank" },
        ]}
      >
        {titleSwitcher(repo, openSwitch, (r) => go({ repo: r }))}
      </Header>
      <div className="page-content page-content-top gh-pr-body flex-column">
        {data.t === "error" ? (
          <ErrorView err={data.err} signIn={() => void props.signIn()} busy={props.busy} retry={invalidateRefs} subject="see this branch's policies" permission="Contents" />
        ) : data.t === "loading" || owned.t === "loading" ? (
          <Loading label="Loading branch policies" />
        ) : editing && others ? (
          <>
            {notice && <MessageCard severity={MessageCardSeverity.Info} onDismiss={() => setNotice(null)}>{notice}</MessageCard>}
            {error && <MessageCard className="gh-bpol-message" severity={MessageCardSeverity.Error} onDismiss={() => setError(null)}>{error.text}</MessageCard>}
            <MessageCard className="gh-bpol-message" severity={MessageCardSeverity.Info}>
              {`Changes are saved to the ruleset "${ownedRulesetName(branch)}" on GitHub, which this extension manages. `}
              {hasPolicies(others) || data.v.classic === "denied"
                ? "Other rules below also apply and can only be changed on GitHub. GitHub enforces all of them together, so the effective policy is the strictest combination."
                : "No other rulesets or branch protection rules apply to this branch."}
              {ownedRs && ownedRs.enforcement && ownedRs.enforcement !== "active" && ` The ruleset is set to "${ownedRs.enforcement}" on GitHub, so its rules are not enforced.`}
            </MessageCard>
            <EditBody branch={branch} form={form!} set={set} busy={busy} locked={isLocked(ownedRs)} />
            {(hasPolicies(others) || data.v.classic === "denied") && (
              <div className="gh-bpol-others flex-column">
                <Header title="Rules from GitHub" titleSize={TitleSize.Medium} titleAriaLevel={2} description="Other rulesets and branch protection on this branch. Read-only here: open a rule's source to edit it on GitHub." className="gh-bpol-others-header" />
                <PoliciesBody repo={repo} branch={branch} p={others} classic={data.v.classic} others />
              </div>
            )}
          </>
        ) : (
          <>
            {owned.t === "denied" && <MessageCard className="gh-bpol-message" severity={MessageCardSeverity.Warning}>{owned.text}</MessageCard>}
            <PoliciesBody repo={repo} branch={branch} p={data.v.policies} classic={data.v.classic} />
          </>
        )}
      </div>
      {leave && (
        <Dialog
          titleProps={{ text: "Discard your changes?" }}
          onDismiss={() => setLeave(null)}
          footerButtonProps={[{ text: "Keep editing", onClick: () => setLeave(null) }, { text: "Discard changes", primary: true, onClick: () => { const run = leave; setLeave(null); run(); } }]}
        >
          Your changes to the policies for {branch} have not been saved and will be lost.
        </Dialog>
      )}
    </>
  );
}

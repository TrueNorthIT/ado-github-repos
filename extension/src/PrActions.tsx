// Acting on a pull request (batch 1): the header's Approve and Complete split buttons, the ⋯ items, the Complete panel,
// the vote and target-branch dialogs, and the policies card. State lives in actionStore.ts; this file only draws it.
import * as React from "react";
import { ContentSize } from "azure-devops-ui/Callout";
import { Card } from "azure-devops-ui/Card";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { ClipboardButton } from "azure-devops-ui/Components/ClipboardButton/ClipboardButton";
import { Button } from "azure-devops-ui/Button";
import { Dialog } from "azure-devops-ui/Dialog";
import { Dropdown } from "azure-devops-ui/Dropdown";
import { FormItem } from "azure-devops-ui/FormItem";
import { Icon } from "azure-devops-ui/Icon";
import { Link } from "azure-devops-ui/Link";
import { MenuItemType, type IMenuItem } from "azure-devops-ui/Menu";
import { Panel } from "azure-devops-ui/Panel";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { SplitButton } from "azure-devops-ui/SplitButton";
import { Status, Statuses, StatusSize } from "azure-devops-ui/Status";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { ActionStore } from "./actionStore";
import { getBranchNames, getMergeMessages } from "./githubBrowse";
import { mergeMethodLabel, supportsCustomMessage, type MergeMethod } from "./lib/mergeOptions";
import type { PolicyState } from "./lib/policies";
import type { ActionablePolicyRow } from "./lib/updateBranch";
import type { CheckRerun } from "./lib/reruns";
import type { StateActionId } from "./lib/stateActions";
import type { VoteId } from "./lib/votes";
import type { WorkItemRef } from "./lib/workItems";
import { fetchWorkItems } from "./workItemsApi";
import { FinishReview } from "./ReviewUi";

/** Which panel or dialog is open. */
export interface Ui {
  panel?: "complete" | "autoComplete";
  vote?: VoteId;
  target?: boolean;
}

const STATUS_OF: Record<PolicyState, typeof Statuses.Success> = { success: Statuses.Success, failure: Statuses.Failed, pending: Statuses.Waiting, neutral: Statuses.Skipped };
const VOTE_STATUS: Record<VoteId, typeof Statuses.Success | undefined> = {
  approve: Statuses.Success,
  approveWithSuggestions: Statuses.Success,
  waitForAuthor: Statuses.Waiting,
  reject: Statuses.Failed,
  reset: undefined,
};
const voteIcon = (id: VoteId) => ({
  render: (cls?: string) => (VOTE_STATUS[id] ? <Status {...VOTE_STATUS[id]!} size={StatusSize.m} className={cls} ariaLabel="" /> : <Icon iconName="CircleRing" className={cls} />),
});
const STATE_ICON: Partial<Record<StateActionId, string>> = { abandon: "Delete", markAsDraft: "BranchRequestDraft", reactivate: "BranchPullRequest" };

// ---------- header ----------

const Approve = ({ store, setUi }: { store: ActionStore; setUi: (u: Ui) => void }) => {
  const v = store.view;
  const main = v?.votes.find((o) => o.id === "approve");
  const approved = v?.voteLabel === "Approved";
  const merged = v?.pr.state === "MERGED";
  const why = !main ? undefined : !main.enabled ? main.disabledReason : approved ? "You've already approved this pull request." : undefined;
  const items: IMenuItem[] = [];
  for (const o of v?.votes ?? []) {
    if (o.id === "reset") items.push({ id: "divider", itemType: MenuItemType.Divider });
    items.push({
      id: o.id,
      text: o.label,
      secondaryText: o.disabledReason,
      disabled: !o.enabled || store.busy,
      iconProps: voteIcon(o.id),
      onActivate: () => (o.bodyRequired ? setUi({ vote: o.id }) : void store.vote(o.id)),
    });
  }
  if (merged) return null;
  return (
    <SplitButton
      className="gh-split gh-split-approve"
      buttonProps={{ text: v?.voteLabel ?? "Approve", onClick: () => void store.vote("approve"), disabled: !main || !main.enabled || approved || store.busy, tooltipProps: why ? { text: why } : undefined }}
      menuButtonProps={{ ariaLabel: "More approve options", disabled: !v, contextualMenuProps: { className: "gh-vote-callout", menuProps: { id: "gh-vote-menu", items } } }}
    />
  );
};

const mainIcon = (kind: string) => (kind === "dequeue" ? "Cancel" : kind === "complete" || kind === "autoComplete" || kind === "enqueue" || kind === "none" ? "BranchMerge" : "BranchPullRequest");

const Complete = ({ store, setUi }: { store: ActionStore; setUi: (u: Ui) => void }) => {
  const v = store.view;
  if (v?.pr.state === "MERGED") return null;
  const main = v?.main;
  const run = () => {
    if (!main) return;
    if (main.kind === "complete" || main.kind === "autoComplete") setUi({ panel: main.kind });
    else if (main.kind === "publish" || main.kind === "reactivate") void store.setState(main.kind);
    else if (main.kind === "cancelAuto") void store.cancelAutoComplete();
    else if (main.kind === "enqueue") void store.enqueue();
    else if (main.kind === "dequeue") void store.dequeue();
  };
  const items: IMenuItem[] = [];
  if (main) {
    items.push({ id: "main", text: main.label, secondaryText: main.reason?.split("\n")[0], disabled: main.disabled || store.busy, iconProps: { iconName: mainIcon(main.kind) }, onActivate: run });
    for (const a of v!.states) {
      if (a.id === main.kind) continue; // publish / reactivate are already the main action
      items.push({ id: a.id, text: a.label, secondaryText: a.disabledReason, disabled: !a.enabled || store.busy, iconProps: STATE_ICON[a.id] ? { iconName: STATE_ICON[a.id] } : undefined, onActivate: () => void store.setState(a.id) });
    }
  }
  return (
    <SplitButton
      primary
      className="gh-split gh-split-complete"
      buttonProps={{
        text: main?.label ?? "Complete",
        iconProps: { iconName: main ? mainIcon(main.kind) : "BranchMerge" },
        onClick: run,
        disabled: !main || main.disabled || store.busy,
        tooltipProps: main?.reason ? { text: main.reason } : undefined,
      }}
      menuButtonProps={{ ariaLabel: "More complete options", disabled: !v, contextualMenuProps: { className: "gh-vote-callout", menuProps: { id: "gh-complete-menu", items } } }}
    />
  );
};

/**
 * The header command bar: copy link, Approve, Complete, then the ⋯ items (Open on GitHub, Follow on GitHub, Change target branch, then `rest`).
 * `open` and `rest` come from the hub (App's sign-out item lives in `rest`).
 */
export function prCommandItems(store: ActionStore, url: string, open: any, rest: any[], setUi: (u: Ui) => void): any[] {
  const v = store.view;
  return [
    { id: "copy", important: true, text: "Copy pull request link", renderButton: () => <ClipboardButton key="copy" className="gh-pr-copylink" getContent={() => url} ariaLabel="Copy pull request link" showCopiedTooltip subtle /> },
    { id: "finishReview", important: true, text: "Finish review", renderButton: () => <FinishReview key="finishReview" repo={store.repo} number={store.number} /> },
    { id: "approve", important: true, text: "Approve", renderButton: () => <Approve key="approve" store={store} setUi={setUi} /> },
    { id: "complete", important: true, text: "Complete", renderButton: () => <Complete key="complete" store={store} setUi={setUi} /> },
    { ...open, important: false },
    // GitHub refuses updateSubscription for GitHub App user tokens (notifications are not an app permission), so send the user to GitHub.
    { id: "follow", important: false, text: "Follow on GitHub", iconProps: { iconName: "Ringer" }, onActivate: () => void window.open(url, "_blank", "noopener") },
    { id: "target", important: false, text: "Change target branch", iconProps: { iconName: "BranchCompare" }, disabled: !v || store.busy || !v.pr.viewerCanUpdate || v.pr.state !== "OPEN", onActivate: () => setUi({ target: true }) },
    ...rest.map((c) => ({ ...c, important: false })),
  ];
}

// ---------- dialogs ----------

function VoteDialog({ store, id, close }: { store: ActionStore; id: VoteId; close: () => void }) {
  const label = store.view?.votes.find((o) => o.id === id)?.label ?? "Vote";
  const [text, setText] = React.useState("");
  const confirm = () => {
    if (!text.trim()) return;
    close();
    void store.vote(id, text);
  };
  return (
    <Dialog
      titleProps={{ text: label }}
      onDismiss={close}
      footerButtonProps={[{ text: "Cancel", onClick: close }, { text: label, primary: true, disabled: !text.trim(), onClick: confirm }]}
    >
      <TextField
        label={id === "approveWithSuggestions" ? "Suggestions" : "Comment"}
        required
        multiline
        rows={5}
        autoFocus
        value={text}
        onChange={(_e, v) => setText(v)}
        placeholder={id === "approveWithSuggestions" ? "What would you suggest?" : "Say why. GitHub needs a comment here."}
        width={TextFieldWidth.standard}
      />
    </Dialog>
  );
}

function TargetDialog({ store, repo, close }: { store: ActionStore; repo: string; close: () => void }) {
  const pr = store.view!.pr;
  const [names, setNames] = React.useState<string[]>();
  const [pick, setPick] = React.useState<string>();
  const selection = React.useRef(new DropdownSelection());
  React.useEffect(() => {
    let dead = false;
    getBranchNames(repo).then((n) => !dead && setNames(n), () => !dead && setNames([]));
    return () => { dead = true; };
  }, [repo]);
  const items = (names ?? []).filter((n) => n !== pr.baseRefName && n !== pr.headRefName).map((n) => ({ id: n, text: n }));
  return (
    <Dialog
      titleProps={{ text: "Change target branch" }}
      onDismiss={close}
      footerButtonProps={[
        { text: "Cancel", onClick: close },
        { text: "Change", primary: true, disabled: !pick, onClick: () => { close(); void store.changeTarget(pick!); } },
      ]}
    >
      <FormItem label={`Target branch (now ${pr.baseRefName})`}>
        <Dropdown ariaLabel="Target branch" items={items} selection={selection.current} placeholder={names ? "Choose a branch" : "Loading branches"} noItemsText={names ? "No other branches" : "Loading branches"} showFilterBox filterPlaceholderText="Find a branch" onSelect={(_e, i) => setPick(i.id)} />
      </FormItem>
    </Dialog>
  );
}

// ---------- Complete panel ----------

/** Small hand-drawn picture of what each merge type does to the history (native draws the same idea). */
function MergeDiagram({ method }: { method: MergeMethod }) {
  const commit = (x: number, y: number, kind: "base" | "new" | "old") => <circle key={`${x},${y}`} cx={x} cy={y} r={6} className={`gh-diagram-${kind}`} />;
  const line = (d: string, dashed?: boolean) => <path key={d} d={d} className={dashed ? "gh-diagram-line gh-diagram-dashed" : "gh-diagram-line"} />;
  const alt = { MERGE: "A merge commit joins the source branch back into the target.", SQUASH: "The source branch's commits become one commit on the target.", REBASE: "The source branch's commits are replayed one by one on the target." }[method];
  return (
    <svg className="gh-diagram" viewBox="0 0 240 56" role="img" aria-label={alt}>
      {method === "MERGE" && <>{line("M20 14H200")}{line("M70 14L100 42H130L160 14")}{[20, 70, 160, 200].map((x) => commit(x, 14, x === 160 ? "new" : "base"))}{commit(100, 42, "old")}{commit(130, 42, "old")}</>}
      {method === "SQUASH" && <>{line("M20 14H200")}{line("M70 14L100 42H130", true)}{[20, 70].map((x) => commit(x, 14, "base"))}{commit(100, 42, "old")}{commit(130, 42, "old")}{commit(160, 14, "new")}{line("M130 42L160 14", true)}</>}
      {method === "REBASE" && <>{line("M20 14H200")}{line("M70 14L100 42H130", true)}{[20, 70].map((x) => commit(x, 14, "base"))}{commit(100, 42, "old")}{commit(130, 42, "old")}{commit(130, 14, "new")}{commit(165, 14, "new")}</>}
    </svg>
  );
}

type Wi = { t: "none" } | { t: "loading" } | { t: "error" } | { t: "ready"; items: WorkItemRef[] };

function CompletePanel({ store, repo, number, mode, workItemIds, close }: { store: ActionStore; repo: string; number: number; mode: "complete" | "autoComplete"; workItemIds: number[]; close: () => void }) {
  const v = store.view!;
  const auto = mode === "autoComplete";
  const [method, setMethod] = React.useState<MergeMethod | null>(v.defaults.mergeMethod);
  const repoDeletes = v.repo.deleteBranchOnMerge;
  const [del, setDel] = React.useState(repoDeletes || (!auto && v.defaults.deleteSourceBranch));
  const [wiOn, setWiOn] = React.useState(false);
  const [custom, setCustom] = React.useState(false);
  const [headline, setHeadline] = React.useState("");
  const [body, setBody] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [msgs, setMsgs] = React.useState<Awaited<ReturnType<typeof getMergeMessages>> | undefined>();
  const [wi, setWi] = React.useState<Wi>(workItemIds.length ? { t: "loading" } : { t: "none" });
  const selection = React.useRef(new DropdownSelection());
  const methodItems = v.methods.map((m) => ({ id: m, text: mergeMethodLabel(m) }));
  React.useEffect(() => { if (method) selection.current.select(v.methods.indexOf(method)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!workItemIds.length) return;
    let dead = false;
    fetchWorkItems(workItemIds).then(
      (r) => !dead && setWi({ t: "ready", items: r.items }),
      () => !dead && setWi({ t: "error" })
    );
    return () => { dead = true; };
  }, [workItemIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const canCustom = !!method && supportsCustomMessage(method);
  React.useEffect(() => {
    if (custom && canCustom && msgs === undefined) getMergeMessages(repo, number).then((m) => setMsgs(m ?? null));
  }, [custom, canCustom]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!touched && msgs && method && method !== "REBASE") (setHeadline(msgs[method].headline), setBody(msgs[method].body));
  }, [msgs, method, touched]);

  const found = wi.t === "ready" ? wi.items.filter((i) => i.found) : [];
  const wiWhy = auto ? "Work items can only be completed when the merge happens now, not when auto-complete finishes it."
    : wi.t === "none" ? "No work items are linked to this pull request."
    : wi.t === "loading" ? "Loading the linked work items."
    : wi.t === "error" ? "The linked work items couldn't be loaded."
    : !found.length ? "None of the linked work items could be found." : undefined;
  const delWhy = repoDeletes ? "This repository deletes branches when they're merged"
    : auto ? "GitHub can't delete the branch when auto-complete finishes the merge. Turn on automatic head branch deletion in the repository settings."
    : v.deleteChoice.reason;
  const delDisabled = repoDeletes || auto || !v.deleteChoice.available;

  const confirm = () => {
    if (!method) return;
    close();
    void store.complete({
      mode,
      mergeMethod: method,
      commitHeadline: custom && canCustom ? headline : undefined,
      commitBody: custom && canCustom ? body : undefined,
      deleteSourceBranch: del && !delDisabled,
      workItems: wiOn && !wiWhy ? found : undefined,
    });
  };
  const title = auto ? "Set auto-complete" : "Complete pull request";
  const note = (id: string, why?: string) => (why ? <div id={id} className="gh-complete-why secondary-text body-s">{why}</div> : null);

  return (
    <Panel
      titleProps={{ text: title }}
      size={ContentSize.Medium}
      onDismiss={close}
      showSeparator
      footerButtonProps={[
        { text: "Cancel", onClick: close },
        { text: auto ? "Set auto-complete" : "Complete merge", primary: true, onClick: confirm, disabled: !method || store.busy },
      ]}
    >
      <div className="gh-complete flex-column">
        {auto && <div className="secondary-text body-m">GitHub will merge this pull request when its required checks and reviews pass.</div>}
        <FormItem label="Merge type">
          <Dropdown ariaLabel="Merge type" items={methodItems} selection={selection.current} placeholder={method ? undefined : "No merge type is allowed"} onSelect={(_e, i) => (setMethod(i.id as MergeMethod), setTouched(false))} />
        </FormItem>
        {method && <MergeDiagram method={method} />}
        <div className="font-weight-semibold">Post-completion options</div>
        <div className="gh-complete-option">
          <Checkbox label="Complete associated work items after merging" checked={wiOn && !wiWhy} disabled={!!wiWhy} onChange={(_e, c) => setWiOn(c)} ariaDescribedBy="gh-wi-why" />
          {note("gh-wi-why", wiWhy)}
        </div>
        <div className="gh-complete-option">
          <Checkbox label={`Delete ${v.pr.headRefName} after merging`} checked={del} disabled={delDisabled} onChange={(_e, c) => setDel(c)} ariaDescribedBy="gh-del-why" />
          {note("gh-del-why", delWhy)}
        </div>
        <div className="gh-complete-option">
          <Checkbox label="Customize merge commit message" checked={custom && canCustom} disabled={!canCustom} onChange={(_e, c) => setCustom(c)} ariaDescribedBy="gh-custom-why" />
          {note("gh-custom-why", canCustom ? undefined : "A rebase merge doesn't create a merge commit.")}
        </div>
        {custom && canCustom && (
          <>
            <TextField label="Commit headline" ariaLabel="Commit headline" value={headline} onChange={(_e, t) => (setHeadline(t), setTouched(true))} />
            <TextField label="Commit message" ariaLabel="Commit message" multiline rows={6} value={body} onChange={(_e, t) => (setBody(t), setTouched(true))} />
          </>
        )}
      </div>
    </Panel>
  );
}

// ---------- the dialogs the page renders ----------

export function PrActionDialogs({ store, repo, number, workItemIds, ui, setUi }: { store: ActionStore; repo: string; number: number; workItemIds: number[]; ui: Ui; setUi: (u: Ui) => void }) {
  const close = () => setUi({});
  if (!store.view) return null;
  return (
    <>
      {ui.panel && <CompletePanel store={store} repo={repo} number={number} mode={ui.panel} workItemIds={workItemIds} close={close} />}
      {ui.vote && <VoteDialog store={store} id={ui.vote} close={close} />}
      {ui.target && <TargetDialog store={store} repo={repo} close={close} />}
    </>
  );
}

// ---------- policies card ----------

const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);

/** CI-2: "Re-run failed jobs" with "Re-run all jobs" in its menu; a disabled button carrying the reason when the row can't be re-run. */
function RerunButton({ store, title, rerun }: { store: ActionStore; title: string; rerun: CheckRerun }) {
  if (!rerun.canRerun) return <Button className="gh-policy-action" subtle disabled iconProps={{ iconName: "Refresh" }} text="Re-run failed jobs" ariaLabel={`Re-run failed jobs for ${title}: ${rerun.reason}`} tooltipProps={{ text: rerun.reason }} />;
  const runId = rerun.runId;
  const items: IMenuItem[] = [{ id: "all", text: "Re-run all jobs", iconProps: { iconName: "Refresh" }, disabled: store.busy, onActivate: () => void store.rerun(runId, true) }];
  return (
    <SplitButton
      className="gh-policy-action"
      buttonProps={{ text: "Re-run failed jobs", iconProps: { iconName: "Refresh" }, ariaLabel: `Re-run failed jobs for ${title}`, disabled: store.busy, onClick: () => void store.rerun(runId, false) }}
      menuButtonProps={{ ariaLabel: `More re-run options for ${title}`, contextualMenuProps: { className: "gh-vote-callout", menuProps: { id: `gh-rerun-${runId}`, items } } }}
    />
  );
}

/** CI-3: "Update branch" merges the base into the head; the menu offers Rebase, disabled with its reason where the head can't be pushed to. */
function UpdateBranchButton({ store, methods }: { store: ActionStore; methods: NonNullable<ActionablePolicyRow["action"]>["methods"] }) {
  const items: IMenuItem[] = methods.map((m) => ({ id: m.method, text: m.label, secondaryText: m.reason, disabled: m.disabled || store.busy, iconProps: { iconName: m.method === "MERGE" ? "BranchMerge" : "BranchPullRequest" }, onActivate: () => void store.updateBranch(m.method) }));
  const merge = methods.find((m) => m.method === "MERGE")!;
  return (
    <SplitButton
      className="gh-policy-action"
      buttonProps={{ text: "Update branch", iconProps: { iconName: "Download" }, disabled: merge.disabled || store.busy, onClick: () => void store.updateBranch("MERGE") }}
      menuButtonProps={{ ariaLabel: "More update branch options", contextualMenuProps: { className: "gh-vote-callout", menuProps: { id: "gh-update-menu", items } } }}
    />
  );
}

function PolicyItem({ r, store }: { r: ActionablePolicyRow; store: ActionStore }) {
  const href = safeUrl(r.url);
  const info = r.kind === "check" ? store.view?.checkInfo.get(r.title) : undefined;
  return (
    <li className="gh-policy flex-row flex-center">
      <Status {...STATUS_OF[r.state]} size={StatusSize.m} ariaLabel={{ success: "Passed", failure: "Failed", pending: "Waiting", neutral: "Skipped" }[r.state]} />
      <span className="gh-policy-title body-m text-ellipsis">{r.title}</span>
      {r.required && <Pill size={PillSize.compact} variant={PillVariant.standard}>Required</Pill>}
      {!!info?.annotations && <span className="gh-policy-annotations secondary-text body-s">{info.annotations} {info.annotations === 1 ? "annotation" : "annotations"}</span>}
      {r.detail && <span className="gh-policy-detail secondary-text body-s text-ellipsis">{r.detail}</span>}
      {href && <Link className="gh-policy-link body-s" href={href} target="_blank" rel="noopener noreferrer">Details</Link>}
      {info && (info.rerun.canRerun || r.state === "failure") && <RerunButton store={store} title={r.title} rerun={info.rerun} />}
      {r.action?.kind === "updateBranch" && <UpdateBranchButton store={store} methods={r.action.methods} />}
    </li>
  );
}

/** The Overview's top card for an open pull request: one row per policy. Returns null when the page should show its fallback card instead. */
export function PoliciesCard({ store }: { store: ActionStore }) {
  if (store.status === "loading" && !store.view) return <Card className="gh-pr-card gh-pr-merge"><div className="gh-pr-merge-row flex-row flex-center"><Spinner size={SpinnerSize.small} ariaLabel="Loading policies" /></div></Card>;
  const v = store.view;
  if (!v || v.pr.state !== "OPEN") return null;
  const ok = v.decision.canComplete;
  const queued = v.decision.primaryAction === "dequeue";
  const text = queued ? "This pull request is in the merge queue" : ok ? "This pull request can be completed" : v.decision.primaryAction === "publish" ? "This pull request is a draft" : "This pull request can't be completed yet";
  return (
    <Card className="gh-pr-card gh-pr-merge gh-pr-policies bolt-card-no-vertical-padding">
      <div className="gh-policies flex-column">
        <div className="flex-row flex-center gh-pr-merge-row">
          <Status {...(queued ? Statuses.Running : ok ? Statuses.Success : Statuses.Warning)} size={StatusSize.l} ariaLabel={text} />
          <div className="flex-column">
            <span className="body-m font-weight-semibold">{text}</span>
            {v.decision.queueText && <span className="secondary-text body-s">{v.decision.queueText}</span>}
            {!queued && v.decision.autoCompleteEnabled && <span className="secondary-text body-s">Auto-complete is set: GitHub will merge when the requirements are met.</span>}
          </div>
        </div>
        {v.rows.length > 0 && (
          <ul className="gh-policy-list" aria-label="Policies">
            {v.rows.map((r, i) => <PolicyItem key={`${r.kind}-${r.title}-${i}`} r={r} store={store} />)}
          </ul>
        )}
      </div>
    </Card>
  );
}

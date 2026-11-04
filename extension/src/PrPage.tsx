// The pull request page (PR-5 to PR-9): header, then Overview / Files / Commits.
import * as React from "react";
import { Card } from "azure-devops-ui/Card";
import { ClipboardButton } from "azure-devops-ui/Components/ClipboardButton/ClipboardButton";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Icon } from "azure-devops-ui/Icon";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { Status, Statuses, StatusSize } from "azure-devops-ui/Status";
import { Table, ITableColumn, TwoLineTableCell } from "azure-devops-ui/Table";
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { HoverRepoContext, PersonHover } from "./HoverCard";
import { RelDate } from "./RelDate";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { BrowseState, type PrPage as PrPageId } from "./lib/browseState";
import type { ChecksSummary, Mergeable, PrPageData, PrReviewer, PrStatus, ReviewState } from "./lib/prModel";
import { commitUrl } from "./lib/commits";
import { reviewerName } from "./lib/copilotReview";
import { prepareMarkdownHtml } from "./lib/markdown";
import type { WorkItemRef } from "./lib/workItems";
import { PermissionError } from "./connections";
import { getBranchRules, getCodeOwnerSet, getCommitSignatures, getDeployments, getPr, invalidatePr } from "./githubBrowse";
import type { BranchRule } from "./lib/branchRules";
import { codeOwnerRequirement, reviewerGroups, type CodeOwnerSet, type ReviewerGroups } from "./lib/codeOwners";
import { fetchWorkItems, type WorkItemsResult } from "./workItemsApi";
import { openRepoHub } from "./hostNav";
import { openInRepos, useRepoHref } from "./repoHref";
import { watchTheme } from "./theme";
import { ErrorView, Markdown } from "./Browser";
import { PrFilesTab } from "./PrFiles";
import { PrUpdatesTab } from "./PrUpdates";
import { recordPrViewed } from "./prefs";
import { viewedKey } from "./lib/lastViewed";
import { ActivityFeed } from "./Feed";
import { feedStore, useFeed } from "./feedStore";
import { ReactionBar } from "./CommentParts";
import { actionStore, useActions, type ActionStore } from "./actionStore";
import { PoliciesCard, PrActionDialogs, prCommandItems, type Ui } from "./PrActions";
import { SignaturePill } from "./Signature";
import { ClosingIssueAdd, DescriptionEditor, EditableTitle, EditError, IssueRow, LabelPill, LabelsAdd, MilestoneAdd, PeopleAdd, ProjectsAdd, RemoveButton, WorkItemsAdd, addItem, dueText, sameReviewer, useEdit, workItemInBody, type EditData } from "./PrEdit";
import { toLabelOption } from "./lib/labels";
import { latestDeployments, type DeploymentRow, type DeploymentTone } from "./lib/deployments";
import type { CommitSignature } from "./lib/signatures";
import "./browser.css";

const PAGES: { id: PrPageId; name: string }[] = [
  { id: "overview", name: "Overview" },
  { id: "files", name: "Files" },
  { id: "updates", name: "Updates" },
  { id: "commits", name: "Commits" },
];

// ---------- header (PR-5) ----------

// Active is native's rgb(0,120,212) with white text; the others are native-like.
const STATUS: Record<PrStatus, { text: string; color?: { red: number; green: number; blue: number } }> = {
  active: { text: "Active", color: { red: 0, green: 120, blue: 212 } },
  draft: { text: "Draft" },
  completed: { text: "Completed", color: { red: 16, green: 124, blue: 16 } },
  abandoned: { text: "Abandoned", color: { red: 96, green: 94, blue: 92 } },
};

function Meta({ pr, repo, status }: { pr: PrPageData; repo: string; status?: PrStatus }) {
  const href = useRepoHref();
  const s = STATUS[status ?? pr.status];
  const branch = (ref: string) => <Link className="gh-pr-branch-link" href={href({ repo, ref })} onClick={openInRepos({ repo, ref })}>{ref}</Link>;
  return (
    <div className="gh-pr-meta flex-row flex-center">
      <Pill size={PillSize.regular} variant={s.color ? PillVariant.colored : PillVariant.standard} color={s.color}>{s.text}</Pill>
      <span className="secondary-text">#{pr.number}</span>
      <PersonHover login={pr.authorLogin} name={pr.authorName} avatarUrl={pr.avatarUrl}><VssPersona imageUrl={pr.avatarUrl} displayName={pr.authorName ?? pr.authorLogin} size="small" suppressPersonaCard showInitialsOnImageError /></PersonHover>
      <span className="gh-pr-meta-text">
        <span className="secondary-text">{pr.authorName ?? pr.authorLogin} proposes to merge </span>
        {branch(pr.headRef)}
        <ClipboardButton className="gh-pr-copy" getContent={() => pr.headRef} ariaLabel={`Copy branch name ${pr.headRef}`} showCopiedTooltip subtle />
        <span className="secondary-text"> into </span>
        {branch(pr.baseRef)}
        <span className="secondary-text"> {pr.commentsResolved} comments resolved</span>
      </span>
    </div>
  );
}

// ---------- Overview (PR-6) ----------

const CHECKS: Record<ChecksSummary, { icon: React.ReactNode; text: string }> = {
  SUCCESS: { icon: <Status {...Statuses.Success} size={StatusSize.s} ariaLabel="Success" />, text: "All checks have passed" },
  FAILURE: { icon: <Status {...Statuses.Failed} size={StatusSize.s} ariaLabel="Failed" />, text: "Some checks have failed" },
  PENDING: { icon: <Status {...Statuses.Running} size={StatusSize.s} ariaLabel="Running" />, text: "Checks are still running" },
  NONE: { icon: <Icon iconName="Info" className="secondary-text" />, text: "No checks reported" },
};
const MERGE: Record<Mergeable, { status: typeof Statuses.Success; text: string }> = {
  MERGEABLE: { status: Statuses.Success, text: "No merge conflicts" },
  CONFLICTING: { status: Statuses.Failed, text: "This branch has merge conflicts" },
  UNKNOWN: { status: Statuses.Warning, text: "Merge status unknown" },
};

function MergeCard({ pr }: { pr: PrPageData }) {
  // Mergeability only means something while the PR is open; GitHub reports UNKNOWN once it is merged or closed.
  const m =
    pr.status === "completed" ? { status: Statuses.Success, text: `Merged into ${pr.baseRef}` }
    : pr.status === "abandoned" ? { status: Statuses.Canceled, text: "Closed without merging" }
    : MERGE[pr.mergeable];
  const c = CHECKS[pr.checks];
  return (
    <Card className="gh-pr-card gh-pr-merge bolt-card-no-vertical-padding">
      <div className="flex-row flex-center gh-pr-merge-row">
        <Status {...m.status} size={StatusSize.l} ariaLabel={m.text} />
        <div className="flex-column">
          <span className="body-m">{m.text}</span>
          <span className="secondary-text body-s flex-row flex-center gh-pr-checks">{c.icon}{c.text}</span>
        </div>
      </div>
    </Card>
  );
}

function Description({ pr, repo, edit, store }: { pr: PrPageData; repo: string; edit?: EditData; store: ActionStore }) {
  const [owner, name] = repo.split("/");
  const [editing, setEditing] = React.useState(false);
  const canEdit = !!edit?.perms.body;
  const items = canEdit && !editing ? [{ id: "edit", important: true, iconProps: { iconName: "Edit" }, tooltipProps: { text: "Edit description" }, ariaLabel: "Edit description", disabled: store.busy, onActivate: () => (store.dismissEditError(), setEditing(true)) }] : undefined;
  // GitHub's bodyHTML goes through the same sanitiser as the README; repo-relative images are fetched with the token by Markdown.
  const prepared = React.useMemo(() => (pr.bodyHtml.trim() ? prepareMarkdownHtml(pr.bodyHtml, { owner, name, ref: pr.baseRef, dir: "" }) : null), [pr.bodyHtml, owner, name, pr.baseRef]);
  const go = React.useCallback((s: BrowseState) => void openRepoHub(s), []);
  const feed = useFeed(repo, pr.number);
  return (
    <Card className="gh-pr-card gh-pr-desc" headerClassName="gh-pr-desc-header" contentProps={{ className: "gh-pr-desc-content", contentPadding: false }} titleProps={{ text: "Description", size: TitleSize.Medium, ariaLevel: 2 }} headerCommandBarItems={items}>
      {editing && edit ? <DescriptionEditor body={edit.node.body ?? ""} edit={edit} store={store} onDone={() => setEditing(false)} />
        : prepared ? <Markdown prepared={prepared} repo={repo} refName={pr.baseRef} go={go} /> : <span className="secondary-text">No description</span>}
      {!editing && feed.prId && <div className="gh-pr-desc-reactions"><ReactionBar store={feed} id={feed.prId} /></div>}
    </Card>
  );
}

/** A right-column section: native draws these straight on the page background (no card), title 17px/400 (Header, TitleSize.Medium). */
export function Section({ title, children, commandBarItems }: { title: string; children: React.ReactNode; commandBarItems?: any[] }) {
  return (
    <section className="gh-pr-section">
      <Header title={title} titleSize={TitleSize.Medium} titleAriaLevel={2} commandBarItems={commandBarItems} />
      {children}
    </section>
  );
}
export const Well = ({ children }: { children: React.ReactNode }) => <div className="gh-pr-well">{children}</div>;

const REVIEW: Record<ReviewState, { text: string; icon: React.ReactNode }> = {
  APPROVED: { text: "Approved", icon: <Status {...Statuses.Success} size={StatusSize.m} ariaLabel="Approved" /> },
  CHANGES_REQUESTED: { text: "Changes requested", icon: <Status {...Statuses.Warning} size={StatusSize.m} ariaLabel="Changes requested" /> },
  COMMENTED: { text: "Commented", icon: <Icon iconName="Comment" ariaLabel="Commented" /> },
  PENDING: { text: "Waiting", icon: <Icon iconName="Clock" ariaLabel="Waiting for review" /> },
};

/**
 * Required / Optional (lib/codeOwners.ts): the target branch's code owner requirement (classic protection from the actions query, rulesets over
 * REST), then the CODEOWNERS file matched against the changed files. { kind: "single" } until all of it is known, and whenever any of it can't be.
 */
function useReviewerGroups(repo: string, number: number, baseRef: string, store: ActionStore, edit: EditData | undefined, list: PrReviewer[]): ReviewerGroups {
  const [rules, setRules] = React.useState<{ key: string; v: BranchRule[] | null }>();
  const [owners, setOwners] = React.useState<{ key: string; v: CodeOwnerSet | null | undefined }>();
  const key = `${repo}|${baseRef}|${number}`;
  React.useEffect(() => {
    let dead = false;
    getBranchRules(repo, baseRef).then((v) => !dead && setRules({ key, v }), () => !dead && setRules({ key, v: null }));
    return () => { dead = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const pr = store.status === "ready" ? store.view?.pr : undefined;
  const classic = pr === undefined || pr.baseRef === undefined ? undefined : pr.baseRef?.branchProtectionRule ?? null;
  const requirement = codeOwnerRequirement(classic, rules?.key === key ? rules.v : undefined);
  React.useEffect(() => {
    if (requirement !== true) return;
    let dead = false;
    getCodeOwnerSet(repo, baseRef, number).then((v) => !dead && setOwners({ key, v }), () => !dead && setOwners({ key, v: undefined }));
    return () => { dead = true; };
  }, [requirement, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return React.useMemo(() => {
    if (requirement === true && !edit) return { kind: "single" }; // the review requests (asCodeOwner, team slugs) aren't in yet
    const people = list.map((r) => {
      const q = edit?.reviewers.find((x) => sameReviewer(x, r.login));
      return { login: r.login, request: q && { kind: q.kind, login: q.login, codeOwner: q.codeOwner } };
    });
    return reviewerGroups(people, requirement, owners?.key === key ? owners.v : undefined, repo.split("/")[0]);
  }, [requirement, edit, list, owners, key, repo]);
}

function Reviewers({ list, store, edit, repo, number, baseRef }: { list: PrReviewer[]; store: ActionStore; edit?: EditData; repo: string; number: number; baseRef: string }) {
  const [adding, setAdding] = React.useState(false);
  const groups = useReviewerGroups(repo, number, baseRef, store, edit, list);
  const canEdit = !!edit?.perms.reviewers;
  // CI-7: GitHub has no field that says whether Copilot code review is on, so it is offered and GitHub's own reason is shown if refused.
  const copilot = store.view?.copilot;
  const items = [
    ...(canEdit ? addItem(() => (store.dismissEditError(), setAdding(true)), store.busy, "Add", true) : []),
    ...(copilot?.offered ? [{ id: "copilot", important: false, text: "Request Copilot review", iconProps: { iconName: "Contact" }, disabled: store.busy, onActivate: () => void store.requestCopilotReview() }] : []),
  ];
  const row = (r: PrReviewer) => {
    const requested = edit?.reviewers.find((q) => sameReviewer(q, r.login));
    return (
      <li key={r.login} className="gh-pr-row flex-row flex-center">
        <PersonHover className="gh-pr-grow" login={r.login} avatarUrl={r.avatarUrl}>
          <VssPersona imageUrl={r.avatarUrl} displayName={reviewerName(r.login)} size="small" suppressPersonaCard showInitialsOnImageError />
          <span className="gh-pr-grow text-ellipsis">{reviewerName(r.login)}</span>
        </PersonHover>
        {requested?.badge && <Pill size={PillSize.compact} variant={PillVariant.outlined}>{requested.badge}</Pill>}
        <span className="secondary-text body-s">{REVIEW[r.state].text}</span>
        {REVIEW[r.state].icon}
        {canEdit && (requested ? <RemoveButton label={`Remove reviewer ${reviewerName(r.login)}`} disabled={store.busy} onClick={() => void store.removeReviewer(requested)} /> : <span className="gh-pr-remove-spacer" aria-hidden="true" />)}
      </li>
    );
  };
  // Native's sub-headings: "Required" and "Optional" (or "Requested" when the split isn't known). An empty group is left out.
  const group = (label: string, people: PrReviewer[], title?: string) =>
    people.length ? (
      <React.Fragment key={label}>
        <div className="gh-pr-sublabel body-s secondary-text font-weight-semibold" title={title}>{label}</div>
        <ul className="gh-pr-list" aria-label={`${label} reviewers`}>{people.map(row)}</ul>
      </React.Fragment>
    ) : null;
  return (
    <Section title="Reviewers" commandBarItems={items.length ? items : undefined}>
      <EditError store={store} field="reviewers" />
      {adding && edit && (
        <PeopleAdd repo={repo} kind="reviewers" authorLogin={edit.node.author?.login} current={edit.reviewers.map((r) => ({ kind: r.kind === "team" ? "team" : "user", login: r.kind === "team" ? r.name : r.login }))} onClose={() => setAdding(false)} onPick={(c) => (setAdding(false), void store.addReviewers(edit.node.id, [c]))} />
      )}
      {store.copilotMessage && <MessageCard className="gh-pr-copilot-msg" severity={MessageCardSeverity.Warning} onDismiss={() => store.dismissCopilot()}>{store.copilotMessage}</MessageCard>}
      {list.length ? (
        groups.kind === "single" ? group("Requested", list) : (
          <>
            {group("Required", list.filter((r) => groups.required.includes(r.login)), "Code owners of the changed files: the target branch requires one of them to approve.")}
            {group("Optional", list.filter((r) => groups.optional.includes(r.login)))}
          </>
        )
      ) : (
        <Well>No reviewers</Well>
      )}
    </Section>
  );
}

function Labels({ pr, store, edit, repo }: { pr: PrPageData; store: ActionStore; edit?: EditData; repo: string }) {
  const [adding, setAdding] = React.useState(false);
  const canEdit = !!edit?.perms.labels;
  // The edit node knows the label ids; until it loads (or if it fails) the page's own labels show read-only.
  const labels = edit ? edit.node.labels.nodes.map(toLabelOption) : pr.labels.map((l) => toLabelOption({ id: l.name, name: l.name, color: l.color }));
  return (
    <Section title="Tags" commandBarItems={canEdit ? addItem(() => (store.dismissEditError(), setAdding(true)), store.busy, "Add tag") : undefined}>
      <EditError store={store} field="labels" />
      {adding && edit && <LabelsAdd repo={repo} applied={labels.map((l) => l.id)} onClose={() => setAdding(false)} onPick={(l) => (setAdding(false), void store.addLabel(edit.node.id, l.id))} />}
      {labels.length ? (
        <div className="flex-row flex-wrap gh-pr-labels">
          {labels.map((l) => <LabelPill key={l.id} l={l} disabled={store.busy} onRemove={canEdit ? () => void store.removeLabel(edit!.node.id, l.id) : undefined} />)}
        </div>
      ) : (
        <Well>No tags</Well>
      )}
    </Section>
  );
}

// ---------- work items (PR-7) ----------

type Wi = { t: "loading" } | { t: "denied" } | { t: "error" } | { t: "ready"; r: WorkItemsResult };

export function useWorkItems(ids: number[], version = 0): Wi {
  const [wi, setWi] = React.useState<Wi>({ t: "loading" });
  const key = ids.join(",");
  React.useEffect(() => {
    if (!ids.length) return;
    let dead = false;
    setWi({ t: "loading" });
    fetchWorkItems(ids).then(
      (r) => !dead && setWi({ t: "ready", r }),
      (e) => !dead && setWi({ t: e instanceof PermissionError ? "denied" : "error" })
    );
    return () => { dead = true; };
  }, [key, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return wi;
}

function TypeIcon({ type, r }: { type?: string; r: WorkItemsResult }) {
  const t = (type && r.types[type]) || {};
  const [bad, setBad] = React.useState(false);
  const color = t.color ? `#${t.color}` : "rgba(var(--palette-neutral-30, 136, 136, 136), 1)";
  return t.iconUrl && !bad
    ? <img className="gh-pr-wi-icon" src={t.iconUrl} alt="" width={16} height={16} onError={() => setBad(true)} />
    : <span className="gh-pr-wi-icon gh-pr-wi-dot" style={{ background: color }} aria-hidden="true" />;
}

export function WorkItemRow({ w, r, remove }: { w: WorkItemRef; r: WorkItemsResult; remove?: { removable: boolean; pinned: boolean; busy: boolean; onRemove: () => void } }) {
  const x = remove && <RemoveButton label={`Remove work item ${w.id}`} disabled={!remove.removable || remove.busy} reason={remove.removable ? undefined : remove.pinned ? "Also mentioned in the title or a commit message, so it stays linked. Edit those to unlink it." : "Not mentioned in the description, so it can't be removed here."} onClick={remove.onRemove} />;
  if (!w.found) return <li className="gh-pr-row flex-row flex-center"><span className="secondary-text gh-pr-grow">AB#{w.id}: not found or no access</span>{x}</li>;
  return (
    <li className="gh-pr-row flex-row gh-pr-wi-row">
      <div className="flex-column gh-pr-wi gh-pr-grow">
      <span className="flex-row flex-center">
        <TypeIcon type={w.type} r={r} />
        <span className="secondary-text body-s">{w.type} #{w.id}</span>
      </span>
      <Link className="gh-pr-wi-title" href={r.url(w.id)} target="_blank" rel="noopener noreferrer">{w.title ?? `#${w.id}`}</Link>
      {w.state && <span className="secondary-text body-s">{w.state}</span>}
      </div>
      {x}
    </li>
  );
}

/** `version` is the action store's: completing the work items refetches them. */
function WorkItems({ ids, pinned, version, store, edit }: { ids: number[]; pinned: number[]; version: number; store: ActionStore; edit?: EditData }) {
  const wi = useWorkItems(ids, version);
  const [adding, setAdding] = React.useState(false);
  const canEdit = !!edit?.perms.workItems;
  let body: React.ReactNode;
  if (!ids.length) body = <Well>No work items</Well>;
  else if (wi.t === "loading") body = <Spinner size={SpinnerSize.small} ariaLabel="Loading work items" />;
  else if (wi.t === "denied") body = <span className="secondary-text">Work items need the extension's work item permission.</span>;
  else if (wi.t === "error") body = <span className="secondary-text">Work items could not be loaded.</span>;
  else body = <ul className="gh-pr-list">{wi.r.items.map((w) => <WorkItemRow key={w.id} w={w} r={wi.r} remove={canEdit ? { removable: workItemInBody(edit!.node, w.id) && !pinned.includes(w.id), pinned: pinned.includes(w.id), busy: store.busy, onRemove: () => void store.removeWorkItem(edit!.node.id, w.id) } : undefined} />)}</ul>;
  return (
    <Section title="Work items" commandBarItems={canEdit ? addItem(() => (store.dismissEditError(), setAdding(true)), store.busy, "Add work item") : undefined}>
      <EditError store={store} field="workItems" />
      {adding && edit && <WorkItemsAdd linked={ids} onClose={() => setAdding(false)} onPick={(w) => (setAdding(false), void store.addWorkItem(edit.node.id, w.id))} />}
      {body}
    </Section>
  );
}

// ---------- GitHub-only sections (ED-5 to ED-8): hidden when empty and read-only ----------

function Assignees({ store, edit, repo }: { store: ActionStore; edit: EditData; repo: string }) {
  const [adding, setAdding] = React.useState(false);
  const canEdit = edit.perms.assignees;
  const list = edit.node.assignees.nodes;
  if (!list.length && !canEdit) return null;
  return (
    <Section title="Assignees" commandBarItems={canEdit ? addItem(() => (store.dismissEditError(), setAdding(true)), store.busy, "Add assignee") : undefined}>
      <EditError store={store} field="assignees" />
      {adding && <PeopleAdd repo={repo} kind="assignees" current={list.map((a) => ({ kind: "user" as const, login: a.login }))} onClose={() => setAdding(false)} onPick={(c) => (setAdding(false), void store.addAssignee(edit.node.id, c))} />}
      {list.length ? (
        <ul className="gh-pr-list">
          {list.map((a) => (
            <li key={a.id} className="gh-pr-row flex-row flex-center">
              <PersonHover className="gh-pr-grow" login={a.login} name={a.name || undefined} avatarUrl={a.avatarUrl}>
                <VssPersona imageUrl={a.avatarUrl} displayName={a.name || a.login} size="small" suppressPersonaCard showInitialsOnImageError />
                <span className="gh-pr-grow text-ellipsis">{a.name || a.login}</span>
              </PersonHover>
              {canEdit && <RemoveButton label={`Remove assignee ${a.name || a.login}`} disabled={store.busy} onClick={() => void store.removeAssignee(edit.node.id, a.id)} />}
            </li>
          ))}
        </ul>
      ) : <Well>No assignees</Well>}
    </Section>
  );
}

function Milestone({ store, edit, repo }: { store: ActionStore; edit: EditData; repo: string }) {
  const [adding, setAdding] = React.useState(false);
  const canEdit = edit.perms.milestone;
  const m = edit.node.milestone;
  if (!m && !canEdit) return null;
  return (
    <Section title="Milestone" commandBarItems={canEdit ? addItem(() => (store.dismissEditError(), setAdding(true)), store.busy, m ? "Change milestone" : "Add milestone", false, m ? "Edit" : "Add") : undefined}>
      <EditError store={store} field="milestone" />
      {adding && <MilestoneAdd repo={repo} onClose={() => setAdding(false)} onPick={(o) => (setAdding(false), void store.setMilestone(edit.node.id, o.id))} />}
      {m ? (
        <div className="gh-pr-row flex-row flex-center">
          <Icon iconName="Flag" className="secondary-text" ariaHidden />
          <span className="gh-pr-grow flex-column">
            <span className="text-ellipsis">{m.title}</span>
            <span className="secondary-text body-s">{dueText(m.dueOn ? new Date(m.dueOn) : null)}</span>
          </span>
          {canEdit && <RemoveButton label={`Clear milestone ${m.title}`} disabled={store.busy} onClick={() => void store.setMilestone(edit.node.id, null)} />}
        </div>
      ) : <Well>No milestone</Well>}
    </Section>
  );
}

function Projects({ store, edit, repo }: { store: ActionStore; edit: EditData; repo: string }) {
  const [adding, setAdding] = React.useState(false);
  const canEdit = edit.perms.projects;
  const rows = edit.projects;
  if (!rows || (!rows.length && !canEdit)) return null; // null: GitHub refuses Projects for this sign-in
  return (
    <Section title="Projects" commandBarItems={canEdit ? addItem(() => (store.dismissEditError(), setAdding(true)), store.busy, "Add to a project") : undefined}>
      <EditError store={store} field="projects" />
      {adding && <ProjectsAdd repo={repo} attached={rows.map((r) => r.projectId)} onClose={() => setAdding(false)} onPick={(p) => (setAdding(false), void store.addProject(edit.node.id, p.id))} />}
      {rows.length ? (
        <ul className="gh-pr-list">
          {rows.map((r) => (
            <li key={r.itemId} className="gh-pr-row flex-row flex-center">
              <Icon iconName="ProjectCollection" className="secondary-text" ariaHidden />
              <span className="gh-pr-grow flex-column">
                <Link className="text-ellipsis" href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</Link>
                {r.status && <span className="secondary-text body-s">Status: {r.status}</span>}
              </span>
              {canEdit && <RemoveButton label={`Remove from project ${r.title}`} disabled={store.busy} onClick={() => void store.removeProject(r.projectId, r.itemId)} />}
            </li>
          ))}
        </ul>
      ) : <Well>No projects</Well>}
    </Section>
  );
}

function LinkedIssues({ store, edit }: { store: ActionStore; edit: EditData }) {
  const [adding, setAdding] = React.useState(false);
  const canEdit = edit.perms.closingIssues;
  if (!edit.linked.length && !canEdit) return null;
  return (
    <Section title="Linked issues" commandBarItems={canEdit ? addItem(() => (store.dismissEditError(), setAdding(true)), store.busy, "Add closing issue") : undefined}>
      <EditError store={store} field="closingIssues" />
      {adding && <ClosingIssueAdd busy={store.busy} onClose={() => setAdding(false)} onAdd={(n) => (setAdding(false), void store.addClosingIssue(edit.node.id, n))} />}
      {edit.linked.length ? (
        <ul className="gh-pr-list">{edit.linked.map((i) => <IssueRow key={i.number} i={i} canRemove={canEdit} onRemove={() => void store.removeClosingIssue(edit.node.id, i.number)} />)}</ul>
      ) : <Well>No linked issues</Well>}
    </Section>
  );
}

// ---------- deployments (CI-5) ----------

const TONE_STATUS: Record<DeploymentTone, typeof Statuses.Success> = { success: Statuses.Success, failure: Statuses.Failed, pending: Statuses.Running, neutral: Statuses.Skipped };
const TONE_LABEL: Record<DeploymentTone, string> = { success: "Succeeded", failure: "Failed", pending: "In progress", neutral: "Inactive" };

function hostOf(url: string) {
  try { return new URL(url).host; } catch { return url; }
}

/** The newest deployment per environment for this pull request. Hidden when GitHub reports none (or the Deployments permission is missing). */
function Deployments({ repo, number, version }: { repo: string; number: number; version: number }) {
  const [rows, setRows] = React.useState<DeploymentRow[]>([]);
  React.useEffect(() => {
    let dead = false;
    getDeployments(repo, number).then((n) => !dead && setRows(latestDeployments(n)), () => !dead && setRows([]));
    return () => { dead = true; };
  }, [repo, number, version]);
  if (!rows.length) return null;
  return (
    <Section title="Deployments">
      <ul className="gh-pr-list gh-deployments" aria-label="Deployments">
        {rows.map((r) => (
          <li key={r.environment} className="gh-deployment flex-row flex-center">
            <Status {...TONE_STATUS[r.tone]} size={StatusSize.m} ariaLabel={TONE_LABEL[r.tone]} />
            <div className="flex-column gh-pr-grow">
              <span className="body-m font-weight-semibold text-ellipsis">{r.environment}</span>
              {r.url && /^https?:\/\//i.test(r.url) && <Link className="body-s text-ellipsis" href={r.url} target="_blank" rel="noopener noreferrer" ariaLabel={`Open ${r.environment} deployment: ${r.url}`}>{hostOf(r.url)}</Link>}
            </div>
            <span className="secondary-text body-s"><RelDate date={r.updatedAt} /></span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Overview({ pr, repo, prTab, openFile, signIn, busy, actions, edit }: { pr: PrPageData; repo: string; prTab: BrowseState["prTab"]; openFile: (path: string) => void; signIn: () => void; busy: boolean; actions: ActionStore; edit?: EditData }) {
  return (
    <div className="gh-pr-overview">
      <div className="gh-pr-main">
        {PoliciesCard({ store: actions }) ?? <MergeCard pr={pr} />}
        <Description pr={pr} repo={repo} edit={edit} store={actions} />
        <ActivityFeed repo={repo} number={pr.number} baseRef={pr.baseRef} prTab={prTab} openFile={openFile} signIn={signIn} busy={busy} />
      </div>
      <div className="gh-pr-aside">
        <Deployments repo={repo} number={pr.number} version={actions.version} />
        <Reviewers list={pr.reviewers} store={actions} edit={edit} repo={repo} number={pr.number} baseRef={pr.baseRef} />
        <Labels pr={pr} store={actions} edit={edit} repo={repo} />
        <WorkItems ids={pr.workItemIds} pinned={pr.workItemIdsOutsideBody} version={actions.version} store={actions} edit={edit} />
        {edit && <Assignees store={actions} edit={edit} repo={repo} />}
        {edit && <Milestone store={actions} edit={edit} repo={repo} />}
        {edit && <Projects store={actions} edit={edit} repo={repo} />}
        {edit && <LinkedIssues store={actions} edit={edit} />}
      </div>
    </div>
  );
}

// ---------- Commits (PR-9) ----------

interface CommitRow { sha: string; shortSha: string; title: string; author: string; avatar: string; date: Date; signature?: CommitSignature | null }

function commitColumns(repo: string): ITableColumn<CommitRow>[] {
  return [
    {
      id: "commit",
      width: -100,
      renderCell: (_r, columnIndex, tableColumn, c) => (
        <TwoLineTableCell
          key="commit"
          columnIndex={columnIndex}
          tableColumn={tableColumn}
          line1={<span className="gh-pr-commit-title commit-title font-weight-semibold text-ellipsis">{c.title}</span>}
          line2={
            <span className="gh-pr-commit-meta flex-row flex-center secondary-text">
              <Link className="monospaced-xs secondary-text" href={commitUrl(repo, c.sha)} target="_blank" rel="noopener noreferrer" subtle ariaLabel={`Commit ${c.shortSha} on GitHub`}>{c.shortSha}</Link>
              <VssPersona imageUrl={c.avatar} displayName={c.author} size="extra-small" suppressPersonaCard showInitialsOnImageError />
              <span>{c.author}</span>
              <RelDate date={c.date} />
              <SignaturePill signature={c.signature} />
            </span>
          }
        />
      ),
    },
  ];
}

function Commits({ pr, repo }: { pr: PrPageData; repo: string }) {
  const cols = React.useMemo(() => commitColumns(repo), [repo]);
  // CI-6: signatures arrive in a second request, so the rows render at once and the badges follow.
  const [sigs, setSigs] = React.useState<Map<string, CommitSignature | null>>(() => new Map());
  React.useEffect(() => {
    let dead = false;
    getCommitSignatures(repo, pr.number).then((m) => !dead && setSigs(m), () => {});
    return () => { dead = true; };
  }, [repo, pr.number]);
  const provider = React.useMemo(() => new ArrayItemProvider<CommitRow>(pr.commits.map((c, i) => ({ ...c, avatar: pr.commitAvatars[i] ?? "", signature: sigs.get(c.sha) }))), [pr, sigs]);
  return (
    <Card className="gh-pr-card bolt-table-card" contentProps={{ contentPadding: false }}>
      <Table<CommitRow> ariaLabel="Commits" role="table" columns={cols} itemProvider={provider} showHeader={false} spacerWidth={8} />
    </Card>
  );
}

// ---------- the page ----------

type Load = { t: "loading" } | { t: "error"; err: unknown } | { t: "ready"; pr: PrPageData };

export interface PrPageProps {
  repo: string;
  state: BrowseState & { pr: number };
  /** The list tab to return to. */
  listTab: NonNullable<BrowseState["prTab"]>;
  go: (s: BrowseState, replace?: boolean | "ifEmpty") => void;
  signedIn: boolean;
  signIn: () => void;
  busy: boolean;
  /** The first item is Open on GitHub, then the ⋯ menu's other items. PrActions turns them all into ⋯ entries. */
  commandBarItems: (url: string) => any[];
}

export function PrPage({ repo, state, listTab, go, signedIn, signIn, busy, commandBarItems }: PrPageProps) {
  const n = state.pr;
  const [load, setLoad] = React.useState<Load>({ t: "loading" });
  const [reload, setReload] = React.useState(0);
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => watchTheme(setDark), []);
  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "loading" });
    getPr(repo, n).then((pr) => !dead && setLoad({ t: "ready", pr }), (err) => !dead && setLoad({ t: "error", err }));
    return () => { dead = true; };
  }, [repo, n, signedIn, reload]);

  // A reply, resolve or comment invalidated the cached page: refetch it quietly so "x/y comments resolved" follows.
  React.useEffect(() => {
    const offs = [feedStore(repo, n), actionStore(repo, n)].map((store) => {
      let seen = store.version;
      return store.subscribe(() => {
        if (store.version === seen) return;
        seen = store.version;
        getPr(repo, n).then((fresh) => setLoad((l) => (l.t === "ready" ? { t: "ready", pr: fresh } : l)), () => {});
      });
    });
    return () => offs.forEach((off) => off());
  }, [repo, n]);

  // VW-9: opening a pull request notes the time, so the list can mark it again once it changes.
  React.useEffect(() => { if (load.t === "ready") void recordPrViewed(viewedKey(repo, n)); }, [repo, n, load.t === "ready"]); // eslint-disable-line react-hooks/exhaustive-deps
  const actions = useActions(repo, n);
  const edit = useEdit(repo, n, actions.version);
  const [ui, setUi] = React.useState<Ui>({});
  const page: PrPageId = state.prPage ?? "overview";
  const list: BrowseState = { repo, view: "prs", prTab: listTab };
  const pr = load.t === "ready" ? load.pr : undefined;
  const url = pr?.url ?? `https://github.com/${repo}/pull/${n}`;
  const [openItem, ...restItems] = commandBarItems(url);
  const nav = (p: Partial<BrowseState>, replace?: boolean) => go({ repo, view: "prs", prTab: state.prTab ?? listTab, pr: n, prPage: page, ...p }, replace);

  return (
    <HoverRepoContext.Provider value={repo}>
      <Header
        className="gh-pr-header"
        title={pr ? <EditableTitle title={pr.title} canEdit={!!edit?.perms.title} store={actions} edit={edit} /> : `Pull request #${n}`}
        titleSize={TitleSize.Large /* 21px; see Browser.tsx. Weight is set to native's 400 in browser.css */}
        titleAriaLevel={1}
        commandBarItems={prCommandItems(actions, url, openItem, restItems, setUi)}
        backButtonProps={{ iconProps: { iconName: "Back" }, ariaLabel: "Back to pull requests", tooltipProps: { text: "Back to pull requests" }, onClick: () => go(list) }}
      />
      <div className="gh-pr-sub">
        {pr ? <Meta pr={pr} repo={repo} status={actions.optimisticStatus} /> : <div className="gh-pr-meta" />}
      </div>
      {(actions.error || actions.notice) && (
        <div className="gh-pr-actionmsg">
          {actions.error && <MessageCard severity={MessageCardSeverity.Error} onDismiss={() => actions.dismiss()}>{actions.error}</MessageCard>}
          {actions.notice && <MessageCard severity={MessageCardSeverity.Warning} onDismiss={() => actions.dismiss()}>{actions.notice}</MessageCard>}
        </div>
      )}
      <PrActionDialogs store={actions} repo={repo} number={n} workItemIds={pr?.workItemIds ?? []} ui={ui} setUi={setUi} prTitle={pr?.title ?? ""} openPr={(m) => go({ repo, view: "prs", prTab: state.prTab ?? listTab, pr: m })} />
      <TabBar ariaLabel="Pull request" selectedTabId={page} onSelectedTabChanged={(id) => nav({ prPage: id as PrPageId, file: undefined })} tabSize={TabSize.Tall} disableSticky>
        {PAGES.map((p) => <Tab key={p.id} id={p.id} name={p.name} />)}
      </TabBar>
      {load.t === "loading" && <div className="page-content page-content-top gh-pr-loading flex-row justify-center"><Spinner size={SpinnerSize.large} ariaLabel="Loading pull request" /></div>}
      {load.t === "error" && (
        <div className="page-content page-content-top">
          <ErrorView err={load.err} signIn={signIn} busy={busy} retry={() => { invalidatePr(); setReload((r) => r + 1); }} subject="see this pull request" permission="Pull requests" />
        </div>
      )}
      {pr && page === "overview" && <div className="page-content page-content-top"><Overview pr={pr} repo={repo} prTab={state.prTab ?? listTab} openFile={(file) => nav({ prPage: "files", file })} signIn={signIn} busy={busy} actions={actions} edit={edit} /></div>}
      {pr && page === "commits" && <div className="page-content page-content-top"><Commits pr={pr} repo={repo} /></div>}
      {pr && page === "updates" && <PrUpdatesTab repo={repo} number={n} pr={pr} dark={dark} signedIn={signedIn} signIn={signIn} busy={busy} />}
      {pr && page === "files" && <PrFilesTab repo={repo} number={n} pr={pr} selected={state.file} select={(file) => nav({ prPage: "files", file }, true)} dark={dark} signedIn={signedIn} signIn={signIn} busy={busy} />}
    </HoverRepoContext.Provider>
  );
}

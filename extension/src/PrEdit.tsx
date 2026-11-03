// Editing a pull request (batch 2, ED-1 to ED-9): the data hook, the title and description editors and the right-column pickers.
// The logic lives in lib/prEdit.ts and friends; the writes in actionStore.ts. This file only draws and wires them.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Icon } from "azure-devops-ui/Icon";
import { IdentityPickerDropdown, IdentityType, type IIdentity, type IPeoplePickerProvider } from "azure-devops-ui/IdentityPicker";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { TagPicker } from "azure-devops-ui/TagPicker";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { parseColor } from "azure-devops-ui/Utilities/Color";
import type { ActionStore } from "./actionStore";
import { getEdit, getProjectRows, searchAssignees, searchLabels, searchMilestones, searchProjects, searchReviewers } from "./githubBrowse";
import { availableLabels, type LabelOption } from "./lib/labels";
import { editPermissions, planTitleBodyUpdate, toLinkedIssueRows, type EditField, type LinkedIssueRow, type PrEditNode } from "./lib/prEdit";
import type { ProjectRow } from "./lib/projects";
import { rankCandidates, toRequestedReviewers, type Candidate, type RequestedReviewer } from "./lib/reviewerSearch";
import type { MilestoneOption } from "./lib/milestones";
import { findWorkItemIds, type WorkItemRef } from "./lib/workItems";
import { searchWorkItems } from "./workItemsApi";

// ---------- data ----------

export interface EditData {
  node: PrEditNode;
  perms: Record<EditField, boolean>;
  reviewers: RequestedReviewer[];
  linked: LinkedIssueRow[];
  /** null when GitHub refuses Projects (the app lacks the permission): the section is hidden. */
  projects: ProjectRow[] | null;
}

/** The edit node and Projects of a pull request, refetched when the action store's `version` moves. Undefined until loaded, and when GitHub refuses it (the page then stays read-only). */
export function useEdit(repo: string, number: number, version: number): EditData | undefined {
  const [d, setD] = React.useState<{ key: string; data: EditData }>();
  const key = `${repo}#${number}`;
  React.useEffect(() => {
    let dead = false;
    Promise.all([getEdit(repo, number), getProjectRows(repo, number)]).then(
      ([node, projects]) => {
        if (dead) return;
        const perms = editPermissions({ state: node.state, viewerCanUpdate: node.viewerCanUpdate, viewerCanLabel: node.viewerCanLabel, viewerCanAssign: node.viewerCanAssign });
        setD({ key, data: { node, perms, reviewers: toRequestedReviewers(node.reviewRequests.nodes), linked: toLinkedIssueRows(node.closingIssuesReferences.nodes, node.body), projects } });
      },
      () => !dead && setD(undefined)
    );
    return () => { dead = true; };
  }, [repo, number, version, key]);
  return d?.key === key ? d.data : undefined;
}

// ---------- shared pieces ----------

/** The failed edit's message, in the panel it belongs to. */
export function EditError({ store, field }: { store: ActionStore; field: EditField }) {
  return store.editError?.field === field ? <MessageCard className="gh-pr-edit-error" severity={MessageCardSeverity.Error} onDismiss={() => store.dismissEditError()}>{store.editError.text}</MessageCard> : null;
}

/** The panel header's Add action. */
export const addItem = (onActivate: () => void, disabled: boolean, text = "Add") => [{ id: "add", important: true, text, iconProps: { iconName: "Add" }, disabled, onActivate }];

/** A remove button that shows on row hover or keyboard focus (see browser.css). */
export function RemoveButton({ label, onClick, disabled, reason }: { label: string; onClick: () => void; disabled?: boolean; reason?: string }) {
  return (
    <Button
      className="gh-pr-remove"
      subtle
      iconProps={{ iconName: "Cancel" }}
      ariaLabel={label}
      tooltipProps={{ text: reason ?? label }}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

/**
 * A search box with a list of suggestions (azure-devops-ui TagPicker used as a picker: nothing is kept selected here, picking an item writes it and closes the box).
 * Esc closes it. `search` runs on every change and an empty box lists the defaults.
 */
export function AddSearch<T>({ search, itemKey, render, onPick, onClose, placeholder, ariaLabel, noResults }: {
  search: (q: string) => Promise<T[]>;
  itemKey: (t: T) => string;
  render: (t: T) => React.ReactNode;
  onPick: (t: T) => void;
  onClose: () => void;
  placeholder: string;
  ariaLabel: string;
  noResults: string;
}) {
  const [items, setItems] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(false);
  const seq = React.useRef(0);
  const run = React.useCallback((q: string) => {
    const mine = ++seq.current;
    setLoading(true);
    search(q).then(
      (r) => mine === seq.current && (setItems(r), setLoading(false)),
      () => mine === seq.current && (setItems([]), setLoading(false))
    );
  }, [search]);
  return (
    <div className="gh-pr-add flex-row flex-center" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <TagPicker<T>
        className="gh-pr-add-picker flex-grow"
        ariaLabel={ariaLabel}
        placeholderText={placeholder}
        noResultsFoundText={noResults}
        areTagsEqual={(a, b) => itemKey(a) === itemKey(b)}
        convertItemToPill={(t) => ({ content: itemKey(t) })}
        selectedTags={[]}
        suggestions={items}
        suggestionsLoading={loading}
        onSearchChanged={run}
        onEmptyInputFocus={() => run("")}
        onTagAdded={onPick}
        onTagRemoved={() => {}}
        renderSuggestionItem={(p) => <div className="gh-pr-suggestion flex-row flex-center">{render(p.item)}</div>}
      />
      <Button subtle text="Cancel" onClick={onClose} />
    </div>
  );
}

// ---------- ED-1: title ----------

/** The header title: click it (or press Enter on it) to edit; Enter saves, Esc cancels, a refused value is shown under the field. */
export function EditableTitle({ title, canEdit, store, edit }: { title: string; canEdit: boolean; store: ActionStore; edit?: EditData }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(title);
  const [error, setError] = React.useState<string>();
  const start = () => (setDraft(title), setError(undefined), store.dismissEditError(), setEditing(true));
  if (!canEdit || !edit) return <>{title}</>;
  if (!editing)
    return (
      <span className="gh-pr-title-edit flex-row flex-center">
        <span role="button" tabIndex={0} className="gh-pr-title-text text-ellipsis" aria-label={`${title}. Edit title`} onClick={start} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), start())}>{title}</span>
        <Icon iconName="Edit" className="gh-pr-title-pencil secondary-text" ariaHidden />
      </span>
    );
  const save = () => {
    const plan = planTitleBodyUpdate(edit.node.id, { title, body: edit.node.body }, { title: draft });
    if (!plan.ok) return setError(plan.error);
    if (!plan.input) return setEditing(false);
    void store.saveTitleBody(plan.input).then((ok) => ok && setEditing(false));
  };
  const serverError = store.editError?.field === "title" ? store.editError.text : undefined;
  const shown = error ?? serverError;
  return (
    <span className="gh-pr-title-form flex-column">
      <TextField
        className="gh-pr-title-field"
        ariaLabel="Pull request title"
        ariaInvalid={!!shown}
        autoFocus
        autoSelect
        width={TextFieldWidth.auto}
        value={draft}
        disabled={store.busy}
        onChange={(_e, v) => (setDraft(v), setError(undefined))}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.preventDefault(), save());
          else if (e.key === "Escape") (e.preventDefault(), setEditing(false));
        }}
      />
      {shown && <span className="gh-pr-field-error body-s" role="alert">{shown}</span>}
    </span>
  );
}

// ---------- ED-1: description ----------

/** The description card's edit mode: a multiline markdown field with Save and Cancel. */
export function DescriptionEditor({ body, edit, store, onDone }: { body: string; edit: EditData; store: ActionStore; onDone: () => void }) {
  const [draft, setDraft] = React.useState(body.replace(/\r\n/g, "\n"));
  const [error, setError] = React.useState<string>();
  const save = () => {
    const plan = planTitleBodyUpdate(edit.node.id, { title: edit.node.title, body: edit.node.body }, { body: draft });
    if (!plan.ok) return setError(plan.error);
    if (!plan.input) return onDone();
    void store.saveTitleBody(plan.input).then((ok) => ok && onDone());
  };
  const shown = error ?? (store.editError?.field === "body" ? store.editError.text : undefined);
  return (
    <div className="gh-pr-desc-edit flex-column">
      <TextField
        ariaLabel="Description (markdown)"
        ariaInvalid={!!shown}
        autoFocus
        multiline
        rows={10}
        resizable
        width={TextFieldWidth.auto}
        value={draft}
        disabled={store.busy}
        onChange={(_e, v) => (setDraft(v), setError(undefined))}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
      />
      {shown && <span className="gh-pr-field-error body-s" role="alert">{shown}</span>}
      <div className="gh-pr-desc-actions flex-row">
        <Button primary text="Save" disabled={store.busy} onClick={save} />
        <Button text="Cancel" disabled={store.busy} onClick={onDone} />
      </div>
    </div>
  );
}

// ---------- ED-2, ED-5: people ----------

const ME_ID = (c: Candidate) => `${c.kind}:${c.id}`;
const toIdentity = (c: Candidate): IIdentity => ({
  entityId: ME_ID(c),
  entityType: c.kind === "team" ? IdentityType.Group : IdentityType.User,
  originDirectory: "github",
  originId: c.id,
  displayName: c.name || c.login,
  image: c.avatarUrl,
  signInAddress: c.kind === "team" ? `team ${c.login}` : c.login,
  mailNickname: c.login,
});

/** Add reviewers (users and teams) or assignees (users), through azure-devops-ui's identity picker backed by GitHub search (ranked and filtered by lib/reviewerSearch.ts). */
export function PeopleAdd({ repo, kind, current, authorLogin, onPick, onClose }: {
  repo: string;
  kind: "reviewers" | "assignees";
  current: { kind: "user" | "team"; login: string }[];
  authorLogin?: string;
  onPick: (c: Candidate) => void;
  onClose: () => void;
}) {
  // what the picker was offered, so onChange can hand back the real candidate for the identity it returns
  const known = React.useRef(new Map<string, Candidate>());
  const provider = React.useMemo<IPeoplePickerProvider>(() => {
    const search = async (q: string) => {
      const found = kind === "reviewers" ? await searchReviewers(repo, q) : await searchAssignees(repo, q);
      const ranked = rankCandidates(found, q, { authorLogin, current });
      ranked.forEach((c) => known.current.set(ME_ID(c), c));
      return ranked.map(toIdentity);
    };
    return {
      onFilterIdentities: (q) => search(q).catch(() => []),
      onEmptyInputFocus: () => search("").catch(() => []),
      onRequestConnectionInformation: () => ({}),
      getEntityFromUniqueAttribute: (id) => toIdentity(known.current.get(id)!),
    };
  }, [repo, kind, authorLogin, JSON.stringify(current)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="gh-pr-add flex-row flex-center" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <IdentityPickerDropdown
        className="flex-grow"
        ariaLabel={kind === "reviewers" ? "Add reviewer" : "Add assignee"}
        placeholder={kind === "reviewers" ? "Search users and teams" : "Search users"}
        noResultsFoundText="No matching people"
        autoFocus
        pickerProvider={provider}
        value={undefined}
        onChange={(i) => {
          const c = i && known.current.get(i.entityId);
          if (c) onPick(c);
        }}
      />
      <Button subtle text="Cancel" onClick={onClose} />
    </div>
  );
}

export function sameReviewer(r: RequestedReviewer, login: string) {
  return r.login === login || r.name === login;
}

// ---------- ED-3: labels ----------

export function LabelPill({ l, onRemove, disabled }: { l: LabelOption; onRemove?: () => void; disabled?: boolean }) {
  const color = parseColor(`#${l.color}`);
  return (
    <Pill className="gh-pr-pill gh-pr-label" size={PillSize.regular} variant={color ? PillVariant.colored : PillVariant.standard} color={color} contentClassName="gh-pr-label-content">
      <span style={{ color: l.textColor }} title={l.description || undefined}>{l.name}</span>
      {onRemove && (
        // hand-rolled: azure-devops-ui's Pill has no remove affordance, and its text colour is not ours to set
        <button type="button" className="gh-pr-pill-x" style={{ color: l.textColor }} aria-label={`Remove tag ${l.name}`} disabled={disabled} onClick={onRemove}>
          <Icon iconName="Cancel" ariaHidden />
        </button>
      )}
    </Pill>
  );
}

export function LabelsAdd({ repo, applied, onPick, onClose }: { repo: string; applied: string[]; onPick: (l: LabelOption) => void; onClose: () => void }) {
  const search = React.useCallback(async (q: string) => availableLabels(await searchLabels(repo, q), applied), [repo, applied.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AddSearch<LabelOption> search={search} itemKey={(l) => l.id} render={(l) => <LabelPill l={l} />} onPick={onPick} onClose={onClose} placeholder="Search tags" ariaLabel="Add tag" noResults="No matching tags" />
  );
}

// ---------- ED-4: work items ----------

export function WorkItemsAdd({ linked, onPick, onClose }: { linked: number[]; onPick: (w: WorkItemRef) => void; onClose: () => void }) {
  const search = React.useCallback(async (q: string) => (await searchWorkItems(q)).filter((w) => !linked.includes(w.id)), [linked.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AddSearch<WorkItemRef>
      search={search}
      itemKey={(w) => String(w.id)}
      render={(w) => <span className="text-ellipsis"><span className="secondary-text">{w.type} #{w.id}</span> {w.title}</span>}
      onPick={onPick}
      onClose={onClose}
      placeholder="Work item id or title"
      ariaLabel="Add work item"
      noResults="No matching work items"
    />
  );
}

/** Whether a work item can be removed here: only a mention in the description can be edited away. */
export const workItemInBody = (node: PrEditNode | undefined, id: number) => !!node && findWorkItemIds(node.body).includes(id);

// ---------- ED-6, ED-7: milestone and projects ----------

export const dueText = (d: Date | null) => (d ? `Due ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : "No due date");

export function MilestoneAdd({ repo, onPick, onClose }: { repo: string; onPick: (m: MilestoneOption) => void; onClose: () => void }) {
  const search = React.useCallback((q: string) => searchMilestones(repo, q), [repo]);
  return (
    <AddSearch<MilestoneOption>
      search={search}
      itemKey={(m) => m.id}
      render={(m) => <span className="text-ellipsis">{m.title} <span className="secondary-text">{dueText(m.dueOn)}</span></span>}
      onPick={onPick}
      onClose={onClose}
      placeholder="Search open milestones"
      ariaLabel="Set milestone"
      noResults="No matching milestones"
    />
  );
}

export function ProjectsAdd({ repo, attached, onPick, onClose }: { repo: string; attached: string[]; onPick: (p: { id: string; title: string }) => void; onClose: () => void }) {
  const search = React.useCallback((q: string) => searchProjects(repo, q, attached), [repo, attached.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AddSearch<{ id: string; title: string; url: string }> search={search} itemKey={(p) => p.id} render={(p) => <span className="text-ellipsis">{p.title}</span>} onPick={onPick} onClose={onClose} placeholder="Search projects" ariaLabel="Add to project" noResults="No matching projects" />
  );
}

// ---------- ED-8: linked issues ----------

/** "Closes #n": the number of an issue in this repository. Written into the description as its own keyword line. */
export function ClosingIssueAdd({ onAdd, onClose, busy }: { onAdd: (n: number) => void; onClose: () => void; busy: boolean }) {
  const [text, setText] = React.useState("");
  const n = Number(text.trim().replace(/^#/, ""));
  const ok = Number.isInteger(n) && n > 0;
  return (
    <div className="gh-pr-add flex-row flex-center" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <TextField
        className="flex-grow"
        ariaLabel="Issue number to close"
        placeholder="Issue number, e.g. 123"
        autoFocus
        width={TextFieldWidth.auto}
        value={text}
        onChange={(_e, v) => setText(v)}
        onKeyDown={(e) => e.key === "Enter" && ok && (e.preventDefault(), onAdd(n))}
      />
      <Button primary text="Add" disabled={!ok || busy} onClick={() => onAdd(n)} />
      <Button subtle text="Cancel" onClick={onClose} />
    </div>
  );
}

export function IssueRow({ i, canRemove, onRemove }: { i: LinkedIssueRow; canRemove: boolean; onRemove: () => void }) {
  return (
    <li className="gh-pr-issue flex-row flex-center">
      <Icon iconName={i.state === "OPEN" ? "StatusCircleInner" : "CompletedSolid"} className="secondary-text" ariaLabel={i.state === "OPEN" ? "Open" : "Closed"} />
      <span className="gh-pr-grow flex-column">
        <Link className="text-ellipsis" href={i.url} target="_blank" rel="noopener noreferrer">{i.title}</Link>
        <span className="secondary-text body-s">Closes #{i.number}</span>
      </span>
      {canRemove && (i.removable ? <RemoveButton label={`Remove closing issue #${i.number}`} onClick={onRemove} /> : <RemoveButton label={`Remove closing issue #${i.number}`} reason="Linked outside the description (sidebar or prose): unlink it on GitHub" disabled onClick={() => {}} />)}
    </li>
  );
}


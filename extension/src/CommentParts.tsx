// The parts of a comment beyond its text (CM-2, CM-4 to CM-7): the pending pill, Edited label and history, the ⋯ menu, collapsed (hidden) comments,
// the edit box, suggested changes with Apply and Add to batch, and the reaction bar. State is in feedStore.ts; the rules are in lib/*.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Dialog } from "azure-devops-ui/Dialog";
import { MenuButton, MoreButton, MenuItemType, type IMenuItem } from "azure-devops-ui/Menu";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { RelDate } from "./RelDate";
import { CommentBox } from "./CommentBox";
import { graphql } from "./githubBrowse";
import type { FeedComment, ThreadItem } from "./lib/feedModel";
import { MINIMIZE_CLASSIFIERS, editHistoryQuery, toEditInfo, type EditEntry, type MinimizeClassifier } from "./lib/commentEdit";
import { PENDING_LABEL, type PendingFeedComment } from "./lib/pendingReview";
import { reactionDefs, visibleReactions, type ReactionContent } from "./lib/reactions";
import { applyFailureText, canSuggest, parseSuggestions, targetLinesFromDiffHunk, type Suggestion } from "./lib/suggestions";
import { BATCH_KEY, type FeedStore } from "./feedStore";

export const Failure = ({ store, id }: { store: FeedStore; id: string }) => {
  const text = store.errors.get(id);
  return text ? <div className="gh-feed-error"><MessageCard severity={MessageCardSeverity.Error} role="alert">{text}</MessageCard></div> : null;
};

export const isPending = (c: FeedComment) => !!(c as PendingFeedComment).pending;

// ---------- Pending, Edited ----------

export const PendingPill = () => <Pill className="gh-pending-pill" size={PillSize.compact} variant={PillVariant.outlined}>{PENDING_LABEL}</Pill>;

/** Edit history, newest first, each revision's full text (GitHub's `diff` field is the whole text after that edit). */
function HistoryDialog({ id, close }: { id: string; close: () => void }) {
  const [rows, setRows] = React.useState<EditEntry[] | "error" | undefined>();
  React.useEffect(() => {
    let dead = false;
    graphql(editHistoryQuery(id)).then(
      (b) => !dead && setRows(toEditInfo({ lastEditedAt: b.data?.node?.lastEditedAt ?? new Date().toISOString(), ...b.data?.node }).history),
      () => !dead && setRows("error")
    );
    return () => { dead = true; };
  }, [id]);
  return (
    <Dialog titleProps={{ text: "Edit history" }} onDismiss={close} footerButtonProps={[{ text: "Close", primary: true, onClick: close }]}>
      {rows === undefined && <Spinner size={SpinnerSize.medium} ariaLabel="Loading edit history" />}
      {rows === "error" && <MessageCard severity={MessageCardSeverity.Error}>Could not load the edit history.</MessageCard>}
      {Array.isArray(rows) && !rows.length && <span className="secondary-text">GitHub has no earlier versions of this comment.</span>}
      {Array.isArray(rows) && (
        <ol className="gh-history" aria-label="Revisions, newest first">
          {rows.map((r, i) => (
            <li key={i} className="gh-history-item">
              <div className="gh-history-head flex-row flex-center">
                <span className="font-weight-semibold">{r.editor}</span>
                <span className="secondary-text">{r.isCreation ? "wrote this" : "edited this"} <RelDate date={r.editedAt} /></span>
                {r.isCreation && <Pill size={PillSize.compact} variant={PillVariant.outlined}>Original</Pill>}
              </div>
              {r.deleted || r.body === null ? <span className="secondary-text">GitHub removed this version's content.</span> : <pre className="gh-history-body">{r.body}</pre>}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}

export function EditedLabel({ store, c }: { store: FeedStore; c: FeedComment }) {
  const [open, setOpen] = React.useState(false);
  const edit = store.meta[c.id]?.edit;
  if (!edit?.label) return null;
  return (
    <>
      <Button className="gh-edited" subtle text={edit.label} ariaLabel="Edited. Show edit history" ariaHasPopup tooltipProps={{ text: "Show edit history" }} onClick={() => setOpen(true)} />
      {open && <HistoryDialog id={c.id} close={() => setOpen(false)} />}
    </>
  );
}

// ---------- the ⋯ menu ----------

const CLASSIFIER_TEXT: Record<MinimizeClassifier, string> = { SPAM: "Spam", ABUSE: "Abuse", OFF_TOPIC: "Off topic", OUTDATED: "Outdated", DUPLICATE: "Duplicate", RESOLVED: "Resolved" };

export function CommentMenu({ store, c }: { store: FeedStore; c: FeedComment }) {
  const [confirm, setConfirm] = React.useState(false);
  const meta = store.meta[c.id];
  if (!meta) return null;
  const a = meta.actions;
  const busy = store.busy.has(c.id);
  const items: IMenuItem[] = [];
  if (a.canEdit) items.push({ id: "edit", text: "Edit", iconProps: { iconName: "Edit" }, disabled: busy, onActivate: () => store.startEdit(c.id) });
  if (a.canDelete) items.push({ id: "delete", text: "Delete", iconProps: { iconName: "Delete" }, disabled: busy, onActivate: () => setConfirm(true) });
  if (a.canMinimize) {
    items.push({
      id: "hide",
      text: "Hide",
      iconProps: { iconName: "Hide2" },
      disabled: busy,
      subMenuProps: { id: `gh-hide-${c.id}`, items: MINIMIZE_CLASSIFIERS.map((k) => ({ id: k, text: CLASSIFIER_TEXT[k], onActivate: () => void store.setMinimized(c.id, k) })) },
    });
  }
  if (a.canUnminimize) items.push({ id: "unhide", text: "Unhide", iconProps: { iconName: "View" }, disabled: busy, onActivate: () => void store.setMinimized(c.id, null) });
  if (!items.length) return null;
  if (items.length > 1 && items.some((i) => i.id === "hide" || i.id === "unhide")) items.splice(items.findIndex((i) => i.id === "hide" || i.id === "unhide"), 0, { id: "divider", itemType: MenuItemType.Divider });
  return (
    <>
      <MoreButton ariaLabel="Comment actions" contextualMenuProps={{ menuProps: { id: `gh-comment-menu-${c.id}`, items } }} />
      {confirm && (
        <Dialog
          titleProps={{ text: "Delete comment?" }}
          onDismiss={() => setConfirm(false)}
          footerButtonProps={[{ text: "Cancel", onClick: () => setConfirm(false) }, { text: "Delete", primary: true, danger: true, onClick: () => { setConfirm(false); void store.remove(c.id); } }]}
        >
          This permanently deletes the comment from GitHub. It cannot be undone.
        </Dialog>
      )}
    </>
  );
}

// ---------- the text of a comment: hidden, being edited, or shown ----------

/** Collapses a hidden comment behind "This comment was marked as {reason}" and a Show toggle. */
export function HiddenGate({ store, c, children }: { store: FeedStore; c: FeedComment; children: React.ReactNode }) {
  const [shown, setShown] = React.useState(false);
  const view = store.meta[c.id]?.minimized;
  if (!view?.collapsed) return <>{children}</>;
  const id = `gh-hidden-${c.id}`;
  return (
    <div className="gh-hidden">
      <div className="gh-hidden-bar flex-row flex-center">
        <span className="secondary-text">{view.label}</span>
        <Button subtle text={shown ? "Hide" : "Show"} ariaExpanded={shown} ariaControls={id} onClick={() => setShown(!shown)} />
      </div>
      <div id={id} hidden={!shown}>{shown && children}</div>
    </div>
  );
}

export function EditBox({ store, c, repo, participants }: { store: FeedStore; c: FeedComment; repo: string; participants: string[] }) {
  const [text, setText] = React.useState(store.meta[c.id]?.body ?? "");
  const busy = store.busy.has(c.id);
  const save = () => {
    if (text.trim()) void store.edit(c.id, text).then((ok) => ok && store.stopEdit(c.id));
  };
  return (
    <div className="gh-edit">
      <CommentBox value={text} set={setText} label="Edit comment" placeholder="Edit comment" disabled={busy} submit={save} repo={repo} participants={participants} autoFocus />
      <div className="gh-edit-actions flex-row">
        <Button primary text="Save" disabled={busy || !text.trim()} onClick={save} />
        <Button text="Cancel" disabled={busy} onClick={() => store.stopEdit(c.id)} />
      </div>
      <Failure store={store} id={c.id} />
    </div>
  );
}

// ---------- suggested changes (CM-2) ----------

/** The lines a thread was placed on, from its first comment's diff hunk. */
export function threadOriginalLines(t: ThreadItem): string[] | null {
  const hunk = t.comments[0]?.diffHunk;
  return hunk && t.line != null ? targetLinesFromDiffHunk(hunk, t.line - (t.startLine ?? t.line) + 1) : null;
}

function SuggestionView({ store, c, t, s, index, original }: { store: FeedStore; c: FeedComment; t: ThreadItem; s: Suggestion; index: number; original: string[] | null }) {
  const key = `${c.id}#${index}`;
  const item = original && { key, path: t.path, suggestion: s, originalLines: original, outdated: t.outdated };
  const busy = store.busy.has(`suggest:${key}`) || store.busy.has(BATCH_KEY);
  const queued = store.batch.some((b) => b.key === key);
  const why = !store.pr.viewerCanApplySuggestion ? applyFailureText("no-permission") : t.outdated ? applyFailureText("outdated") : isPending(c) ? "Submit your review before applying this suggestion." : !original ? "The lines this suggestion replaces could not be read, so it cannot be checked against the code." : undefined;
  return (
    <div className="gh-suggestion">
      <div className="gh-suggestion-head font-weight-semibold">Suggested change</div>
      <div className="gh-suggestion-diff monospaced-xs" role="group" aria-label="Suggested change">
        {(original ?? []).map((l, i) => <div key={`o${i}`} className="gh-suggestion-del"><span aria-hidden="true">-</span>{l || " "}</div>)}
        {s.replacement.map((l, i) => <div key={`n${i}`} className="gh-suggestion-add"><span aria-hidden="true">+</span>{l || " "}</div>)}
        {!s.replacement.length && <div className="gh-suggestion-note secondary-text">This suggestion removes the lines.</div>}
      </div>
      <div className="gh-suggestion-actions flex-row flex-center">
        <Button primary text="Apply suggestion" disabled={!!why || busy} onClick={() => item && void store.applySuggestions([item], `suggest:${key}`)} />
        <Button text={queued ? "Remove from batch" : "Add to batch"} disabled={!!why || (busy && !queued)} onClick={() => (queued ? store.removeFromBatch(key) : item && store.addToBatch(item))} />
        {busy && <Spinner size={SpinnerSize.small} ariaLabel="Committing" />}
      </div>
      {why && <div className="gh-suggestion-why"><MessageCard severity={t.outdated || !original ? MessageCardSeverity.Warning : MessageCardSeverity.Info}>{why}</MessageCard></div>}
      <Failure store={store} id={`suggest:${key}`} />
    </div>
  );
}

/** One panel per suggestion block in the comment; only for comments in a thread on the new side of a line. */
export function Suggestions({ store, c, t }: { store: FeedStore; c: FeedComment; t?: ThreadItem }) {
  const meta = store.meta[c.id];
  const blocks = React.useMemo(() => (meta && t && canSuggest({ subjectType: t.subjectType, side: t.side, line: t.line, outdated: false }) ? parseSuggestions(meta.body, { line: t.line, startLine: t.startLine }) : []), [meta?.body, t?.line, t?.startLine, t?.side]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t || !blocks.length) return null;
  const original = threadOriginalLines(t);
  return <>{blocks.map((s, i) => <SuggestionView key={i} store={store} c={c} t={t} s={s} index={i} original={original} />)}</>;
}

// ---------- reactions (CM-7) ----------

const REACTION_LABEL: Record<ReactionContent, string> = { THUMBS_UP: "Thumbs up", THUMBS_DOWN: "Thumbs down", LAUGH: "Laugh", HOORAY: "Hooray", CONFUSED: "Confused", HEART: "Heart", ROCKET: "Rocket", EYES: "Eyes" };

/** The reactions under a comment or the PR description: a pill per reaction with a count, and a picker with all eight. `id` is the node id. */
export function ReactionBar({ store, id }: { store: FeedStore; id: string }) {
  const state = store.reactionState(id);
  const shown = visibleReactions(state);
  const can = id === store.prId ? store.pr.viewerCanReact : !!store.meta[id]?.viewerCanReact;
  if (!shown.length && !can) return null;
  const busy = store.busy.has(`react:${id}`);
  // Plain items, not `checked` ones: azure-devops-ui keeps a menu open after a checkbox item is activated, and the reaction
  // re-render then left it stuck open with no light dismiss (seen live in 0.27.0). Mine are marked with a check icon instead.
  const items: IMenuItem[] = reactionDefs().map((d) => {
    const mine = !!state.find((r) => r.content === d.content)?.viewerHasReacted;
    return {
      id: d.content,
      text: `${d.emoji}  ${REACTION_LABEL[d.content]}`,
      ariaLabel: `${mine ? "Remove" : "Add"} ${REACTION_LABEL[d.content]} reaction`,
      secondaryText: mine ? "✓" : undefined,
      disabled: busy,
      onActivate: () => void store.react(id, d.content),
    };
  });
  return (
    <div className="gh-reactions flex-row flex-center" role="group" aria-label="Reactions">
      {shown.map((r) => (
        <Button
          key={r.content}
          className={`gh-reaction ${r.viewerHasReacted ? "gh-reaction-mine" : ""}`}
          ariaPressed={r.viewerHasReacted}
          ariaLabel={`${REACTION_LABEL[r.content]}: ${r.count}${r.viewerHasReacted ? ", including you" : ""}`}
          disabled={!can || busy}
          onClick={() => void store.react(id, r.content)}
        >
          <span aria-hidden="true">{r.emoji}</span>
          <span className="gh-reaction-count" aria-hidden="true">{r.count}</span>
        </Button>
      ))}
      {can && <MenuButton className="gh-reaction-add" subtle hideDropdownIcon iconProps={{ iconName: "AddReaction" }} ariaLabel="Add reaction" tooltipProps={{ text: "Add reaction" }} contextualMenuProps={{ menuProps: { id: `gh-react-menu-${id}`, items } }} />}
      <Failure store={store} id={`react:${id}`} />
    </div>
  );
}

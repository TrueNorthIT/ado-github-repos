// Writing a review (CM-1, CM-2, CM-3): the composer for a new line or file comment, the "Finish review" control and dialog, and the suggestion batch bar.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Dialog } from "azure-devops-ui/Dialog";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { RadioButton, RadioButtonGroup } from "azure-devops-ui/RadioButton";
import { CommentBox } from "./CommentBox";
import { Failure } from "./CommentParts";
import { BATCH_KEY, REVIEW_KEY, useFeed, type FeedStore } from "./feedStore";
import type { ThreadTarget } from "./lib/newThread";
import { linesLabel } from "./lib/inlineThreads";
import { canSubmitReview, type SubmitEvent } from "./lib/pendingReview";

export const people = (store: FeedStore) => [...new Set([store.viewer.login, ...store.items.flatMap((i) => (i.kind === "event" ? [i.actor] : i.kind === "comment" ? [i.author] : i.comments.map((c) => c.author)))].filter(Boolean))];

const where = (t: ThreadTarget) => (t.subjectType === "FILE" ? t.path : `${t.path}, ${linesLabel(t)}`);

/**
 * A new comment on a line, a range or a whole file. "Add single comment" posts it at once; "Start a review" keeps it pending with the viewer's other
 * comments until they finish the review. With a review already open there is only "Add review comment".
 */
export function NewThreadComposer({ store, repo, target, originalLines, onClose }: { store: FeedStore; repo: string; target: ThreadTarget; originalLines?: string[]; onClose: () => void }) {
  const key = `new:${where(target)}`;
  const [text, setText] = React.useState("");
  const busy = store.busy.has(key);
  const live = React.useRef(true);
  React.useEffect(() => () => { live.current = false; }, []);
  const post = (mode: "single" | "review") => {
    if (text.trim()) void store.newThread(key, target, text, mode).then((ok) => ok && live.current && onClose());
  };
  const reviewing = !!store.pending;
  return (
    <Card className="bolt-card-no-vertical-padding gh-feed-card gh-new-thread" contentProps={{ contentPadding: false }}>
      <div className="gh-new-thread-body" role="group" aria-label={`New comment on ${where(target)}`}>
        <div className="gh-new-thread-where secondary-text body-s text-ellipsis">{where(target)}</div>
        <CommentBox value={text} set={setText} label="Write a comment" placeholder="Leave a comment" disabled={busy} submit={() => post(reviewing ? "review" : "single")} repo={repo} participants={people(store)} originalLines={originalLines} autoFocus />
        <div className="gh-new-thread-actions flex-row flex-center">
          {reviewing ? (
            <Button primary text="Add review comment" disabled={busy || !text.trim()} onClick={() => post("review")} />
          ) : (
            <>
              <Button primary text="Start a review" disabled={busy || !text.trim()} onClick={() => post("review")} />
              <Button text="Add single comment" disabled={busy || !text.trim()} onClick={() => post("single")} />
            </>
          )}
          <Button subtle text="Cancel" disabled={busy} onClick={onClose} />
        </div>
        <Failure store={store} id={key} />
      </div>
    </Card>
  );
}

// ---------- Finish review ----------

const VERDICTS: { id: SubmitEvent; text: string; hint: string }[] = [
  { id: "COMMENT", text: "Comment", hint: "Submit general feedback without explicit approval." },
  { id: "APPROVE", text: "Approve", hint: "Submit feedback and approve merging these changes." },
  { id: "REQUEST_CHANGES", text: "Request changes", hint: "Submit feedback that must be addressed before merging." },
];

function ReviewDialog({ store, repo, close }: { store: FeedStore; repo: string; close: () => void }) {
  const [event, setEvent] = React.useState<SubmitEvent>("COMMENT");
  const [body, setBody] = React.useState(store.pending?.body ?? "");
  const [discarding, setDiscarding] = React.useState(false);
  const busy = store.busy.has(REVIEW_KEY);
  const n = store.pendingCount;
  const ok = canSubmitReview({ event, body, pendingCount: n });
  const submit = () => ok && void store.submitReview(event, body).then((done) => done && close());
  return (
    <Dialog
      titleProps={{ text: "Finish your review" }}
      onDismiss={close}
      footerButtonProps={
        discarding
          ? [{ text: "Keep review", disabled: busy, onClick: () => setDiscarding(false) }, { text: "Discard review", primary: true, danger: true, disabled: busy, onClick: () => void store.discardReview().then((done) => done && close()) }]
          : [{ text: "Discard review", disabled: busy, onClick: () => setDiscarding(true) }, { text: "Cancel", disabled: busy, onClick: close }, { text: "Submit review", primary: true, disabled: busy || !ok, onClick: submit }]
      }
    >
      <div className="gh-review-dialog flex-column">
        {discarding ? (
          <MessageCard severity={MessageCardSeverity.Warning}>This deletes your review and its {n} pending {n === 1 ? "comment" : "comments"} from GitHub. It cannot be undone.</MessageCard>
        ) : (
          <>
            <CommentBox value={body} set={setBody} label="Review summary" placeholder="Leave a comment" disabled={busy} submit={submit} repo={repo} participants={people(store)} rows={5} autoFocus />
            <div className="gh-review-verdict">
              <RadioButtonGroup text="Review type" selectedButtonId={event} onSelect={(id) => setEvent(id as SubmitEvent)}>
                {VERDICTS.map((v) => <RadioButton key={v.id} id={v.id} text={`${v.text}. ${v.hint}`} disabled={busy} />)}
              </RadioButtonGroup>
            </div>
            <span className="secondary-text body-s">{n} pending {n === 1 ? "comment" : "comments"} will be submitted with this review.</span>
          </>
        )}
        <Failure store={store} id={REVIEW_KEY} />
      </div>
    </Dialog>
  );
}

/** The header button shown while the viewer has an unsubmitted review. */
export function FinishReview({ repo, number }: { repo: string; number: number }) {
  const store = useFeed(repo, number);
  const [open, setOpen] = React.useState(false);
  if (!store.pending) return null;
  return (
    <>
      <Button className="gh-finish-review" primary text={`Finish review (${store.pendingCount} pending)`} iconProps={{ iconName: "CommentAdd" }} ariaHasPopup onClick={() => { store.errors.delete(REVIEW_KEY); setOpen(true); }} />
      {open && <ReviewDialog store={store} repo={repo} close={() => setOpen(false)} />}
    </>
  );
}

// ---------- the suggestion batch ----------

/** "Commit N suggestions" while any suggestion is queued, and the outcome of the last commit. */
export function SuggestionBar({ store }: { store: FeedStore }) {
  const n = store.batch.length;
  const busy = store.busy.has(BATCH_KEY);
  if (!n && !store.committed && !store.errors.has(BATCH_KEY)) return null;
  return (
    <div className="gh-batch" role="region" aria-label="Suggestion batch">
      {n > 0 && (
        <div className="gh-batch-bar flex-row flex-center">
          <span className="body-m">{n} {n === 1 ? "suggestion" : "suggestions"} in the batch</span>
          <Button primary text={`Commit ${n} ${n === 1 ? "suggestion" : "suggestions"}`} disabled={busy} onClick={() => void store.applySuggestions(store.batch, BATCH_KEY)} />
          <Button subtle text="Clear batch" disabled={busy} onClick={() => store.clearBatch()} />
        </div>
      )}
      <Failure store={store} id={BATCH_KEY} />
      {store.committed && (
        <MessageCard severity={MessageCardSeverity.Info} onDismiss={() => store.dismissCommitted()}>
          Committed {store.committed.count} {store.committed.count === 1 ? "suggestion" : "suggestions"} to the branch.{" "}
          {/^https:\/\//.test(store.committed.url) && <Link href={store.committed.url} target="_blank" rel="noopener noreferrer">View the commit on GitHub</Link>}
        </MessageCard>
      )}
    </div>
  );
}

/** A NewThreadComposer for a React root of its own (a Monaco view zone or the file card), kept in step with the feed store. */
export function ComposerRoot({ repo, number, target, originalLines, onClose }: { repo: string; number: number; target: ThreadTarget; originalLines?: string[]; onClose: () => void }) {
  const store = useFeed(repo, number);
  return <NewThreadComposer store={store} repo={repo} target={target} originalLines={originalLines} onClose={onClose} />;
}

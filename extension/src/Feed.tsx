// The PR activity feed (AF-1 to AF-5, AF-7): composer, review-thread and comment cards, and event rows, on a dotted timeline.
// ThreadCard is also what the Files diff puts under a commented line (AF-6).
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Card } from "azure-devops-ui/Card";
import { Dropdown, DropdownExpandableButton } from "azure-devops-ui/Dropdown";
import { Icon } from "azure-devops-ui/Icon";
import { Link } from "azure-devops-ui/Link";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { RelDate } from "./RelDate";
import { parseColor } from "azure-devops-ui/Utilities/Color";
import { commitUrl, shortSha } from "./lib/commits";
import { linesLabel } from "./lib/inlineThreads";
import { counts, filterFeed, type CommentItem, type EventItem, type EventType, type FeedComment, type FeedFilter, type ThreadItem } from "./lib/feedModel";
import { prepareMarkdownHtml } from "./lib/markdown";
import { serialize, type BrowseState } from "./lib/browseState";
import { COMMENT_KEY, useFeed, type FeedStore } from "./feedStore";
import { CommentBox } from "./CommentBox";
import { EditBox, EditedLabel, CommentMenu, Failure, HiddenGate, PendingPill, ReactionBar, Suggestions, isPending } from "./CommentParts";
import { SuggestionBar, people } from "./ReviewUi";
import { openRepoHub } from "./hostNav";
import { ErrorView, Markdown, hubClick } from "./Browser";

const Avatar = ({ url, name, size }: { url: string; name: string; size: "small" }) => (
  <VssPersona imageUrl={url} displayName={name} size={size} suppressPersonaCard showInitialsOnImageError />
);
const When = ({ date }: { date: Date }) => <RelDate className="gh-feed-time secondary-text body-s" date={date} />;

/** A comment's GitHub HTML, through the same sanitiser as the README and the PR description. */
function Body({ html, repo, baseRef }: { html: string; repo: string; baseRef: string }) {
  const [owner, name] = repo.split("/");
  const prepared = React.useMemo(() => prepareMarkdownHtml(html, { owner, name, ref: baseRef, dir: "" }), [html, owner, name, baseRef]);
  const go = React.useCallback((s: BrowseState) => void openRepoHub(s), []);
  return (
    <div className="gh-feed-body">
      <Markdown prepared={prepared} repo={repo} refName={baseRef} go={go} />
    </div>
  );
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    /* clipboard blocked: nothing to do */
  }
}

// ---------- the text box (composer and reply) ----------

/** Text state that is cleared only once the call succeeded; a failure keeps what was typed. */
function useDraft(send: (text: string) => Promise<boolean>) {
  const [text, setText] = React.useState("");
  const live = React.useRef(true);
  React.useEffect(() => () => { live.current = false; }, []);
  const submit = React.useCallback(() => {
    if (text.trim()) void send(text).then((ok) => ok && live.current && setText(""));
  }, [text, send]);
  return { text, setText, submit };
}

function Composer({ store, repo }: { store: FeedStore; repo: string }) {
  const busy = store.busy.has(COMMENT_KEY);
  const { text, setText, submit } = useDraft((t) => store.comment(t));
  const who = React.useMemo(() => people(store), [store.items]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card className="bolt-card-no-vertical-padding gh-feed-card gh-feed-composer" contentProps={{ contentPadding: false }}>
      <div className="gh-feed-compose-row">
        <Avatar url={store.viewer.avatarUrl ?? ""} name={store.viewer.login} size="small" />
        <CommentBox value={text} set={setText} placeholder="Add a comment..." label="Add a comment" disabled={busy} submit={submit} repo={repo} participants={who} collapsible />
        {text.trim() && <Button primary text="Comment" disabled={busy} onClick={submit} />}
      </div>
      <Failure store={store} id={COMMENT_KEY} />
    </Card>
  );
}

// ---------- cards ----------

function CommentHead({ c, store, children }: { c: FeedComment; store: FeedStore; children?: React.ReactNode }) {
  return (
    <div className="gh-feed-head">
      <Avatar url={c.avatarUrl} name={c.author} size="small" />
      <div className="gh-feed-who flex-column">
        <span className="gh-feed-author font-weight-semibold">{c.author}</span>
        <When date={c.date} />
      </div>
      {isPending(c) && <PendingPill />}
      <EditedLabel store={store} c={c} />
      <div className="gh-feed-head-actions flex-row flex-center">
        {children}
        <CommentMenu store={store} c={c} />
      </div>
    </div>
  );
}

/** A comment's text and what hangs off it: hidden behind a toggle, an edit box, the suggested changes and the reactions. */
function CommentContent({ store, c, t, repo, baseRef }: { store: FeedStore; c: FeedComment; t?: ThreadItem; repo: string; baseRef: string }) {
  const who = React.useMemo(() => people(store), [store.items]); // eslint-disable-line react-hooks/exhaustive-deps
  if (store.editing.has(c.id)) return <EditBox store={store} c={c} repo={repo} participants={who} />;
  return (
    <HiddenGate store={store} c={c}>
      <Body html={c.html} repo={repo} baseRef={baseRef} />
      <Suggestions store={store} c={c} t={t} />
      {!isPending(c) && <ReactionBar store={store} id={c.id} />}
      <Failure store={store} id={c.id} />
    </HiddenGate>
  );
}

const CopyLink = ({ url }: { url: string }) => (
  <Button subtle iconProps={{ iconName: "Link" }} ariaLabel="Copy link to comment" tooltipProps={{ text: "Copy link to comment" }} disabled={!url} onClick={() => void copyLink(url)} />
);

const STATUS = [{ id: "active", text: "Active" }, { id: "resolved", text: "Resolved" }];

export interface ThreadCardProps {
  store: FeedStore;
  thread: ThreadItem;
  repo: string;
  baseRef: string;
  /** Overview shows where the thread is; the Files diff already does. */
  where?: { href: string; open: () => void };
}

export function ThreadCard({ store, thread: t, repo, baseRef, where }: ThreadCardProps) {
  const busy = store.busy.has(t.id);
  const resolved = t.status === "resolved";
  const { text, setText, submit } = useDraft((v) => store.reply(t.id, v));
  const who = React.useMemo(() => people(store), [store.items]); // eslint-disable-line react-hooks/exhaustive-deps
  const [first, ...replies] = t.comments;
  // CM-6: in the diff a multi-line thread says which lines it covers, as native ADO does ("Lines 12–18").
  const range = !t.outdated && t.line != null && t.startLine != null && t.startLine !== t.line;
  if (!first) return null;
  return (
    <Card className="bolt-card-no-vertical-padding gh-feed-card gh-feed-thread" contentProps={{ contentPadding: false }}>
      <div className="gh-feed-section">
        <CommentHead c={first} store={store}>
          <CopyLink url={first.url} />
          <Dropdown
            className="gh-feed-status"
            ariaLabel={`Thread status: ${resolved ? "Resolved" : "Active"}`}
            disabled={busy}
            placeholder={resolved ? "Resolved" : "Active"}
            items={STATUS}
            onSelect={(_e, item) => item.id !== t.status && void store.resolve(t.id, item.id === "resolved")}
            renderExpandable={(p) => <DropdownExpandableButton {...p} subtle />}
          />
        </CommentHead>
        <div className="gh-feed-indent">
          {(where || t.outdated || range) && (
            <div className="gh-feed-where flex-row flex-center">
              {where && (
                <Link className="gh-feed-file" href={where.href} onClick={hubClick(where.open)}>
                  {t.path}{t.line ? `, ${linesLabel(t)}` : ""}
                </Link>
              )}
              {!where && range && <span className="gh-feed-lines secondary-text">{linesLabel(t, true)}</span>}
              {t.outdated && <Pill size={PillSize.compact} variant={PillVariant.outlined}>Outdated</Pill>}
              {t.subjectType === "FILE" && <Pill size={PillSize.compact} variant={PillVariant.outlined}>File comment</Pill>}
            </div>
          )}
          <CommentContent store={store} c={first} t={t} repo={repo} baseRef={baseRef} />
        </div>
      </div>
      {replies.map((c) => (
        <div key={c.id} className="gh-feed-section gh-feed-reply">
          <CommentHead c={c} store={store} />
          <div className="gh-feed-indent"><CommentContent store={store} c={c} t={t} repo={repo} baseRef={baseRef} /></div>
        </div>
      ))}
      <div className="gh-feed-footer">
        <div className="gh-feed-compose-row">
          <Avatar url={store.viewer.avatarUrl ?? ""} name={store.viewer.login} size="small" />
          <CommentBox value={text} set={setText} placeholder="Write a reply..." label="Write a reply" disabled={busy} submit={submit} repo={repo} participants={who} collapsible />
          {text.trim() && <Button primary text={store.pending ? "Add review comment" : "Reply"} disabled={busy} onClick={submit} />}
          <Button text={resolved ? "Reactivate" : "Resolve"} disabled={busy} onClick={() => void store.resolve(t.id, !resolved)} />
        </div>
        <Failure store={store} id={t.id} />
      </div>
    </Card>
  );
}

function CommentCard({ store, c, repo, baseRef }: { store: FeedStore; c: CommentItem; repo: string; baseRef: string }) {
  return (
    <Card className="bolt-card-no-vertical-padding gh-feed-card gh-feed-thread" contentProps={{ contentPadding: false }}>
      <div className="gh-feed-section">
        <CommentHead c={c} store={store}><CopyLink url={c.url} /></CommentHead>
        <div className="gh-feed-indent"><CommentContent store={store} c={c} repo={repo} baseRef={baseRef} /></div>
      </div>
    </Card>
  );
}

// ---------- events ----------

// Every name is in azure-devops-ui's FluentIcons.css, except BranchCommit (FabricIcons.css); checked against the CSS at build time of this change.
export const RAIL: Record<EventType | "thread" | "comment", { icon?: string; tone?: "success" | "warning" }> = {
  thread: { icon: "Chat" },
  comment: { icon: "Comment" },
  created: {},
  pushed: { icon: "BranchCommit" },
  review_approved: { icon: "CheckMark", tone: "success" },
  review_changes_requested: { icon: "Warning", tone: "warning" },
  review_commented: { icon: "Comment" },
  review_requested: { icon: "AddFriend" },
  labelled: { icon: "Tag" },
  unlabelled: { icon: "Tag" },
  ready_for_review: { icon: "Rocket" },
  converted_to_draft: { icon: "Edit" },
  merged: { icon: "BranchMerge" },
  closed: { icon: "Blocked2" },
  reopened: { icon: "Undo" },
  force_pushed: { icon: "Rewind", tone: "warning" },
};

function LabelPill({ name, color }: { name: string; color: string }) {
  const c = parseColor(`#${color}`);
  return <Pill className="gh-pr-pill" size={PillSize.compact} variant={c ? PillVariant.colored : PillVariant.standard} color={c}>{name}</Pill>;
}

function Phrase({ e, baseRef }: { e: EventItem; baseRef: string }) {
  switch (e.type) {
    case "created": return <>created the pull request</>;
    case "pushed": return <>pushed {e.count} {e.count === 1 ? "commit" : "commits"}</>;
    case "review_approved": return <>approved the pull request</>;
    case "review_changes_requested": return <>requested changes</>;
    case "review_commented": return <>reviewed</>;
    case "review_requested": return <>requested a review from <span className="font-weight-semibold">{e.reviewer}</span></>;
    case "labelled": return <>added label {e.label && <LabelPill {...e.label} />}</>;
    case "unlabelled": return <>removed label {e.label && <LabelPill {...e.label} />}</>;
    case "ready_for_review": return <>marked as ready for review</>;
    case "converted_to_draft": return <>converted to draft</>;
    case "merged": return <>merged into <span className="font-weight-semibold">{baseRef}</span></>;
    case "closed": return <>closed</>;
    case "reopened": return <>reopened</>;
    case "force_pushed": return <>force-pushed{e.before && e.after ? <> <span className="monospaced-xs secondary-text">{shortSha(e.before)} to {shortSha(e.after)}</span></> : null}</>;
  }
}

function EventRow({ e, repo, baseRef }: { e: EventItem; repo: string; baseRef: string }) {
  const [open, setOpen] = React.useState(false);
  const pushed = e.type === "pushed" && (e.commits?.length ?? 0) > 0;
  const listId = `gh-feed-commits-${e.id}`;
  return (
    <div className="gh-feed-event">
      <div className="gh-feed-event-line">
        <span className="gh-feed-event-text">
          <span className="gh-feed-actor">{e.actor}</span> <Phrase e={e} baseRef={baseRef} />
          {pushed && (
            <Button className="gh-feed-expand" subtle iconProps={{ iconName: open ? "ChevronDown" : "ChevronRight" }} ariaLabel={open ? "Hide commits" : "Show commits"} ariaExpanded={open} ariaControls={listId} onClick={() => setOpen(!open)} />
          )}
        </span>
        <When date={e.date} />
      </div>
      {open && (
        <ul id={listId} className="gh-feed-commits">
          {e.commits!.map((c) => (
            <li key={c.sha}>
              <Link className="monospaced-xs" href={commitUrl(repo, c.sha)} target="_blank" rel="noopener noreferrer" ariaLabel={`Commit ${shortSha(c.sha)} on GitHub`}>{shortSha(c.sha)}</Link>
              <span className="text-ellipsis">{c.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A submitted review with a body: a card like a comment's, the verdict in the header. */
function ReviewCard({ e, repo, baseRef }: { e: EventItem; repo: string; baseRef: string }) {
  return (
    <Card className="bolt-card-no-vertical-padding gh-feed-card gh-feed-thread" contentProps={{ contentPadding: false }}>
      <div className="gh-feed-section">
        <div className="gh-feed-head">
          <Avatar url={e.avatarUrl} name={e.actor} size="small" />
          <div className="gh-feed-who flex-column">
            <span><span className="gh-feed-author font-weight-semibold">{e.actor}</span><span className="secondary-text"><Phrase e={e} baseRef={baseRef} /></span></span>
            <When date={e.date} />
          </div>
        </div>
        <div className="gh-feed-indent"><Body html={e.html!} repo={repo} baseRef={baseRef} /></div>
      </div>
    </Card>
  );
}

/** The threads anchored at one line of the Files diff (rendered into a Monaco view zone by PrFiles). */
export function InlineThreads({ repo, number, baseRef, ids }: { repo: string; number: number; baseRef: string; ids: string[] }) {
  const store = useFeed(repo, number);
  return (
    <>
      {ids.map((id) => {
        const t = store.thread(id);
        return t ? <ThreadCard key={id} store={store} thread={t} repo={repo} baseRef={baseRef} /> : null;
      })}
    </>
  );
}

// ---------- the feed ----------

const FILTERS: { id: FeedFilter; text: string }[] = [{ id: "all", text: "Everything" }, { id: "comments", text: "Comments" }, { id: "events", text: "Events" }];

export interface ActivityFeedProps {
  repo: string;
  number: number;
  baseRef: string;
  /** The list tab, for the Files link's href. */
  prTab: BrowseState["prTab"];
  openFile: (path: string) => void;
  signIn: () => void;
  busy: boolean;
}

export function ActivityFeed({ repo, number, baseRef, prTab, openFile, signIn, busy }: ActivityFeedProps) {
  const store = useFeed(repo, number);
  const [filter, setFilter] = React.useState<FeedFilter>("all");
  const n = React.useMemo(() => counts(store.items), [store.items]);
  const shown = React.useMemo(() => filterFeed(store.items, filter), [store.items, filter]);
  if (store.status === "loading" && !store.items.length) return <div className="gh-feed-loading flex-row justify-center"><Spinner size={SpinnerSize.medium} ariaLabel="Loading activity" /></div>;
  if (store.status === "error") return <ErrorView err={store.err} signIn={signIn} busy={busy} retry={() => store.ensureLoaded(true)} subject="see this pull request's activity" permission="Pull requests" />;
  const count = (id: FeedFilter) => n[id];
  const current = FILTERS.find((f) => f.id === filter)!;
  return (
    <section className="gh-feed" aria-labelledby="gh-feed-title">
      <h2 id="gh-feed-title" className="screen-reader-only">Activity feed</h2>
      <div className="gh-feed-filter flex-row justify-end">
        <Dropdown
          ariaLabel={`Filter activity: show ${current.text.toLowerCase()}`}
          placeholder={`Show ${current.text.toLowerCase()} (${count(filter)})`}
          items={FILTERS.map((f) => ({ id: f.id, text: `${f.text} (${count(f.id)})` }))}
          onSelect={(_e, item) => setFilter(item.id as FeedFilter)}
          renderExpandable={(p) => <DropdownExpandableButton {...p} subtle />}
        />
      </div>
      <SuggestionBar store={store} />
      <ul className="gh-feed-list" role="list">
        {filter === "all" && (
          <li className="gh-feed-row">
            <span className="gh-feed-rail secondary-text"><Icon iconName="Add" /></span>
            <Composer store={store} repo={repo} />
          </li>
        )}
        {shown.map((item) => {
          const rail = RAIL[item.kind === "event" ? item.type : item.kind];
          return (
            <li key={item.id} className={`gh-feed-row gh-feed-row-${item.kind === "event" && item.html ? "review" : item.kind}`}>
              {rail.icon && <span className={`gh-feed-rail secondary-text ${rail.tone ? `gh-feed-rail-${rail.tone}` : ""}`}><Icon iconName={rail.icon} /></span>}
              {item.kind === "thread" ? (
                <ThreadCard store={store} thread={item} repo={repo} baseRef={baseRef} where={{ href: serialize({ repo, view: "prs", prTab, pr: number, prPage: "files", file: item.path }), open: () => openFile(item.path) }} />
              ) : item.kind === "comment" ? (
                <CommentCard store={store} c={item} repo={repo} baseRef={baseRef} />
              ) : item.html ? (
                <ReviewCard e={item} repo={repo} baseRef={baseRef} />
              ) : (
                <EventRow e={item} repo={repo} baseRef={baseRef} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

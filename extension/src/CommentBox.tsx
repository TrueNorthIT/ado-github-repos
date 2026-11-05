// The comment box every composer uses (CM-8, CM-9): a formatting toolbar over a TextField, Ctrl+B/I/K/E, and an @mention list.
// Text edits come from lib/mdToolbar.ts, mention text handling and ranking from lib/mentions.ts; this file only draws them and moves the caret.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { TextField } from "azure-devops-ui/TextField";
import { VssPersona } from "azure-devops-ui/VssPersona";
import { searchReviewers } from "./githubBrowse";
import { applyToolbar, shortcutAction, type ToolbarAction } from "./lib/mdToolbar";
import { detectMention, insertMention, mentionHandle, rankMentions, type MentionMatch } from "./lib/mentions";
import type { Candidate } from "./lib/reviewerSearch";

interface ToolbarButton {
  action: ToolbarAction;
  label: string;
  /** azure-devops-ui icon, when the icon font has one. */
  icon?: string;
  /** Text shown when it has none (Heading, Quote). */
  text?: string;
}

const BUTTONS: ToolbarButton[] = [
  { action: "heading", label: "Heading", text: "H" },
  { action: "bold", label: "Bold (Ctrl+B)", icon: "Bold" },
  { action: "italic", label: "Italic (Ctrl+I)", icon: "Italic" },
  { action: "quote", label: "Quote", text: "“" },
  { action: "code", label: "Code (Ctrl+E)", icon: "Code" },
  { action: "link", label: "Link (Ctrl+K)", icon: "Link" },
  { action: "bulletList", label: "Bulleted list", icon: "BulletedList" },
  { action: "numberedList", label: "Numbered list", icon: "NumberedList" },
  { action: "taskList", label: "Task list", icon: "CheckList" },
];
const SUGGESTION: ToolbarButton = { action: "suggestion", label: "Add a suggestion", icon: "Lightbulb" };

export interface CommentBoxProps {
  value: string;
  set: (v: string) => void;
  label: string;
  placeholder: string;
  disabled?: boolean;
  /** Ctrl+Enter. */
  submit: () => void;
  /** "owner/name": where @mentions are searched. */
  repo: string;
  /** People already in the conversation, ranked first in the @mention list. */
  participants?: string[];
  /** The lines this comment is on: when given, the toolbar gets a Suggestion button that quotes them. */
  originalLines?: string[];
  /** One line until it is focused or holds text (the Overview composers); false keeps it open (a dialog, an edit box). */
  collapsible?: boolean;
  rows?: number;
  autoFocus?: boolean;
  /** Native's New pull request layout: the text first, then `footer` (counter, hints), then the toolbar. */
  toolbarBelow?: boolean;
  footer?: React.ReactNode;
}

let boxSerial = 0;

export function CommentBox({ value, set, label, placeholder, disabled = false, submit, repo, participants, originalLines, collapsible = false, rows = 4, autoFocus, toolbarBelow = false, footer }: CommentBoxProps) {
  const ta = React.useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [within, setWithin] = React.useState(false);
  const open = !collapsible || within || !!value;
  const id = React.useRef(`gh-mention-${++boxSerial}`).current;

  // Selection to restore after the next render of a controlled value.
  const pendingSel = React.useRef<{ start: number; end: number } | null>(null);
  React.useLayoutEffect(() => {
    const s = pendingSel.current;
    if (s && ta.current) {
      pendingSel.current = null;
      ta.current.focus();
      ta.current.setSelectionRange(s.start, s.end);
    }
  }, [value]);

  const run = (action: ToolbarAction) => {
    const el = ta.current;
    if (!el || disabled) return;
    try {
      const r = applyToolbar(action, value, el.selectionStart, el.selectionEnd, { originalLines });
      pendingSel.current = { start: r.selStart, end: r.selEnd };
      set(r.value);
    } catch {
      /* the suggestion button without lines: nothing to insert */
    }
  };

  // ---- @mentions ----
  const [match, setMatch] = React.useState<MentionMatch | null>(null);
  const [found, setFound] = React.useState<Candidate[]>([]);
  const [active, setActive] = React.useState(0);
  const dismissed = React.useRef(-1);
  const cache = React.useRef(new Map<string, Candidate[]>());
  const org = repo.split("/")[0];

  const track = () => {
    const el = ta.current;
    const m = el && el.selectionStart === el.selectionEnd ? detectMention(el.value, el.selectionStart) : null;
    setMatch(m && m.start !== dismissed.current ? m : null);
  };
  const query = match?.query ?? null;
  React.useEffect(() => {
    if (query === null) return;
    const term = query.includes("/") ? query.slice(query.indexOf("/") + 1) : query;
    const hit = cache.current.get(term);
    if (hit) return setFound(hit);
    let dead = false;
    const t = setTimeout(() => {
      searchReviewers(repo, term).then(
        (c) => {
          cache.current.set(term, c);
          if (!dead) setFound(c);
        },
        () => !dead && setFound([])
      );
    }, 150);
    return () => { dead = true; clearTimeout(t); };
  }, [query, repo]);
  const ranked = React.useMemo(() => (query === null ? [] : rankMentions(found, query, { participants, org })), [found, query, participants, org]);
  React.useEffect(() => setActive(0), [query]);
  const listOpen = !!match && ranked.length > 0;

  const choose = (c: Candidate) => {
    if (!match) return;
    const r = insertMention(value, match, mentionHandle(c, org));
    pendingSel.current = { start: r.caret, end: r.caret };
    setMatch(null);
    set(r.value);
  };

  // The textarea is the combobox: keep its aria in step with the list.
  React.useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.setAttribute("aria-autocomplete", "list");
    if (listOpen) {
      el.setAttribute("aria-controls", id);
      el.setAttribute("aria-activedescendant", `${id}-${active}`);
    } else {
      el.removeAttribute("aria-controls");
      el.removeAttribute("aria-activedescendant");
    }
  }, [listOpen, active, id]);

  const buttons = originalLines?.length ? [...BUTTONS, SUGGESTION] : BUTTONS;
  const toolbar = (
    <div className={`gh-md-toolbar flex-row flex-center${toolbarBelow ? " gh-md-toolbar-below" : ""}`} role="toolbar" aria-label="Formatting" onMouseDown={(e) => e.preventDefault() /* keep the selection and focus in the text */}>
      {buttons.map((b) => (
        <Button
          key={b.action}
          subtle
          className="gh-md-button"
          iconProps={b.icon ? { iconName: b.icon } : undefined}
          text={b.text}
          ariaLabel={b.label}
          tooltipProps={{ text: b.label }}
          disabled={disabled}
          onClick={() => run(b.action)}
        />
      ))}
    </div>
  );
  return (
    <div
      className={`gh-box flex-column flex-grow ${open ? "gh-box-open" : ""}`}
      onFocus={() => setWithin(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setWithin(false)}
    >
      {open && !toolbarBelow && toolbar}
      <TextField
        containerClassName="gh-feed-field flex-grow"
        inputElement={ta}
        multiline
        rows={open ? rows : 1}
        resizable={false}
        value={value}
        placeholder={placeholder}
        ariaLabel={label}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(_e, v) => { set(v); requestAnimationFrame(track); }}
        onKeyUp={(e) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) track(); }}
        onClick={track}
        onKeyDown={(e) => {
          if (listOpen) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : ranked.length - 1)) % ranked.length);
              return;
            }
            if ((e.key === "Enter" || e.key === "Tab") && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
              e.preventDefault();
              choose(ranked[Math.min(active, ranked.length - 1)]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              dismissed.current = match!.start;
              setMatch(null);
              return;
            }
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
            return;
          }
          const action = shortcutAction(e);
          if (action) {
            e.preventDefault();
            run(action);
          }
        }}
      />
      {listOpen && (
        // Hand-rolled: azure-devops-ui has no suggestion list that follows a caret inside a textarea. It sits in the flow under the box so it
        // also grows an inline diff zone, which would clip a floating list.
        <ul className="gh-mention-list" id={id} role="listbox" aria-label="People and teams">
          {ranked.map((c, i) => (
            <li
              key={`${c.kind}:${c.login}`}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`gh-mention-item flex-row flex-center ${i === active ? "gh-mention-active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); choose(c); }}
              onMouseEnter={() => setActive(i)}
            >
              {c.avatarUrl ? <VssPersona imageUrl={c.avatarUrl} displayName={c.login} size="extra-small" suppressPersonaCard showInitialsOnImageError /> : <span className="gh-mention-team" aria-hidden="true">@</span>}
              <span className="font-weight-semibold">{c.kind === "team" ? `${org}/${c.login}` : c.login}</span>
              {c.name && c.name !== c.login && <span className="secondary-text text-ellipsis">{c.name}</span>}
              {c.kind === "team" && <span className="secondary-text">Team</span>}
            </li>
          ))}
        </ul>
      )}
      {toolbarBelow && footer}
      {open && toolbarBelow && toolbar}
      <span className="screen-reader-only" role="status">{listOpen ? `${ranked.length} ${ranked.length === 1 ? "match" : "matches"}. Use the arrow keys, then Enter or Tab to insert.` : ""}</span>
    </div>
  );
}

// The path bar of the right pane: folder icon + breadcrumb, which turns into a find-file box on click or "t".
import * as React from "react";
import { Link } from "azure-devops-ui/Link";
import { SuggestionsList } from "azure-devops-ui/SuggestionsList";
import { TextField, TextFieldStyle, TextFieldWidth } from "azure-devops-ui/TextField";
import { getSafeId } from "azure-devops-ui/Util";
import { FolderOutlineIcon } from "./fileIcons";
import { fuzzyFind } from "./lib/fuzzy";

export interface Crumb {
  text: string;
  href?: string;
  onClick?: (e?: React.MouseEvent | React.KeyboardEvent) => void;
}

const Highlighted = ({ path, indices }: { path: string; indices: number[] }) => {
  const hit = new Set(indices);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < path.length; ) {
    const on = hit.has(i);
    let j = i;
    while (j < path.length && hit.has(j) === on) j++;
    out.push(on ? <b key={i}>{path.slice(i, j)}</b> : path.slice(i, j));
    i = j;
  }
  return <>{out}</>;
};

export function FindBox({ crumbs, paths, partial, onPick }: { crumbs: Crumb[]; paths: string[]; partial: boolean; onPick: (path: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(0);
  const input = React.useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const start = React.useCallback(() => {
    setQ("");
    setSel(0);
    setOpen(true);
  }, []);
  React.useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  // "t" opens the finder from anywhere that isn't a text field or the code viewer.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "t" || e.ctrlKey || e.metaKey || e.altKey || el?.closest("input, textarea, select, [contenteditable], .monaco-editor")) return;
      e.preventDefault();
      start();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [start]);

  // ponytail: re-ranks synchronously on each keystroke; fine for tens of thousands of paths, debounce or index if a huge repo lags.
  const hits = React.useMemo(() => (open ? fuzzyFind(paths, q) : []), [open, paths, q]);
  const pick = (path: string) => {
    setOpen(false);
    input.current?.blur();
    onPick(path);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return void (setOpen(false), input.current?.blur());
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : hits.length - 1; // read the event now: React 16 recycles it before an updater runs
      if (hits.length) setSel((s) => (s + step) % hits.length);
    } else if (e.key === "Enter" && hits[sel]) {
      e.preventDefault();
      pick(hits[sel].path);
    }
  };

  // At the root there is nothing to show as a path, so the (empty) field itself is the hint; focusing it starts a search.
  const field = open || crumbs.length === 0;
  return (
    <div className="gh-find flex-row flex-center flex-grow">
      <FolderOutlineIcon />
      <span className="gh-sep" aria-hidden="true">/</span>
      {field ? (
        <div className="gh-find-input flex-grow">
          <TextField
            inputElement={input}
            style={TextFieldStyle.inline}
            width={TextFieldWidth.auto}
            containerClassName="flex-grow"
            role="combobox"
            ariaLabel="Find a file or folder"
            ariaExpanded={hits.length > 0}
            ariaControls={getSafeId("suggestion-list")}
            ariaActiveDescendant={hits[sel] ? getSafeId(`sug-row-${sel}`) : undefined}
            ariaAutoComplete="list"
            placeholder="Type to find a file or folder..."
            value={open ? q : ""}
            onFocus={() => !open && start()}
            onChange={(_e, v) => {
              setQ(v);
              setSel(0);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setOpen(false)}
          />
          {open && q.trim() && (
            <div className="gh-find-pop depth-16">
              {partial && <div className="gh-find-note">Searching only the folders loaded so far. Expand folders in the tree to include them.</div>}
              <SuggestionsList
                suggestions={hits}
                selectedIndex={sel}
                suggestionsContainerAriaLabel="Matching files and folders"
                noResultsFoundText="No matching files or folders"
                onSuggestionClicked={(s) => pick(s.item.path)}
                renderSuggestion={({ item }) => (
                  <span className="text-ellipsis"><Highlighted path={item.path} indices={item.indices} /></span>
                )}
              />
            </div>
          )}
        </div>
      ) : (
        // The empty space after the crumbs is the click target that starts a search; the crumbs themselves are real links.
        <div className="gh-crumbs flex-row flex-center flex-grow" onClick={(e) => e.target === e.currentTarget && start()}>
          {crumbs.map((c, i) => (
            <React.Fragment key={c.text + (c.href ?? "")}>
              {i > 0 && <span className="gh-sep" aria-hidden="true">/</span>}
              {c.href ? <Link href={c.href} onClick={c.onClick} subtle removeUnderline>{c.text}</Link> : <span className="gh-crumb-last">{c.text}</span>}
            </React.Fragment>
          ))}
          <button type="button" className="gh-find-hint flex-grow" onClick={start} aria-label="Find a file or folder" />
        </div>
      )}
    </div>
  );
}

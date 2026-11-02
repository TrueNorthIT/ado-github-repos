// The path bar of the right pane: folder icon + breadcrumb, which turns into a find-file box on click or "t".
import * as React from "react";
import { Link } from "azure-devops-ui/Link";
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
  const input = React.useRef<HTMLInputElement>(null);

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
    onPick(path);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : hits.length - 1; // read the event now: React 16 recycles it before an updater runs
      if (hits.length) setSel((s) => (s + step) % hits.length);
    } else if (e.key === "Enter" && hits[sel]) {
      e.preventDefault();
      pick(hits[sel].path);
    }
  };

  return (
    <div className="gh-find">
      <FolderOutlineIcon />
      {open ? (
        <div className="gh-find-input">
          <span className="gh-sep" aria-hidden="true">/</span>
          <input
            ref={input}
            role="combobox"
            aria-label="Find a file or folder"
            aria-expanded={hits.length > 0}
            aria-controls="gh-find-list"
            aria-activedescendant={hits[sel] ? `gh-find-${sel}` : undefined}
            aria-autocomplete="list"
            placeholder="Type to find a file or folder…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setOpen(false)}
          />
          {q.trim() && (
            <div className="gh-find-pop">
              {partial && <div className="gh-find-note">Searching only the folders loaded so far. Expand folders in the tree to include them.</div>}
              {hits.length ? (
                <ul id="gh-find-list" role="listbox" aria-label="Matching files and folders">
                  {hits.map((h, i) => (
                    // mousedown (not click) so the input's blur doesn't close the list first
                    <li key={h.path} id={`gh-find-${i}`} role="option" aria-selected={i === sel} className={i === sel ? "selected" : undefined} onMouseDown={(e) => { e.preventDefault(); pick(h.path); }} onMouseMove={() => setSel(i)}>
                      <Highlighted path={h.path} indices={h.indices} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="gh-find-note" role="status">No matching files or folders</div>
              )}
            </div>
          )}
        </div>
      ) : (
        // The empty space after the crumbs is the click target that starts a search; the crumbs themselves are real links.
        <div className="gh-crumbs" onClick={(e) => e.target === e.currentTarget && start()}>
          {crumbs.length === 0 && (
            <button type="button" className="gh-find-hint" onClick={start}><span className="gh-sep">/</span> Type to find a file or folder…</button>
          )}
          {crumbs.map((c) => (
            <React.Fragment key={c.text + (c.href ?? "")}>
              <span className="gh-sep" aria-hidden="true">/</span>
              {c.href ? <Link href={c.href} onClick={c.onClick}>{c.text}</Link> : <span className="gh-crumb-last">{c.text}</span>}
            </React.Fragment>
          ))}
          {crumbs.length > 0 && <button type="button" className="gh-find-hint gh-find-fill" onClick={start} aria-label="Find a file or folder" />}
        </div>
      )}
    </div>
  );
}

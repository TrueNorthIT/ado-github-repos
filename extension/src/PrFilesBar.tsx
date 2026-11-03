// The PR Files toolbar and the file-tree filter (VW-2 to VW-6): layout, whitespace, "Show changes from", viewed progress, and the tree's filter box and menu.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Dropdown } from "azure-devops-ui/Dropdown";
import { DropdownExpandableButton } from "azure-devops-ui/Components/Dropdown/DropdownExpandableButton";
import { DropdownMultiSelection } from "azure-devops-ui/Utilities/DropdownSelection";
import { Icon, IconSize } from "azure-devops-ui/Icon";
import { ListBoxItemType, type IListBoxItem } from "azure-devops-ui/ListBox";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { Toggle } from "azure-devops-ui/Toggle";
import type { ChangesFrom, RangeContext } from "./lib/commitRange";
import { EMPTY_FILE_FILTER, isFilterActive, type FileFilter, type FileStatus } from "./lib/fileFilter";
import type { ViewedProgress } from "./lib/viewedFiles";

// ---------- the tree's filter box and menu (VW-5) ----------

const STATUSES: { id: FileStatus; text: string }[] = [
  { id: "added", text: "Added" },
  { id: "modified", text: "Modified" },
  { id: "removed", text: "Removed" },
  { id: "renamed", text: "Renamed" },
];
const extOf = (path: string) => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i).toLowerCase() : "";
};

/** A filter box over the file tree and a multi-select menu of statuses and extensions. The menu is a Dropdown with its own selection, so choosing an item never re-creates it. */
export function TreeFilter({ files, filter, onChange }: { files: { path: string }[]; filter: FileFilter; onChange: (f: FileFilter) => void }) {
  const exts = React.useMemo(() => [...new Set(files.map((f) => extOf(f.path)).filter(Boolean))].sort(), [files]);
  const items = React.useMemo<IListBoxItem<string>[]>(
    () => [
      { id: "h-status", text: "Status", type: ListBoxItemType.Header },
      ...STATUSES.map((s) => ({ id: `status:${s.id}`, text: s.text })),
      ...(exts.length ? [{ id: "h-ext", text: "File type", type: ListBoxItemType.Header }, ...exts.map((e) => ({ id: `ext:${e}`, text: e }))] : []),
    ],
    [exts]
  );
  const selection = React.useMemo(() => new DropdownMultiSelection(), []);
  const current = React.useRef(filter);
  current.current = filter;
  const sync = () => {
    const ids: string[] = [];
    for (const r of selection.value) for (let i = r.beginIndex; i <= r.endIndex; i++) ids.push(String(items[i]?.id));
    onChange({
      ...current.current,
      statuses: ids.filter((i) => i.startsWith("status:")).map((i) => i.slice(7) as FileStatus),
      extensions: ids.filter((i) => i.startsWith("ext:")).map((i) => i.slice(4)),
    });
  };
  const count = filter.statuses.length + filter.extensions.length;
  return (
    <div className="gh-tree-filter flex-row flex-center">
      <TextField
        containerClassName="gh-tree-filter-box" /* TextField wraps the box in a flex-column; size that, or the box stretches tall */
        width={TextFieldWidth.auto}
        value={filter.query}
        onChange={(_e, v) => onChange({ ...filter, query: v })}
        placeholder="Filter files"
        ariaLabel="Filter changed files by path"
        prefixIconProps={{ iconName: "Filter" }}
        onKeyDown={(e) => { if (e.key === "Escape" && filter.query) onChange({ ...filter, query: "" }); }}
      />
      <Dropdown<string>
        key={exts.join("|")}
        className="gh-tree-filter-menu"
        ariaLabel={count ? `File filters: ${count} selected` : "File filters: status and file type"}
        items={items}
        selection={selection}
        onSelect={sync}
        showFilterBox={false}
        minCalloutWidth={200}
        dismissOnSelect={false}
        renderExpandable={(p) => <DropdownExpandableButton {...p} subtle iconProps={{ iconName: "FilterSolid", size: IconSize.medium }} text={count ? String(count) : undefined} />}
      />
      {isFilterActive(filter) && <Button subtle iconProps={{ iconName: "Cancel" }} ariaLabel="Clear file filters" tooltipProps={{ text: "Clear file filters" }} onClick={() => { selection.clear(); onChange(EMPTY_FILE_FILTER); }} />}
    </div>
  );
}

// ---------- "Show changes from" (VW-6) ----------

const short = (oid: string) => oid.slice(0, 7);

function ChangesFromPicker({ ctx, value, onChange }: { ctx: RangeContext; value: ChangesFrom; onChange: (v: ChangesFrom) => void }) {
  const items = React.useMemo<IListBoxItem<string>[]>(
    () => [
      { id: "all", text: "All changes" },
      ...(ctx.lastReviewedOid ? [{ id: "review", text: "Since your last review" }] : []),
      ...(ctx.commits.length > 1 ? [{ id: "range", text: "A range of commits" }] : []),
      { id: "h-commits", text: "Single commit", type: ListBoxItemType.Header },
      ...ctx.commits.map((c) => ({ id: `commit:${c.oid}`, text: `${short(c.oid)}  ${c.title}` })),
    ],
    [ctx]
  );
  const label =
    value.kind === "all" ? "All changes"
    : value.kind === "sinceReview" ? "Since your last review"
    : value.kind === "range" ? "A range of commits"
    : `Commit ${short(value.oid)}`;
  const first = ctx.commits[0]?.oid, last = ctx.commits[ctx.commits.length - 1]?.oid;
  const commitItems = ctx.commits.map((c) => ({ id: c.oid, text: `${short(c.oid)}  ${c.title}` }));
  const text = (oid: string) => `${short(oid)}  ${ctx.commits.find((c) => c.oid === oid)?.title ?? ""}`;
  return (
    <>
      <span className="gh-bar-label secondary-text" id="gh-changes-from-label">Show changes from</span>
      <Dropdown<string>
        className="gh-changes-from"
        ariaLabelledBy="gh-changes-from-label"
        placeholder={label}
        items={items}
        showFilterBox={false}
        onSelect={(_e, item) => {
          const id = String(item.id);
          onChange(id === "all" ? { kind: "all" } : id === "review" ? { kind: "sinceReview" } : id === "range" ? { kind: "range", from: first, to: last } : { kind: "commit", oid: id.slice(7) });
        }}
        renderExpandable={(p) => <DropdownExpandableButton {...p} />}
      />
      {value.kind === "range" && (
        <>
          <Dropdown<string> className="gh-range-end" ariaLabel="Range: from commit" placeholder={text(value.from)} items={commitItems} showFilterBox={false} onSelect={(_e, item) => onChange({ ...value, from: String(item.id) })} renderExpandable={(p) => <DropdownExpandableButton {...p} />} />
          <Icon iconName="ChevronRightMed" size={IconSize.small} className="secondary-text" />
          <Dropdown<string> className="gh-range-end" ariaLabel="Range: to commit" placeholder={text(value.to)} items={commitItems} showFilterBox={false} onSelect={(_e, item) => onChange({ ...value, to: String(item.id) })} renderExpandable={(p) => <DropdownExpandableButton {...p} />} />
        </>
      )}
    </>
  );
}

// ---------- the toolbar ----------

export interface FilesBarProps {
  count: number;
  shown: number;
  /** Absent until the commits are known (or when the page has none to offer). */
  range?: { ctx: RangeContext; value: ChangesFrom; onChange: (v: ChangesFrom) => void };
  sideBySide: boolean;
  setSideBySide: (v: boolean) => void;
  ignoreWhitespace: boolean;
  setIgnoreWhitespace: (v: boolean) => void;
  progress?: ViewedProgress;
}

export function FilesBar(p: FilesBarProps) {
  return (
    <div className="gh-pr-files-bar flex-row flex-center flex-wrap body-m">
      <span className="gh-changed-count" role="status">{p.shown === p.count ? `${p.count} changed ${p.count === 1 ? "file" : "files"}` : `${p.shown} of ${p.count} changed files`}</span>
      {p.range && <ChangesFromPicker {...p.range} />}
      <span className="flex-grow" />
      {p.progress && <span className="gh-viewed-progress secondary-text" role="status">{p.progress.text}</span>}
      <Toggle className="gh-ws-toggle" text="Ignore whitespace" checked={p.ignoreWhitespace} onChange={(_e, v) => p.setIgnoreWhitespace(v)} />
      <Dropdown<string>
        ariaLabel={`Diff layout: ${p.sideBySide ? "Side-by-side" : "Inline"}`}
        className="gh-layout-picker"
        placeholder={p.sideBySide ? "Side-by-side" : "Inline"}
        items={[{ id: "side", text: "Side-by-side", iconProps: { iconName: "DiffSideBySide" } }, { id: "inline", text: "Inline", iconProps: { iconName: "DiffInline" } }]}
        onSelect={(_e, item) => p.setSideBySide(item.id === "side")}
        renderExpandable={(x) => <DropdownExpandableButton {...x} iconProps={{ iconName: p.sideBySide ? "DiffSideBySide" : "DiffInline", size: IconSize.medium }} />}
      />
    </div>
  );
}

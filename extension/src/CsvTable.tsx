// CSV and TSV files as azure-devops-ui Tables: the Files hub's Preview tab (CsvPreview) and the "Rendered" view of a changed file in a
// PR or commit diff (CsvDiff). Parsing and the row diff are pure (lib/csv.ts); the Table virtualises its rows, so 5,000 rows stay quick.
import * as React from "react";
import { ColumnFill, ITableColumn, ITableRowDetails, SimpleTableCell, Table, TableRow, renderColumns } from "azure-devops-ui/Table";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { MAX_TABLE_ROWS, columnCount, columnWidth, diffColumnWidth, diffTables, parseTable, tableDelimiter, type RowChange } from "./lib/csv";
import { BINARY_NOTICE, MAX_DIFF_BYTES } from "./lib/richDiff";
import { getRaw } from "./githubBrowse";
import type { PrFile } from "./lib/prFiles";
import type { DiffCtx } from "./PrFiles";

const fmt = (n: number) => n.toLocaleString("en-GB");
const truncatedNote = (shown: number, total: number) => `Showing the first ${fmt(shown)} of ${fmt(total)} rows.`;

/** Header names: the first record's cells, or the column number where it is short (ragged files). */
const headerNames = (header: string[] | undefined, width: number) => Array.from({ length: width }, (_, c) => header?.[c] || `Column ${c + 1}`);

type PreviewRow = { n: number; cells: string[] };

/** The Preview tab of a .csv or .tsv file: the first record is the header row, then up to MAX_TABLE_ROWS records. */
export function CsvPreview({ text, path }: { text: string; path: string }) {
  const parsed = React.useMemo(() => parseTable(text, tableDelimiter(path) ?? ",", MAX_TABLE_ROWS + 1), [text, path]);
  const [header, ...body] = parsed.rows;
  const rows = body.slice(0, MAX_TABLE_ROWS);
  const width = columnCount(parsed.rows);
  const provider = React.useMemo(() => new ArrayItemProvider<PreviewRow>(rows.map((cells, i) => ({ n: i + 1, cells }))), [parsed]); // eslint-disable-line react-hooks/exhaustive-deps -- rows derives from parsed
  const columns = React.useMemo<ITableColumn<PreviewRow>[]>(() => {
    const names = headerNames(header, width);
    return [
      { id: "n", name: "", ariaLabel: "Row", width: 56, renderCell: (_r, ci, col, item) => <SimpleTableCell key="n" columnIndex={ci} tableColumn={col} className="gh-csv-n secondary-text">{item.n}</SimpleTableCell> },
      ...names.map<ITableColumn<PreviewRow>>((name, c) => ({
        id: `c${c}`,
        name,
        width: columnWidth(rows, c, name),
        renderCell: (_r, ci, col, item) => <SimpleTableCell key={`c${c}`} columnIndex={ci} tableColumn={col}><span className="text-ellipsis" title={item.cells[c]}>{item.cells[c] ?? ""}</span></SimpleTableCell>,
      })),
      ColumnFill as unknown as ITableColumn<PreviewRow>,
    ];
  }, [parsed]); // eslint-disable-line react-hooks/exhaustive-deps -- header, width and rows derive from parsed
  if (!parsed.rows.length) return <div className="gh-csv-empty secondary-text">This file is empty.</div>;
  const total = Math.max(0, parsed.total - 1);
  return (
    <div className="gh-csv flex-column">
      {total > rows.length && <MessageCard className="gh-csv-note" severity={MessageCardSeverity.Info}>{truncatedNote(rows.length, total)} Open Contents for the whole file.</MessageCard>}
      <Table<PreviewRow> className="gh-csv-table" containerClassName="gh-csv-scroll" ariaLabel={`${path} as a table`} role="table" columns={columns} itemProvider={provider} selectableText showLines />
    </div>
  );
}

// ---------- the table diff ----------

type DiffRow = RowChange & { header?: boolean };
type Load = { t: "wait" } | { t: "cant"; why: string } | { t: "ok"; before: string | null; after: string | null };

async function readSide(repo: string, sha: string | null, path: string | null): Promise<string | null> {
  if (!sha || !path) return null;
  const buf = await getRaw(repo, sha, path);
  if (buf.byteLength > MAX_DIFF_BYTES) throw new Error(BINARY_NOTICE);
  return new TextDecoder().decode(buf);
}

const rowNumber = (r: DiffRow, side: "old" | "new") => {
  const i = side === "old" ? ("oldIndex" in r ? r.oldIndex : undefined) : "newIndex" in r ? r.newIndex : undefined;
  return i === undefined || i === 0 ? "" : String(i); // data rows count from 1, as in the Preview tab; the header has no number
};

function DiffCell({ r, c }: { r: DiffRow; c: number }) {
  if (r.kind === "changed" && r.changed.includes(c))
    return (
      <span className="gh-csv-change text-ellipsis" title={`${r.oldCells[c] ?? ""} → ${r.cells[c] ?? ""}`}>
        {(r.oldCells[c] ?? "") !== "" && <del className="gh-csv-old">{r.oldCells[c]}</del>}
        <ins className="gh-csv-new">{r.cells[c] ?? ""}</ins>
      </span>
    );
  return <span className="text-ellipsis" title={r.cells[c]}>{r.cells[c] ?? ""}</span>;
}

/** A changed .csv/.tsv as a table diff: rows matched by an LCS, added rows green, removed rows red, edited cells marked. The header row shows in the body only when it changed. */
export function CsvDiff({ file, repo, pr }: { file: PrFile; repo: string; pr: DiffCtx }) {
  const [load, setLoad] = React.useState<Load>({ t: "wait" });
  React.useEffect(() => {
    let dead = false;
    setLoad({ t: "wait" });
    const beforePath = file.changeType === "ADDED" ? null : file.previousPath ?? file.path;
    const afterPath = file.changeType === "DELETED" ? null : file.path;
    Promise.all([readSide(repo, pr.baseSha, beforePath), readSide(repo, pr.headSha, afterPath)]).then(
      ([before, after]) => !dead && setLoad({ t: "ok", before, after }),
      (e) => !dead && setLoad({ t: "cant", why: e instanceof Error && e.message === BINARY_NOTICE ? BINARY_NOTICE : "Could not load this file." })
    );
    return () => { dead = true; };
  }, [repo, file, pr.baseSha, pr.headSha]);

  const delim = tableDelimiter(file.path) ?? ",";
  const model = React.useMemo(() => {
    if (load.t !== "ok") return null;
    const a = load.before === null ? null : parseTable(load.before, delim, MAX_TABLE_ROWS + 1);
    const b = load.after === null ? null : parseTable(load.after, delim, MAX_TABLE_ROWS + 1);
    const rows: DiffRow[] = diffTables(a?.rows ?? [], b?.rows ?? []);
    // The header row is the Table's own header; it stays in the body, marked, only when it changed.
    if (rows.length && ("newIndex" in rows[0] ? rows[0].newIndex === 0 : rows[0].oldIndex === 0)) {
      if (rows[0].kind === "same") rows.shift();
      else rows[0] = { ...rows[0], header: true };
    }
    const width = Math.max(columnCount(a?.rows ?? []), columnCount(b?.rows ?? []));
    const truncated = !!(a?.truncated || b?.truncated);
    return { rows, width, truncated, names: headerNames((b ?? a)?.rows[0], width) };
  }, [load, delim]);

  const provider = React.useMemo(() => new ArrayItemProvider<DiffRow>(model?.rows ?? []), [model]);
  const columns = React.useMemo<ITableColumn<DiffRow>[]>(() => {
    if (!model) return [];
    const num = (side: "old" | "new"): ITableColumn<DiffRow> => ({
      id: side, name: "", ariaLabel: side === "old" ? "Row before" : "Row after", width: 48,
      renderCell: (_r, ci, col, item) => <SimpleTableCell key={side} columnIndex={ci} tableColumn={col} className="gh-csv-n secondary-text">{rowNumber(item, side)}</SimpleTableCell>,
    });
    return [
      num("old"),
      num("new"),
      ...model.names.map<ITableColumn<DiffRow>>((name, c) => ({
        id: `c${c}`, name, width: diffColumnWidth(model.rows, c, name),
        renderCell: (_r, ci, col, item) => <SimpleTableCell key={`c${c}`} columnIndex={ci} tableColumn={col} className={item.kind === "changed" && item.changed.includes(c) ? "gh-csv-cell-changed" : undefined}><DiffCell r={item} c={c} /></SimpleTableCell>,
      })),
      ColumnFill as unknown as ITableColumn<DiffRow>,
    ];
  }, [model]);
  const renderRow = React.useCallback(
    (index: number, item: DiffRow, details: ITableRowDetails<DiffRow>) => (
      <TableRow<DiffRow> key={index} index={index} details={details} className={`gh-csv-${item.kind}${item.header ? " gh-csv-header-row" : ""}`}>
        {renderColumns(index, columns, item, details)}
      </TableRow>
    ),
    [columns]
  );

  if (load.t === "wait") return <div className="gh-pr-diff-note flex-row justify-center"><Spinner size={SpinnerSize.small} ariaLabel="Loading the table" /></div>;
  if (load.t === "cant") return <div className="gh-pr-diff-note secondary-text" role="status">{load.why}</div>;
  if (!model || !model.rows.length) return <div className="gh-pr-diff-note secondary-text" role="status">Both versions are empty.</div>;
  return (
    <div className="gh-pr-diff gh-csv gh-csv-diff flex-column">
      {model.truncated && <MessageCard className="gh-csv-note" severity={MessageCardSeverity.Info}>Only the first {fmt(MAX_TABLE_ROWS)} rows of each version are compared. The Source view has the whole diff.</MessageCard>}
      <Table<DiffRow> className="gh-csv-table" containerClassName="gh-csv-scroll" ariaLabel={`Table diff of ${file.path}`} role="table" columns={columns} itemProvider={provider} renderRow={renderRow} selectableText showLines />
    </div>
  );
}

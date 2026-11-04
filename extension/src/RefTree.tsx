// A table of refs grouped into collapsible folders by "/" (Branches and Tags): azure-devops-ui's Tree with several columns.
import * as React from "react";
import { Link } from "azure-devops-ui/Link";
import { SimpleTableCell, Table, TableColumnLayout, type ITableColumn } from "azure-devops-ui/Table";
import { Tree, ExpandableTreeCell, ITreeColumn } from "azure-devops-ui/TreeEx";
import { ITreeItem, TreeItemProvider } from "azure-devops-ui/Utilities/TreeItemProvider";
import type { RefLeaf, RefNode } from "./lib/branches";
import { FileIcon } from "./fileIcons";
import { skeletonRows } from "./RepoHub";

export interface RefColumn<T> {
  id: string;
  name: string;
  width: number;
  /** Cell content of a ref row. Folder rows leave these cells empty. */
  render: (leaf: RefLeaf<T>) => React.ReactNode;
}

const toItem = <T,>(n: RefNode<T>, collapsed: ReadonlySet<string>): ITreeItem<RefNode<T>> =>
  n.kind === "folder"
    ? { id: `folder:${n.path}`, data: n, expanded: !collapsed.has(n.path), childItems: n.children.map((c) => toItem(c, collapsed)) }
    : { id: `ref:${(n.item as unknown as { name: string }).name}`, data: n };

export function RefTree<T extends { name: string }>({ nodes, columns, name, nameCell, collapsed, toggleFolder, label, onOpen, loading }: {
  nodes: RefNode<T>[];
  columns: RefColumn<T>[];
  /** Header of the first (hierarchical) column. */
  name: string;
  /** The first column of a ref row: icon, link and any pills. */
  nameCell: (leaf: RefLeaf<T>) => React.ReactNode;
  collapsed: ReadonlySet<string>;
  toggleFolder: (path: string) => void;
  label: string;
  /** Activating (clicking) a ref row. */
  onOpen: (item: T) => void;
  /** Shimmer rows in the same columns (a Table: Tree has no loading rows), until the refs arrive. */
  loading?: boolean;
}) {
  const cols = React.useMemo<ITreeColumn<RefNode<T>>[]>(
    () => [
      {
        id: "name",
        name,
        width: -100,
        hierarchical: true,
        renderCell: (_r, columnIndex, treeColumn, treeItem) => {
          const n = treeItem.underlyingItem.data;
          return (
            <ExpandableTreeCell key="name" columnIndex={columnIndex} treeColumn={treeColumn} treeItem={treeItem}>
              {n.kind === "folder" ? (
                <>
                  <span className="gh-entry-icon"><FileIcon name={n.name} kind="folder" /></span>
                  <Link className="bolt-table-link text-ellipsis" subtle removeUnderline role="presentation" excludeTabStop>{n.name}</Link>
                </>
              ) : (
                nameCell(n)
              )}
            </ExpandableTreeCell>
          );
        },
      },
      ...columns.map<ITreeColumn<RefNode<T>>>((c) => ({
        id: c.id,
        name: c.name,
        width: c.width,
        renderCell: (_r, columnIndex, treeColumn, treeItem) => {
          const n = treeItem.underlyingItem.data;
          return (
            <SimpleTableCell key={c.id} columnIndex={columnIndex} tableColumn={treeColumn}>
              {n.kind === "ref" ? c.render(n) : null}
            </SimpleTableCell>
          );
        },
      })),
    ],
    [columns, name, nameCell]
  );
  // A new provider whenever the cells change too: Tree rows don't re-render for new columns alone, so a lock (or any state a cell reads)
  // arriving after the rows rendered was sometimes never shown.
  const provider = React.useMemo(() => new TreeItemProvider<RefNode<T>>(nodes.map((n) => toItem(n, collapsed))), [nodes, collapsed, cols]);
  const skeletonCols = React.useMemo<ITableColumn<object>[]>(
    () => [
      { id: "name", name, width: -100, columnLayout: TableColumnLayout.singleLinePrefix, renderCell: () => null as never },
      ...columns.map<ITableColumn<object>>((c) => ({ id: c.id, name: c.name, width: c.width, columnLayout: c.name ? TableColumnLayout.singleLine : TableColumnLayout.none, renderCell: () => null as never })),
    ],
    [columns, name]
  );
  if (loading) return <Table<object> ariaLabel={`Loading ${label.toLowerCase()}`} className="gh-ref-tree" columns={skeletonCols} itemProvider={skeletonRows<object>()} role="table" spacerWidth={8} />;
  return (
    <Tree<RefNode<T>>
      ariaLabel={label}
      className="gh-ref-tree"
      columns={cols}
      itemProvider={provider as any}
      onToggle={(_e, ex) => {
        const n = (ex.underlyingItem as ITreeItem<RefNode<T>>).data;
        if (n.kind === "folder") toggleFolder(n.path);
      }}
      onActivate={(_e, row) => {
        const n = row.data.underlyingItem.data;
        if (n.kind === "folder") toggleFolder(n.path);
        else onOpen(n.item);
      }}
      singleClickActivation
      showHeader
      showLines={false}
      role="treegrid"
    />
  );
}

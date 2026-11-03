// One row of the Commits Graph column, drawn as SVG from computeGraph's lanes (native draws a canvas per row). No azure-devops-ui component draws a commit graph.
import * as React from "react";
import type { GraphRow } from "./lib/commitGraph";

export const ROW_H = 61;
const LANE_W = 12;
const X0 = 21;
const R = 4;

/** Width in px of the Graph column for a layout `lanes` wide. */
export const graphWidth = (lanes: number) => Math.max(96, X0 + lanes * LANE_W + 16);

const BLUE = "var(--communication-background, #0078d4)";
const GREY = "var(--palette-neutral-60, rgba(110, 110, 110, 1))";
const x = (lane: number) => X0 + lane * LANE_W;
const colour = (lane: number) => (lane === 0 ? BLUE : GREY);

/** Blue on the first-parent lane (lane 0), grey for the others, as native. */
export function GraphCell({ row, lanes }: { row: GraphRow; lanes: number }) {
  const mid = ROW_H / 2;
  const w = graphWidth(lanes);
  const stroke = { strokeWidth: 1.5, fill: "none" as const };
  // A curve from the dot down to (lane, bottom edge): cubic with vertical tangents at both ends.
  const curve = (to: number) => `M${x(row.lane)} ${mid} C${x(row.lane)} ${mid + 18}, ${x(to)} ${ROW_H - 18}, ${x(to)} ${ROW_H}`;
  return (
    <svg className="gh-graph" width={w} height={ROW_H} viewBox={`0 0 ${w} ${ROW_H}`} aria-hidden="true" focusable="false">
      {row.lines.map((l) => <line key={`l${l}`} x1={x(l)} x2={x(l)} y1={0} y2={ROW_H} stroke={colour(l)} {...stroke} />)}
      {row.top && <line x1={x(row.lane)} x2={x(row.lane)} y1={0} y2={mid} stroke={colour(row.lane)} {...stroke} />}
      {row.bottom && <line x1={x(row.lane)} x2={x(row.lane)} y1={mid} y2={ROW_H} stroke={colour(row.lane)} {...stroke} />}
      {row.merges.map((m) => <path key={`m${m}`} d={curve(m)} stroke={colour(m)} {...stroke} />)}
      {row.branches.map((b) => <path key={`b${b}`} d={curve(b)} stroke={colour(row.lane)} {...stroke} />)}
      <circle cx={x(row.lane)} cy={mid} r={R} fill={colour(row.lane)} />
    </svg>
  );
}

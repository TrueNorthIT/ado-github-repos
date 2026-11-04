// VW-12: the row in a collapsed run of unchanged lines (rendered into a Monaco view zone by PrFiles). A small run opens whole with
// one click; a larger one offers 20 more above, 20 more below and all, as GitHub does. Subtle azure-devops-ui Buttons, so the row
// reads like native ADO's own expand controls and each action is a real, focusable button.
import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { actionLabel, type ExpandAction } from "./lib/contextRegions";
import type { ContextRow as Row } from "./monacoChunk";

const ICON: Record<ExpandAction, string> = { above: "ChevronUp", below: "ChevronDown", all: "ChevronUnfold10" };

export function ContextRow({ row }: { row: Row }) {
  const one = row.actions.length === 1;
  return (
    <div
      className={`gh-context-row flex-row flex-center${one ? " gh-context-row-one" : ""}`}
      role="group"
      aria-label={`${row.hidden} unchanged ${row.hidden === 1 ? "line" : "lines"} hidden`}
      // The whole row is the target for a small run (the Button inside stays the keyboard path).
      onClick={one ? (e) => { if (!(e.target as Element).closest("button")) row.run("all"); } : undefined}
    >
      {row.actions.map((a) => (
        <Button key={a} className="gh-context-action" subtle iconProps={{ iconName: ICON[a] }} text={actionLabel(a, row.hidden)} onClick={() => row.run(a)} />
      ))}
      {!one && <span className="gh-context-count secondary-text body-s">{row.hidden} hidden lines</span>}
    </div>
  );
}

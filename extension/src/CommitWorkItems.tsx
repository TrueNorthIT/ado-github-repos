// AB#123 work item mentions in commit messages: pills on the Commits list rows, links in the commit detail's message (C-1, C-3). The lookups are
// PrPage's useWorkItems (one ADO call for every id on screen); the link works before, or without, that lookup, from the project context alone.
// Hovering a pill or link opens the work item's hover card (HoverCard.tsx), which replaced the one-line tooltip.
import * as React from "react";
import { Link } from "azure-devops-ui/Link";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { WorkItemHover } from "./HoverCard";
import { getProjectCtx } from "./connections";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import { WorkItemRow, useWorkItems } from "./PrPage";
import { splitWorkItemMentions } from "./lib/commitWorkItems";
import { workItemUrl, type WorkItemRef } from "./lib/workItems";

export interface WorkItemLinks {
  /** undefined until the project context is known. */
  url: (id: number) => string | undefined;
  /** The looked-up item, once ADO has answered. */
  item: (id: number) => WorkItemRef | undefined;
  /** The ADO lookup's state, for a full list (commit detail). */
  lookup: ReturnType<typeof useWorkItems>;
}

let ctx: Promise<{ org: string; project: string } | null> | undefined;
function useProjectCtx() {
  const [c, setC] = React.useState<{ org: string; project: string } | null>(null);
  React.useEffect(() => {
    let dead = false;
    (ctx ??= getProjectCtx().then((x) => ({ org: x.org, project: x.project }), () => ((ctx = undefined), null))).then((x) => !dead && setC(x));
    return () => { dead = true; };
  }, []);
  return c;
}

/** Links and details for the given ids (memoised on them, so a Table's columns can depend on it). */
export function useWorkItemLinks(ids: number[]): WorkItemLinks {
  const c = useProjectCtx();
  const wi = useWorkItems(ids);
  return React.useMemo(() => {
    const byId = new Map<number, WorkItemRef>((wi.t === "ready" ? wi.r.items : []).map((w) => [w.id, w]));
    return { url: (id) => (c ? workItemUrl(c.org, c.project, id) : undefined), item: (id) => byId.get(id), lookup: wi };
  }, [c, wi]);
}

/** The commit detail's Work items row: PrPage's rows (type, id, title link, state). */
export function CommitWorkItemList({ links }: { links: WorkItemLinks }) {
  const wi = links.lookup;
  if (wi.t === "loading") return <Spinner size={SpinnerSize.small} ariaLabel="Loading work items" />;
  if (wi.t === "denied") return <span className="secondary-text">Work items need the extension's work item permission.</span>;
  if (wi.t === "error") return <span className="secondary-text">Work items could not be loaded.</span>;
  return <ul className="gh-pr-list">{wi.r.items.map((w) => <WorkItemRow key={w.id} w={w} r={wi.r} />)}</ul>;
}

const describe = (id: number, w: WorkItemRef | undefined) =>
  !w ? `Work item ${id}` : !w.found ? `AB#${id}: not found or no access` : `${w.type ?? "Work item"} ${id}: ${w.title ?? ""}${w.state ? ` (${w.state})` : ""}`;

/** Compact pills, one per mentioned work item, each opening the item in a new tab. */
export function WorkItemPills({ ids, links }: { ids: number[]; links: WorkItemLinks }) {
  if (!ids.length) return null;
  return (
    <span className="gh-wi-pills flex-row flex-center">
      {ids.map((id) => {
        const label = describe(id, links.item(id));
        const pill = <Pill size={PillSize.compact} variant={PillVariant.outlined} iconProps={{ iconName: "WorkItem" }}>{`AB#${id}`}</Pill>;
        const url = links.url(id);
        return (
          <WorkItemHover key={id} id={id}>
            {url ? <Link className="gh-wi-pill-link" href={url} target="_blank" rel="noopener noreferrer" ariaLabel={label} subtle removeUnderline>{pill}</Link> : <span>{pill}</span>}
          </WorkItemHover>
        );
      })}
    </span>
  );
}

/** A commit message with its AB# mentions as work item links. */
export function MessageWithWorkItems({ text, links }: { text: string; links: WorkItemLinks }) {
  return (
    <>
      {splitWorkItemMentions(text).map((p, i) => {
        if (typeof p === "string") return <React.Fragment key={i}>{p}</React.Fragment>;
        const url = links.url(p.id);
        return url ? <WorkItemHover key={i} id={p.id}><Link href={url} target="_blank" rel="noopener noreferrer" ariaLabel={describe(p.id, links.item(p.id))}>{p.text}</Link></WorkItemHover> : <React.Fragment key={i}>{p.text}</React.Fragment>;
      })}
    </>
  );
}

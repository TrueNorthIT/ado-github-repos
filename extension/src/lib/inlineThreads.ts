// Places review threads on the Files diff (AF-6).
import type { ThreadItem } from "./feedModel";

export type InlineThread = Pick<ThreadItem, "id" | "path" | "line" | "startLine" | "side" | "outdated">;

export interface InlineAnchor {
  line: number;
  side: "LEFT" | "RIGHT";
  /** Threads sharing this line and side, in input order. */
  threadIds: string[];
}

/** Anchors per file path, ascending by line, LEFT before RIGHT on the same line. Outdated threads and threads with a null line are left out. */
export function threadsByFile(threads: InlineThread[]): Map<string, InlineAnchor[]> {
  const map = new Map<string, InlineAnchor[]>();
  for (const t of threads) {
    if (t.outdated || t.line == null) continue;
    const list = map.get(t.path) ?? [];
    map.set(t.path, list);
    const hit = list.find((a) => a.line === t.line && a.side === t.side);
    if (hit) hit.threadIds.push(t.id);
    else list.push({ line: t.line, side: t.side, threadIds: [t.id] });
  }
  for (const list of map.values()) list.sort((a, b) => a.line - b.line || (a.side === b.side ? 0 : a.side === "LEFT" ? -1 : 1));
  return map;
}

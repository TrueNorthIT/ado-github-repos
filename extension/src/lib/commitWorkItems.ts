// AB#123 mentions in commit messages (Commits list and commit detail), on top of workItems.ts's rules: not inside code, not in a link's destination.
import { findWorkItemIds, maskCode } from "./workItems";

export type MessagePart = string | { id: number; text: string };

const MENTION = /(?<!\w)AB#(\d+)(?!\w)/gi;

/** `text` split into plain runs and AB# mentions, in order; joining every part's text gives back `text`. Mentions in code are left as text. */
export function splitWorkItemMentions(text: string): MessagePart[] {
  const masked = maskCode(text);
  const out: MessagePart[] = [];
  let at = 0;
  for (const m of masked.matchAll(MENTION)) {
    const id = Number(m[1]);
    if (!(id > 0 && Number.isSafeInteger(id))) continue;
    const start = m.index!;
    if (start > at) out.push(text.slice(at, start));
    out.push({ id, text: text.slice(start, start + m[0].length) });
    at = start + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** The mentioned ids per commit sha, and every id across them (first-seen order, capped as findWorkItemIds caps). */
export function commitWorkItemIds(rows: { sha: string; message: string }[]): { bySha: Record<string, number[]>; all: number[] } {
  const bySha: Record<string, number[]> = {};
  for (const r of rows) {
    const ids = findWorkItemIds(r.message);
    if (ids.length) bySha[r.sha] = ids;
  }
  return { bySha, all: findWorkItemIds(...rows.map((r) => r.message)) };
}

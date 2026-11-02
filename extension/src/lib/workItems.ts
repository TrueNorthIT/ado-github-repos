// Azure Boards work item references in GitHub text (PR-7).

/** Maximum number of ids returned. */
export const MAX_WORK_ITEMS = 200;

// GitHub does not autolink inside code, and a link's destination is not a mention.
const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[^\n]*|(?![\s\S]))/gm;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
const LINK_DEST = /\]\([^)]*\)/g;
const MENTION = /(?<!\w)AB#(\d+)(?!\w)/gi;

/** `AB#123` mentions across the given texts: unique, first-seen order, capped at MAX_WORK_ITEMS. */
export function findWorkItemIds(...texts: (string | null | undefined)[]): number[] {
  const seen = new Set<number>();
  for (const t of texts) {
    if (!t) continue;
    const plain = t.replace(FENCE, " ").replace(INLINE_CODE, " ").replace(LINK_DEST, "]");
    for (const m of plain.matchAll(MENTION)) {
      const id = Number(m[1]);
      if (id > 0 && Number.isSafeInteger(id)) seen.add(id);
    }
  }
  return [...seen].slice(0, MAX_WORK_ITEMS);
}

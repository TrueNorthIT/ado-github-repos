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

export interface WorkItemRef {
  id: number;
  /** false when ADO returned null for the id (missing, or no access). */
  found: boolean;
  title?: string;
  state?: string;
  type?: string;
}

export const workItemsUrl = (org: string, ids: number[]) =>
  `https://dev.azure.com/${encodeURIComponent(org)}/_apis/wit/workitems?ids=${ids.join(",")}&fields=System.Title,System.State,System.WorkItemType&errorPolicy=omit&api-version=7.1`;

export const workItemUrl = (org: string, project: string, id: number) =>
  `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_workitems/edit/${id}`;

/** Maps the workitems response back onto the requested ids, in order. Ids ADO omitted or returned as null are `found: false`. */
export function parseWorkItems(ids: number[], body: { value?: ({ id: number; fields?: Record<string, unknown> } | null)[] } | null | undefined): WorkItemRef[] {
  const byId = new Map<number, { fields?: Record<string, unknown> }>();
  for (const w of body?.value ?? []) if (w) byId.set(w.id, w);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return ids.map((id) => {
    const w = byId.get(id);
    if (!w) return { id, found: false };
    return { id, found: true, title: str(w.fields?.["System.Title"]), state: str(w.fields?.["System.State"]), type: str(w.fields?.["System.WorkItemType"]) };
  });
}

/** `text` with code (fences, inline code) and link destinations blanked to spaces: same length and line breaks, so a position in the result is a position in the original. */
export function maskCode(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return text.replace(FENCE, blank).replace(INLINE_CODE, blank).replace(LINK_DEST, blank);
}

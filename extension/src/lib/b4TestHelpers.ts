// Shared assertions for the batch 4 (VW-*) tests. Test support only: not imported by any production module.
import { expect } from "vitest";
import { norm } from "./ciTestHelpers";

/** The text between the braces of the first `{ ... }` that follows the first match of `opener`, nested braces included; null when there is no match or the braces do not balance. */
export function selectionBlock(req: { query: string }, opener: RegExp): string | null {
  const q = norm(req.query);
  const m = opener.exec(q);
  if (!m) return null;
  const open = q.indexOf("{", m.index + m[0].length);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < q.length; i++) {
    if (q[i] === "{") depth++;
    else if (q[i] === "}" && --depth === 0) return q.slice(open + 1, i);
  }
  return null;
}

/** Like editTestHelpers.expectSelection, but the block may contain nested selections: every one of `fields` must appear as a word anywhere inside it. */
export function expectNestedSelection(req: { query: string }, opener: RegExp, fields: string[], what: string) {
  const block = selectionBlock(req, opener);
  expect(block, `Expected ${what} in the query`).not.toBeNull();
  const words = block!.split(/[^A-Za-z0-9_]+/);
  for (const f of fields) expect(words, `Expected ${what} to select ${f}`).toContain(f);
}

/** Asserts the query declares each variable exactly as given, ignoring spacing, e.g. "$after: String" (so "$after: String!" does not satisfy it). */
export function expectDeclares(req: { query: string }, decls: string[]) {
  const q = norm(req.query).replace(/\s+/g, "");
  for (const d of decls) {
    const want = d.replace(/\s+/g, "").replace(/[$.*+?^${}()|[\]\\]/g, "\\$&");
    expect(q, `Expected the query to declare ${d}`).toMatch(new RegExp(`${want}(?![A-Za-z0-9_!\\[])`));
  }
}

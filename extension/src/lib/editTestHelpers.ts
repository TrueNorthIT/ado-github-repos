// Shared assertions for the batch 2 (ED-*) tests. Test support only: not imported by any production module.
import { expect } from "vitest";
import { norm } from "./ciTestHelpers";

/** Asserts the (whitespace-normalised) query contains `opener` followed by a { ... } selection that names every one of `fields`. */
export function expectSelection(req: { query: string }, opener: RegExp, fields: string[], what: string) {
  const m = norm(req.query).match(new RegExp(`${opener.source}\\s*\\{([^{}]*)`));
  expect(m, `Expected ${what} in the query`).not.toBeNull();
  const words = m![m!.length - 1].split(/[^A-Za-z0-9_]+/);
  for (const f of fields) expect(words, `Expected ${what} to select ${f}`).toContain(f);
}

/** Asserts the query is a single `query` operation (not a mutation). */
export function expectQueryOperation(req: { query: string }) {
  expect(norm(req.query), "Expected a query operation").toMatch(/^\s*query\b/);
}

/** Asserts a node-list connection call such as `assignableUsers(query: $query, first: 20)` is present, with the argument order not mattering. */
export function expectConnectionCall(req: { query: string }, field: string, args: string[]) {
  const m = norm(req.query).match(new RegExp(`${field}\\(([^)]*)\\)`));
  expect(m, `Expected a ${field}(...) call`).not.toBeNull();
  for (const a of args) expect(m![1].replace(/\s+/g, ""), `Expected ${field}(...) to pass ${a}`).toContain(a.replace(/\s+/g, ""));
}

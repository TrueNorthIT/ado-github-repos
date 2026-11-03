// Shared assertions for the batch 1b (CI-*) tests. Test support only: not imported by any production module.
import { expect } from "vitest";

export const norm = (s: string) => s.replace(/\s+/g, " ");

/** Awkward values for owner, name and ids: a builder that pastes them into the query text instead of `variables` fails. */
export const NASTY = ['we"ird', "back\\slash", "ünï cødé 日本", "sp ace #hash", "q{uery}", "$var"];

/** Asserts `req` is `mutation X($input: TYPE!) { field(input: $input) ... }`, one operation. */
export function expectMutation(req: { query: string }, inputType: string, field: string) {
  const q = norm(req.query);
  expect(q, `Expected a mutation operation taking $input: ${inputType}!`).toMatch(new RegExp(`^\\s*mutation\\b[^{]*\\$input:\\s*${inputType}!`));
  expect(q, `Expected ${field}(input: $input)`).toMatch(new RegExp(`\\b${field}\\(input:\\s*\\$input\\)`));
  expect(q.match(/\bmutation\b/g), "Expected exactly one operation").toHaveLength(1);
}

/** Asserts the query is a repository(owner: $owner, name: $name) { pullRequest(number: $number) ... } query. */
export function expectPrQuery(req: { query: string }) {
  const q = norm(req.query);
  expect(q, "Expected the text to start with a query operation").toMatch(/^\s*query\b/);
  expect(q, "Expected $owner: String!").toMatch(/\$owner:\s*String!/);
  expect(q, "Expected $name: String!").toMatch(/\$name:\s*String!/);
  expect(q, "Expected $number: Int!").toMatch(/\$number:\s*Int!/);
  expect(q, "Expected repository(owner: $owner, name: $name)").toMatch(/repository\(owner:\s*\$owner,\s*name:\s*\$name\)/);
  expect(q, "Expected pullRequest(number: $number)").toMatch(/pullRequest\(number:\s*\$number\)/);
}

/** Asserts none of `values` appears in the query text (they must travel in variables). */
export function expectNotInQuery(req: { query: string }, values: string[]) {
  for (const v of values) expect(req.query, `Expected the caller-supplied value ${JSON.stringify(v)} to travel in variables, not the query text`).not.toContain(v);
}

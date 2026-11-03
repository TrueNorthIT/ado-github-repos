import { describe, it, expect } from "vitest";
import {
  prEditQuery,
  updatePullRequestMutation,
  planTitleBodyUpdate,
  addWorkItemToBody,
  removeWorkItemFromBody,
  findClosingIssueNumbers,
  addClosingIssueToBody,
  removeClosingIssueFromBody,
  isClosingIssueRemovable,
  toLinkedIssueRows,
  editPermissions,
  type EditContext,
  type EditField,
} from "./prEdit";
import { findWorkItemIds } from "./workItems";
import { expectMutation, expectNotInQuery, expectPrQuery, norm, NASTY } from "./ciTestHelpers";

// Module under test: src/lib/prEdit.ts (stubs until the developer implements them).
// Requirements: ED-1 (edit title and description), ED-4 (work items by AB#id in the body), ED-8 (linked issues by "Closes #n"), ED-9 (permissions).
// Schema facts are in the header of src/lib/prEdit.ts. Decisions fixed by these tests:
//  - ED-1: the title is trimmed, required and at most 256 characters (Unicode code points); the body is sent as given, may be empty, and is at most 65536 characters. Unchanged values send nothing.
//  - ED-4: a new AB#id goes on its own line after a blank line, or onto an existing trailing line of AB# mentions; removal keeps everything else byte for byte.
//  - ED-8: only a line that is exactly "KEYWORD #n" (optionally bulleted) can be added or removed through the body.
//  - ED-9: labels follow viewerCanLabel and assignees follow viewerCanAssign; everything else follows viewerCanUpdate; closed and merged PRs only allow labels and projects.

const ID = "PR_node1";

describe("ED-1: prEditQuery loads what the edit controls need", () => {
  // Given owner/name/number, prEditQuery returns a variables-only query selecting the PR node id, permissions, reviewers (with asCodeOwner), assignees, labels with ids, milestone and linked issues.
  it("is a variables-only pull request query", () => {
    const req = prEditQuery({ owner: "octo", name: "repo", number: 7 });
    expectPrQuery(req);
    expect(req.variables, "Expected variables { owner, name, number }").toEqual({ owner: "octo", name: "repo", number: 7 });
  });

  it("selects the fields the edit controls read", () => {
    const q = norm(prEditQuery({ owner: "octo", name: "repo", number: 7 }).query);
    for (const f of ["id", "state", "title", "body", "viewerCanUpdate", "viewerCanLabel", "viewerCanAssign", "asCodeOwner", "milestone"])
      expect(q, `Expected the edit query to select ${f}`).toContain(f);
    expect(q, "Expected the author login").toMatch(/author\s*\{\s*login/);
    expect(q, "Expected closingIssuesReferences(first: 20)").toMatch(/closingIssuesReferences\(first:\s*20\)/);
    const has = (re: RegExp, fields: string[], what: string) => {
      const m = q.match(re);
      expect(m, `Expected ${what} in the edit query`).not.toBeNull();
      for (const f of fields) expect(m![1].split(/[^A-Za-z0-9_]+/), `Expected ${what} to select ${f}`).toContain(f);
    };
    has(/labels\(first:\s*\d+\)\s*\{\s*nodes\s*\{([^}]*)\}/, ["id", "name", "color", "description"], "labels with their node ids");
    has(/\.\.\. on Team\s*\{([^}]*)\}/, ["id", "slug", "name"], "team reviewers");
    has(/\.\.\. on User\s*\{([^}]*)\}/, ["id", "login", "name"], "user reviewers");
    has(/milestone\s*\{([^}]*)\}/, ["id", "title", "dueOn"], "the milestone");
    has(/closingIssuesReferences\([^)]*\)\s*\{\s*nodes\s*\{([^}]*)\}/, ["number", "title", "state", "url"], "linked issues");
  });

  it("keeps projects out of this query (they need the read:project scope and would fail the whole query)", () => {
    expect(prEditQuery({ owner: "o", name: "r", number: 1 }).query, "Expected no projectItems in the edit query: it has its own query in projects.ts").not.toContain("projectItems");
  });

  it("sends awkward owner and name only in variables", () => {
    const req = prEditQuery({ owner: NASTY[0], name: NASTY[1], number: 1 });
    expectNotInQuery(req, [NASTY[0], NASTY[1]]);
    expect(req.variables, "Expected owner and name verbatim in variables").toMatchObject({ owner: NASTY[0], name: NASTY[1] });
  });
});

describe("ED-1: updatePullRequestMutation", () => {
  // Given { pullRequestId, title, body }, the request is `mutation($input: UpdatePullRequestInput!) { updatePullRequest(input: $input) ... }`.
  it("is a mutation taking $input: UpdatePullRequestInput!", () => {
    expectMutation(updatePullRequestMutation({ pullRequestId: ID, title: "T" }), "UpdatePullRequestInput", "updatePullRequest");
  });

  it("sends the id and only the keys given", () => {
    expect(updatePullRequestMutation({ pullRequestId: ID, title: "New" }).variables, "Expected only pullRequestId and title").toEqual({ input: { pullRequestId: ID, title: "New" } });
    expect(updatePullRequestMutation({ pullRequestId: ID, body: "B" }).variables, "Expected only pullRequestId and body").toEqual({ input: { pullRequestId: ID, body: "B" } });
  });

  it("keeps an explicit null milestoneId (it clears the milestone)", () => {
    const input = (updatePullRequestMutation({ pullRequestId: ID, milestoneId: null }).variables as { input: Record<string, unknown> }).input;
    expect("milestoneId" in input, "Expected the milestoneId key to be present").toBe(true);
    expect(input.milestoneId, "Expected milestoneId to be null").toBeNull();
  });

  it("selects the updated title and body back", () => {
    const m = norm(updatePullRequestMutation({ pullRequestId: ID, title: "T" }).query).match(/pullRequest\s*\{([^{}]*)/);
    expect(m, "Expected a pullRequest { ... } payload selection").not.toBeNull();
    for (const f of ["id", "title", "body"]) expect(m![1].split(/[^A-Za-z0-9_]+/), `Expected the payload to select ${f}`).toContain(f);
  });

  it("keeps user text out of the query text", () => {
    const req = updatePullRequestMutation({ pullRequestId: NASTY[0], title: NASTY[2], body: NASTY[4] });
    expectNotInQuery(req, [NASTY[0], NASTY[2], NASTY[4]]);
    expect(req.variables, "Expected the text verbatim in variables").toEqual({ input: { pullRequestId: NASTY[0], title: NASTY[2], body: NASTY[4] } });
  });

  it("refuses a blank pull request id", () => {
    expect(() => updatePullRequestMutation({ pullRequestId: "  ", title: "T" }), "Expected a blank pullRequestId to be refused").toThrow(/pullRequestId is required/);
  });
});

describe("ED-1: planTitleBodyUpdate", () => {
  const cur = { title: "Old title", body: "Old body" };

  // Given a new title with spaces around it, the title is trimmed and sent.
  it("sends the trimmed title when it changed", () => {
    expect(planTitleBodyUpdate(ID, cur, { title: "  New title  " }), "Expected a trimmed title in the minimal input").toEqual({ ok: true, input: { pullRequestId: ID, title: "New title" } });
  });

  it("sends only the changed field when title and body are both given but one is unchanged", () => {
    expect(planTitleBodyUpdate(ID, cur, { title: "Old title", body: "New body" }), "Expected only the body").toEqual({ ok: true, input: { pullRequestId: ID, body: "New body" } });
    expect(planTitleBodyUpdate(ID, cur, { title: "New", body: "Old body" }), "Expected only the title").toEqual({ ok: true, input: { pullRequestId: ID, title: "New" } });
  });

  it("sends both when both changed", () => {
    expect(planTitleBodyUpdate(ID, cur, { title: "A", body: "B" }), "Expected title and body").toEqual({ ok: true, input: { pullRequestId: ID, title: "A", body: "B" } });
  });

  it("sends no mutation when the title is unchanged, even with different surrounding spaces", () => {
    expect(planTitleBodyUpdate(ID, cur, { title: " Old title " }), "Expected input null for an unchanged title").toEqual({ ok: true, input: null });
  });

  it("sends no mutation when the body is unchanged", () => {
    expect(planTitleBodyUpdate(ID, cur, { body: "Old body" }), "Expected input null for an unchanged body").toEqual({ ok: true, input: null });
  });

  it("sends no mutation when nothing was edited", () => {
    expect(planTitleBodyUpdate(ID, cur, {}), "Expected input null when no field is given").toEqual({ ok: true, input: null });
  });

  // GitHub stores web-editor bodies with CRLF; a textarea gives LF. The same text must not count as an edit.
  it("treats a body differing only by CRLF versus LF as unchanged", () => {
    expect(planTitleBodyUpdate(ID, { title: "T", body: "line one\r\nline two" }, { body: "line one\nline two" }), "Expected no mutation for a CRLF/LF-only difference").toEqual({ ok: true, input: null });
  });

  it("treats a null current body as empty", () => {
    expect(planTitleBodyUpdate(ID, { title: "T", body: null }, { body: "" }), "Expected no mutation: null and empty are the same").toEqual({ ok: true, input: null });
    expect(planTitleBodyUpdate(ID, { title: "T", body: null }, { body: "Now there is text" }), "Expected the body to be sent").toEqual({ ok: true, input: { pullRequestId: ID, body: "Now there is text" } });
  });

  it("sends a changed body untrimmed", () => {
    expect(planTitleBodyUpdate(ID, cur, { body: "  indented\n\n" }), "Expected the body exactly as typed").toEqual({ ok: true, input: { pullRequestId: ID, body: "  indented\n\n" } });
  });

  it("allows clearing the description", () => {
    expect(planTitleBodyUpdate(ID, cur, { body: "" }), "Expected an empty body to be sent").toEqual({ ok: true, input: { pullRequestId: ID, body: "" } });
  });

  it.each([[""], ["   "], ["\t\n"]])("refuses an empty title (%j)", (title) => {
    const r = planTitleBodyUpdate(ID, cur, { title });
    expect(r.ok, "Expected an empty title to be refused").toBe(false);
    if (!r.ok) {
      expect(r.field, "Expected the error to name the title field").toBe("title");
      expect(r.error, "Expected a message saying the title is required").toMatch(/required|empty/i);
    }
  });

  it("accepts a title of exactly 256 characters and refuses 257", () => {
    expect(planTitleBodyUpdate(ID, cur, { title: "a".repeat(256) }), "Expected 256 characters to be accepted").toEqual({ ok: true, input: { pullRequestId: ID, title: "a".repeat(256) } });
    const r = planTitleBodyUpdate(ID, cur, { title: "a".repeat(257) });
    expect(r.ok, "Expected 257 characters to be refused").toBe(false);
    if (!r.ok) {
      expect(r.field, "Expected the error to name the title field").toBe("title");
      expect(r.error, "Expected the message to state the 256 limit").toMatch(/256/);
    }
  });

  it("measures the title in characters, not UTF-16 units (256 emoji are allowed)", () => {
    const title = "😀".repeat(256);
    expect(planTitleBodyUpdate(ID, cur, { title }), "Expected 256 emoji (512 UTF-16 units) to be accepted").toEqual({ ok: true, input: { pullRequestId: ID, title } });
  });

  it("measures the limit after trimming", () => {
    const title = `  ${"a".repeat(256)}  `;
    expect(planTitleBodyUpdate(ID, cur, { title }), "Expected 256 characters plus padding to be accepted").toEqual({ ok: true, input: { pullRequestId: ID, title: "a".repeat(256) } });
  });

  it("accepts a body of 65536 characters and refuses 65537", () => {
    expect(planTitleBodyUpdate(ID, cur, { body: "b".repeat(65536) }).ok, "Expected 65536 characters to be accepted").toBe(true);
    const r = planTitleBodyUpdate(ID, cur, { body: "b".repeat(65537) });
    expect(r.ok, "Expected 65537 characters to be refused").toBe(false);
    if (!r.ok) expect(r.field, "Expected the error to name the body field").toBe("body");
  });

  it("sends nothing at all when one field is invalid, even if the other changed", () => {
    const r = planTitleBodyUpdate(ID, cur, { title: " ", body: "New body" });
    expect(r.ok, "Expected the whole edit to be refused, not partly applied").toBe(false);
  });

  it("does not validate a title that was not edited", () => {
    expect(planTitleBodyUpdate(ID, { title: "", body: "x" }, { body: "y" }), "Expected the untouched (empty) title to be ignored").toEqual({ ok: true, input: { pullRequestId: ID, body: "y" } });
  });
});

describe("ED-4: addWorkItemToBody", () => {
  it("gives just the mention for an empty, null or undefined body", () => {
    for (const b of ["", null, undefined]) expect(addWorkItemToBody(b, 123), `Expected "AB#123" for ${String(b)}`).toBe("AB#123");
  });

  it("appends the mention on its own line after a blank line", () => {
    expect(addWorkItemToBody("Some text", 123), "Expected the body, a blank line, then AB#123").toBe("Some text\n\nAB#123");
  });

  it("does not leave a trailing newline or stack blank lines", () => {
    expect(addWorkItemToBody("Some text\n\n\n", 5), "Expected the end of the body trimmed before the new line").toBe("Some text\n\nAB#5");
  });

  it("adds to an existing trailing line of mentions", () => {
    expect(addWorkItemToBody("Text\n\nAB#1", 2), "Expected AB#2 added to the AB#1 line").toBe("Text\n\nAB#1 AB#2");
    expect(addWorkItemToBody("Text\n\nAB#1 AB#2\n", 3), "Expected AB#3 added to the last line, ignoring the trailing newline").toBe("Text\n\nAB#1 AB#2 AB#3");
  });

  it("starts a new line when the last line has other text as well", () => {
    expect(addWorkItemToBody("Text\n\nFixes AB#1", 2), "Expected a new line, not an edit of the prose line").toBe("Text\n\nFixes AB#1\n\nAB#2");
  });

  it("is idempotent: an id already mentioned changes nothing, even mid-sentence", () => {
    const body = "Does the thing.\n\nSee AB#123 for context  \n";
    expect(addWorkItemToBody(body, 123), "Expected the body returned unchanged").toBe(body);
  });

  it("gives the same result when applied twice", () => {
    const once = addWorkItemToBody("Text", 9);
    expect(addWorkItemToBody(once, 9), "Expected a second add to change nothing").toBe(once);
  });

  it("matches the mention case-insensitively when checking for an existing one", () => {
    expect(addWorkItemToBody("ab#123", 123), "Expected ab#123 to count as already linked").toBe("ab#123");
  });

  it("does not mistake AB#1234 for AB#123", () => {
    expect(addWorkItemToBody("Text\n\nAB#1234", 123), "Expected AB#123 to be added alongside AB#1234").toBe("Text\n\nAB#1234 AB#123");
  });

  it("does not count a mention inside code as a link", () => {
    expect(addWorkItemToBody("Run `AB#5` to see", 5), "Expected a real mention to be added: code is not autolinked").toBe("Run `AB#5` to see\n\nAB#5");
  });

  it("uses CRLF line breaks when the body uses them", () => {
    expect(addWorkItemToBody("Text\r\nmore", 4), "Expected CRLF between the body and the mention").toBe("Text\r\nmore\r\n\r\nAB#4");
    expect(addWorkItemToBody("Text\r\n\r\nAB#1", 2), "Expected the trailing line extended in place").toBe("Text\r\n\r\nAB#1 AB#2");
  });

  it("produces a body that findWorkItemIds reads back", () => {
    expect(findWorkItemIds(addWorkItemToBody("Text", 42)), "Expected the added work item to be found").toEqual([42]);
  });

  it.each([0, -3, 1.5, Number.NaN])("refuses the invalid work item id %s", (id) => {
    expect(() => addWorkItemToBody("Text", id), `Expected ${id} to be refused`).toThrow(/positive integer/);
  });
});

describe("ED-4: removeWorkItemFromBody", () => {
  it("removes a mention on its own trailing line and the blank line before it", () => {
    expect(removeWorkItemFromBody("Text\n\nAB#123", 123), "Expected just the text to remain").toBe("Text");
  });

  it("deletes a mention line in the middle without leaving a double blank line", () => {
    expect(removeWorkItemFromBody("A\n\nAB#123\n\nB", 123), "Expected one blank line between A and B").toBe("A\n\nB");
    expect(removeWorkItemFromBody("A\nAB#123\nB", 123), "Expected the line gone without a blank one in its place").toBe("A\nB");
  });

  it("leaves the other ids on a shared line", () => {
    expect(removeWorkItemFromBody("AB#1 AB#2", 1), "Expected AB#2 alone").toBe("AB#2");
    expect(removeWorkItemFromBody("AB#1 AB#2", 2), "Expected AB#1 alone").toBe("AB#1");
    expect(removeWorkItemFromBody("AB#1 AB#2 AB#3", 2), "Expected AB#1 AB#3").toBe("AB#1 AB#3");
  });

  it("closes up the space when a mention sits in a sentence", () => {
    expect(removeWorkItemFromBody("Fixes AB#123 today", 123), "Expected a single space left").toBe("Fixes today");
  });

  it("does not touch AB#1234 when removing AB#123", () => {
    expect(removeWorkItemFromBody("AB#1234", 123), "Expected AB#1234 untouched").toBe("AB#1234");
    expect(removeWorkItemFromBody("AB#123 and AB#1234", 123), "Expected only AB#123 removed").toBe("and AB#1234");
  });

  it("does not touch AB#12 or AB#23 when removing AB#123 (nor the reverse)", () => {
    expect(removeWorkItemFromBody("AB#12 AB#23 AB#123", 123), "Expected only AB#123 removed").toBe("AB#12 AB#23");
  });

  it("leaves every other line exactly as it was, including trailing spaces and CRLF", () => {
    const body = "Line one  \r\nAB#9\r\nLine two\t\r\n";
    expect(removeWorkItemFromBody(body, 9), "Expected only the AB#9 line to go").toBe("Line one  \r\nLine two\t\r\n");
  });

  it("removes the mention case-insensitively", () => {
    expect(removeWorkItemFromBody("Text\n\nab#123", 123), "Expected ab#123 removed").toBe("Text");
  });

  it("removes every mention of the id", () => {
    const out = removeWorkItemFromBody("AB#123\n\nSee AB#123 for more, and AB#123 again", 123);
    expect(findWorkItemIds(out), "Expected no mention of 123 left").toEqual([]);
    expect(out, "Expected the prose kept").toContain("for more");
  });

  it("does not touch a mention inside code (it was never a link)", () => {
    const body = "Use `AB#123` in a commit\n\n```\nAB#123\n```";
    expect(removeWorkItemFromBody(body, 123), "Expected code left alone").toBe(body);
  });

  it("returns the body byte for byte when the id is absent", () => {
    const body = "Text  \r\n\r\nAB#5 \r\n";
    expect(removeWorkItemFromBody(body, 123), "Expected an unchanged body").toBe(body);
  });

  it("gives an empty string for a null or undefined body", () => {
    expect(removeWorkItemFromBody(null, 1), "Expected '' for null").toBe("");
    expect(removeWorkItemFromBody(undefined, 1), "Expected '' for undefined").toBe("");
  });

  it("undoes addWorkItemToBody", () => {
    expect(removeWorkItemFromBody(addWorkItemToBody("Some text", 7), 7), "Expected add then remove to restore the body").toBe("Some text");
    expect(removeWorkItemFromBody(addWorkItemToBody("", 7), 7), "Expected add then remove on an empty body to give an empty body").toBe("");
  });

  it("feeds the ED-1 plan as a minimal body update", () => {
    const body = "Text\n\nAB#123";
    expect(planTitleBodyUpdate(ID, { title: "T", body }, { body: removeWorkItemFromBody(body, 123) }), "Expected a body-only update").toEqual({ ok: true, input: { pullRequestId: ID, body: "Text" } });
  });
});

describe("ED-8: findClosingIssueNumbers", () => {
  it.each(["close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved"])("recognises the keyword %s", (kw) => {
    expect(findClosingIssueNumbers(`${kw} #12`), `Expected "${kw} #12" to close issue 12`).toEqual([12]);
  });

  it("is case-insensitive and allows a colon", () => {
    expect(findClosingIssueNumbers("CLOSES #1\nFixes: #2\nresolved  #3"), "Expected 1, 2 and 3").toEqual([1, 2, 3]);
  });

  it("returns unique numbers in first-seen order", () => {
    expect(findClosingIssueNumbers("Fixes #5\nCloses #3\nfixes #5"), "Expected [5, 3]").toEqual([5, 3]);
  });

  it("needs a keyword for each reference", () => {
    expect(findClosingIssueNumbers("Closes #1, #2"), "Expected only #1: #2 has no keyword of its own").toEqual([1]);
  });

  it.each(["prefixes #5", "Closes the bug #5", "Closes #5abc", "Closes octo/repo#5", "see #5", "closes# 5", ""])("finds nothing in %j", (text) => {
    expect(findClosingIssueNumbers(text), `Expected no closing issue in ${JSON.stringify(text)}`).toEqual([]);
  });

  it("ignores references inside code", () => {
    expect(findClosingIssueNumbers("Write `Closes #5` in the body\n\n```\nFixes #6\n```"), "Expected code to be ignored").toEqual([]);
  });

  it("gives [] for null and undefined", () => {
    expect(findClosingIssueNumbers(null), "Expected [] for null").toEqual([]);
    expect(findClosingIssueNumbers(undefined), "Expected [] for undefined").toEqual([]);
  });
});

describe("ED-8: addClosingIssueToBody", () => {
  it("adds 'Closes #n' on its own line after a blank line", () => {
    expect(addClosingIssueToBody("Some text", 12), "Expected the body, a blank line, then Closes #12").toBe("Some text\n\nCloses #12");
    expect(addClosingIssueToBody("", 12), "Expected just the line for an empty body").toBe("Closes #12");
    expect(addClosingIssueToBody(null, 12), "Expected just the line for a null body").toBe("Closes #12");
  });

  it("puts a second reference on the next line with its own keyword", () => {
    expect(addClosingIssueToBody("Text\n\nCloses #1", 2), "Expected Closes #2 straight under Closes #1").toBe("Text\n\nCloses #1\nCloses #2");
  });

  it("is idempotent for any keyword and case", () => {
    for (const body of ["fixes #12", "Resolved: #12", "Text\n\nCLOSES #12\n"])
      expect(addClosingIssueToBody(body, 12), `Expected ${JSON.stringify(body)} unchanged`).toBe(body);
  });

  it("does not mistake #123 for #12", () => {
    expect(addClosingIssueToBody("Closes #123", 12), "Expected Closes #12 added alongside #123").toBe("Closes #123\nCloses #12");
  });

  it("does not count a reference inside code", () => {
    expect(addClosingIssueToBody("Use `Closes #12`", 12), "Expected a real line added").toBe("Use `Closes #12`\n\nCloses #12");
  });

  it("uses CRLF when the body does", () => {
    expect(addClosingIssueToBody("Text\r\nmore", 3), "Expected CRLF line breaks").toBe("Text\r\nmore\r\n\r\nCloses #3");
  });

  it("is read back by findClosingIssueNumbers", () => {
    expect(findClosingIssueNumbers(addClosingIssueToBody("Text", 8)), "Expected issue 8 to be found").toEqual([8]);
  });

  it.each([0, -1, 2.5, Number.NaN])("refuses the invalid issue number %s", (n) => {
    expect(() => addClosingIssueToBody("x", n), `Expected ${n} to be refused`).toThrow(/positive integer/);
  });
});

describe("ED-8: removing a closing issue through the body", () => {
  it("deletes a keyword line (and the blank line before it)", () => {
    expect(removeClosingIssueFromBody("Text\n\nCloses #12", 12), "Expected just the text").toBe("Text");
  });

  it("deletes a bulleted keyword line, whatever the case", () => {
    expect(removeClosingIssueFromBody("Intro\n- fixes #12\n- Fixes #13", 12), "Expected only the #12 bullet to go").toBe("Intro\n- Fixes #13");
    expect(removeClosingIssueFromBody("RESOLVES: #12", 12), "Expected the keyword line deleted").toBe("");
  });

  it("keeps the other issues' lines", () => {
    expect(removeClosingIssueFromBody("Closes #12\nCloses #13", 12), "Expected Closes #13").toBe("Closes #13");
  });

  it("does not touch #123 when removing #12", () => {
    expect(removeClosingIssueFromBody("Closes #123", 12), "Expected the body unchanged").toBe("Closes #123");
  });

  it.each(["This closes #12 and more", "Closes #12, closes #13", "Closes #12 because of the crash", "Closes octo/repo#12"])("leaves unparsable text alone: %j", (body) => {
    expect(removeClosingIssueFromBody(body, 12), `Expected ${JSON.stringify(body)} unchanged`).toBe(body);
  });

  it("leaves code alone", () => {
    const body = "```\nCloses #12\n```";
    expect(removeClosingIssueFromBody(body, 12), "Expected the fenced line unchanged").toBe(body);
  });

  it("preserves the other lines byte for byte", () => {
    expect(removeClosingIssueFromBody("One  \r\nCloses #5\r\nTwo\t", 5), "Expected only the keyword line to go").toBe("One  \r\nTwo\t");
  });

  it("undoes addClosingIssueToBody", () => {
    expect(removeClosingIssueFromBody(addClosingIssueToBody("Some text", 4), 4), "Expected add then remove to restore the body").toBe("Some text");
  });

  it("isClosingIssueRemovable is true only for a parsable keyword line", () => {
    expect(isClosingIssueRemovable("Text\n\nCloses #12", 12), "Expected a keyword line to be removable").toBe(true);
    expect(isClosingIssueRemovable("- fixes #12", 12), "Expected a bulleted keyword line to be removable").toBe(true);
    expect(isClosingIssueRemovable("This closes #12 and more", 12), "Expected prose not to be removable").toBe(false);
    expect(isClosingIssueRemovable("Closes #123", 12), "Expected a different number not to count").toBe(false);
    expect(isClosingIssueRemovable("", 12), "Expected an empty body not to be removable").toBe(false);
    expect(isClosingIssueRemovable(null, 12), "Expected a null body not to be removable").toBe(false);
  });
});

describe("ED-8: toLinkedIssueRows", () => {
  const nodes = [
    { number: 12, title: "Crash on start", state: "OPEN" as const, url: "https://github.com/octo/repo/issues/12" },
    { number: 13, title: "Slow list", state: "CLOSED" as const, url: "https://github.com/octo/repo/issues/13" },
  ];

  it("keeps the issues in order and marks which can be removed through the body", () => {
    const rows = toLinkedIssueRows(nodes, "Text\n\nCloses #12");
    expect(rows.map((r) => r.number), "Expected the order of closingIssuesReferences").toEqual([12, 13]);
    expect(rows.map((r) => r.removable), "Expected #12 removable (keyword line) and #13 not (linked in the sidebar)").toEqual([true, false]);
    expect(rows[0], "Expected number, title, state and url copied").toMatchObject({ number: 12, title: "Crash on start", state: "OPEN", url: "https://github.com/octo/repo/issues/12" });
  });

  it("gives [] for missing nodes", () => {
    expect(toLinkedIssueRows(null, "x"), "Expected [] for null").toEqual([]);
    expect(toLinkedIssueRows(undefined, null), "Expected [] for undefined").toEqual([]);
  });
});

describe("ED-9: editPermissions", () => {
  const FIELDS: EditField[] = ["title", "body", "reviewers", "assignees", "labels", "milestone", "projects", "workItems", "closingIssues"];
  const open: EditContext = { state: "OPEN", viewerCanUpdate: true, viewerCanLabel: true, viewerCanAssign: true };
  const ctx = (over: Partial<EditContext> = {}): EditContext => ({ ...open, ...over });
  const allowed = (c: EditContext) => FIELDS.filter((f) => editPermissions(c)[f]);

  it("offers every edit on an open pull request the viewer can update", () => {
    expect(allowed(ctx()), "Expected all nine edits to be offered").toEqual(FIELDS);
  });

  it("gives an answer for every field", () => {
    expect(Object.keys(editPermissions(ctx())).sort(), "Expected one boolean per edit field").toEqual([...FIELDS].sort());
  });

  it.each(["CLOSED", "MERGED"] as const)("on a %s pull request offers only labels and projects", (state) => {
    expect(allowed(ctx({ state })), `Expected only labels and projects on a ${state} PR`).toEqual(["labels", "projects"]);
  });

  it("offers nothing to a viewer with no permissions, on any state", () => {
    for (const state of ["OPEN", "CLOSED", "MERGED"] as const)
      expect(allowed({ state, viewerCanUpdate: false, viewerCanLabel: false, viewerCanAssign: false }), `Expected no edits on ${state}`).toEqual([]);
  });

  it("without viewerCanUpdate hides title, body, reviewers, milestone, work items, linked issues and projects", () => {
    expect(allowed(ctx({ viewerCanUpdate: false })), "Expected only labels and assignees (their own flags are still true)").toEqual(["assignees", "labels"]);
  });

  it("labels follow viewerCanLabel, not viewerCanUpdate", () => {
    expect(editPermissions(ctx({ viewerCanLabel: false })).labels, "Expected no label edit without viewerCanLabel").toBe(false);
    expect(editPermissions(ctx({ viewerCanLabel: false })).title, "Expected the title unaffected").toBe(true);
    expect(editPermissions(ctx({ viewerCanUpdate: false, viewerCanLabel: true })).labels, "Expected labels offered to a viewer who can label but not update").toBe(true);
  });

  it("assignees follow viewerCanAssign, not viewerCanUpdate", () => {
    expect(editPermissions(ctx({ viewerCanAssign: false })).assignees, "Expected no assignee edit without viewerCanAssign").toBe(false);
    expect(editPermissions(ctx({ viewerCanUpdate: false, viewerCanAssign: true })).assignees, "Expected assignees offered to a viewer who can assign but not update").toBe(true);
  });

  it("assignees are hidden once the pull request is closed or merged", () => {
    expect(editPermissions(ctx({ state: "CLOSED" })).assignees, "Expected no assignee edit on a closed PR").toBe(false);
  });

  it("projects follow viewerCanUpdate in any state", () => {
    expect(editPermissions(ctx({ state: "MERGED" })).projects, "Expected projects offered on a merged PR").toBe(true);
    expect(editPermissions(ctx({ state: "MERGED", viewerCanUpdate: false })).projects, "Expected no project edit without viewerCanUpdate").toBe(false);
  });

  it("falls back to viewerCanUpdate when the per-field flags were not queried", () => {
    const c: EditContext = { state: "OPEN", viewerCanUpdate: true };
    expect(editPermissions(c).labels, "Expected labels offered via viewerCanUpdate").toBe(true);
    expect(editPermissions(c).assignees, "Expected assignees offered via viewerCanUpdate").toBe(true);
    const n: EditContext = { state: "OPEN", viewerCanUpdate: false };
    expect(editPermissions(n).labels, "Expected no label edit when nothing allows it").toBe(false);
    expect(editPermissions(n).assignees, "Expected no assignee edit when nothing allows it").toBe(false);
  });
});

describe("removeWorkItemFromBody: mentions the Boards app turned into links", () => {
  // Live finding (0.26.0): the Azure Boards GitHub app rewrites `AB#123` in a PR body to `[AB#123](https://dev.azure.com/...)`,
  // so removing only the mention left an empty `[](url)` link behind.
  it("removes the whole link, not just its text", () => {
    const b = "Intro.\n\nRelates to [AB#42](https://dev.azure.com/o/p/_workitems/edit/42).\n\nOutro.";
    expect(removeWorkItemFromBody(b, 42)).toBe("Intro.\n\nRelates to.\n\nOutro.");
  });
  it("drops a line that held only the linked mention", () => {
    expect(removeWorkItemFromBody("Intro.\n[AB#42](https://dev.azure.com/o/p/_workitems/edit/42)", 42)).toBe("Intro.");
  });
  it("leaves other links and ids alone", () => {
    const b = "See [AB#43](https://dev.azure.com/o/p/_workitems/edit/43) and [AB#42](https://dev.azure.com/o/p/_workitems/edit/42).";
    expect(removeWorkItemFromBody(b, 42)).toBe("See [AB#43](https://dev.azure.com/o/p/_workitems/edit/43) and.");
  });
});

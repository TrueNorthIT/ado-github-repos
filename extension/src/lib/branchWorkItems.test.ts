import { describe, it, expect } from "vitest";
import { findBranchWorkItemIds, newPrWorkItemIds, prefillWorkItems } from "./branchWorkItems";
import { addWorkItemToBody } from "./prEdit";

// Module under test: src/lib/branchWorkItems.ts (stubs until the developer implements them). Requirement CP-3: "The source branch name is often users/x/123-thing or feature/AB#123: extract work item ids
// from branch names and commit messages (reuse workItems.findWorkItemIds plus a branch pattern for leading digits after a `/`; be conservative and test the false positives) and pre-fill them as AB#id
// in the description via addWorkItemToBody." The matching rules are in the header of src/lib/branchWorkItems.ts.

describe("CP-3: findBranchWorkItemIds finds work items a branch name points at", () => {
  const found: [string, number[]][] = [
    ["feature/AB#123", [123]],
    ["feature/AB#123-add-login", [123]],
    ["feature/ab#123-add-login", [123]],
    ["users/x/123-thing", [123]],
    ["users/jo/4567_fix-thing", [4567]],
    ["bugfix/42-null-ref", [42]],
    ["users/x/1234567-big", [1234567]],
    ["feature/AB#123-and-AB#456", [123, 456]],
    ["users/x/12-a/34-b", [12, 34]],
    ["users/x/123-thing-AB#123", [123]],
  ];
  it.each(found)("%s gives %j", (branch, ids) => {
    expect(findBranchWorkItemIds(branch), `Expected the work items of ${branch}`).toEqual(ids);
  });

  it("returns each id once when the branch names it both ways, and both ids when they differ", () => {
    expect([...findBranchWorkItemIds("users/x/5-thing-AB#9")].sort((a, b) => a - b), "Expected 5 and 9, once each").toEqual([5, 9]);
  });

  // The false positives: a link to the wrong work item is worse than no link.
  const notFound: [string, string][] = [
    ["123-thing", "no folder: GitHub's own issue-branch format, an issue number rather than a work item"],
    ["feature/add-login", "no digits"],
    ["main", "no digits"],
    ["feature/123", "a bare number with no text after it"],
    ["feature/2fa-login", "digits followed by letters, not a separator"],
    ["feature/v2-redesign", "a version, not leading digits"],
    ["feature/PROJ-123-thing", "a Jira-style key, not an Azure Boards id"],
    ["release/2024-01-15-hotfix", "a date: a digit follows the separator"],
    ["release/20240115-hotfix", "an eight-digit date"],
    ["release/1-0-0", "a version written with dashes"],
    ["feature/0-thing", "zero is not a work item id"],
    ["feature/007-bond", "a leading zero"],
    ["feature/AB-123-thing", "AB- is not the AB# reference"],
    ["feature/AB#", "AB# with no number"],
    ["feature/AB#0", "zero is not a work item id"],
    ["feature/AB#1234x", "not a whole number"],
  ];
  it.each(notFound)("%s gives nothing (%s)", (branch) => {
    expect(findBranchWorkItemIds(branch), `Expected no work item from ${branch}`).toEqual([]);
  });

  it("gives [] for an empty name", () => {
    expect(findBranchWorkItemIds(""), "Expected no work items for an empty branch name").toEqual([]);
  });
});

describe("CP-3: newPrWorkItemIds combines the branch and the commits", () => {
  const commit = (subject: string, body = "") => ({ subject, body });

  it("lists the branch's ids first, then the commits', each once", () => {
    const ids = newPrWorkItemIds({ branch: "users/x/123-thing", commits: [commit("Fix bug AB#456"), commit("More", "Relates to AB#123 and AB#789.")] });
    expect(ids, "Expected 123 (branch), 456 and 789 (commits), 123 not repeated").toEqual([123, 456, 789]);
  });

  it("reads AB# from commit subjects and bodies but not from code", () => {
    const ids = newPrWorkItemIds({ branch: null, commits: [commit("Subject", "Use `AB#5` in the text.\n\n```\nAB#6\n```\nBut AB#7 is real.")] });
    expect(ids, "Expected only the mention outside code").toEqual([7]);
  });

  it("copes with no branch and no commits", () => {
    expect(newPrWorkItemIds({ branch: null, commits: [] }), "Expected no ids").toEqual([]);
    expect(newPrWorkItemIds({ branch: "feature/add-login", commits: [commit("Add it")] }), "Expected no ids when nothing matches").toEqual([]);
  });
});

describe("CP-3: prefillWorkItems adds AB#id to the description through addWorkItemToBody", () => {
  it("appends the ids on one line after a blank line", () => {
    expect(prefillWorkItems("Adds the login page.", [123, 456]), "Expected the body, a blank line, then AB#123 AB#456").toBe("Adds the login page.\n\nAB#123 AB#456");
  });

  it("gives just the references for an empty body", () => {
    expect(prefillWorkItems("", [123]), "Expected only AB#123").toBe("AB#123");
  });

  it("leaves a body that already mentions an id alone", () => {
    expect(prefillWorkItems("Done. AB#123", [123]), "Expected no duplicate AB#123").toBe("Done. AB#123");
    expect(prefillWorkItems("Done.\n\nAB#123", [123, 456]), "Expected 456 joined to the existing reference line").toBe("Done.\n\nAB#123 AB#456");
  });

  it("returns the body unchanged when there are no ids", () => {
    expect(prefillWorkItems("Body\r\n", []), "Expected the body byte for byte").toBe("Body\r\n");
  });

  it("keeps the body's line-break style", () => {
    expect(prefillWorkItems("Line one\r\n\r\nLine two", [9]), "Expected CRLF between the body and the reference").toBe("Line one\r\n\r\nLine two\r\n\r\nAB#9");
  });

  it("gives the same result as applying addWorkItemToBody id by id", () => {
    const body = "## Summary\n\nText.";
    expect(prefillWorkItems(body, [1, 2, 3]), "Expected prEdit.addWorkItemToBody applied in order").toBe(addWorkItemToBody(addWorkItemToBody(addWorkItemToBody(body, 1), 2), 3));
  });
});

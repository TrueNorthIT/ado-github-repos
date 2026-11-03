import { describe, it, expect } from "vitest";
import { parseWiqlIds, parseWorkItemId, wiqlTitleQuery, wiqlUrl } from "./workItemSearch";

describe("ED-4: parseWorkItemId", () => {
  it.each([["123", 123], ["#123", 123], ["AB#123", 123], [" ab#7 ", 7]])("reads %j as %i", (text, id) => {
    expect(parseWorkItemId(text), `Expected ${JSON.stringify(text)} to be work item ${id}`).toBe(id);
  });
  it.each(["", "0", "retry jobs", "12 34", "AB#", "1234567890"])("does not read %j as an id", (text) => {
    expect(parseWorkItemId(text), `Expected ${JSON.stringify(text)} not to be an id`).toBeNull();
  });
});

describe("ED-4: wiqlTitleQuery", () => {
  it("searches the title inside the current project", () => {
    const q = wiqlTitleQuery("  retry jobs ").query;
    expect(q, "Expected the project filter").toContain("[System.TeamProject] = @project");
    expect(q, "Expected a CONTAINS on the trimmed title").toContain("[System.Title] CONTAINS 'retry jobs'");
  });
  it("doubles single quotes so the text cannot leave its string", () => {
    expect(wiqlTitleQuery("it's' OR 1=1").query, "Expected quotes doubled").toContain("CONTAINS 'it''s'' OR 1=1'");
  });
});

describe("ED-4: parseWiqlIds and wiqlUrl", () => {
  it("lists the ids in order and tolerates missing data", () => {
    expect(parseWiqlIds({ workItems: [{ id: 5 }, null, { id: 2 }] }), "Expected [5, 2]").toEqual([5, 2]);
    expect(parseWiqlIds(null), "Expected [] for null").toEqual([]);
  });
  it("builds the project-scoped URL with $top", () => {
    expect(wiqlUrl("org x", "Proj", 10), "Expected an encoded org and project").toBe("https://dev.azure.com/org%20x/Proj/_apis/wit/wiql?$top=10&api-version=7.1");
  });
});

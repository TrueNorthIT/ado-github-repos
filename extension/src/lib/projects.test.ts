import { describe, it, expect } from "vitest";
import { projectItemsQuery, toProjectRows, repoProjectsQuery, orgProjectsQuery, mergeProjectOptions, addProjectItemMutation, deleteProjectItemMutation } from "./projects";
import { expectMutation, expectNotInQuery, expectPrQuery, norm, NASTY } from "./ciTestHelpers";
import { expectConnectionCall, expectQueryOperation, expectSelection } from "./editTestHelpers";

// Module under test: src/lib/projects.ts (stubs until the developer implements them). Schema facts are in its header.
// Requirement ED-7 "Projects (v2). List projectItems on the PR with project title and status field value. Add with addProjectV2ItemById(input:{projectId, contentId}) and remove with deleteProjectV2Item.
// Find projects through the org's projectsV2(query:) and the repo's projectsV2. The GitHub App has org Projects read/write."
// Decisions fixed by these tests:
//  - projectItems has its own query: ProjectV2 fields need the read:project scope and would fail the whole edit query without it (seen live).
//  - the Status value is the single-select option name, null for any other kind of value.
//  - repository-linked projects are listed before organisation projects; closed and already-attached projects are not offered.
//  - deleteProjectV2Item needs the ProjectV2Item id (itemId), not the pull request id.

const proj = (id: string, title = `Project ${id}`, closed = false) => ({ id, title, url: `https://github.com/orgs/octo/projects/${id}`, closed });

describe("ED-7: projectItemsQuery", () => {
  it("is a variables-only pull request query", () => {
    const req = projectItemsQuery({ owner: "octo", name: "repo", number: 7 });
    expectPrQuery(req);
    expect(req.variables, "Expected variables { owner, name, number }").toEqual({ owner: "octo", name: "repo", number: 7 });
  });

  it("selects each item's id, project title and Status value", () => {
    const req = projectItemsQuery({ owner: "o", name: "r", number: 1 });
    expectConnectionCall(req, "projectItems", ["first:20"]);
    expectSelection(req, /projectItems\([^)]*\)\s*\{\s*nodes/, ["id", "project"], "the project item fields");
    expectSelection(req, /project\s*(?=\{)/, ["id", "title", "url", "closed"], "the project");
    expect(norm(req.query), 'Expected fieldValueByName(name: "Status")').toMatch(/fieldValueByName\(name:\s*"Status"\)/);
    expect(norm(req.query), "Expected the single-select value's name").toMatch(/\.\.\. on ProjectV2ItemFieldSingleSelectValue\s*\{[^}]*\bname\b/);
  });

  it("sends awkward owner and name only in variables", () => {
    expectNotInQuery(projectItemsQuery({ owner: NASTY[0], name: NASTY[1], number: 1 }), [NASTY[0], NASTY[1]]);
  });
});

describe("ED-7: toProjectRows", () => {
  it("maps items to rows with the project title and Status", () => {
    const rows = toProjectRows([
      { id: "I1", project: proj("P1", "Roadmap"), fieldValueByName: { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "In progress" } },
      { id: "I2", project: proj("P2", "Backlog", true), fieldValueByName: null },
    ]);
    expect(rows, "Expected one row per item, in order").toEqual([
      { itemId: "I1", projectId: "P1", title: "Roadmap", url: "https://github.com/orgs/octo/projects/P1", status: "In progress", closed: false },
      { itemId: "I2", projectId: "P2", title: "Backlog", url: "https://github.com/orgs/octo/projects/P2", status: null, closed: true },
    ]);
  });

  it("gives a null status for a value that is not a single-select option, or has no name", () => {
    const rows = toProjectRows([
      { id: "I1", project: proj("P1"), fieldValueByName: { __typename: "ProjectV2ItemFieldTextValue" } },
      { id: "I2", project: proj("P2"), fieldValueByName: {} },
    ]);
    expect(rows.map((r) => r.status), "Expected null for both").toEqual([null, null]);
  });

  it("drops null items and items whose project the viewer cannot see", () => {
    const rows = toProjectRows([null, { id: "I1", project: null }, { id: "I2", project: proj("P2") }]);
    expect(rows.map((r) => r.itemId), "Expected only I2").toEqual(["I2"]);
  });

  it("gives [] for missing input", () => {
    expect(toProjectRows(null), "Expected [] for null").toEqual([]);
    expect(toProjectRows(undefined), "Expected [] for undefined").toEqual([]);
  });
});

describe("ED-7: repoProjectsQuery and orgProjectsQuery", () => {
  it("repoProjectsQuery asks repository.projectsV2 for projects the viewer can write to", () => {
    const req = repoProjectsQuery({ owner: "octo", name: "repo", query: "road" });
    expectQueryOperation(req);
    expect(req.query, "Expected repository(owner: $owner, name: $name)").toMatch(/repository\(owner:\s*\$owner,\s*name:\s*\$name\)/);
    expectConnectionCall(req, "projectsV2", ["query:$query", "first:20", "minPermissionLevel:WRITE"]);
    expectSelection(req, /projectsV2\([^)]*\)\s*\{\s*nodes/, ["id", "title", "url", "closed"], "the project fields");
    expect(req.variables, "Expected variables { owner, name, query }").toEqual({ owner: "octo", name: "repo", query: "road" });
  });

  it("orgProjectsQuery asks organization(login: $org).projectsV2 for projects the viewer can write to", () => {
    const req = orgProjectsQuery({ org: "octo-org", query: "road" });
    expectQueryOperation(req);
    expect(req.query, "Expected organization(login: $org)").toMatch(/organization\(login:\s*\$org\)/);
    expectConnectionCall(req, "projectsV2", ["query:$query", "first:20", "minPermissionLevel:WRITE"]);
    expectSelection(req, /projectsV2\([^)]*\)\s*\{\s*nodes/, ["id", "title", "url", "closed"], "the project fields");
    expect(req.variables, "Expected variables { org, query }").toEqual({ org: "octo-org", query: "road" });
  });

  it("trim the query and send null when blank", () => {
    expect(repoProjectsQuery({ owner: "o", name: "r", query: " x " }).variables, "Expected a trimmed query").toMatchObject({ query: "x" });
    expect(repoProjectsQuery({ owner: "o", name: "r", query: "" }).variables, "Expected null for a blank query (repo)").toMatchObject({ query: null });
    expect(orgProjectsQuery({ org: "o", query: "  " }).variables, "Expected null for a blank query (org)").toEqual({ org: "o", query: null });
  });

  it("keep awkward text out of the query string", () => {
    expectNotInQuery(repoProjectsQuery({ owner: NASTY[0], name: NASTY[1], query: NASTY[2] }), [NASTY[0], NASTY[1], NASTY[2]]);
    expectNotInQuery(orgProjectsQuery({ org: NASTY[0], query: NASTY[3] }), [NASTY[0], NASTY[3]]);
  });
});

describe("ED-7: mergeProjectOptions", () => {
  it("lists repository projects before organisation projects, each in the order given", () => {
    const out = mergeProjectOptions([proj("R2"), proj("R1")], [proj("O1"), proj("O2")], []);
    expect(out.map((p) => p.id), "Expected R2, R1, O1, O2").toEqual(["R2", "R1", "O1", "O2"]);
  });

  it("lists a project found by both searches once, in the repository group", () => {
    const out = mergeProjectOptions([proj("P1"), proj("P2")], [proj("P0"), proj("P1")], []);
    expect(out.map((p) => p.id), "Expected P1 once, in the repository group").toEqual(["P1", "P2", "P0"]);
  });

  it("leaves out closed projects and projects already on the pull request", () => {
    const out = mergeProjectOptions([proj("R1", "Closed one", true), proj("R2")], [proj("O1"), proj("O2")], ["R2", "O1"]);
    expect(out.map((p) => p.id), "Expected only O2").toEqual(["O2"]);
  });

  it("offers id, title and url", () => {
    expect(mergeProjectOptions([proj("R1", "Roadmap")], [], []), "Expected the option shape").toEqual([{ id: "R1", title: "Roadmap", url: "https://github.com/orgs/octo/projects/R1" }]);
  });

  it("copes with null lists and null nodes (a failed organisation search for a user-owned repository)", () => {
    expect(mergeProjectOptions([null, proj("R1")], null, []).map((p) => p.id), "Expected R1 only").toEqual(["R1"]);
    expect(mergeProjectOptions(undefined, [proj("O1"), null], []).map((p) => p.id), "Expected O1 only").toEqual(["O1"]);
    expect(mergeProjectOptions(null, null, []), "Expected []").toEqual([]);
  });
});

describe("ED-7: addProjectItemMutation and deleteProjectItemMutation", () => {
  it("add is addProjectV2ItemById(input: $input) with { projectId, contentId }", () => {
    const req = addProjectItemMutation({ projectId: "P1", contentId: "PR1" });
    expectMutation(req, "AddProjectV2ItemByIdInput", "addProjectV2ItemById");
    expect(req.variables, "Expected { projectId, contentId }").toEqual({ input: { projectId: "P1", contentId: "PR1" } });
    expectSelection(req, /addProjectV2ItemById\(input:\s*\$input\)\s*\{\s*item/, ["id"], "the new item id");
  });

  it("delete is deleteProjectV2Item(input: $input) with { projectId, itemId }", () => {
    const req = deleteProjectItemMutation({ projectId: "P1", itemId: "I1" });
    expectMutation(req, "DeleteProjectV2ItemInput", "deleteProjectV2Item");
    expect(req.variables, "Expected { projectId, itemId }").toEqual({ input: { projectId: "P1", itemId: "I1" } });
    expect(norm(req.query), "Expected deletedItemId in the payload").toContain("deletedItemId");
  });

  it("keep ids out of the query text", () => {
    expectNotInQuery(addProjectItemMutation({ projectId: NASTY[0], contentId: NASTY[1] }), [NASTY[0], NASTY[1]]);
    expectNotInQuery(deleteProjectItemMutation({ projectId: NASTY[0], itemId: NASTY[1] }), [NASTY[0], NASTY[1]]);
  });

  it("refuse blank ids", () => {
    expect(() => addProjectItemMutation({ projectId: " ", contentId: "PR1" }), "Expected a blank projectId to be refused (add)").toThrow(/projectId is required/);
    expect(() => addProjectItemMutation({ projectId: "P1", contentId: "" }), "Expected a blank contentId to be refused").toThrow(/contentId is required/);
    expect(() => deleteProjectItemMutation({ projectId: "", itemId: "I1" }), "Expected a blank projectId to be refused (delete)").toThrow(/projectId is required/);
    expect(() => deleteProjectItemMutation({ projectId: "P1", itemId: " " }), "Expected a blank itemId to be refused").toThrow(/itemId is required/);
  });
});

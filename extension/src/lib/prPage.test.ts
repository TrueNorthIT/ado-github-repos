import { describe, it, expect } from "vitest";
import { detailQuery } from "./prQuery";
import { toPrPage, type PrDetailNode } from "./prModel";
import { fromRestFile } from "./prFiles";
import { parseWorkItems, workItemsUrl, workItemUrl } from "./workItems";

const node: PrDetailNode = {
  number: 5, title: "T", url: "u", state: "OPEN", isDraft: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", baseRefName: "main", headRefName: "f",
  body: "md", bodyHTML: "<p>md</p>", headRefOid: "h".repeat(40), baseRefOid: "b".repeat(40),
  commits: { nodes: [{ commit: { oid: "a".repeat(40), message: "m", authoredDate: "2026-01-01T00:00:00Z", author: { name: "N", avatarUrl: "https://a/x" } } }, { commit: { oid: "c".repeat(40), message: "m2", authoredDate: "2026-01-01T00:00:00Z" } }] },
};

describe("PR page query and mapping", () => {
  it("detailQuery asks for the rendered body, both shas and commit avatars", () => {
    const q = detailQuery({ owner: "o", name: "n", number: 1 }).query;
    for (const f of ["bodyHTML", "headRefOid", "baseRefOid", "avatarUrl"]) expect(q).toContain(f);
  });
  it("toPrPage adds html, shas and a parallel avatar list", () => {
    const p = toPrPage(node);
    expect(p.bodyHtml).toBe("<p>md</p>");
    expect([p.baseSha, p.headSha]).toEqual(["b".repeat(40), "h".repeat(40)]);
    expect(p.commitAvatars).toEqual(["https://a/x", ""]);
    expect(p.commits).toHaveLength(2);
  });
  it("toPrPage tolerates a missing body, shas and avatars", () => {
    const p = toPrPage({ ...node, bodyHTML: undefined, headRefOid: undefined, baseRefOid: undefined, commits: null });
    expect([p.bodyHtml, p.baseSha, p.headSha, p.commitAvatars]).toEqual(["", "", "", []]);
  });
});

describe("fromRestFile", () => {
  it.each([["added", "ADDED"], ["removed", "DELETED"], ["modified", "MODIFIED"], ["renamed", "RENAMED"], ["copied", "COPIED"], ["changed", "CHANGED"], ["unchanged", "CHANGED"]])("%s maps to %s", (status, type) => {
    expect(fromRestFile({ filename: "a/b.ts", status, additions: 1, deletions: 2 }).changeType).toBe(type);
  });
  it("keeps the path, counts, old path and patch", () => {
    expect(fromRestFile({ filename: "n.ts", status: "renamed", additions: 3, deletions: 4, previous_filename: "o.ts", patch: "@@" })).toEqual({ path: "n.ts", additions: 3, deletions: 4, changeType: "RENAMED", previousPath: "o.ts", patch: "@@" });
  });
});

describe("work items", () => {
  it("builds the batch URL with errorPolicy=omit", () => {
    const u = workItemsUrl("org name", [1, 2]);
    expect(u).toContain("/org%20name/_apis/wit/workitems?ids=1,2&");
    expect(u).toContain("errorPolicy=omit");
    expect(u).toContain("api-version=7.1");
  });
  it("links to the work item page", () => {
    expect(workItemUrl("o", "My Proj", 7)).toBe("https://dev.azure.com/o/My%20Proj/_workitems/edit/7");
  });
  it("maps results onto the requested ids, flagging nulls and omissions", () => {
    const r = parseWorkItems([1, 2, 3], { value: [{ id: 1, fields: { "System.Title": "A", "System.State": "Active", "System.WorkItemType": "Bug" } }, null] });
    expect(r).toEqual([{ id: 1, found: true, title: "A", state: "Active", type: "Bug" }, { id: 2, found: false }, { id: 3, found: false }]);
  });
  it("treats an empty or missing body as nothing found", () => {
    expect(parseWorkItems([9], undefined)).toEqual([{ id: 9, found: false }]);
  });
});

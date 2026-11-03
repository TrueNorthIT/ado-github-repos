import { describe, it, expect } from "vitest";
import {
  VIEWED_PAGE_SIZE,
  CHANGED_SINCE_VIEWED,
  viewedFilesQuery,
  markViewedMutation,
  unmarkViewedMutation,
  toViewedPage,
  mergeViewed,
  viewedProgress,
  isCollapsedByDefault,
  changedSinceViewed,
  withViewed,
  type ViewedState,
} from "./viewedFiles";
import { expectMutation, expectPrQuery, expectNotInQuery, NASTY } from "./ciTestHelpers";
import { expectQueryOperation } from "./editTestHelpers";
import { expectNestedSelection, expectDeclares } from "./b4TestHelpers";

// Module under test: src/lib/viewedFiles.ts (stubs until the developer implements them). Requirement VW-3: "Viewed files. markFileAsViewed / unmarkFileAsViewed(input:{pullRequestId, path}), and
// files(first:100){ nodes{ path viewerViewedState } } (VIEWED / UNVIEWED / DISMISSED; DISMISSED means changed since you viewed). Model the "N of M viewed" progress, the collapse of viewed files by
// default, and a "Changed since last viewed" badge. Paging past 100 files." Schema facts are in the header of src/lib/viewedFiles.ts.

const page = (nodes: any[], hasNextPage = false, endCursor: string | null = null, id = "PR_1") => ({ data: { repository: { pullRequest: { id, files: { pageInfo: { hasNextPage, endCursor }, nodes } } } } });

describe("VW-3: viewedFilesQuery reads viewerViewedState of the changed files, a page at a time", () => {
  const req = () => viewedFilesQuery({ owner: "octo", name: "demo", number: 7 });

  it("is a variables-only query over repository { pullRequest(number) } with an $after cursor", () => {
    expectQueryOperation(req());
    expectPrQuery(req());
    expectDeclares(req(), ["$after: String"]);
    expect(req().variables, "Expected variables { owner, name, number, after: null } on the first page").toEqual({ owner: "octo", name: "demo", number: 7, after: null });
  });

  it("asks for the first 100 files after the cursor, with path and viewerViewedState, plus the paging info and the PR id", () => {
    expect(VIEWED_PAGE_SIZE, "Expected the page size to be GitHub's maximum, 100").toBe(100);
    expect(req().query.replace(/\s+/g, " "), "Expected files(first: 100, after: $after)").toMatch(/files\(first:\s*100,\s*after:\s*\$after\)/);
    expectNestedSelection(req(), /files\([^)]*\)/, ["pageInfo", "hasNextPage", "endCursor", "nodes", "path", "viewerViewedState"], "the files connection");
    expectNestedSelection(req(), /pullRequest\(number:\s*\$number\)/, ["id"], "the pullRequest (its id is what the mutations need)");
  });

  it("sends the cursor in variables and keeps caller values out of the text", () => {
    expect(viewedFilesQuery({ owner: "o", name: "n", number: 1, after: "Mw" }).variables.after, "Expected the cursor in variables").toBe("Mw");
    NASTY.forEach((v) => expectNotInQuery(viewedFilesQuery({ owner: v, name: v, number: 1, after: v }), [v]));
  });
});

describe.each([
  ["markViewedMutation", markViewedMutation, "MarkFileAsViewedInput", "markFileAsViewed"],
  ["unmarkViewedMutation", unmarkViewedMutation, "UnmarkFileAsViewedInput", "unmarkFileAsViewed"],
] as const)("VW-3: %s", (_name, build, inputType, field) => {
  it(`is a variables-only mutation taking $input: ${inputType}!`, () => {
    const req = build("PR_1", "src/a.ts");
    expectMutation(req, inputType, field);
    expect(Object.keys(req.variables), "Expected the only variable to be input").toEqual(["input"]);
  });

  it("sends exactly { pullRequestId, path }", () => {
    expect(build("PR_1", "src/a.ts").variables.input, "Expected input { pullRequestId, path } and nothing else").toEqual({ pullRequestId: "PR_1", path: "src/a.ts" });
  });

  it("selects the pull request id", () => {
    expectNestedSelection(build("PR_1", "a"), /pullRequest(?=\s*\{)/, ["id"], "the pullRequest payload");
  });

  it("sends an awkward path exactly as given and keeps it out of the query text", () => {
    NASTY.forEach((v) => {
      const req = build("PR_1", v);
      expect((req.variables.input as { path: string }).path, `Expected the path ${JSON.stringify(v)} to arrive unchanged`).toBe(v);
      expectNotInQuery(req, [v]);
    });
  });

  it("rejects a blank pull request id or path", () => {
    expect(() => build(" ", "a.ts"), "Expected a blank id to be refused").toThrow("pullRequestId is required");
    expect(() => build("PR_1", ""), "Expected a blank path to be refused").toThrow("path is required");
  });
});

describe("VW-3: toViewedPage and mergeViewed read states across pages of 100", () => {
  it("maps path to state and carries the paging info and PR id", () => {
    const p = toViewedPage(page([{ path: "a.ts", viewerViewedState: "VIEWED" }, { path: "b.ts", viewerViewedState: "DISMISSED" }, { path: "c.ts", viewerViewedState: "UNVIEWED" }], true, "Mw", "PR_9"));
    expect(p.states, "Expected each path with its viewerViewedState").toEqual({ "a.ts": "VIEWED", "b.ts": "DISMISSED", "c.ts": "UNVIEWED" });
    expect([p.hasNextPage, p.cursor, p.pullRequestId], "Expected hasNextPage, endCursor and the PR id").toEqual([true, "Mw", "PR_9"]);
  });

  it("has no cursor on the last page", () => {
    const p = toViewedPage(page([{ path: "a.ts", viewerViewedState: "VIEWED" }], false, "Mg"));
    expect([p.hasNextPage, p.cursor], "Expected no further page and a null cursor").toEqual([false, null]);
  });

  it("skips null nodes and treats an unrecognised state as UNVIEWED", () => {
    const p = toViewedPage(page([null, { path: "a.ts", viewerViewedState: "SOMETHING_NEW" }]));
    expect(p.states, "Expected the null node skipped and the unknown state UNVIEWED").toEqual({ "a.ts": "UNVIEWED" });
  });

  it("gives an empty page, without throwing, when the pull request is missing", () => {
    const p = toViewedPage({ data: { repository: { pullRequest: null } }, errors: [{ message: "boom" }] });
    expect(p, "Expected an empty page").toEqual({ pullRequestId: "", states: {}, hasNextPage: false, cursor: null });
    expect(toViewedPage(undefined).states, "Expected undefined to give an empty page").toEqual({});
  });

  it("merges two full pages of 100 into 200 entries", () => {
    const mk = (from: number, state: string, more: boolean) => toViewedPage(page(Array.from({ length: 100 }, (_, i) => ({ path: `f${from + i}.ts`, viewerViewedState: state })), more, more ? "Y3Vy" : null));
    const merged = mergeViewed([mk(0, "VIEWED", true), mk(100, "UNVIEWED", false)]);
    expect(Object.keys(merged), "Expected every file of both pages").toHaveLength(200);
    expect([merged["f0.ts"], merged["f199.ts"]], "Expected each page's states to survive").toEqual(["VIEWED", "UNVIEWED"]);
  });

  it("lets a later page win on a repeated path and merges none to {}", () => {
    const a = toViewedPage(page([{ path: "a.ts", viewerViewedState: "UNVIEWED" }]));
    const b = toViewedPage(page([{ path: "a.ts", viewerViewedState: "VIEWED" }]));
    expect(mergeViewed([a, b]), "Expected the later page's state").toEqual({ "a.ts": "VIEWED" });
    expect(mergeViewed([]), "Expected {} for no pages").toEqual({});
  });
});

describe("VW-3: viewedProgress is 'N of M viewed'", () => {
  const paths = ["a.ts", "b.ts", "c.ts", "d.ts"];

  it("counts VIEWED files against every changed file and words it '2 of 4 viewed'", () => {
    const p = viewedProgress(paths, { "a.ts": "VIEWED", "b.ts": "VIEWED", "c.ts": "UNVIEWED" });
    expect(p, "Expected 2 of 4 viewed").toEqual({ viewed: 2, total: 4, text: "2 of 4 viewed" });
  });

  it("does not count DISMISSED files (they changed since they were viewed) and counts a path with no state as unviewed", () => {
    const p = viewedProgress(paths, { "a.ts": "DISMISSED", "b.ts": "VIEWED" });
    expect(p.viewed, "Expected only VIEWED to count").toBe(1);
    expect(p.total, "Expected the total to be every changed file, known or not").toBe(4);
  });

  it("ignores states for paths that are no longer changed files", () => {
    expect(viewedProgress(["a.ts"], { "a.ts": "VIEWED", "gone.ts": "VIEWED" }), "Expected 1 of 1, not 2 of 1").toMatchObject({ viewed: 1, total: 1, text: "1 of 1 viewed" });
  });

  it("covers more than one page of files", () => {
    const many = Array.from({ length: 250 }, (_, i) => `f${i}.ts`);
    const states = Object.fromEntries(many.slice(0, 120).map((p) => [p, "VIEWED"])) as Record<string, ViewedState>;
    expect(viewedProgress(many, states).text, "Expected 120 of 250 viewed").toBe("120 of 250 viewed");
  });

  it("says '0 of 0 viewed' for no files", () => {
    expect(viewedProgress([], {}).text, "Expected 0 of 0 viewed").toBe("0 of 0 viewed");
  });
});

describe("VW-3: viewed files collapse and changed-since-viewed files are flagged", () => {
  it.each([
    ["VIEWED", true],
    ["UNVIEWED", false],
    ["DISMISSED", false],
    [undefined, false],
  ] as const)("isCollapsedByDefault(%s) is %s", (state, collapsed) => {
    expect(isCollapsedByDefault(state), `Expected a ${state ?? "stateless"} file to be ${collapsed ? "collapsed" : "expanded"} when the Files tab opens`).toBe(collapsed);
  });

  it.each([
    ["DISMISSED", true],
    ["VIEWED", false],
    ["UNVIEWED", false],
    [undefined, false],
  ] as const)("changedSinceViewed(%s) is %s", (state, badge) => {
    expect(changedSinceViewed(state), `Expected the "${CHANGED_SINCE_VIEWED}" badge to be ${badge ? "shown" : "hidden"} for ${state ?? "no state"}`).toBe(badge);
  });

  it("words the badge 'Changed since last viewed'", () => {
    expect(CHANGED_SINCE_VIEWED, "Expected the badge text from the requirement").toBe("Changed since last viewed");
  });
});

describe("VW-3: withViewed updates the local state after a toggle", () => {
  it("marks a file VIEWED, or UNVIEWED when unticked, without changing the input", () => {
    const before: Record<string, ViewedState> = { "a.ts": "DISMISSED", "b.ts": "VIEWED" };
    expect(withViewed(before, "a.ts", true), "Expected a.ts VIEWED and b.ts untouched").toEqual({ "a.ts": "VIEWED", "b.ts": "VIEWED" });
    expect(withViewed(before, "b.ts", false), "Expected b.ts UNVIEWED").toEqual({ "a.ts": "DISMISSED", "b.ts": "UNVIEWED" });
    expect(before, "Expected the input record to be left alone").toEqual({ "a.ts": "DISMISSED", "b.ts": "VIEWED" });
  });

  it("adds a path that had no state", () => {
    expect(withViewed({}, "new.ts", true), "Expected the new path to be VIEWED").toEqual({ "new.ts": "VIEWED" });
  });
});

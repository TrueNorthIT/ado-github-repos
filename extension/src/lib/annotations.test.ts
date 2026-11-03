import { describe, it, expect } from "vitest";
import { annotationsQuery, mapAnnotations, type AnnotatedContext, type AnnotationNode } from "./annotations";
import { expectNotInQuery, expectPrQuery, norm, NASTY } from "./ciTestHelpers";

// Module under test: src/lib/annotations.ts (annotationsQuery, mapAnnotations).
// Requirement CI-1: "Check annotations inline in the diff": annotations of the head commit's check runs, mapped to per-file anchors on the head (RIGHT)
// side by end line, grouped per (path, line) with the check name attached; annotations on files not in the PR are dropped from the inline view but
// still counted per check; severity ordering failure, warning, notice.
//
// Decisions fixed by these tests (the brief left them open):
//  - GraphQL, not REST: CheckRun.annotations(first: 50) { totalCount nodes { ... } } in one query (measured cost: 3 points for 3 PRs of up to 100 checks).
//  - the anchor line is location.end.line; when end is missing the start line is used; an annotation with neither is dropped from the diff but counted.
//  - side is always "RIGHT". Anchors per file ascend by line. Inside an anchor annotations run FAILURE, WARNING, NOTICE (stable within a level),
//    and the anchor's own `level` is the worst of them. A null annotationLevel counts as NOTICE.
//  - perCheck lists only check runs with at least one annotation (totalCount > 0), worst level first, then input order. `total` is totalCount
//    (so it can exceed the 50 fetched, then `truncated` is true); failure/warning/notice count the fetched nodes; `inline` counts those placed on the diff.
//  - real data seen on cli/cli and dotnet/runtime: paths such as ".github" and "Build log " that are not files of the PR, null rawDetails and "" titles.

const ann = (over: Partial<AnnotationNode> = {}): AnnotationNode => ({
  path: "src/app.ts",
  location: { start: { line: 10 }, end: { line: 10 } },
  annotationLevel: "WARNING",
  title: "A title",
  message: "A message",
  rawDetails: null,
  ...over,
});
const at = (path: string, line: number, level: AnnotationNode["annotationLevel"], message = "m", over: Partial<AnnotationNode> = {}) =>
  ann({ path, location: { start: { line }, end: { line } }, annotationLevel: level, message, ...over });
const run = (name: string, nodes: AnnotationNode[], totalCount = nodes.length, databaseId = 1): AnnotatedContext => ({
  __typename: "CheckRun",
  databaseId,
  name,
  annotations: { totalCount, nodes },
});

describe("CI-1: annotationsQuery reads the head commit's check runs and their annotations", () => {
  // Given owner, name and number, the request selects each CheckRun's annotations; every caller value is a variable.
  it("takes { owner, name, number } as variables on repository.pullRequest", () => {
    const req = annotationsQuery({ owner: "octo", name: "repo", number: 7 });
    expectPrQuery(req);
    expect(req.variables, "Expected variables { owner, name, number } and nothing else").toEqual({ owner: "octo", name: "repo", number: 7 });
  });

  it("selects the head commit's check contexts (statusCheckRollup) and, per CheckRun, the first 50 annotations with the agreed fields", () => {
    const q = norm(annotationsQuery({ owner: "o", name: "r", number: 1 }).query);
    expect(q, "Expected statusCheckRollup { contexts(...) } for the head commit").toMatch(/statusCheckRollup\s*\{\s*contexts\(/);
    expect(q, "Expected ... on CheckRun with databaseId and name").toMatch(/\.\.\.\s*on CheckRun\s*\{[^]*\bdatabaseId\b[^]*\bname\b/);
    expect(q, "Expected annotations(first: 50)").toMatch(/annotations\(first:\s*50\)/);
    expect(q, "Expected totalCount so a run with more than 50 annotations is counted truly").toMatch(/annotations\(first:\s*50\)\s*\{[^]*\btotalCount\b/);
    for (const field of ["path", "annotationLevel", "title", "message", "rawDetails"]) {
      expect(q, `Expected the annotation selection to include ${field}`).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(q, "Expected location { start { line } end { line } }").toMatch(/location\s*\{\s*start\s*\{\s*line\s*\}\s*end\s*\{\s*line\s*\}\s*\}/);
  });

  it.each(NASTY)("keeps %j out of the query text", (v) => {
    const req = annotationsQuery({ owner: v, name: v, number: 1 });
    expectNotInQuery(req, [v]);
    expect(req.variables, "Expected the awkward owner and name to travel in variables").toMatchObject({ owner: v, name: v });
  });
});

describe("CI-1: mapAnnotations places annotations on the head (RIGHT) side by end line", () => {
  // Given one warning ending on src/app.ts line 12 (starting on 10), the file has one RIGHT anchor at line 12 carrying the check name.
  it("anchors an annotation at its END line on the RIGHT side with the check name attached", () => {
    const r = mapAnnotations([run("lint", [ann({ location: { start: { line: 10 }, end: { line: 12 } }, title: "no-unused", message: "x is unused", rawDetails: "details" })])], ["src/app.ts"]);
    expect(r.byFile.get("src/app.ts"), "Expected one RIGHT anchor at end line 12 (not the start line 10) holding the lint annotation").toEqual([
      { line: 12, side: "RIGHT", level: "WARNING", annotations: [{ checkName: "lint", level: "WARNING", title: "no-unused", message: "x is unused", details: "details" }] },
    ]);
  });

  it("falls back to the start line when there is no end line", () => {
    const r = mapAnnotations([run("lint", [ann({ location: { start: { line: 4 }, end: null } })])], ["src/app.ts"]);
    expect(r.byFile.get("src/app.ts")?.map((a) => a.line), "Expected the annotation to anchor at start line 4 when end is null").toEqual([4]);
  });

  it("drops an annotation with no line from the diff but still counts it for its check", () => {
    const r = mapAnnotations([run("lint", [ann({ location: null })])], ["src/app.ts"]);
    expect(r.byFile.size, "Expected a line-less annotation to be left out of the inline view").toBe(0);
    expect(r.perCheck[0], "Expected the check to count the line-less annotation (total 1, inline 0)").toMatchObject({ checkName: "lint", total: 1, inline: 0 });
  });

  it("omits details when rawDetails is null or blank and uses an empty title for a null title", () => {
    const r = mapAnnotations([run("lint", [ann({ rawDetails: null, title: null }), ann({ rawDetails: "  ", title: "" , location: { start: { line: 11 }, end: { line: 11 } } })])], ["src/app.ts"]);
    const items = r.byFile.get("src/app.ts")!.flatMap((a) => a.annotations);
    expect(items.map((x) => x.title), "Expected null and empty titles to be returned as empty strings").toEqual(["", ""]);
    expect(items.every((x) => !("details" in x)), "Expected the details key to be absent when rawDetails is null or blank").toBe(true);
  });

  it("groups annotations on the same (path, line) into one anchor, from different checks too", () => {
    const r = mapAnnotations([run("lint", [at("src/app.ts", 5, "WARNING", "a")]), run("build", [at("src/app.ts", 5, "WARNING", "b")], 1, 2)], ["src/app.ts"]);
    const anchors = r.byFile.get("src/app.ts")!;
    expect(anchors, "Expected one anchor for line 5").toHaveLength(1);
    expect(anchors[0].annotations.map((x) => [x.checkName, x.message]), "Expected both checks' annotations on the shared anchor, in input order").toEqual([["lint", "a"], ["build", "b"]]);
  });

  it("orders anchors ascending by line and keeps files separate", () => {
    const r = mapAnnotations([run("lint", [at("b.ts", 9, "NOTICE"), at("a.ts", 30, "NOTICE"), at("a.ts", 2, "NOTICE")])], ["a.ts", "b.ts"]);
    expect([...r.byFile.keys()].sort(), "Expected one entry per file").toEqual(["a.ts", "b.ts"]);
    expect(r.byFile.get("a.ts")!.map((a) => a.line), "Expected a.ts anchors ascending by line").toEqual([2, 30]);
    expect(r.byFile.get("b.ts")!.map((a) => a.line), "Expected b.ts to hold only its own annotation").toEqual([9]);
  });

  it("ignores StatusContext entries", () => {
    const r = mapAnnotations([{ __typename: "StatusContext" }, run("lint", [at("src/app.ts", 1, "NOTICE")])], ["src/app.ts"]);
    expect(r.perCheck.map((c) => c.checkName), "Expected only the CheckRun to be counted").toEqual(["lint"]);
  });

  it("returns nothing for a check run with a null annotations connection", () => {
    const r = mapAnnotations([{ __typename: "CheckRun", databaseId: 1, name: "lint", annotations: null }], ["src/app.ts"]);
    expect(r, "Expected an empty result when no check run has annotations").toEqual({ byFile: new Map(), perCheck: [] });
  });
});

describe("CI-1: annotations on files outside the pull request leave the inline view but are still counted", () => {
  // Given annotations on src/app.ts (in the PR) and on .github (not a PR file), only the first is placed, and the check counts both.
  it("drops annotations whose path is not a file of the PR", () => {
    const r = mapAnnotations([run("lint", [at("src/app.ts", 3, "FAILURE"), at(".github", 1, "NOTICE"), at("Build log ", 61, "FAILURE"), at("other.ts", 8, "WARNING")])], ["src/app.ts"]);
    expect([...r.byFile.keys()], "Expected only src/app.ts to have an inline entry").toEqual(["src/app.ts"]);
  });

  it("counts every annotation of the check, placed or not", () => {
    const r = mapAnnotations([run("lint", [at("src/app.ts", 3, "FAILURE"), at(".github", 1, "NOTICE"), at("other.ts", 8, "WARNING")])], ["src/app.ts"]);
    expect(r.perCheck, "Expected total 3 (failure 1, warning 1, notice 1) with only 1 placed inline").toEqual([
      { checkName: "lint", total: 3, failure: 1, warning: 1, notice: 1, inline: 1, truncated: false },
    ]);
  });

  it("reports totalCount as the total and marks the counts truncated when more annotations exist than were fetched", () => {
    const r = mapAnnotations([run("big", [at("src/app.ts", 1, "WARNING"), at("src/app.ts", 2, "WARNING")], 120)], ["src/app.ts"]);
    expect(r.perCheck[0], "Expected total 120 from totalCount, with truncated true because only 2 were fetched").toMatchObject({ total: 120, warning: 2, truncated: true });
  });

  it("lists no entry for a check run with no annotations", () => {
    const r = mapAnnotations([run("clean", []), run("lint", [at("src/app.ts", 1, "NOTICE")], 1, 2)], ["src/app.ts"]);
    expect(r.perCheck.map((c) => c.checkName), "Expected only checks with annotations in perCheck").toEqual(["lint"]);
  });

  it("accepts any iterable of PR paths", () => {
    const r = mapAnnotations([run("lint", [at("src/app.ts", 1, "NOTICE")])], new Set(["src/app.ts"]));
    expect(r.byFile.has("src/app.ts"), "Expected a Set of paths to work like an array").toBe(true);
  });
});

describe("CI-1: severity ordering is failure, warning, notice", () => {
  // Given a notice, a failure and a warning on the same line, the anchor lists failure, warning, notice and its level is FAILURE.
  it("orders the annotations within an anchor by severity and gives the anchor the worst level", () => {
    const r = mapAnnotations([run("lint", [at("src/app.ts", 5, "NOTICE", "n"), at("src/app.ts", 5, "FAILURE", "f"), at("src/app.ts", 5, "WARNING", "w")])], ["src/app.ts"]);
    const anchor = r.byFile.get("src/app.ts")![0];
    expect(anchor.annotations.map((x) => x.level), "Expected FAILURE, WARNING, NOTICE inside the anchor").toEqual(["FAILURE", "WARNING", "NOTICE"]);
    expect(anchor.level, "Expected the anchor to carry the worst level, FAILURE").toBe("FAILURE");
  });

  it("keeps input order among annotations of the same level", () => {
    const r = mapAnnotations([run("lint", [at("src/app.ts", 5, "WARNING", "first"), at("src/app.ts", 5, "WARNING", "second")])], ["src/app.ts"]);
    expect(r.byFile.get("src/app.ts")![0].annotations.map((x) => x.message), "Expected a stable order within one level").toEqual(["first", "second"]);
  });

  it("treats a null annotationLevel as NOTICE", () => {
    const r = mapAnnotations([run("lint", [at("src/app.ts", 5, null)])], ["src/app.ts"]);
    expect(r.byFile.get("src/app.ts")![0].level, "Expected a null level to be shown as NOTICE").toBe("NOTICE");
    expect(r.perCheck[0].notice, "Expected a null level to count as a notice").toBe(1);
  });

  it("lists the checks with the worst level first, then in input order", () => {
    const r = mapAnnotations(
      [run("notices", [at("src/app.ts", 1, "NOTICE")], 1, 1), run("warns", [at("src/app.ts", 2, "WARNING")], 1, 2), run("fails", [at("src/app.ts", 3, "FAILURE")], 1, 3), run("warns too", [at("src/app.ts", 4, "WARNING")], 1, 4)],
      ["src/app.ts"]
    );
    expect(r.perCheck.map((c) => c.checkName), "Expected checks ordered fails, warns, warns too, notices").toEqual(["fails", "warns", "warns too", "notices"]);
  });
});

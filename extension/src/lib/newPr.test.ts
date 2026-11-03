import { describe, it, expect } from "vitest";
import {
  defaultBranches,
  newPrQuery,
  mapNewPr,
  humaniseBranch,
  defaultTitle,
  defaultDescription,
  initialDescription,
  createBlockers,
  SAME_BRANCH_MESSAGE,
  NO_CHANGES_MESSAGE,
  NO_SOURCE_MESSAGE,
  NO_TARGET_MESSAGE,
  NO_TITLE_MESSAGE,
  CHECKING_MESSAGE,
  VIEW_EXISTING_LABEL,
  MAX_COMPARE_COMMITS,
  type NewPrCommit,
  type NewPrCompare,
} from "./newPr";
import { MAX_TITLE_LENGTH } from "./prEdit";
import { expectNotInQuery, NASTY } from "./ciTestHelpers";
import { expectQueryOperation, expectConnectionCall } from "./editTestHelpers";
import { expectNestedSelection, expectDeclares } from "./b4TestHelpers";

// Module under test: src/lib/newPr.ts (stubs until the developer implements them). Requirements CP-1 (source and target), CP-2 (default title and description) and CP-5 (validation before Create).
// The schema facts (compare validated live, fork PRs matching headRefName, a missing head giving an errors entry) and the decisions are in the header of src/lib/newPr.ts.
// Shapes below mirror real cli/cli responses; names are generic.

const commit = (subject: string, body = "", oid = subject.length.toString(16).padStart(8, "0")): NewPrCommit => ({ oid, subject, body });

const compare = (over: Partial<NewPrCompare> = {}): NewPrCompare => ({
  repoId: "R_1",
  defaultBranch: "main",
  autoMergeAllowed: true,
  baseExists: true,
  headExists: true,
  ahead: 2,
  behind: 0,
  status: "AHEAD",
  commits: [commit("One"), commit("Two")],
  commitCount: 2,
  existingPr: null,
  ...over,
});

/** A newPrQuery response body for a healthy pair. */
const response = (over: Record<string, unknown> = {}) => ({
  data: {
    repository: {
      id: "R_1",
      defaultBranchRef: { name: "main" },
      autoMergeAllowed: true,
      baseRef: {
        compare: {
          aheadBy: 3,
          behindBy: 28,
          status: "DIVERGED",
          commits: {
            totalCount: 3,
            nodes: [
              { oid: "a1", messageHeadline: "Add shared skill", messageBody: "Explains the skill.\n\nCo-authored-by: A <a@example.com>" },
              { oid: "b2", messageHeadline: "Update shared skill", messageBody: "" },
              { oid: "c3", messageHeadline: "Avoid duplicating guidance", messageBody: null },
            ],
          },
        },
      },
      headRef: { id: "REF_head" },
      pullRequests: { nodes: [] },
      ...over,
    },
  },
});

describe("CP-1: defaultBranches", () => {
  it("makes the repository's default branch the target and the entry point's branch the source", () => {
    expect(defaultBranches({ defaultBranch: "main", entrySource: "feature/x" }), "Expected target main and source feature/x").toEqual({ source: "feature/x", target: "main" });
  });

  it("leaves the source empty when there is no entry point", () => {
    expect(defaultBranches({ defaultBranch: "main" }), "Expected no source without an entry point").toEqual({ source: null, target: "main" });
    expect(defaultBranches({ defaultBranch: "main", entrySource: null }), "Expected no source for a null entry point").toEqual({ source: null, target: "main" });
  });

  it("treats a blank entry source as none", () => {
    expect(defaultBranches({ defaultBranch: "main", entrySource: "  " }).source, "Expected a blank source to become null").toBeNull();
  });

  it("gives no target for an empty repository", () => {
    expect(defaultBranches({ defaultBranch: null, entrySource: "x" }), "Expected a null target when the repository has no default branch").toEqual({ source: "x", target: null });
  });

  it("keeps a source equal to the default branch (createBlockers reports it)", () => {
    expect(defaultBranches({ defaultBranch: "main", entrySource: "main" }), "Expected the same branch to be kept for validation to report").toEqual({ source: "main", target: "main" });
  });
});

describe("CP-1: newPrQuery asks for the comparison, the existing pull request and the repository facts in one request", () => {
  const make = () => newPrQuery({ owner: "octo", name: "demo", base: "main", head: "feature/x" });

  it("is a query declaring $owner, $name, $base and $head as required strings", () => {
    const req = make();
    expectQueryOperation(req);
    expectDeclares(req, ["$owner: String!", "$name: String!", "$base: String!", "$head: String!"]);
    expect(req.query.replace(/\s+/g, " "), "Expected repository(owner: $owner, name: $name)").toMatch(/repository\(owner:\s*\$owner,\s*name:\s*\$name\)/);
  });

  it("selects the repository id, default branch and autoMergeAllowed", () => {
    const req = make();
    expectNestedSelection(req, /repository\(owner:\s*\$owner,\s*name:\s*\$name\)/, ["id", "defaultBranchRef", "autoMergeAllowed"], "the repository facts");
  });

  it("compares head against base with Ref.compare(headRef:) and selects aheadBy, behindBy, status and the commits", () => {
    const req = make();
    expect(req.query.replace(/\s+/g, " "), "Expected baseRef: ref(qualifiedName: $base)").toMatch(/baseRef:\s*ref\(qualifiedName:\s*\$base\)/);
    expectNestedSelection(req, /compare\(headRef:\s*\$head\)/, ["aheadBy", "behindBy", "status", "commits", "totalCount", "oid", "messageHeadline", "messageBody"], "the comparison");
    expectConnectionCall(req, "commits", [`first:${MAX_COMPARE_COMMITS}`]);
  });

  it("looks up the head ref under its own alias so a missing head can be told from a missing base", () => {
    const req = make();
    expect(req.query.replace(/\s+/g, " "), "Expected headRef: ref(qualifiedName: $head)").toMatch(/headRef:\s*ref\(qualifiedName:\s*\$head\)/);
  });

  it("finds open pull requests for the same head and base, selecting isCrossRepository", () => {
    const req = make();
    expectConnectionCall(req, "pullRequests", ["headRefName:$head", "baseRefName:$base", "states:OPEN"]);
    expectNestedSelection(req, /pullRequests\(/, ["number", "title", "url", "isDraft", "isCrossRepository"], "the existing pull request");
  });

  it("passes owner, name, base and head as variables", () => {
    const req = make();
    expect(req.variables, "Expected { owner, name, base, head } in variables").toEqual({ owner: "octo", name: "demo", base: "main", head: "feature/x" });
  });

  it("keeps awkward branch names out of the query text", () => {
    for (const v of NASTY) {
      const r = newPrQuery({ owner: v, name: v, base: v, head: v });
      expectNotInQuery(r, [v]);
      expect(r.variables, `Expected ${JSON.stringify(v)} to travel in variables`).toEqual({ owner: v, name: v, base: v, head: v });
    }
  });
});

describe("CP-1: mapNewPr reads the comparison response", () => {
  it("maps the repository facts and the ahead / behind counts", () => {
    const m = mapNewPr(response());
    expect(m.repoId, "Expected repository.id as repoId").toBe("R_1");
    expect(m.defaultBranch, "Expected defaultBranchRef.name").toBe("main");
    expect(m.autoMergeAllowed, "Expected autoMergeAllowed").toBe(true);
    expect([m.ahead, m.behind, m.status], "Expected aheadBy 3, behindBy 28, DIVERGED").toEqual([3, 28, "DIVERGED"]);
    expect([m.baseExists, m.headExists], "Expected both branches to exist").toEqual([true, true]);
  });

  it("maps the commits oldest first with subject and body, a missing body becoming ''", () => {
    const m = mapNewPr(response());
    expect(m.commitCount, "Expected totalCount").toBe(3);
    expect(m.commits, "Expected the commits in the order given, body '' when null or empty").toEqual([
      { oid: "a1", subject: "Add shared skill", body: "Explains the skill.\n\nCo-authored-by: A <a@example.com>" },
      { oid: "b2", subject: "Update shared skill", body: "" },
      { oid: "c3", subject: "Avoid duplicating guidance", body: "" },
    ]);
  });

  it("reports identical branches as ahead 0", () => {
    const m = mapNewPr(response({ baseRef: { compare: { aheadBy: 0, behindBy: 0, status: "IDENTICAL", commits: { totalCount: 0, nodes: [] } } } }));
    expect([m.ahead, m.status, m.commits], "Expected ahead 0, IDENTICAL and no commits").toEqual([0, "IDENTICAL", []]);
  });

  it("returns the open pull request from this repository's own branch", () => {
    const pr = { number: 14846, title: "Add shared skill", url: "https://github.com/octo/demo/pull/14846", isDraft: true, isCrossRepository: false };
    expect(mapNewPr(response({ pullRequests: { nodes: [pr] } })).existingPr, "Expected the existing PR with number, title, url and isDraft").toEqual({
      number: 14846,
      title: "Add shared skill",
      url: "https://github.com/octo/demo/pull/14846",
      isDraft: true,
    });
  });

  it("ignores a pull request from a fork that merely has a branch of the same name", () => {
    const fork = { number: 14373, title: "Docs", url: "https://github.com/octo/demo/pull/14373", isDraft: false, isCrossRepository: true };
    const own = { number: 7, title: "Mine", url: "https://github.com/octo/demo/pull/7", isDraft: false, isCrossRepository: false };
    expect(mapNewPr(response({ pullRequests: { nodes: [fork] } })).existingPr, "Expected a fork PR not to count as an existing PR").toBeNull();
    expect(mapNewPr(response({ pullRequests: { nodes: [fork, own] } })).existingPr?.number, "Expected the first same-repository PR to be chosen").toBe(7);
  });

  it("says the head branch is missing when compare is null and headRef is null", () => {
    const m = mapNewPr(response({ baseRef: { compare: null }, headRef: null }));
    expect([m.baseExists, m.headExists, m.ahead, m.behind, m.commits], "Expected a missing head: base exists, head not, no counts").toEqual([true, false, 0, 0, []]);
  });

  it("says the base branch is missing when baseRef is null", () => {
    const m = mapNewPr(response({ baseRef: null }));
    expect([m.baseExists, m.headExists, m.ahead], "Expected a missing base: head exists, base not").toEqual([false, true, 0]);
  });

  it("never throws on missing or garbage input", () => {
    for (const bad of [null, undefined, {}, { data: null }, { data: { repository: null } }, "x", 7]) {
      const m = mapNewPr(bad);
      expect([m.repoId, m.baseExists, m.headExists, m.ahead, m.behind, m.commits, m.existingPr], `Expected safe defaults for ${JSON.stringify(bad)}`).toEqual(["", false, false, 0, 0, [], null]);
    }
  });
});

describe("CP-2: humaniseBranch turns a branch name into a title", () => {
  const cases: [string, string][] = [
    ["feature/add-login", "Add login"],
    ["bugfix/fix_null_ref", "Fix null ref"],
    ["add-login", "Add login"],
    ["users/jo/123-add-login", "Add login"],
    ["users/jo/123_add-login", "Add login"],
    ["feature/AB#123-add-login", "Add login"],
    ["feature/add-OAuth-login", "Add OAuth login"],
    ["feature/add--login__now", "Add login now"],
    ["a/b/c/deep-name", "Deep name"],
    ["main", "Main"],
    ["release/1.2.3", "1.2.3"],
    ["feature/AB#123", "AB#123"],
    ["", ""],
  ];
  it.each(cases)("%s gives %s", (branch, title) => {
    expect(humaniseBranch(branch), `Expected ${branch} to be humanised to "${title}"`).toBe(title);
  });
});

describe("CP-2: defaultTitle", () => {
  it("is the subject of the only commit", () => {
    expect(defaultTitle("feature/add-login", [commit("Add the login page", "Body.")]), "Expected a single commit's subject").toBe("Add the login page");
  });

  it("is the humanised branch name when there are several commits", () => {
    expect(defaultTitle("feature/add-login", [commit("One"), commit("Two")]), "Expected the humanised branch name").toBe("Add login");
  });

  it("falls back to the humanised branch name when there are no commits", () => {
    expect(defaultTitle("feature/add-login", []), "Expected the humanised branch name").toBe("Add login");
  });

  it("is clamped to the title limit, ending in an ellipsis, without splitting a character", () => {
    const long = defaultTitle("x", [commit("a".repeat(MAX_TITLE_LENGTH + 44))]);
    expect([...long].length, `Expected exactly ${MAX_TITLE_LENGTH} characters`).toBe(MAX_TITLE_LENGTH);
    expect(long.endsWith("…"), "Expected an ellipsis at the end").toBe(true);
    expect(long.startsWith("a".repeat(MAX_TITLE_LENGTH - 1)), "Expected the first characters kept").toBe(true);
    const emoji = defaultTitle("x", [commit("😀".repeat(MAX_TITLE_LENGTH + 5))]);
    expect([...emoji].length, "Expected the limit counted in code points").toBe(MAX_TITLE_LENGTH);
    expect([...emoji].slice(0, MAX_TITLE_LENGTH - 1).every((c) => c === "😀"), "Expected no half emoji").toBe(true);
  });

  it("leaves a title of exactly the limit alone", () => {
    const exact = "b".repeat(MAX_TITLE_LENGTH);
    expect(defaultTitle("x", [commit(exact)]), "Expected a title at the limit to be unchanged").toBe(exact);
  });
});

describe("CP-2: defaultDescription", () => {
  it("is the trimmed body of the only commit", () => {
    expect(defaultDescription([commit("Subject", "\nThe body.\n\nMore.\n\n")]), "Expected the body without surrounding blank lines").toBe("The body.\n\nMore.");
  });

  it("is '' for a single commit with no body", () => {
    expect(defaultDescription([commit("Subject")]), "Expected an empty description").toBe("");
  });

  it("lists the subjects as bullets, in order, when there are several commits", () => {
    expect(defaultDescription([commit("First", "ignored body"), commit("Second"), commit("Third")]), "Expected one bullet per subject").toBe("- First\n- Second\n- Third");
  });

  it("is '' when there are no commits", () => {
    expect(defaultDescription([]), "Expected an empty description").toBe("");
  });
});

describe("CP-2: initialDescription lets a pull request template override the description", () => {
  const commits = [commit("One"), commit("Two")];

  it("uses the template text verbatim", () => {
    const t = "## Summary\r\n\r\n- [ ] Tests\r\n";
    expect(initialDescription(t, commits), "Expected the template to override the commit bullets, untouched").toBe(t);
  });

  it("falls back to the commit-based description when there is no template", () => {
    expect(initialDescription(null, commits), "Expected bullets for null").toBe("- One\n- Two");
    expect(initialDescription(undefined, commits), "Expected bullets for undefined").toBe("- One\n- Two");
  });

  it("falls back when the template is blank", () => {
    expect(initialDescription("  \n\n", commits), "Expected bullets for a whitespace-only template").toBe("- One\n- Two");
  });
});

describe("CP-1: VIEW_EXISTING_LABEL (constant only)", () => {
  it("is the text of the link offered for an existing pull request", () => {
    expect(VIEW_EXISTING_LABEL, "Expected the wording from the requirement").toBe("View the existing pull request");
  });
});

describe("CP-1 / CP-5: createBlockers lists why Create is disabled", () => {
  const ok = { title: "Add login", source: "feature/x", target: "main", compare: compare() };

  it("is empty when everything is valid", () => {
    expect(createBlockers(ok), "Expected Create to be allowed").toEqual([]);
  });

  it("asks for a source branch when none is chosen", () => {
    expect(createBlockers({ ...ok, source: null, compare: null }), "Expected only the missing-source reason").toEqual([NO_SOURCE_MESSAGE]);
    expect(createBlockers({ ...ok, source: "  ", compare: null }), "Expected a blank source to count as missing").toEqual([NO_SOURCE_MESSAGE]);
  });

  it("asks for a target branch when none is chosen", () => {
    expect(createBlockers({ ...ok, target: null, compare: null }), "Expected only the missing-target reason").toEqual([NO_TARGET_MESSAGE]);
  });

  it("lists both missing branches, source first", () => {
    expect(createBlockers({ ...ok, source: null, target: null, compare: null }), "Expected source then target").toEqual([NO_SOURCE_MESSAGE, NO_TARGET_MESSAGE]);
  });

  it("says 'Choose two different branches' for the same branch, and nothing about changes", () => {
    expect(SAME_BRANCH_MESSAGE, "Expected the wording from the requirement").toBe("Choose two different branches");
    expect(createBlockers({ ...ok, source: "main", target: "main", compare: null }), "Expected only the same-branch reason when the comparison is unknown").toEqual([SAME_BRANCH_MESSAGE]);
    expect(createBlockers({ ...ok, source: "main", target: "main", compare: compare({ ahead: 0 }) }), "Expected no 'no changes' noise for the same branch").toEqual([SAME_BRANCH_MESSAGE]);
  });

  it("says 'There are no changes to merge' when the source is not ahead of the target", () => {
    expect(NO_CHANGES_MESSAGE, "Expected the wording from the requirement").toBe("There are no changes to merge");
    expect(createBlockers({ ...ok, compare: compare({ ahead: 0, behind: 0, status: "IDENTICAL", commits: [], commitCount: 0 }) }), "Expected identical branches to have nothing to merge").toEqual([NO_CHANGES_MESSAGE]);
    expect(createBlockers({ ...ok, compare: compare({ ahead: 0, behind: 5, status: "BEHIND", commits: [], commitCount: 0 }) }), "Expected a source only behind the target to have nothing to merge").toEqual([NO_CHANGES_MESSAGE]);
  });

  it("names the existing pull request and says nothing about changes", () => {
    const existingPr = { number: 12, title: "Add login", url: "https://github.com/octo/demo/pull/12", isDraft: false };
    expect(createBlockers({ ...ok, compare: compare({ existingPr }) }), "Expected the existing pull request to block Create").toEqual(["Pull request #12 already exists for these branches"]);
  });

  it("names a source branch that was not found, and a target that was not found", () => {
    expect(createBlockers({ ...ok, compare: compare({ headExists: false, ahead: 0, commits: [] }) }), "Expected a missing source branch to be named").toEqual(["The source branch 'feature/x' was not found"]);
    expect(createBlockers({ ...ok, compare: compare({ baseExists: false, ahead: 0, commits: [] }) }), "Expected a missing target branch to be named").toEqual(["The target branch 'main' was not found"]);
  });

  it("says it is checking while the comparison is still loading for two different branches", () => {
    expect(createBlockers({ ...ok, compare: null }), "Expected Create to wait for the comparison").toEqual([CHECKING_MESSAGE]);
  });

  it("requires a title, treating whitespace as empty", () => {
    expect(createBlockers({ ...ok, title: "   " }), "Expected a blank title to block Create").toEqual([NO_TITLE_MESSAGE]);
    expect(createBlockers({ ...ok, title: "" }), "Expected an empty title to block Create").toEqual([NO_TITLE_MESSAGE]);
  });

  it("lists several reasons in page order: branches, existing pull request, changes, then title", () => {
    const existingPr = { number: 3, title: "t", url: "u", isDraft: false };
    expect(createBlockers({ ...ok, title: "", compare: compare({ existingPr, ahead: 0, commits: [] }) }), "Expected existing PR, no changes, then title").toEqual([
      "Pull request #3 already exists for these branches",
      NO_CHANGES_MESSAGE,
      NO_TITLE_MESSAGE,
    ]);
    expect(createBlockers({ ...ok, title: "", source: null, compare: null }), "Expected the branch reason before the title reason").toEqual([NO_SOURCE_MESSAGE, NO_TITLE_MESSAGE]);
  });
});

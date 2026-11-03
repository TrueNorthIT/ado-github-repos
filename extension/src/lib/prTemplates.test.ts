import { describe, it, expect } from "vitest";
import { resolveTemplates, templateListingQuery, listedPaths, templateBlobsQuery, mapTemplateBlobs, LISTING_DIRS } from "./prTemplates";
import { expectNotInQuery, NASTY } from "./ciTestHelpers";
import { expectQueryOperation } from "./editTestHelpers";
import { expectNestedSelection, expectDeclares } from "./b4TestHelpers";

// Module under test: src/lib/prTemplates.ts (stubs until the developer implements them). Requirement CP-2: "A PR template overrides the description: look in .github/pull_request_template.md,
// .github/PULL_REQUEST_TEMPLATE.md, docs/..., the root, and PULL_REQUEST_TEMPLATE/ (several templates mean the user picks one). Write a pure resolver over the found paths, then build one GraphQL query
// fetching those candidate blobs at the base branch through object(expression:) aliases." The object(expression:) facts (case-sensitive paths, null for a missing folder) are in the header of src/lib/prTemplates.ts.

describe("CP-2: resolveTemplates over the found paths", () => {
  it("finds no template among unrelated files", () => {
    const paths = ["README.md", "src/pull_request_template.md", ".github/ISSUE_TEMPLATE/bug.md", ".github/workflows/ci.yml", "docs/guide/pull_request_template.md", "docs/readme.md"];
    expect(resolveTemplates(paths), "Expected no template from unrelated paths").toEqual({ kind: "none" });
    expect(resolveTemplates([]), "Expected no template from no paths").toEqual({ kind: "none" });
  });

  it("uses a single pull_request_template.md in .github, docs or the root without asking", () => {
    for (const p of [".github/pull_request_template.md", "docs/pull_request_template.md", "pull_request_template.md"])
      expect(resolveTemplates(["README.md", p]), `Expected ${p} to be the template`).toEqual({ kind: "single", path: p });
  });

  it("matches the file name in any letter case and keeps the path as given", () => {
    for (const p of [".github/PULL_REQUEST_TEMPLATE.md", "docs/Pull_Request_Template.md", "PULL_REQUEST_TEMPLATE.md"])
      expect(resolveTemplates([p]), `Expected ${p} to match case-insensitively, path unchanged`).toEqual({ kind: "single", path: p });
  });

  it("accepts a .txt template", () => {
    expect(resolveTemplates([".github/pull_request_template.txt"]), "Expected .txt to be accepted").toEqual({ kind: "single", path: ".github/pull_request_template.txt" });
  });

  it("prefers .github, then docs, then the root", () => {
    expect(resolveTemplates(["pull_request_template.md", "docs/pull_request_template.md", ".github/pull_request_template.md"]), "Expected .github to win").toEqual({ kind: "single", path: ".github/pull_request_template.md" });
    expect(resolveTemplates(["pull_request_template.md", "docs/pull_request_template.md"]), "Expected docs to beat the root").toEqual({ kind: "single", path: "docs/pull_request_template.md" });
  });

  it("makes the user pick when a PULL_REQUEST_TEMPLATE folder holds several templates, sorted by name", () => {
    const paths = [".github/PULL_REQUEST_TEMPLATE/feature.md", ".github/PULL_REQUEST_TEMPLATE/Bug.md", ".github/PULL_REQUEST_TEMPLATE/chore.md"];
    expect(resolveTemplates(paths), "Expected a pick list sorted case-insensitively by name").toEqual({
      kind: "pick",
      paths: [".github/PULL_REQUEST_TEMPLATE/Bug.md", ".github/PULL_REQUEST_TEMPLATE/chore.md", ".github/PULL_REQUEST_TEMPLATE/feature.md"],
    });
  });

  it("uses a folder's only template without asking", () => {
    expect(resolveTemplates(["docs/PULL_REQUEST_TEMPLATE/only.md"]), "Expected a single template from a one-file folder").toEqual({ kind: "single", path: "docs/PULL_REQUEST_TEMPLATE/only.md" });
  });

  it("recognises the folder name in any letter case, in .github, docs and the root", () => {
    const paths = ["pull_request_template/a.md", "docs/Pull_Request_Template/b.md", ".github/PULL_REQUEST_TEMPLATE/c.md"];
    expect(resolveTemplates(paths), "Expected .github first, then docs, then the root").toEqual({
      kind: "pick",
      paths: [".github/PULL_REQUEST_TEMPLATE/c.md", "docs/Pull_Request_Template/b.md", "pull_request_template/a.md"],
    });
  });

  it("offers the single-file template first, then the folder's templates", () => {
    const paths = [".github/PULL_REQUEST_TEMPLATE/feature.md", ".github/PULL_REQUEST_TEMPLATE/bug.md", ".github/pull_request_template.md"];
    expect(resolveTemplates(paths), "Expected the default file ahead of the folder templates").toEqual({
      kind: "pick",
      paths: [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE/bug.md", ".github/PULL_REQUEST_TEMPLATE/feature.md"],
    });
  });

  it("ignores non-markdown files and nested folders inside a template folder", () => {
    const paths = [".github/PULL_REQUEST_TEMPLATE/bug.md", ".github/PULL_REQUEST_TEMPLATE/config.yml", ".github/PULL_REQUEST_TEMPLATE/archive/old.md"];
    expect(resolveTemplates(paths), "Expected only bug.md to count").toEqual({ kind: "single", path: ".github/PULL_REQUEST_TEMPLATE/bug.md" });
  });
});

describe("CP-2: templateListingQuery reads the candidate folders at the base branch", () => {
  const make = () => templateListingQuery({ owner: "octo", name: "demo", base: "release/1.0" });

  it("is a query with one object(expression:) alias per candidate folder, each selecting the tree entries", () => {
    const req = make();
    expectQueryOperation(req);
    LISTING_DIRS.forEach((_, i) => {
      expectNestedSelection(req, new RegExp(`d${i}: object\\(expression: \\$d${i}\\)`), ["Tree", "entries", "name", "type"], `the folder alias d${i}`);
    });
    expectDeclares(req, ["$owner: String!", "$name: String!", ...LISTING_DIRS.map((_, i) => `$d${i}: String!`)]);
    expect(req.query.replace(/\s+/g, " "), "Expected repository(owner: $owner, name: $name)").toMatch(/repository\(owner:\s*\$owner,\s*name:\s*\$name\)/);
  });

  it("passes `${base}:${folder}` for each folder as a variable, the root being `${base}:`", () => {
    const req = make();
    const expected: Record<string, string> = { owner: "octo", name: "demo" };
    LISTING_DIRS.forEach((d, i) => (expected[`d${i}`] = `release/1.0:${d}`));
    expect(req.variables, "Expected owner, name and one expression per folder").toEqual(expected);
    expect(req.variables.d0, "Expected the root expression to end at the colon").toBe("release/1.0:");
  });

  it("covers the root, .github, docs and the PULL_REQUEST_TEMPLATE folders in each", () => {
    expect([...LISTING_DIRS].sort(), "Expected the six candidate folders").toEqual(["", ".github", ".github/PULL_REQUEST_TEMPLATE", "PULL_REQUEST_TEMPLATE", "docs", "docs/PULL_REQUEST_TEMPLATE"].sort());
  });

  it("keeps awkward values out of the query text", () => {
    for (const v of NASTY) {
      const r = templateListingQuery({ owner: v, name: v, base: v });
      expectNotInQuery(r, [v]);
      expect(r.variables.d1, `Expected the base ${JSON.stringify(v)} inside the variable`).toBe(`${v}:.github`);
    }
  });
});

describe("CP-2: listedPaths flattens a listing response", () => {
  const entries = (...e: [string, "blob" | "tree"][]) => ({ entries: e.map(([name, type]) => ({ name, type })) });

  it("joins each blob to its folder, in alias then entry order, skipping trees and missing folders", () => {
    const body = {
      data: {
        repository: {
          d0: entries(["README.md", "blob"], [".github", "tree"], ["pull_request_template.md", "blob"]),
          d1: entries(["PULL_REQUEST_TEMPLATE.md", "blob"], ["ISSUE_TEMPLATE", "tree"]),
          d2: null,
          d3: null,
          d4: entries(["bug.md", "blob"], ["feature.md", "blob"]),
          d5: {},
        },
      },
    };
    expect(listedPaths(body), "Expected root files bare, others prefixed with their folder").toEqual([
      "README.md",
      "pull_request_template.md",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/PULL_REQUEST_TEMPLATE/bug.md",
      ".github/PULL_REQUEST_TEMPLATE/feature.md",
    ]);
  });

  it("feeds resolveTemplates end to end", () => {
    const body = { data: { repository: { d0: entries(["README.md", "blob"]), d1: entries(["PULL_REQUEST_TEMPLATE.md", "blob"]), d2: null, d3: null, d4: null, d5: null } } };
    expect(resolveTemplates(listedPaths(body)), "Expected the .github template to be resolved from the listing").toEqual({ kind: "single", path: ".github/PULL_REQUEST_TEMPLATE.md" });
  });

  it("gives [] for missing or garbage input", () => {
    for (const bad of [null, undefined, {}, { data: null }, { data: { repository: null } }, "x"]) expect(listedPaths(bad), `Expected [] for ${JSON.stringify(bad)}`).toEqual([]);
  });
});

describe("CP-2: templateBlobsQuery fetches the candidate blobs at the base branch", () => {
  const paths = [".github/PULL_REQUEST_TEMPLATE/bug.md", ".github/PULL_REQUEST_TEMPLATE/feature.md"];
  const make = () => templateBlobsQuery({ owner: "octo", name: "demo", base: "main" }, paths);

  it("is a query with one object(expression:) alias per path, each selecting the blob text", () => {
    const req = make();
    expectQueryOperation(req);
    paths.forEach((_, i) => expectNestedSelection(req, new RegExp(`t${i}: object\\(expression: \\$e${i}\\)`), ["Blob", "text", "byteSize", "isTruncated"], `the blob alias t${i}`));
    expectDeclares(req, ["$owner: String!", "$name: String!", "$e0: String!", "$e1: String!"]);
  });

  it("passes `${base}:${path}` for each path as a variable, keeping the path's case", () => {
    const req = make();
    expect(req.variables, "Expected owner, name and one expression per path").toEqual({ owner: "octo", name: "demo", e0: "main:.github/PULL_REQUEST_TEMPLATE/bug.md", e1: "main:.github/PULL_REQUEST_TEMPLATE/feature.md" });
  });

  it("keeps awkward values out of the query text", () => {
    for (const v of NASTY) {
      const r = templateBlobsQuery({ owner: v, name: v, base: v }, [`dir/${v}.md`]);
      expectNotInQuery(r, [v]);
      expect(r.variables.e0, `Expected the base and path ${JSON.stringify(v)} inside the variable`).toBe(`${v}:dir/${v}.md`);
    }
  });

  it("refuses an empty list of paths", () => {
    expect(() => templateBlobsQuery({ owner: "o", name: "n", base: "main" }, []), "Expected an error for no candidate templates").toThrow("at least one template path is required");
  });
});

describe("CP-2: mapTemplateBlobs reads the blob response", () => {
  const paths = ["a.md", "b.md", "c.md", "d.md"];
  const blob = (text: string, isTruncated = false) => ({ text, byteSize: text.length, isTruncated });

  it("returns { path, text } in the order of the paths, leaving out aliases that are missing, not blobs or truncated", () => {
    const body = { data: { repository: { t0: blob("## First\r\n"), t1: null, t2: {}, t3: blob("cut", true) } } };
    expect(mapTemplateBlobs(body, paths), "Expected only the first alias to survive, text verbatim").toEqual([{ path: "a.md", text: "## First\r\n" }]);
  });

  it("keeps the order of the paths", () => {
    const body = { data: { repository: { t0: blob("A"), t1: blob("B"), t2: blob("C"), t3: blob("D") } } };
    expect(mapTemplateBlobs(body, paths).map((b) => b.path), "Expected a, b, c, d").toEqual(["a.md", "b.md", "c.md", "d.md"]);
  });

  it("gives [] for missing or garbage input", () => {
    for (const bad of [null, undefined, {}, { data: null }, { data: { repository: null } }, "x"]) expect(mapTemplateBlobs(bad, paths), `Expected [] for ${JSON.stringify(bad)}`).toEqual([]);
  });
});

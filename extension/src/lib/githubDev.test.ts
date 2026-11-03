import { describe, it, expect } from "vitest";
import { GITHUB_DEV, githubDevPrUrl, githubDevFileUrl } from "./githubDev";
import { githubUrl } from "./githubUrl";

// Module under test: src/lib/githubDev.ts (stubs until the developer implements them). Requirement VW-12: "github.dev. URL builders for `https://github.dev/{o}/{r}/pull/{n}` and for a file at a ref:
// `https://github.dev/{o}/{r}/blob/{ref}/{path}`, with path encoding." Decisions are in the header of src/lib/githubDev.ts.

describe("VW-12: githubDevPrUrl", () => {
  it("is https://github.dev/{owner}/{repo}/pull/{number}", () => {
    expect(GITHUB_DEV, "Expected the github.dev origin").toBe("https://github.dev");
    expect(githubDevPrUrl("octo/demo", 42), "Expected the pull request URL").toBe("https://github.dev/octo/demo/pull/42");
  });

  it("refuses a number that is not a positive integer", () => {
    for (const n of [0, -1, 1.5, NaN]) expect(() => githubDevPrUrl("octo/demo", n), `Expected ${n} to be refused`).toThrow("number must be a positive integer");
  });
});

describe("VW-12: githubDevFileUrl", () => {
  it("is https://github.dev/{owner}/{repo}/blob/{ref}/{path}", () => {
    expect(githubDevFileUrl("octo/demo", "main", "src/app/main.ts"), "Expected the file URL").toBe("https://github.dev/octo/demo/blob/main/src/app/main.ts");
  });

  it("encodes the path per segment, keeping the slashes", () => {
    expect(githubDevFileUrl("octo/demo", "main", "docs/my file#1 (v2).md"), "Expected spaces, # and parentheses handled by encodeURIComponent per segment").toBe(
      `https://github.dev/octo/demo/blob/main/docs/${encodeURIComponent("my file#1 (v2).md")}`,
    );
  });

  it("encodes the ref per segment as githubUrl does, so a branch name keeps its slashes", () => {
    expect(githubDevFileUrl("octo/demo", "feature/x y", "a.ts"), "Expected the ref encoded per segment").toBe("https://github.dev/octo/demo/blob/feature/x%20y/a.ts");
  });

  it("is githubUrl's file link on the github.dev host, for any ref and path", () => {
    for (const [ref, path] of [["main", "a.ts"], ["release/1.0", "x/y z/ü.ts"], ["0123abcd", "weird#name?.md"]])
      expect(githubDevFileUrl("octo/demo", ref, path), `Expected the same encoding as githubUrl for ${ref} ${path}`).toBe(githubUrl("octo/demo", ref, path, true).replace("https://github.com", GITHUB_DEV));
  });

  it("refuses a blank path", () => {
    expect(() => githubDevFileUrl("octo/demo", "main", ""), "Expected an empty path to be refused").toThrow("path is required");
    expect(() => githubDevFileUrl("octo/demo", "main", "  "), "Expected a blank path to be refused").toThrow("path is required");
  });
});

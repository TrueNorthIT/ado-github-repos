import { describe, it, expect } from "vitest";
import { githubUrl } from "./githubUrl";

// Module under test: src/lib/githubUrl.ts. githubUrl(repo "owner/name", ref, path, isFile).

describe("B-10: An Open on GitHub button opens the current branch and path on GitHub", () => {
  it("uses /tree/ for the repo root", () => {
    expect(githubUrl("acme/web", "main", "", false), "Expected the root URL to be .../tree/main with no trailing slash").toBe("https://github.com/acme/web/tree/main");
  });

  it("uses /tree/ for a folder", () => {
    expect(githubUrl("acme/web", "main", "src/lib", false), "Expected a folder to open under /tree/").toBe("https://github.com/acme/web/tree/main/src/lib");
  });

  it("uses /blob/ for a file", () => {
    expect(githubUrl("acme/web", "main", "src/index.ts", true), "Expected a file to open under /blob/").toBe("https://github.com/acme/web/blob/main/src/index.ts");
  });

  it("keeps the / separators in a branch name", () => {
    expect(githubUrl("acme/web", "feature/x/y", "a.md", true), "Expected 'feature/x/y' not to have its slashes encoded").toBe("https://github.com/acme/web/blob/feature/x/y/a.md");
    expect(githubUrl("acme/web", "feature/x", "", false), "Expected a root URL on a slashed branch").toBe("https://github.com/acme/web/tree/feature/x");
  });

  it("encodes spaces, # and % in each path segment but not the separators", () => {
    expect(githubUrl("acme/web", "main", "my docs/read me#1/100%.md", true), "Expected each segment encoded, separators kept").toBe(
      "https://github.com/acme/web/blob/main/my%20docs/read%20me%231/100%25.md"
    );
  });

  it("encodes other reserved characters in a path segment", () => {
    expect(githubUrl("acme/web", "main", "a?b/c&d+e.txt", true), "Expected ? & + to be encoded").toBe("https://github.com/acme/web/blob/main/a%3Fb/c%26d%2Be.txt");
  });

  it("encodes unicode in a path as UTF-8 percent escapes", () => {
    expect(githubUrl("acme/web", "main", "café/日本.md", true), "Expected UTF-8 percent-encoding").toBe(
      "https://github.com/acme/web/blob/main/caf%C3%A9/%E6%97%A5%E6%9C%AC.md"
    );
  });

  it("encodes spaces and # inside branch-name segments but keeps the slashes", () => {
    expect(githubUrl("acme/web", "release/v 1#2", "", false), "Expected the ref segments encoded, slashes kept").toBe("https://github.com/acme/web/tree/release/v%201%232");
  });
});

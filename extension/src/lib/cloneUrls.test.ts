import { describe, it, expect } from "vitest";
import { archiveUrl, cloneUrls, vscodeCloneUrl } from "./cloneUrls";

describe("cloneUrls", () => {
  it("uses GitHub's own clone_url and ssh_url", () => {
    expect(cloneUrls("a/b", { cloneUrl: "https://github.com/A/B.git", sshUrl: "git@github.com:A/B.git" })).toEqual({ https: "https://github.com/A/B.git", ssh: "git@github.com:A/B.git" });
  });
  it("falls back to the github.com forms when the metadata has none", () => {
    expect(cloneUrls("truenorthit/repo", {})).toEqual({ https: "https://github.com/truenorthit/repo.git", ssh: "git@github.com:truenorthit/repo.git" });
    expect(cloneUrls("truenorthit/repo")).toEqual({ https: "https://github.com/truenorthit/repo.git", ssh: "git@github.com:truenorthit/repo.git" });
  });
  it("makes nothing up for a name that is not owner/name", () => {
    expect(cloneUrls("../x")).toEqual({ https: "", ssh: "" });
  });
});

describe("vscodeCloneUrl", () => {
  it("encodes the URL for VS Code's Git clone handler", () => {
    expect(vscodeCloneUrl("https://github.com/a/b.git")).toBe("vscode://vscode.git/clone?url=https%3A%2F%2Fgithub.com%2Fa%2Fb.git");
    expect(vscodeCloneUrl("git@github.com:a/b.git")).toBe("vscode://vscode.git/clone?url=git%40github.com%3Aa%2Fb.git");
  });
});

describe("archiveUrl", () => {
  it("names the ref in github.com's archive path, keeping its slashes and encoding the rest", () => {
    expect(archiveUrl("a/b", "main")).toBe("https://github.com/a/b/archive/main.zip");
    expect(archiveUrl("a/b", "feature/x y#1")).toBe("https://github.com/a/b/archive/feature/x%20y%231.zip");
  });
});

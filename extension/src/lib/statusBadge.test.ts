import { describe, it, expect } from "vitest";
import { statusBadge } from "./workflows";

describe("statusBadge", () => {
  it("builds GitHub's badge, its runs link and the Markdown for a branch", () => {
    const b = statusBadge("octo/demo", ".github/workflows/ci.yml", "CI", "main");
    expect(b.imageUrl).toBe("https://github.com/octo/demo/actions/workflows/ci.yml/badge.svg?branch=main");
    expect(b.linkUrl).toBe("https://github.com/octo/demo/actions/workflows/ci.yml?query=branch%3Amain");
    expect(b.markdown).toBe("[![CI](https://github.com/octo/demo/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/octo/demo/actions/workflows/ci.yml?query=branch%3Amain)");
  });

  it("encodes branch names and leaves the branch out when there is none", () => {
    expect(statusBadge("o/r", ".github/workflows/ci.yml", "CI", "feature/a b&c").imageUrl).toBe("https://github.com/o/r/actions/workflows/ci.yml/badge.svg?branch=feature%2Fa%20b%26c");
    const any = statusBadge("o/r", ".github/workflows/deploy prod.yml", "Deploy", " ");
    expect(any.imageUrl).toBe("https://github.com/o/r/actions/workflows/deploy%20prod.yml/badge.svg");
    expect(any.linkUrl).toBe("https://github.com/o/r/actions/workflows/deploy%20prod.yml");
  });

  it("escapes brackets in the alt text", () => {
    expect(statusBadge("o/r", ".github/workflows/x.yml", "Build [nightly]").markdown.startsWith("[![Build \\[nightly\\]](")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { BINARY_NOTICE, MAX_DIFF_BYTES, richKind, diffViews, imageSources, renderedSides, toggleRenderedSide, diffNotice, type DiffNoticeInput } from "./richDiff";
import { classifyFile } from "./fileKind";

// Module under test: src/lib/richDiff.ts (stubs until the developer implements them). Requirement VW-11: "Rich diffs. Which files get a rendered view (markdown, images by extension and MIME type, SVG
// both ways). For images, the model gives before and after URLs (raw.githubusercontent or contents API at the base and head oids, handling added/removed). For markdown, a rendered before/after toggle
// model. Binary and large files show "Binary file not shown", with the threshold pinned." The facts and decisions (contents API paths, views, threshold) are in the header of src/lib/richDiff.ts.

describe("VW-11: richKind says which files get a rendered view", () => {
  it.each([
    ["README.md", "markdown"],
    ["docs/Guide.MARKDOWN", "markdown"],
    ["img/logo.png", "image"],
    ["img/photo.JPG", "image"],
    ["a.jpeg", "image"],
    ["a.gif", "image"],
    ["a.webp", "image"],
    ["a.bmp", "image"],
    ["a.ico", "image"],
    ["img/logo.svg", "svg"],
  ] as const)("%s by extension is %s", (path, kind) => {
    expect(richKind(path), `Expected ${path} to get the ${kind} view`).toBe(kind);
  });

  it.each(["src/app.ts", "package.json", "notes.txt", "Dockerfile", "archive.zip", "readme.mdx", "noext"])("%s has no rendered view", (path) => {
    expect(richKind(path), `Expected ${path} to be an ordinary text or binary diff`).toBeNull();
  });

  it("uses a MIME type when the extension says nothing", () => {
    expect(richKind("assets/blob", "image/png"), "Expected image/png to be an image").toBe("image");
    expect(richKind("assets/blob", "image/jpeg"), "Expected image/jpeg to be an image").toBe("image");
    expect(richKind("assets/blob", "text/markdown"), "Expected text/markdown to be markdown").toBe("markdown");
  });

  it("treats image/svg+xml as svg, and ignores MIME parameters", () => {
    expect(richKind("assets/blob", "image/svg+xml"), "Expected svg").toBe("svg");
    expect(richKind("assets/blob", "image/png; charset=binary"), "Expected the parameter to be ignored").toBe("image");
  });

  it("lets a recognised MIME type win over the extension", () => {
    expect(richKind("photo.dat", "image/gif"), "Expected the MIME type to decide").toBe("image");
    expect(richKind("diagram.png", "image/svg+xml"), "Expected the svg MIME type to beat the .png extension").toBe("svg");
  });

  it("falls back to the extension for a MIME type it does not recognise", () => {
    expect(richKind("img/logo.png", "application/octet-stream"), "Expected the extension to decide").toBe("image");
    expect(richKind("src/app.ts", "application/octet-stream"), "Expected no view").toBeNull();
  });
});

describe("VW-11: diffViews says which views a kind offers and which it opens on", () => {
  it("offers an image only its rendered view", () => {
    expect(diffViews("image"), "Expected rendered only").toEqual({ views: ["rendered"], default: "rendered" });
  });

  it("offers svg both ways, opening on the rendered image", () => {
    expect(diffViews("svg"), "Expected rendered and source, opening rendered").toEqual({ views: ["rendered", "source"], default: "rendered" });
  });

  it("offers markdown both ways, opening on the source diff (the one reviewers comment on)", () => {
    expect(diffViews("markdown"), "Expected source and rendered, opening source").toEqual({ views: ["source", "rendered"], default: "source" });
  });
});

describe("VW-11: imageSources gives the before and after paths at the base and head oids", () => {
  const base = { repo: "octo/demo", baseOid: "BASE1", headOid: "HEAD2" };
  const url = (path: string, oid: string) => `/repos/octo/demo/contents/${path}?ref=${oid}`;

  it("reads a modified image at the base for before and at the head for after", () => {
    expect(imageSources({ ...base, path: "img/logo.png", changeType: "MODIFIED" }), "Expected both sides").toEqual({ before: url("img/logo.png", "BASE1"), after: url("img/logo.png", "HEAD2") });
  });

  it("has no before for an added image", () => {
    expect(imageSources({ ...base, path: "img/logo.png", changeType: "ADDED" }), "Expected only after").toEqual({ before: null, after: url("img/logo.png", "HEAD2") });
  });

  it("has no after for a deleted image, and reads before at the base", () => {
    expect(imageSources({ ...base, path: "img/logo.png", changeType: "DELETED" }), "Expected only before").toEqual({ before: url("img/logo.png", "BASE1"), after: null });
  });

  it("reads the before side of a renamed image from its previous path", () => {
    expect(imageSources({ ...base, path: "img/new.png", previousPath: "img/old.png", changeType: "RENAMED" }), "Expected before at the old path, after at the new").toEqual({ before: url("img/old.png", "BASE1"), after: url("img/new.png", "HEAD2") });
  });

  it("falls back to the current path when a rename has no previous path", () => {
    expect(imageSources({ ...base, path: "img/new.png", changeType: "RENAMED" }).before, "Expected the current path").toBe(url("img/new.png", "BASE1"));
  });

  it("encodes the path per segment, keeping the slashes, and encodes the oid", () => {
    const s = imageSources({ ...base, path: "docs/my pics/a#b.png", changeType: "MODIFIED", headOid: "feature/x" });
    expect(s.before, "Expected spaces and # encoded, slashes kept").toBe(url("docs/my%20pics/a%23b.png", "BASE1"));
    expect(s.after, "Expected the oid encoded like the other contents calls").toBe(url("docs/my%20pics/a%23b.png", "feature%2Fx"));
  });
});

describe("VW-11: the rendered markdown before/after toggle", () => {
  it("offers both sides, before then after, for a modified or renamed file", () => {
    expect(renderedSides("MODIFIED"), "Expected before and after").toEqual(["before", "after"]);
    expect(renderedSides("RENAMED"), "Expected before and after for a rename").toEqual(["before", "after"]);
  });

  it("offers only after for an added file and only before for a deleted one", () => {
    expect(renderedSides("ADDED"), "Expected after only").toEqual(["after"]);
    expect(renderedSides("DELETED"), "Expected before only").toEqual(["before"]);
  });

  it("toggles between the two sides when both exist", () => {
    expect(toggleRenderedSide("MODIFIED", "after"), "Expected after to flip to before").toBe("before");
    expect(toggleRenderedSide("MODIFIED", "before"), "Expected before to flip to after").toBe("after");
  });

  it("stays on the only side when there is one, even if asked for the other", () => {
    expect(toggleRenderedSide("ADDED", "after"), "Expected after to stay").toBe("after");
    expect(toggleRenderedSide("DELETED", "before"), "Expected before to stay").toBe("before");
    expect(toggleRenderedSide("ADDED", "before"), "Expected a side that does not exist to resolve to the one that does").toBe("after");
  });
});

describe("VW-11: diffNotice says 'Binary file not shown' for binary and large files", () => {
  const file = (over: Partial<DiffNoticeInput> = {}): DiffNoticeInput => ({ path: "src/app.ts", patch: "@@ -1 +1 @@\n-a\n+b", additions: 1, deletions: 1, ...over });

  it("words the notice as in the requirement", () => {
    expect(BINARY_NOTICE, "Expected the text from the requirement").toBe("Binary file not shown");
  });

  it("pins the threshold at 1 MiB, the Files hub's limit", () => {
    expect(MAX_DIFF_BYTES, "Expected 1048576 bytes").toBe(1048576);
    expect(classifyFile("a.txt", MAX_DIFF_BYTES), "Fixture check: fileKind agrees that exactly 1 MiB is still text").toBe("text");
  });

  it("shows an ordinary text file", () => {
    expect(diffNotice(file()), "Expected no notice for a small text file with a patch").toBeNull();
  });

  it("shows a text file of exactly the threshold size and hides one byte more", () => {
    expect(diffNotice(file({ size: MAX_DIFF_BYTES })), "Expected exactly 1 MiB to be shown").toBeNull();
    expect(diffNotice(file({ size: MAX_DIFF_BYTES + 1 })), "Expected 1 MiB + 1 byte to show the notice").toBe(BINARY_NOTICE);
  });

  it.each(["dist/app.exe", "lib/native.dll", "release/pack.zip", "docs/spec.pdf", "fonts/a.woff2"])("hides %s, a known binary type, even with a patch", (path) => {
    expect(diffNotice(file({ path })), `Expected the notice for ${path}`).toBe(BINARY_NOTICE);
  });

  it("hides a file whose first bytes contain a NUL", () => {
    expect(diffNotice(file({ path: "data/blob.dat", head: new Uint8Array([72, 105, 0, 33]) })), "Expected the notice for a NUL byte").toBe(BINARY_NOTICE);
  });

  it("hides a file that GitHub sent without a patch while lines changed (binary or very large)", () => {
    expect(diffNotice(file({ path: "data/blob.dat", patch: undefined, additions: 10, deletions: 0 })), "Expected the notice when the patch is missing").toBe(BINARY_NOTICE);
    expect(diffNotice(file({ patch: null, additions: 0, deletions: 4 })), "Expected the notice for a null patch with deletions").toBe(BINARY_NOTICE);
  });

  it("does not hide a pure rename that has no patch because nothing changed", () => {
    expect(diffNotice(file({ patch: undefined, additions: 0, deletions: 0 })), "Expected no notice when no lines changed").toBeNull();
  });

  it("does not hide an image because it has no patch: it gets a rendered view instead", () => {
    expect(diffNotice(file({ path: "img/logo.png", patch: undefined, additions: 0, deletions: 0 })), "Expected no notice for an image").toBeNull();
    expect(diffNotice(file({ path: "img/logo.png", patch: undefined, additions: 5, deletions: 5 })), "Expected no notice for an image whose patch GitHub omitted").toBeNull();
  });

  it("hides an image above fileKind's 10 MiB image limit", () => {
    expect(diffNotice(file({ path: "img/huge.png", patch: undefined, size: 10 * 1048576 + 1 })), "Expected the notice for a 10 MiB + 1 image").toBe(BINARY_NOTICE);
    expect(diffNotice(file({ path: "img/big.png", patch: undefined, size: 10 * 1048576 })), "Expected exactly 10 MiB to be shown").toBeNull();
  });
});

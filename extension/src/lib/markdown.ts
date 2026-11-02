/** Rewrites and sanitises GitHub-rendered HTML before it goes into the extension frame (B-4, B-6). */
import DOMPurify from "dompurify";
import { normalizePath, serialize } from "./browseState";

export interface MarkdownContext {
  owner: string;
  name: string;
  ref: string;
  /** Folder of the markdown file, "" for the root. Relative links and images resolve against it. */
  dir: string;
}

export interface PreparedMarkdown {
  html: string;
  /** Resolved repo paths of images the UI must fetch with the user's token (see data-repo-path). */
  images: string[];
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const clean = (v: string) => v.replace(/[\u0000- ]/g, "").toLowerCase();
const GH_CLASS = /^(pl-|highlight|markdown-alert|task-list-item|contains-task-list|anchor|octicon)/;

/** Resolves a relative or root-absolute reference to a repo path (query and fragment dropped, percent-decoded, clamped to the root). Null if undecodable. */
function resolveRepoPath(href: string, dir: string): string | null {
  try {
    const p = decodeURIComponent(href.replace(/[?#].*$/, ""));
    return normalizePath(p.startsWith("/") ? p : `${dir}/${p}`);
  } catch {
    return null;
  }
}

/** Splits `rest` (after /blob/ or /tree/ or /raw/) into ref and path, preferring the current ref. */
function splitRefPath(rest: string[], ref: string): { ref: string; path: string } {
  const cur = ref.split("/");
  if (cur.every((s, i) => rest[i] === s)) return { ref, path: rest.slice(cur.length).join("/") };
  // ponytail: a different ref is taken to be the first segment, so another branch containing "/" lands on the wrong ref; resolve against the branch list if that bites.
  return { ref: rest[0], path: rest.slice(1).join("/") };
}

/** For a github.com / raw.githubusercontent.com URL into this repo: kind and ref/path. Null for anything else. */
function sameRepoUrl(href: string, c: MarkdownContext): { kind: string; ref: string; path: string; sameRef: boolean } | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  let segs: string[];
  try {
    segs = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  let kind = "raw";
  if (host === "github.com" || host === "www.github.com") {
    kind = segs[2];
    if (kind !== "blob" && kind !== "tree" && kind !== "raw") return null;
    segs.splice(2, 1);
  } else if (host !== "raw.githubusercontent.com") return null;
  const [owner, name, ...rest] = segs;
  if (owner?.toLowerCase() !== c.owner.toLowerCase() || name?.toLowerCase() !== c.name.toLowerCase() || !rest.length) return null;
  const r = splitRefPath(rest, c.ref);
  return { kind, ref: r.ref, path: normalizePath(r.path), sameRef: r.ref === c.ref };
}

export function prepareMarkdownHtml(html: string, ctx: MarkdownContext): PreparedMarkdown {
  const body = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    RETURN_DOM: true,
    ALLOW_DATA_ATTR: false,
    // map/area: an <area href> would navigate the frame past the link rewriting below. dialog: <dialog open> is a ready-made overlay.
    FORBID_TAGS: ["style", "form", "base", "iframe", "object", "embed", "script", "button", "textarea", "select", "video", "audio", "track", "link", "meta", "noscript", "map", "area", "dialog"],
    FORBID_ATTR: ["style", "background", "formaction", "srcset", "srcdoc", "usemap", "crossorigin"],
  }) as HTMLElement;
  const images: string[] = [];
  const repo = `${ctx.owner}/${ctx.name}`;
  const hub = (ref: string, path: string) => serialize({ repo, ref, path });

  body.querySelectorAll("source").forEach((el) => el.remove()); // srcset is stripped, so a <picture> falls back to its <img>

  body.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    for (const a of Array.from(el.attributes)) {
      // data: is allowed only as an image on <img>; SVG in an <img> cannot run script.
      if (clean(a.value).startsWith("data:") && !(tag === "img" && a.name === "src" && clean(a.value).startsWith("data:image/"))) el.removeAttribute(a.name);
    }
    // Only GitHub's own markdown classes: anything else could pick up the host UI's CSS (e.g. bolt-portal-host is position:fixed over the frame).
    if (el.hasAttribute("class")) {
      const keep = Array.from(el.classList).filter((c) => GH_CLASS.test(c));
      if (keep.length) el.setAttribute("class", keep.join(" "));
      else el.removeAttribute("class");
    }
    if (tag === "input") {
      if (el.getAttribute("type")?.toLowerCase() === "checkbox") el.setAttribute("disabled", "");
      else el.remove();
    }
  });

  body.querySelectorAll("a[href]").forEach((a) => {
    const href = (a.getAttribute("href") ?? "").trim();
    if (href.startsWith("#")) return;
    const external = () => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    };
    if (/^mailto:|^tel:/i.test(href)) return;
    if (SCHEME.test(href) || href.startsWith("//")) {
      const same = sameRepoUrl(href, ctx);
      if (same && (same.kind === "blob" || same.kind === "tree")) a.setAttribute("href", hub(same.ref, same.path));
      else external();
      return;
    }
    const path = href ? resolveRepoPath(href, ctx.dir) : null;
    if (path === null) a.removeAttribute("href");
    else a.setAttribute("href", hub(ctx.ref, path));
  });

  body.querySelectorAll("img").forEach((img) => {
    img.setAttribute("referrerpolicy", "no-referrer");
    img.setAttribute("loading", "lazy");
    const src = (img.getAttribute("src") ?? "").trim();
    let path: string | null = null;
    if (!src || src.startsWith("data:") || src.startsWith("//")) {
      if (!src) img.removeAttribute("src");
      return;
    }
    if (SCHEME.test(src)) {
      const same = sameRepoUrl(src, ctx);
      if (!same || !same.sameRef || same.kind === "tree") return; // external (camo, other repos): leave alone
      path = same.path;
    } else path = resolveRepoPath(src, ctx.dir);
    img.removeAttribute("src");
    if (path) {
      img.setAttribute("data-repo-path", path);
      if (!images.includes(path)) images.push(path);
    }
  });

  return { html: body.innerHTML, images };
}

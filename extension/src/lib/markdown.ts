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
  const diagrams = collectMermaid(body); // before the class filter, which strips GitHub's wrapper classes it looks for

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

  dressAlerts(body);
  diagrams.forEach((d) => (d.className = "markdown-mermaid"));
  return { html: body.innerHTML, images };
}

/**
 * Replaces each ```mermaid block with `<div class="markdown-mermaid"><pre lang="mermaid"><code>source</code></pre></div>`, which the Markdown
 * component renders as a diagram (and leaves as code if that fails). GitHub emits several shapes: the markdown API and bodyHTML wrap
 * `<pre lang="mermaid" aria-label="Raw mermaid code">` in a `section.js-render-needs-enrichment` (whose data-json is stripped already); other
 * paths give `div.highlight-source-mermaid > pre` or `pre > code.language-mermaid`. The section or highlight wrapper goes with the block.
 * Returns the new divs; the caller sets their class after the class filter, so README HTML cannot ask for a diagram that GitHub didn't make.
 */
function collectMermaid(body: HTMLElement): HTMLElement[] {
  const doc = body.ownerDocument;
  const pres = new Set<HTMLElement>();
  body.querySelectorAll<HTMLElement>('pre[lang="mermaid" i], div.highlight-source-mermaid pre, pre > code.language-mermaid').forEach((el) => pres.add(el.tagName === "CODE" ? (el.parentElement as HTMLElement) : el));
  const out: HTMLElement[] = [];
  pres.forEach((pre) => {
    if (!pre.isConnected) return;
    const source = pre.textContent ?? "";
    const section = pre.closest("section");
    const target = section && (section.textContent ?? "").trim() === source.trim() ? section : pre.closest<HTMLElement>("div.highlight-source-mermaid") ?? pre;
    const div = doc.createElement("div");
    const newPre = doc.createElement("pre");
    const code = doc.createElement("code");
    newPre.setAttribute("lang", "mermaid");
    code.textContent = source;
    newPre.appendChild(code);
    div.appendChild(newPre);
    target.replaceWith(div);
    out.push(div);
  });
  return out;
}

/**
 * GitHub's alert types and the azure-devops-ui MessageBar severity and icon each one borrows. MessageBar has no purple, so IMPORTANT
 * is info-blue and tells itself apart from NOTE by its icon (a speech bubble with "!", as GitHub's octicon-report).
 */
export const ALERTS = {
  note: { severity: "info", iconName: "Info" },
  tip: { severity: "success", iconName: "Lightbulb" },
  important: { severity: "info", iconName: "ChatWarning" },
  warning: { severity: "warning", iconName: "Warning" },
  caution: { severity: "error", iconName: "ErrorBadge" },
} as const;
export type AlertType = keyof typeof ALERTS;

/**
 * Restyles GitHub's alerts (`<div class="markdown-alert markdown-alert-note"><p class="markdown-alert-title">Note</p>…</div>`; the octicon
 * <svg> is already gone) as azure-devops-ui MessageBar markup: the HTML is a string, so no React MessageBar can go in, but its own classes
 * (bolt-messagebar severity-*, bolt-messagebar-icon, the Fluent icon span) give the same colours from the library's palette variables.
 * Runs after the class filter, so these library classes are only ever ones put here.
 */
function dressAlerts(body: HTMLElement) {
  body.querySelectorAll("div.markdown-alert").forEach((alert) => {
    const type = (Object.keys(ALERTS) as AlertType[]).find((t) => alert.classList.contains(`markdown-alert-${t}`));
    if (!type) return;
    const { severity, iconName } = ALERTS[type];
    const doc = alert.ownerDocument;
    const el = (tag: string, cls: string) => {
      const e = doc.createElement(tag);
      e.className = cls;
      return e;
    };
    const content = el("div", "bolt-messagebar-content flex-row");
    const icons = el("div", "bolt-messagebar-icons flex-row");
    const wrap = el("span", "fluent-icons-enabled");
    const icon = el("span", `fabric-icon ms-Icon--${iconName} bolt-messagebar-icon medium flex-noshrink`);
    icon.setAttribute("aria-hidden", "true");
    wrap.appendChild(icon);
    icons.appendChild(wrap);
    const msg = el("div", "markdown-alert-body flex-column flex-grow flex-shrink");
    while (alert.firstChild) msg.appendChild(alert.firstChild);
    const title = msg.querySelector(":scope > .markdown-alert-title");
    if (title) title.classList.add("font-weight-semibold");
    content.append(icons, msg);
    alert.appendChild(content);
    alert.classList.add("bolt-messagebar", `severity-${severity}`);
    alert.setAttribute("role", "note");
  });
}

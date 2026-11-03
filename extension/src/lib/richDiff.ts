// Batch 4, rich diffs: rendered markdown, images and SVG, and the "Binary file not shown" notice (VW-11).
//
// Facts:
//  - fileKind.classifyFile(name, size, head?) is the Files hub's preview classifier: images (png jpg jpeg gif webp bmp ico svg) are "image" up to 10 MB and "tooLarge" above; anything else is "tooLarge" above 1 MB (1048576),
//    "binary" for known binary extensions or a NUL byte in the first 8000 bytes, "markdown" for .md and .markdown. This module reuses it, so MAX_DIFF_BYTES is the same 1 MB.
//  - REST GET /pulls/{n}/files omits `patch` for binary files and for very large diffs (prFiles.RestPrFile.patch). It carries no file size, so the patch's absence is the usual signal in a pull request.
//  - githubBrowse.ts already reads file bytes through the contents API: `/repos/{repo}/contents/{path encoded per segment}?ref={ref}` with Accept application/vnd.github.raw, which also works for private
//    repositories (raw.githubusercontent.com cannot take the extension's token and an <img> cannot send headers). So the image "URLs" below are those REST paths; the caller fetches them as blobs.
//
// Decisions fixed by the tests (richDiff.test.ts):
//  - A MIME type, when given and one of image/* or text/markdown (parameters such as "; charset=binary" ignored), decides the kind; otherwise the file extension does. SVG is its own kind: it is an image and text.
//  - Views: image has only "rendered"; svg has "rendered" and "source", opening on "rendered"; markdown has "source" and "rendered", opening on "source" (reviewers comment on the source diff).
//  - Image sources: ADDED has no before; DELETED has no after; RENAMED reads the before from previousPath; before is read at baseOid and after at headOid.
//  - Rendered markdown shows one side at a time: both sides for a modified file, only "after" for an added file and only "before" for a deleted one; the toggle flips between them and stays put when there is one.
import type { ChangeType } from "./prFiles";
import { classifyFile } from "./fileKind";

export type RichKind = "markdown" | "image" | "svg";
export type DiffView = "source" | "rendered";
export type RenderedSide = "before" | "after";

/** The text shown in place of a diff that cannot be shown. */
export const BINARY_NOTICE = "Binary file not shown";
/** A file larger than this many bytes (1 MiB, as fileKind) shows BINARY_NOTICE; exactly this size is still shown. */
export const MAX_DIFF_BYTES = 1048576;

/** The rendered view this file can have, or null for an ordinary text diff. See the header for how a MIME type and the extension combine. */
export function richKind(path: string, mime?: string | null): RichKind | null {
  const m = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (m === "image/svg+xml") return "svg";
  if (m.startsWith("image/")) return "image";
  if (m === "text/markdown") return "markdown";
  const e = /\.([^./]+)$/.exec(path)?.[1].toLowerCase();
  if (e === "svg") return "svg";
  if (e && ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"].includes(e)) return "image";
  return e === "md" || e === "markdown" ? "markdown" : null;
}

/** The views a kind offers and the one it opens on. */
export function diffViews(kind: RichKind): { views: DiffView[]; default: DiffView } {
  if (kind === "image") return { views: ["rendered"], default: "rendered" };
  return kind === "svg" ? { views: ["rendered", "source"], default: "rendered" } : { views: ["source", "rendered"], default: "source" };
}

export interface ImageSourceParams {
  /** "owner/name". */
  repo: string;
  path: string;
  /** The old path of a RENAMED file. */
  previousPath?: string;
  changeType: ChangeType;
  baseOid: string;
  headOid: string;
}

/** REST paths for the two sides of an image: `/repos/${repo}/contents/${path per segment}?ref=${encodeURIComponent(oid)}`; null where the side does not exist. See the header. */
export function imageSources(p: ImageSourceParams): { before: string | null; after: string | null } {
  const url = (path: string, oid: string) => `/repos/${p.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(oid)}`;
  return {
    before: p.changeType === "ADDED" ? null : url(p.changeType === "RENAMED" ? p.previousPath ?? p.path : p.path, p.baseOid),
    after: p.changeType === "DELETED" ? null : url(p.path, p.headOid),
  };
}

/** Sides the rendered markdown view can show, in the order before, after. */
export function renderedSides(changeType: ChangeType): RenderedSide[] {
  return changeType === "ADDED" ? ["after"] : changeType === "DELETED" ? ["before"] : ["before", "after"];
}

/** The other side when both exist, else the only side. `current` that does not exist for the change type is treated as the only side. */
export function toggleRenderedSide(changeType: ChangeType, current: RenderedSide): RenderedSide {
  const sides = renderedSides(changeType);
  return sides.length === 1 ? sides[0] : current === "after" ? "before" : "after";
}

export interface DiffNoticeInput {
  path: string;
  /** Bytes, when known (REST pulls/files does not give it). */
  size?: number;
  /** REST `patch`; absent for binary and very large diffs. */
  patch?: string | null;
  additions: number;
  deletions: number;
  /** The first bytes of the file, when read. */
  head?: Uint8Array;
}

/**
 * BINARY_NOTICE when the diff cannot be shown, otherwise null: fileKind.classifyFile(path, size ?? 0, head) is "binary" or "tooLarge" (so an image over 10 MB, a known binary extension, a NUL byte, or
 * more than MAX_DIFF_BYTES), or the patch is missing while additions + deletions > 0 and the file is not an image. A missing patch with no added or deleted lines (a pure rename) is not a notice.
 */
export function diffNotice(f: DiffNoticeInput): string | null {
  const kind = classifyFile(f.path, f.size ?? 0, f.head);
  if (kind === "binary" || kind === "tooLarge") return BINARY_NOTICE;
  return !f.patch && f.additions + f.deletions > 0 && kind !== "image" ? BINARY_NOTICE : null;
}

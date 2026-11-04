// Image diff view modes for a modified image (both sides exist): 2-up, Swipe and Onion skin, as GitHub offers them.
//
// Facts:
//  - Dimensions come from the loaded <img> (naturalWidth / naturalHeight). An SVG with no width and height (only a viewBox) can report 0 × 0, so a zero side falls back to the CSS default
//    replaced-element size, 300 × 150.
//  - Sizes come from the Blob read through the contents API (blob.size).
//
// Decisions fixed by the tests (imageDiff.test.ts):
//  - Modes are offered only when both sides exist; the default is "2-up"; a stored value that is not a known mode is ignored.
//  - Images are never scaled up. 2-up uses one scale for both sides (so a size change shows), chosen so the wider side fits its column and the taller one fits MAX_IMAGE_HEIGHT.
//    Swipe and Onion skin draw both in one frame the size of the larger width and the larger height, scaled to fit the same way.
//  - Labels read "W × H px · size": bytes under 1 KB as "N B", then KB and MB with one decimal (trailing ".0" dropped), 1 KB = 1024 bytes.
import type { ChangeType } from "./prFiles";

export type ImageDiffMode = "2-up" | "swipe" | "onion";
export const IMAGE_DIFF_MODES: { id: ImageDiffMode; label: string }[] = [
  { id: "2-up", label: "2-up" },
  { id: "swipe", label: "Swipe" },
  { id: "onion", label: "Onion skin" },
];
export const DEFAULT_IMAGE_DIFF_MODE: ImageDiffMode = "2-up";
/** The tallest an image is drawn, in CSS pixels. */
export const MAX_IMAGE_HEIGHT = 480;
/** The gap between the two 2-up columns, in CSS pixels. */
export const TWO_UP_GAP = 16;
/** Onion skin opens with the after image at this opacity (percent); Swipe opens with the divider at this position (percent). */
export const DEFAULT_OPACITY = 50;
export const DEFAULT_SWIPE = 50;

export interface Size { w: number; h: number }

/** A stored mode when it is a known one, otherwise the default. */
export function storedImageDiffMode(v: unknown): ImageDiffMode {
  return IMAGE_DIFF_MODES.some((m) => m.id === v) ? (v as ImageDiffMode) : DEFAULT_IMAGE_DIFF_MODE;
}

/** True when the change has a before and an after to compare (not ADDED, not DELETED). */
export function hasBothSides(changeType: ChangeType): boolean {
  return changeType !== "ADDED" && changeType !== "DELETED";
}

/** naturalWidth / naturalHeight, with 300 × 150 in place of a zero or missing size (an SVG with only a viewBox). */
export function naturalSize(w: number | undefined, h: number | undefined): Size {
  return w && h ? { w, h } : { w: 300, h: 150 };
}

/** The smallest box holding both images. */
export function frameSize(a: Size, b: Size): Size {
  return { w: Math.max(a.w, b.w), h: Math.max(a.h, b.h) };
}

/** The scale (at most 1) at which `size` fits in `maxW` × `maxH`. A non-positive box gives 1 (not yet measured). */
export function fitScale(size: Size, maxW: number, maxH = MAX_IMAGE_HEIGHT): number {
  if (maxW <= 0 || size.w <= 0 || size.h <= 0) return 1;
  return Math.min(1, maxW / size.w, maxH / size.h);
}

/** 2-up: one scale for both, so each fits half of `width` (less the gap) and MAX_IMAGE_HEIGHT. */
export function twoUpScale(a: Size, b: Size, width: number): number {
  return fitScale(frameSize(a, b), (width - TWO_UP_GAP) / 2);
}

/** `size` times `scale`, rounded to whole pixels and at least 1. */
export function scaled(size: Size, scale: number): Size {
  return { w: Math.max(1, Math.round(size.w * scale)), h: Math.max(1, Math.round(size.h * scale)) };
}

/** "160 B", "1.5 KB", "2 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const one = (x: number) => String(Math.round(x * 10) / 10);
  return n < 1048576 ? `${one(n / 1024)} KB` : `${one(n / 1048576)} MB`;
}

/** "200 × 120 px · 1.5 KB"; either part is left out when unknown. */
export function imageLabel(size: Size | undefined, bytes: number | undefined): string {
  return [size && `${size.w} × ${size.h} px`, bytes !== undefined && formatBytes(bytes)].filter(Boolean).join(" · ");
}

/** A slider value clamped to 0–100 and rounded; anything not a number gives `fallback`. */
export function clampPercent(v: unknown, fallback = DEFAULT_OPACITY): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
}

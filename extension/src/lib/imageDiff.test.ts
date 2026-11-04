import { describe, it, expect } from "vitest";
import { DEFAULT_IMAGE_DIFF_MODE, IMAGE_DIFF_MODES, MAX_IMAGE_HEIGHT, TWO_UP_GAP, clampPercent, fitScale, formatBytes, frameSize, hasBothSides, imageLabel, naturalSize, scaled, storedImageDiffMode, twoUpScale } from "./imageDiff";

describe("image diff modes", () => {
  it("offers 2-up, Swipe and Onion skin, opening on 2-up", () => {
    expect(IMAGE_DIFF_MODES.map((m) => m.label)).toEqual(["2-up", "Swipe", "Onion skin"]);
    expect(DEFAULT_IMAGE_DIFF_MODE).toBe("2-up");
  });
  it.each([["onion", "onion"], ["swipe", "swipe"], ["2-up", "2-up"], ["blink", "2-up"], [undefined, "2-up"], [null, "2-up"], [3, "2-up"]])("stored %s reads as %s", (v, want) => {
    expect(storedImageDiffMode(v)).toBe(want);
  });
  it.each([["MODIFIED", true], ["RENAMED", true], ["CHANGED", true], ["ADDED", false], ["DELETED", false]] as const)("%s has both sides: %s", (c, want) => {
    expect(hasBothSides(c)).toBe(want);
  });
});

describe("image sizes and scaling", () => {
  it("falls back to 300 × 150 for an SVG that reports no size", () => {
    expect(naturalSize(0, 0)).toEqual({ w: 300, h: 150 });
    expect(naturalSize(undefined, 20)).toEqual({ w: 300, h: 150 });
    expect(naturalSize(48, 24)).toEqual({ w: 48, h: 24 });
  });
  it("frames both images at the larger width and the larger height", () => {
    expect(frameSize({ w: 160, h: 200 }, { w: 300, h: 100 })).toEqual({ w: 300, h: 200 });
  });
  it("never scales up", () => {
    expect(fitScale({ w: 100, h: 50 }, 1000)).toBe(1);
  });
  it("fits the width or the height, whichever is tighter", () => {
    expect(fitScale({ w: 2000, h: 100 }, 1000)).toBe(0.5);
    expect(fitScale({ w: 100, h: MAX_IMAGE_HEIGHT * 2 }, 1000)).toBe(0.5);
  });
  it("treats an unmeasured box as scale 1", () => {
    expect(fitScale({ w: 2000, h: 100 }, 0)).toBe(1);
  });
  it("2-up uses one scale for both sides, fitting the wider into half the width less the gap", () => {
    const width = 1000 + TWO_UP_GAP;
    expect(twoUpScale({ w: 1000, h: 100 }, { w: 250, h: 50 }, width)).toBe(0.5);
    expect(scaled({ w: 250, h: 50 }, 0.5)).toEqual({ w: 125, h: 25 });
  });
  it("rounds scaled sizes and keeps at least 1 px", () => {
    expect(scaled({ w: 3, h: 1 }, 0.1)).toEqual({ w: 1, h: 1 });
    expect(scaled({ w: 201, h: 99 }, 0.5)).toEqual({ w: 101, h: 50 });
  });
});

describe("image labels", () => {
  it.each([[0, "0 B"], [1023, "1023 B"], [1024, "1 KB"], [1536, "1.5 KB"], [1048575, "1024 KB"], [1048576, "1 MB"], [2.25 * 1048576, "2.3 MB"]])("%d bytes is %s", (n, want) => {
    expect(formatBytes(n)).toBe(want);
  });
  it("joins dimensions and size, leaving out what is unknown", () => {
    expect(imageLabel({ w: 200, h: 120 }, 551)).toBe("200 × 120 px · 551 B");
    expect(imageLabel({ w: 200, h: 120 }, undefined)).toBe("200 × 120 px");
    expect(imageLabel(undefined, 2048)).toBe("2 KB");
    expect(imageLabel(undefined, undefined)).toBe("");
  });
});

describe("slider values", () => {
  it.each([[50, 50], [-3, 0], [140, 100], [33.6, 34], ["70", 70], ["x", 50], [NaN, 50]])("%s clamps to %s", (v, want) => {
    expect(clampPercent(v)).toBe(want);
  });
});

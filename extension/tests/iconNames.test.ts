import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Lives outside src/ (the build type-checks src/ without Node types). A past release shipped an invisible "ArrowLeft": every icon name in src/ must exist in azure-devops-ui's icon fonts.
const ICONS = join(__dirname, "..", "node_modules", "azure-devops-ui", "Components", "Icon");
const known = new Set([...(readFileSync(join(ICONS, "FluentIcons.css"), "utf8") + readFileSync(join(ICONS, "FabricIcons.css"), "utf8")).matchAll(/ms-Icon--([A-Za-z0-9_]+)/g)].map((m) => m[1]));

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === "dev" ? [] : sources(p)) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });

describe("icon names", () => {
  it("every iconName in src/ exists in FluentIcons.css or FabricIcons.css", () => {
    const missing: string[] = [];
    for (const file of sources(join(__dirname, "..", "src"))) {
      const text = readFileSync(file, "utf8");
      // iconName: "X" / iconName="X", and iconName: cond ? "X" : "Y"
      const names = [...text.matchAll(/iconName[:=]\s*\{?\s*(?:\w[\w.]*\s*\?\s*"([A-Za-z0-9_]+)"\s*:\s*)?"([A-Za-z0-9_]+)"/g)].flatMap((m) => [m[1], m[2]].filter(Boolean));
      for (const n of names) if (!known.has(n)) missing.push(`${file}: ${n}`);
    }
    expect(missing, "Expected every icon name to exist in the icon fonts").toEqual([]);
  });
});

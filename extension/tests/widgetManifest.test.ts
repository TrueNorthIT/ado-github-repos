// The dashboard widgets' contributions: each widget names its own configuration contribution, and both load widget.html,
// which routes on the contribution id (lib/widgets.ts widgetFrame).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { widgetFrame } from "../src/lib/widgets";

describe("manifest", () => {
  it("contributes each widget with its own configuration, both served by widget.html", () => {
    const m = JSON.parse(readFileSync(join(__dirname, "..", "vss-extension.json"), "utf8")) as { contributions: { id: string; type: string; targets: string[]; properties: Record<string, any> }[] };
    const byId = new Map(m.contributions.map((c) => [c.id, c]));
    for (const kind of ["prs", "runs"] as const) {
      const w = byId.get(`github-${kind}-widget`)!;
      expect(w.type).toBe("ms.vss-dashboards-web.widget");
      expect(w.targets).toEqual(["ms.vss-dashboards-web.widget-catalog", `.github-${kind}-widget-config`]);
      expect(w.properties.uri).toBe("dist/widget.html");
      expect(widgetFrame(`TrueNorthIT.github-repos.${w.id}`)).toEqual({ kind, config: false });
      const c = byId.get(`github-${kind}-widget-config`)!;
      expect(c.type).toBe("ms.vss-dashboards-web.widget-configuration");
      expect(c.properties.uri).toBe("dist/widget.html");
      expect(widgetFrame(`TrueNorthIT.github-repos.${c.id}`)).toEqual({ kind, config: true });
    }
  });
});

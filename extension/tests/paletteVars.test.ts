// ADO's theme defines --palette-neutral-* (and other non-alpha palette entries) as bare RGB triples
// ("102, 102, 102"), meant for rgba(var(--palette-neutral-60), 1). Used directly as a colour they are
// invalid in real ADO, while mock mode silently uses the fallback. The alpha entries are full colours.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(n) ? [p] : [];
  });
}

describe("palette variables", () => {
  it("wraps RGB-triple palette variables in rgb()/rgba()", () => {
    const bad: string[] = [];
    for (const f of files(join(__dirname, "..", "src"))) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/(.{0,5})var\(--palette-(?!black-alpha|white-alpha)[a-z0-9-]+/g)) {
        if (!/rgba?\($/.test(m[1])) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

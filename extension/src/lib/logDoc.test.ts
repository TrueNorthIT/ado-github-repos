import { describe, it, expect } from "vitest";
import { parseLog } from "./workflowLog";
import { buildLogDoc } from "./logDoc";

const log = "2026-11-03T10:00:01.500Z ##[group]Run x\n2026-11-03T10:00:02.000Z \u001b[31mred\u001b[0m ok\n2026-11-03T10:00:03.000Z ##[error]boom";

describe("buildLogDoc", () => {
  it("keeps one document line per log line, without timestamps by default", () => {
    const d = buildLogDoc(parseLog(log), false);
    expect(d.text).toBe("Run x\nred ok\nboom");
    expect(d.errors).toEqual([3]);
  });
  it("puts the clock in a fixed-width column and shifts marks past it", () => {
    const d = buildLogDoc(parseLog(log), true);
    expect(d.text.split("\n")[1]).toBe("10:00:02.000 red ok");
    expect(d.marks).toEqual([{ line: 2, start: 14, end: 17, span: { text: "red", fg: 1 } }]);
  });
});

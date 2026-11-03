import { describe, it, expect } from "vitest";
import { pickDefaultRepo, recallRepo, rememberRepo } from "./lastRepo";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("pickDefaultRepo", () => {
  const connected = ["TrueNorthIT/ado-github-repos", "TrueNorthIT/TrueTunes"];
  it("uses the remembered repo when it is still connected, spelt as connected", () => {
    expect(pickDefaultRepo(connected, "truenorthit/truetunes")).toBe("TrueNorthIT/TrueTunes");
  });
  it("falls back to the first connected repo when the remembered one is gone or absent", () => {
    expect(pickDefaultRepo(connected, "TrueNorthIT/removed")).toBe("TrueNorthIT/ado-github-repos");
    expect(pickDefaultRepo(connected, undefined)).toBe("TrueNorthIT/ado-github-repos");
  });
  it("gives nothing when no repo is connected", () => {
    expect(pickDefaultRepo([], "TrueNorthIT/TrueTunes")).toBeUndefined();
  });
});

describe("rememberRepo / recallRepo", () => {
  it("round-trips per organisation and project, ignoring case", () => {
    const s = memory();
    rememberRepo("trueNorthIT", "TrueNorth - Infrastructure", "TrueNorthIT/TrueTunes", s);
    expect(recallRepo("truenorthit", "truenorth - infrastructure", s)).toBe("TrueNorthIT/TrueTunes");
    expect(recallRepo("trueNorthIT", "Another project", s)).toBeUndefined();
  });
  it("survives storage that throws", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => rememberRepo("o", "p", "a/b", broken)).not.toThrow();
    expect(recallRepo("o", "p", broken)).toBeUndefined();
  });
});

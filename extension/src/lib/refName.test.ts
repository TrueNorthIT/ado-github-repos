import { describe, it, expect } from "vitest";
import { validateRefName } from "./refName";

// Module under test: src/lib/refName.ts (validateRefName). Shared by new-branch (B-5) and new-tag (T-2) validation.
// Contract fixed by these tests:
//  - the result is { ok: true } or { ok: false, code, reason }; `reason` is a non-empty sentence, `code` is machine-readable.
//  - rules are `git check-ref-format` basics applied to the SHORT name (no refs/heads/ prefix).
//  - when a name breaks several rules the FIRST in the documented order wins. The specific leading/trailing slash codes
//    win over the generic "empty-segment" for "/x" and "x/". "a//b" is "empty-segment".
//  - the duplicate check is exact and case-sensitive, and only runs once the format is valid.
// Not pinned (see report): rules git has that the requirement does not list, e.g. a segment starting with ".", "@{", control characters.

const none: string[] = [];
const reject = (name: string, existing: Iterable<string> = none) => validateRefName(name, existing);

describe("B-5: branch names are validated as git check-ref-format basics", () => {
  it.each(["feature", "feature/jdp/tooling", "release-1.2.3", "fix_bug#42", "ünï", "a.b", "x-y"])("accepts %s", (name) => {
    expect(reject(name), `Expected "${name}" to be a valid ref name`).toEqual({ ok: true });
  });

  it("rejects an empty name", () => {
    const r = reject("");
    expect(r, "Expected an empty name to be rejected").toMatchObject({ ok: false, code: "empty" });
    expect((r as any).reason, "Expected a reason sentence for the user").toMatch(/\S/);
  });

  it("rejects a name that is only whitespace as having a space", () => {
    expect(reject("   "), "Expected whitespace-only to be rejected (no spaces allowed)").toMatchObject({ ok: false, code: "space" });
  });

  it.each(["my branch", "a\tb", " lead", "trail "])("rejects a name containing whitespace: %j", (name) => {
    expect(reject(name), `Expected "${name}" to be rejected for whitespace`).toMatchObject({ ok: false, code: "space" });
  });

  it.each(["a..b", "..", "feature/x..y"])("rejects '..' anywhere: %s", (name) => {
    expect(reject(name), `Expected "${name}" to be rejected for ".."`).toMatchObject({ ok: false, code: "double-dot" });
  });

  it.each(["a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b"])("rejects the forbidden character in %s", (name) => {
    expect(reject(name), `Expected "${name}" to be rejected for one of ~ ^ : ? * [ \\`).toMatchObject({ ok: false, code: "forbidden-char" });
  });

  it("rejects a leading slash", () => {
    expect(reject("/feature"), "Expected a leading / to be rejected").toMatchObject({ ok: false, code: "leading-slash" });
  });

  it.each(["-feature", "-"])("rejects a leading dash: %s", (name) => {
    expect(reject(name), `Expected "${name}" to be rejected for a leading -`).toMatchObject({ ok: false, code: "leading-dash" });
  });

  it("rejects a trailing .lock", () => {
    expect(reject("feature.lock"), "Expected a trailing .lock to be rejected").toMatchObject({ ok: false, code: "trailing-lock" });
  });

  it("accepts .lock when it is not at the end", () => {
    expect(reject("feature.lock.v2"), "Expected .lock in the middle to be allowed").toEqual({ ok: true });
  });

  it("rejects a trailing slash", () => {
    expect(reject("feature/"), "Expected a trailing / to be rejected").toMatchObject({ ok: false, code: "trailing-slash" });
  });

  it.each(["a//b", "feature//jdp/x"])("rejects an empty segment: %s", (name) => {
    expect(reject(name), `Expected "${name}" to be rejected for an empty path segment`).toMatchObject({ ok: false, code: "empty-segment" });
  });

  it("rejects a name that already exists (array of existing names)", () => {
    expect(reject("main", ["develop", "main"]), "Expected an existing name to be rejected").toMatchObject({ ok: false, code: "exists" });
  });

  it("rejects a name that already exists (any iterable, e.g. a Set)", () => {
    expect(reject("v1.0", new Set(["v1.0"])), "Expected a Set of existing names to be honoured").toMatchObject({ ok: false, code: "exists" });
  });

  it("treats names that differ only by case as different", () => {
    expect(reject("Main", ["main"]), "Expected the duplicate check to be case-sensitive").toEqual({ ok: true });
  });

  it("reports the format error before the duplicate when both apply", () => {
    expect(reject("bad name", ["bad name"]), "Expected the format rule to win over 'exists'").toMatchObject({ ok: false, code: "space" });
  });
});

describe("T-2: tag names use the same validation", () => {
  // Given existing tag names, a new tag with one of them is refused and a fresh valid name is accepted.
  it("rejects a tag name that already exists and accepts a fresh one", () => {
    const tags = ["v1.0.0", "v1.1.0"];
    expect(reject("v1.1.0", tags), "Expected an existing tag name to be rejected").toMatchObject({ ok: false, code: "exists" });
    expect(reject("v1.2.0", tags), "Expected an unused tag name to be accepted").toEqual({ ok: true });
  });
});

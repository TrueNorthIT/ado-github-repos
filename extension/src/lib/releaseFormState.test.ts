import { describe, expect, it } from "vitest";
import { emptyForm, formButtons, formFromRelease, latestChecked, needsOverwriteConfirm, releaseErrorText, sameForm } from "./releaseFormState";

const rel = { tagName: "v1.0", name: "v1.0", description: "notes", isDraft: false, isPrerelease: false, isLatest: true };

describe("releaseFormState", () => {
  it("starts a new form blank, latest ticked", () => {
    expect(emptyForm("v2", "main")).toEqual({ tagName: "v2", target: "main", name: "", body: "", prerelease: false, makeLatest: true });
  });
  it("blanks a title that is only the tag name", () => {
    expect(formFromRelease(rel, "main").name).toBe("");
    expect(formFromRelease({ ...rel, name: "First" }, "main").name).toBe("First");
  });
  it("carries latest and pre-release from the release", () => {
    expect(formFromRelease({ ...rel, isLatest: false }, "main").makeLatest).toBe(false);
    expect(formFromRelease({ ...rel, isDraft: true, isLatest: false }, "main").makeLatest).toBe(true);
    expect(formFromRelease({ ...rel, isDraft: true, isLatest: false, isPrerelease: true }, "main")).toMatchObject({ prerelease: true, makeLatest: false });
  });
  it("picks buttons by mode and draft state", () => {
    expect(formButtons("new", false)).toEqual({ primary: "Publish release", saveDraft: true });
    expect(formButtons("edit", true)).toEqual({ primary: "Publish release", saveDraft: true });
    expect(formButtons("edit", false)).toEqual({ primary: "Update release", saveDraft: false });
  });
  it("confirms only over non-blank notes", () => {
    expect(needsOverwriteConfirm("")).toBe(false);
    expect(needsOverwriteConfirm("  \n")).toBe(false);
    expect(needsOverwriteConfirm("x")).toBe(true);
  });
  it("never shows latest ticked on a pre-release", () => {
    expect(latestChecked({ prerelease: true, makeLatest: true })).toBe(false);
    expect(latestChecked({ prerelease: false, makeLatest: true })).toBe(true);
  });
  it("compares forms field by field", () => {
    const a = emptyForm("v1", "main");
    expect(sameForm(a, { ...a })).toBe(true);
    expect(sameForm(a, { ...a, body: "x" })).toBe(false);
  });
  it("words errors with GitHub's message", () => {
    expect(releaseErrorText("Could not save", { kind: "access", status: 403, apiMessage: "Resource not accessible" })).toContain("Resource not accessible");
    expect(releaseErrorText("Could not save", { kind: "other", status: 422, apiMessage: "Validation Failed" })).toBe("Could not save. GitHub said: Validation Failed");
    expect(releaseErrorText("Could not save", new Error("x"))).toContain("could not reach GitHub");
  });
});

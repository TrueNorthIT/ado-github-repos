import { describe, it, expect } from "vitest";
import { actionsStateFromUrl } from "./actionsLink";

describe("actionsStateFromUrl", () => {
  const repo = "octo/demo";
  it("reads a run and job from an Actions details URL", () => {
    expect(actionsStateFromUrl("https://github.com/octo/demo/actions/runs/41617937185/job/125855973951", repo)).toEqual({ repo, run: 41617937185, job: 125855973951 });
  });
  it("reads a run alone", () => {
    expect(actionsStateFromUrl("https://github.com/Octo/Demo/actions/runs/5", repo)).toEqual({ repo, run: 5 });
  });
  it("ignores other repositories, non-Actions URLs and junk", () => {
    expect(actionsStateFromUrl("https://github.com/other/demo/actions/runs/5", repo)).toBeNull();
    expect(actionsStateFromUrl("https://ci.example.com/build/5", repo)).toBeNull();
    expect(actionsStateFromUrl("https://github.com/octo/demo/runs/5", repo)).toBeNull();
    expect(actionsStateFromUrl(undefined, repo)).toBeNull();
  });
});

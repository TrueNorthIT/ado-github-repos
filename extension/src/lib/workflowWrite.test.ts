import { describe, it, expect } from "vitest";
import { isWorkflowPath, isWorkflowPermissionError, WORKFLOW_PERMISSION_TEXT } from "./workflowWrite";

describe("workflow write refusals", () => {
  it("knows workflow paths", () => {
    expect(isWorkflowPath(".github/workflows/ci.yml")).toBe(true);
    expect(isWorkflowPath("/.github/workflows/sub/x.yaml")).toBe(true);
    expect(isWorkflowPath(".github/workflows/")).toBe(false);
    expect(isWorkflowPath(".github/dependabot.yml")).toBe(false);
    expect(isWorkflowPath("docs/.github/workflows/ci.yml")).toBe(false);
  });

  it("recognises GitHub's own message, whatever the path or status", () => {
    expect(isWorkflowPermissionError({ status: 0, message: "refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission" }, [])).toBe(true);
    expect(isWorkflowPermissionError({ status: 422, message: "refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope" }, ["x"])).toBe(true);
  });

  it("treats a 403 or 404 on a workflow change as the same refusal, and nothing else", () => {
    expect(isWorkflowPermissionError({ status: 403 }, ["README.md", ".github/workflows/ci.yml"])).toBe(true);
    expect(isWorkflowPermissionError({ status: 404 }, [".github/workflows/ci.yml"])).toBe(true);
    expect(isWorkflowPermissionError({ status: 403 }, ["README.md"])).toBe(false);
    expect(isWorkflowPermissionError({ status: 422, message: "Update is not a fast forward" }, [".github/workflows/ci.yml"])).toBe(false);
  });

  it("says which permission is missing", () => {
    expect(WORKFLOW_PERMISSION_TEXT).toMatch(/Workflows permission/);
  });
});

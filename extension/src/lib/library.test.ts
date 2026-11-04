import { describe, expect, it } from "vitest";
import {
  createVariableRequest,
  deleteSecretRequest,
  deleteVariableRequest,
  groupRows,
  libraryProblem,
  libraryWriteError,
  listSecretsRequest,
  listVariablesRequest,
  nameError,
  secretsSettingsUrl,
  toSecret,
  toVariable,
  updateVariableRequest,
  valueError,
} from "./library";
import { parseActions, serializeActions } from "./actionsHash";

const R = "o/r";
const repo = { kind: "repo" } as const;
const env = { kind: "env", env: "prod eu/1" } as const;

describe("nameError (GitHub's naming rules)", () => {
  it("accepts letters, digits and underscores", () => {
    expect(nameError("NODE_VERSION")).toBeUndefined();
    expect(nameError("_private1")).toBeUndefined();
    expect(nameError("  trimmed  ")).toBeUndefined();
  });
  it("refuses blanks, spaces and punctuation", () => {
    expect(nameError("")).toMatch(/Enter a name/);
    expect(nameError("   ")).toMatch(/Enter a name/);
    expect(nameError("MY VAR")).toMatch(/letters, numbers and underscores/);
    expect(nameError("my-var")).toMatch(/letters, numbers and underscores/);
    expect(nameError("café")).toMatch(/letters, numbers and underscores/);
  });
  it("refuses a leading digit and the GITHUB_ prefix in any case", () => {
    expect(nameError("1ST")).toMatch(/start with a number/);
    expect(nameError("GITHUB_TOKEN")).toMatch(/GITHUB_/);
    expect(nameError("github_x")).toMatch(/GITHUB_/);
    expect(nameError("GITHUBX")).toBeUndefined();
  });
  it("refuses a name already taken in the scope, case-insensitively, but not the variable's own", () => {
    expect(nameError("node_version", ["NODE_VERSION"])).toMatch(/NODE_VERSION already exists/);
    expect(nameError("node_version", ["NODE_VERSION"], "NODE_VERSION")).toBeUndefined();
    expect(nameError("OTHER", ["NODE_VERSION", "OTHER"], "NODE_VERSION")).toMatch(/already exists/);
  });
});

describe("valueError", () => {
  it("needs a value no bigger than 48 KB", () => {
    expect(valueError("")).toMatch(/Enter a value/);
    expect(valueError("x")).toBeUndefined();
    expect(valueError("x".repeat(48 * 1024))).toBeUndefined();
    expect(valueError("x".repeat(48 * 1024 + 1))).toMatch(/48 KB/);
    expect(valueError("é".repeat(25 * 1024))).toMatch(/48 KB/); // bytes, not characters
  });
});

describe("mapping and grouping", () => {
  it("reads variables and secrets, falling back to created_at", () => {
    expect(toVariable({ name: "A", value: "1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" })).toEqual({ name: "A", value: "1", updatedAt: new Date("2026-02-01T00:00:00Z") });
    expect(toSecret({ name: "S", created_at: "2026-01-01T00:00:00Z" })).toEqual({ name: "S", updatedAt: new Date("2026-01-01T00:00:00Z") });
    expect(toVariable(null).name).toBe("");
  });
  it("lists variables then secrets, each by name", () => {
    const d = new Date(0);
    const rows = groupRows([{ name: "B", value: "", updatedAt: d }, { name: "A", value: "", updatedAt: d }], [{ name: "Z", updatedAt: d }, { name: "C", updatedAt: d }]);
    expect(rows.map((r) => `${r.secret ? "s" : "v"}:${r.name}`)).toEqual(["v:A", "v:B", "s:C", "s:Z"]);
  });
});

describe("requests", () => {
  it("lists with GitHub's page sizes (30 variables, 100 secrets)", () => {
    expect(listVariablesRequest(R, repo, 2)).toEqual({ method: "GET", path: "/repos/o/r/actions/variables?per_page=30&page=2" });
    expect(listSecretsRequest(R, repo)).toEqual({ method: "GET", path: "/repos/o/r/actions/secrets?per_page=100&page=1" });
    expect(listVariablesRequest(R, env)).toEqual({ method: "GET", path: "/repos/o/r/environments/prod%20eu%2F1/variables?per_page=30&page=1" });
    expect(listSecretsRequest(R, env).path).toBe("/repos/o/r/environments/prod%20eu%2F1/secrets?per_page=100&page=1");
  });
  it("creates, updates, renames and deletes", () => {
    expect(createVariableRequest(R, repo, " NEW ", "v")).toEqual({ method: "POST", path: "/repos/o/r/actions/variables", body: { name: "NEW", value: "v" } });
    expect(updateVariableRequest(R, env, "OLD", "old", "v")).toEqual({ method: "PATCH", path: "/repos/o/r/environments/prod%20eu%2F1/variables/OLD", body: { value: "v" } });
    expect(updateVariableRequest(R, repo, "OLD", "NEW", "v")).toEqual({ method: "PATCH", path: "/repos/o/r/actions/variables/OLD", body: { name: "NEW", value: "v" } });
    expect(deleteVariableRequest(R, repo, "A")).toEqual({ method: "DELETE", path: "/repos/o/r/actions/variables/A" });
    expect(deleteSecretRequest(R, env, "S")).toEqual({ method: "DELETE", path: "/repos/o/r/environments/prod%20eu%2F1/secrets/S" });
  });
  it("links to GitHub's secrets settings", () => {
    expect(secretsSettingsUrl(R, repo)).toBe("https://github.com/o/r/settings/secrets/actions");
    expect(secretsSettingsUrl(R, env, 42)).toBe("https://github.com/o/r/settings/environments/42/edit");
    expect(secretsSettingsUrl(R, env)).toBe("https://github.com/o/r/settings/environments");
  });
});

describe("errors", () => {
  it("names the missing app permission when GitHub says the integration can't", () => {
    const p = libraryProblem({ kind: "access", status: 403, apiMessage: "Resource not accessible by integration" }, "secrets");
    expect(p.kind).toBe("permission");
    expect(p.text).toContain('"Secrets" repository permission');
  });
  it("covers a plain 403/404 as permission or admin rights", () => {
    const p = libraryProblem({ kind: "access", status: 404 }, "variables");
    expect(p.kind).toBe("permission");
    expect(p.text).toMatch(/"Variables".*admin/);
  });
  it("maps sign-in, rate limit and anything else", () => {
    expect(libraryProblem({ kind: "auth", status: 401 }, "variables").kind).toBe("auth");
    expect(libraryProblem({ kind: "rateLimit", status: 403 }, "variables").kind).toBe("rateLimit");
    expect(libraryProblem(new Error("x"), "secrets")).toEqual({ kind: "other", text: "Could not load secrets from GitHub." });
  });
  it("words failed writes", () => {
    expect(libraryWriteError({ kind: "other", status: 409, apiMessage: "Already exists" }, "add the variable", "variables")).toBe("Could not add the variable: a variable with that name already exists.");
    expect(libraryWriteError({ kind: "access", status: 403, apiMessage: "Resource not accessible by integration" }, "delete the secret", "secrets")).toMatch(/"Secrets"/);
    expect(libraryWriteError({ kind: "access", status: 403 }, "save the variable", "variables")).toMatch(/admin rights/);
    expect(libraryWriteError({ kind: "other", status: 500 }, "save the variable", "variables")).toBe("Could not save the variable.");
  });
});

describe("the Library tab in the Actions hash", () => {
  it("round-trips actTab=library and keeps no environment key", () => {
    const h = serializeActions({ repo: R, tab: "library" });
    expect(h).toBe("#repo=o%2Fr&view=actions&actTab=library");
    expect(parseActions(h)).toEqual({ repo: R, tab: "library" });
    expect(parseActions("#repo=o%2Fr&view=actions&actTab=library&actEnv=staging")).toEqual({ repo: R, tab: "library" });
  });
});

import { describe, it, expect } from "vitest";
import { groupChecks, reconcileOpen, OTHER_CHECKS, type GroupableRow } from "./checkGroups";
import { policyRows, type CheckContext } from "./policies";

const row = (title: string, state: GroupableRow["state"], group?: string, required = false, kind: GroupableRow["kind"] = "check"): GroupableRow => ({ kind, title, state, required, ...(group ? { group } : {}) });

describe("groupChecks", () => {
  it("leaves non-check rows ungrouped at the top and groups check rows by their group, rows keeping their order", () => {
    const rows = [row("Review approval", "success", undefined, true, "reviews"), row("b", "success", "Validate"), row("a", "success", "Validate"), row("x", "success", "Storybook")];
    const { top, groups } = groupChecks(rows);
    expect(top.map((r) => r.title)).toEqual(["Review approval"]);
    expect(groups.map((g) => g.name)).toEqual(["Storybook", "Validate"]);
    expect(groups.find((g) => g.name === "Validate")!.rows.map((r) => r.title)).toEqual(["b", "a"]);
  });

  it("puts check rows with no group under Other checks, which sorts last in its bucket", () => {
    const { groups } = groupChecks([row("s", "success"), row("z", "success", "Zeta"), row("a", "success", "Alpha")]);
    expect(groups.map((g) => g.name)).toEqual(["Alpha", "Zeta", OTHER_CHECKS]);
  });

  it("orders failing groups, then pending, then the rest; alphabetical within each", () => {
    const { groups } = groupChecks([
      row("1", "success", "A-pass"), row("2", "neutral", "B-skip"), row("3", "pending", "Z-run"), row("4", "failure", "Y-fail"),
      row("5", "pending", "C-run"), row("6", "failure", "X-fail"), row("7", "success"), row("8", "failure", undefined),
    ]);
    // the ungrouped failure joins Other checks (failing), which sorts last within the failing bucket
    expect(groups.map((g) => g.name)).toEqual(["X-fail", "Y-fail", OTHER_CHECKS, "C-run", "Z-run", "A-pass", "B-skip"]);
  });

  it("takes the worst state: failure > pending > success > neutral", () => {
    const st = (...s: GroupableRow["state"][]) => groupChecks(s.map((x, i) => row(String(i), x, "G"))).groups[0].state;
    expect(st("success", "neutral", "failure", "pending")).toBe("failure");
    expect(st("success", "pending", "neutral")).toBe("pending");
    expect(st("neutral", "success")).toBe("success");
    expect(st("neutral", "neutral")).toBe("neutral");
  });

  it("builds the summary", () => {
    const sum = (...s: GroupableRow["state"][]) => groupChecks(s.map((x, i) => row(String(i), x, "G"))).groups[0].summary;
    expect(sum("success", "failure", "success")).toBe("3 checks · 1 failed");
    expect(sum("pending", "pending")).toBe("2 checks · running");
    expect(sum("success")).toBe("1 check");
    expect(sum("success", "pending", "failure", "failure")).toBe("4 checks · 2 failed · 1 running");
    expect(sum("failure", "failure")).toBe("2 checks · 2 failed");
  });

  it("marks a group Required when any check in it is", () => {
    const { groups } = groupChecks([row("a", "success", "G"), row("b", "success", "G", true), row("c", "success", "H")]);
    expect(groups.map((g) => [g.name, g.required])).toEqual([["G", true], ["H", false]]);
  });

  it("forms groups from policyRows: workflow, else app, else Other checks", () => {
    const run = (name: string, extra: object): CheckContext => ({ __typename: "CheckRun", name, status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: null, isRequired: false, ...extra } as CheckContext);
    const rows = policyRows({
      state: "OPEN", isDraft: false, mergeStateStatus: "CLEAN", reviewDecision: null, autoMergeAllowed: false, autoMergeRequest: null,
      checks: [
        run("job", { checkSuite: { workflowRun: { workflow: { name: "Validate" } } }, appSuite: { app: { name: "GitHub Actions" } } }),
        run("scan", { checkSuite: { workflowRun: null }, appSuite: { app: { name: "CodeQL" } } }),
        run("bare", {}),
        { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS", targetUrl: null, isRequired: false },
      ],
    });
    const { top, groups } = groupChecks(rows);
    expect(top.map((r) => r.kind)).toEqual(["conflicts"]);
    expect(groups.map((g) => [g.name, g.rows.map((r) => r.title)])).toEqual([["CodeQL", ["scan"]], ["Validate", ["job"]], [OTHER_CHECKS, ["bare", "ci/legacy"]]]);
  });
});

describe("reconcileOpen (default expansion)", () => {
  type St = { open: Record<string, boolean>; toggled: Record<string, boolean>; seen: Record<string, GroupableRow["state"]> };
  const g = (name: string, state: GroupableRow["state"]) => ({ name, state });
  const step = (s: St, ...gs: ReturnType<typeof g>[]) => reconcileOpen(s.toggled, s.seen, gs);
  const toggle = (s: St, name: string): St => ({ ...s, toggled: { ...s.toggled, [name]: !s.open[name] } });
  const start: St = { open: {}, toggled: {}, seen: {} };

  it("opens a group with a failure or anything pending, collapses one that passed or is neutral", () => {
    const s = step(start, g("F", "failure"), g("P", "pending"), g("S", "success"), g("N", "neutral"));
    expect(s.open).toEqual({ F: true, P: true, S: false, N: false });
  });

  it("an untouched group follows its state: one first seen running collapses once it passes, and opens if it then fails", () => {
    let s = step(start, g("Publish", "pending"));
    expect(s.open.Publish, "Expected a running group to start open").toBe(true);
    s = step(s, g("Publish", "success"));
    expect(s.open.Publish, "Expected it to collapse once it passed (it stayed open in 0.39.2)").toBe(false);
    s = step(s, g("Publish", "failure"));
    expect(s.open.Publish, "Expected it to open when it failed").toBe(true);
  });

  it("the user's choice wins even when the state changes", () => {
    let s = step(start, g("F", "failure"), g("S", "success"));
    s = toggle(toggle(s, "F"), "S"); // user collapses F, opens S
    s = step(s, g("F", "success"), g("S", "success"));
    expect(s.open).toEqual({ F: false, S: true });
    s = step(s, g("F", "pending"), g("S", "pending"));
    expect(s.open).toEqual({ F: false, S: true });
  });

  it("a collapsed group that goes from passing to failing opens", () => {
    let s = step(start, g("G", "success"));
    s = step({ ...s, toggled: { G: false } }, g("G", "success")); // the user opened it and closed it again
    expect(s.open.G).toBe(false);
    s = step(s, g("G", "failure"));
    expect(s.open.G).toBe(true);
  });

  it("but not when the user collapsed it after it was already failing", () => {
    let s = step(start, g("G", "failure"));
    s = step(toggle(s, "G"), g("G", "failure"));
    expect(s.open.G).toBe(false);
    s = step(s, g("G", "pending")); // a re-run: still the user's call
    expect(s.open.G).toBe(false);
  });

  it("takes another rule for untouched groups (the Checks tab opens everything)", () => {
    const s = reconcileOpen({}, {}, [g("S", "success"), g("F", "failure")], () => true);
    expect(s.open).toEqual({ S: true, F: true });
  });

  it("is idempotent for unchanged input", () => {
    const a = step(start, g("G", "success"), g("H", "failure"));
    expect(step(a, g("G", "success"), g("H", "failure"))).toEqual(a);
  });
});

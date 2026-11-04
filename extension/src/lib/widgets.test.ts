import { describe, expect, it, vi } from "vitest";
import { barCount, filterPrs, parsePrSettings, parseRunsSettings, pullsPath, runBars, serializeSettings, toWidgetPr, widgetFrame, widgetPixels } from "./widgets";
import { toRun } from "./workflows";

vi.mock("azure-devops-extension-sdk", () => ({ getContributionId: () => "TrueNorthIT.github-repos.github-prs-widget" }));

describe("widgetFrame", () => {
  it("names the widget and whether it is the configuration frame", () => {
    expect(widgetFrame("TrueNorthIT.github-repos.github-prs-widget")).toEqual({ kind: "prs", config: false });
    expect(widgetFrame("TrueNorthIT.github-repos.github-runs-widget-config")).toEqual({ kind: "runs", config: true });
    expect(widgetFrame("github-runs-widget")).toEqual({ kind: "runs", config: false });
  });
  it("is null for hubs and anything else", () => {
    expect(widgetFrame("TrueNorthIT.github-repos.github-repos-prs-hub")).toBeNull();
    expect(widgetFrame("TrueNorthIT.github-repos.github-prs-widget-configx")).toBeNull();
    expect(widgetFrame("")).toBeNull();
  });
});

describe("widget settings", () => {
  it("round-trips", () => {
    expect(parsePrSettings(serializeSettings({ repo: "o/r", filter: "mine" }))).toEqual({ repo: "o/r", filter: "mine" });
    expect(parseRunsSettings(serializeSettings({ repo: "o/r", workflowId: 101 }))).toEqual({ repo: "o/r", workflowId: 101 });
  });
  it("falls back on missing or malformed data", () => {
    expect(parsePrSettings(undefined)).toEqual({ repo: undefined, filter: "all" });
    expect(parsePrSettings("not json")).toEqual({ repo: undefined, filter: "all" });
    expect(parsePrSettings('{"repo":"../x","filter":"everything"}')).toEqual({ repo: undefined, filter: "all" });
    expect(parsePrSettings("[1]")).toEqual({ repo: undefined, filter: "all" });
    expect(parseRunsSettings('{"repo":"o/r","workflowId":-3}')).toEqual({ repo: "o/r", workflowId: undefined });
    expect(parseRunsSettings('{"workflowId":"101"}')).toEqual({ repo: undefined, workflowId: undefined });
  });
});

const pr = (n: number, author: string, extra: Record<string, unknown> = {}) =>
  toWidgetPr({ number: n, title: `PR ${n}`, user: { login: author, avatar_url: `https://a/${author}` }, created_at: "2026-11-01T10:00:00Z", base: { ref: "main" }, draft: false, requested_reviewers: [], assignees: [], ...extra });

describe("pull requests", () => {
  it("maps the REST list item", () => {
    expect(pr(7, "ann", { draft: true, requested_reviewers: [{ login: "bob" }], assignees: [{ login: "bob" }, { login: "cat" }] })).toEqual({
      number: 7, title: "PR 7", isDraft: true, authorLogin: "ann", avatarUrl: "https://a/ann", createdAt: new Date("2026-11-01T10:00:00Z"), baseRef: "main", assigned: ["bob", "cat"],
    });
    expect(toWidgetPr({ number: 1, user: null, created_at: "2026-11-01T10:00:00Z" }).authorLogin).toBe("ghost");
  });
  it("filters by author or by review request and assignee, ignoring case", () => {
    const list = [pr(1, "Ann"), pr(2, "bob", { requested_reviewers: [{ login: "ANN" }] }), pr(3, "bob", { assignees: [{ login: "ann" }] }), pr(4, "bob")];
    expect(filterPrs(list, "all", undefined).map((p) => p.number)).toEqual([1, 2, 3, 4]);
    expect(filterPrs(list, "mine", "ann").map((p) => p.number)).toEqual([1]);
    expect(filterPrs(list, "assigned", "ann").map((p) => p.number)).toEqual([2, 3]);
    expect(filterPrs(list, "mine", undefined)).toEqual([]);
  });
  it("asks for open pull requests, newest first", () => {
    expect(pullsPath("o/r")).toBe("/repos/o/r/pulls?state=open&sort=created&direction=desc&per_page=50");
  });
});

const run = (id: number, status: string, conclusion: string | null, startMin: number, endMin: number) =>
  toRun({ id, status, conclusion, created_at: new Date(Date.UTC(2026, 10, 3, 10, startMin)).toISOString(), run_started_at: new Date(Date.UTC(2026, 10, 3, 10, startMin)).toISOString(), updated_at: new Date(Date.UTC(2026, 10, 3, 10, endMin)).toISOString() });

describe("runBars", () => {
  it("puts the newest run on the right and scales heights to the longest run", () => {
    const now = new Date(Date.UTC(2026, 10, 3, 11, 0));
    // newest first, as GitHub lists them
    const bars = runBars([run(3, "in_progress", null, 50, 50), run(2, "completed", "failure", 20, 25), run(1, "completed", "success", 0, 10)], now);
    expect(bars.map((b) => b.run.id)).toEqual([1, 2, 3]);
    expect(bars.map((b) => b.state)).toEqual(["succeeded", "failed", "inProgress"]);
    expect(bars.map((b) => b.durationMs / 60e3)).toEqual([10, 5, 10]); // the running one counts up to now
    expect(bars.map((b) => b.height)).toEqual([1, 0.5, 1]);
  });
  it("scales to the longest finished run, so a long wait doesn't flatten the rest", () => {
    const now = new Date(Date.UTC(2026, 10, 3, 14, 0));
    const bars = runBars([run(3, "waiting", null, 0, 0), run(2, "completed", "success", 0, 4), run(1, "completed", "success", 0, 8)], now);
    expect(bars.map((b) => b.height)).toEqual([1, 0.5, 1]);
    expect(runBars([run(1, "in_progress", null, 0, 0)], now)[0].height).toBe(1); // nothing finished yet: scaled to itself
  });
  it("gives zero-length runs a sliver", () => {
    const bars = runBars([run(2, "completed", "skipped", 0, 0), run(1, "completed", "success", 0, 100)], new Date());
    expect(bars[1].height).toBe(0.08);
    expect(runBars([run(1, "completed", "skipped", 0, 0)], new Date())[0].height).toBe(0.08);
    expect(runBars([], new Date())).toEqual([]);
  });
});

describe("sizes", () => {
  it("follows the dashboard grid", () => {
    expect(widgetPixels({ columnSpan: 2, rowSpan: 2 })).toEqual({ width: 330, height: 330 });
    expect(widgetPixels({ columnSpan: 4, rowSpan: 1 })).toEqual({ width: 670, height: 160 });
    expect(barCount(2)).toBe(22);
    expect(barCount(4)).toBe(46);
    expect(barCount(1)).toBe(10);
  });
});

describe("hub links from a widget", () => {
  it("swap the widget's relative id for the hub's", async () => {
    const { hubContributionId } = await import("../hostNav");
    expect(hubContributionId("prs", "TrueNorthIT.github-repos.github-prs-widget")).toBe("TrueNorthIT.github-repos.github-repos-prs-hub");
    expect(hubContributionId("actions", "Dev.github-repos-dev.github-runs-widget")).toBe("Dev.github-repos-dev.github-repos-actions-hub");
    expect(hubContributionId("actions", "TrueNorthIT.github-repos.github-repos-prs-hub")).toBe("TrueNorthIT.github-repos.github-repos-actions-hub");
    expect(hubContributionId("files", "TrueNorthIT.github-repos.github-repos-hub")).toBe("TrueNorthIT.github-repos.github-repos-hub");
  });
});

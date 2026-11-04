import { describe, expect, it } from "vitest";
import { CLOSE_DELAY, OPEN_DELAY, hoverStep, isLogin, isShown, prLinkNumber, restPrStatus, reviewCounts, reviewSummary, toPullCard, toUserCard, toWorkItemCard, workItemCardUrl, type HoverEvent, type HoverPhase } from "./hoverCard";

const run = (events: HoverEvent[], from: HoverPhase = "idle") => events.reduce((p, e) => hoverStep(p, e).phase, from);

describe("hoverStep", () => {
  it("opens only after the open delay", () => {
    expect(hoverStep("idle", "anchorEnter")).toEqual({ phase: "opening", timer: OPEN_DELAY });
    expect(isShown("opening")).toBe(false);
    expect(hoverStep("opening", "timer")).toEqual({ phase: "open", timer: "clear" });
    expect(isShown("open")).toBe(true);
  });
  it("keyboard focus opens like a hover", () => {
    expect(run(["focus", "timer"])).toBe("open");
  });
  it("passing over an anchor without resting opens nothing", () => {
    expect(hoverStep("opening", "anchorLeave")).toEqual({ phase: "idle", timer: "clear" });
    expect(run(["anchorEnter", "anchorLeave", "timer"])).toBe("idle");
  });
  it("re-entering while the timer runs keeps it", () => {
    expect(hoverStep("opening", "anchorEnter").timer).toBe("keep");
  });
  it("leaving gives a grace period to reach the card, which keeps it open", () => {
    expect(hoverStep("open", "anchorLeave")).toEqual({ phase: "closing", timer: CLOSE_DELAY });
    expect(isShown("closing")).toBe(true);
    expect(hoverStep("closing", "cardEnter")).toEqual({ phase: "open", timer: "clear" });
    expect(run(["anchorEnter", "timer", "anchorLeave", "cardEnter", "timer"])).toBe("open");
  });
  it("closes once the grace period runs out, or when the pointer leaves the card", () => {
    expect(run(["anchorEnter", "timer", "anchorLeave", "timer"])).toBe("idle");
    expect(run(["anchorEnter", "timer", "anchorLeave", "cardEnter", "cardLeave", "timer"])).toBe("idle");
    expect(run(["focus", "timer", "blur", "timer"])).toBe("idle");
  });
  it("Escape and dismiss close at once from any phase", () => {
    for (const p of ["idle", "opening", "open", "closing"] as HoverPhase[]) {
      expect(hoverStep(p, "escape")).toEqual({ phase: "idle", timer: "clear" });
      expect(hoverStep(p, "dismiss").phase).toBe("idle");
    }
  });
  it("ignores stray events while idle", () => {
    for (const e of ["anchorLeave", "cardEnter", "cardLeave", "blur", "timer"] as HoverEvent[]) expect(hoverStep("idle", e)).toEqual({ phase: "idle", timer: "keep" });
  });
});

describe("toUserCard", () => {
  it("maps the profile and trims blanks to undefined", () => {
    expect(toUserCard("ann", { login: "Ann", name: "Ann Author", avatar_url: "a.png", bio: " Builds things ", company: "", location: null, html_url: "https://github.com/Ann", type: "User" }))
      .toEqual({ login: "Ann", name: "Ann Author", avatarUrl: "a.png", bio: "Builds things", company: undefined, location: undefined, htmlUrl: "https://github.com/Ann", type: "User" });
  });
  it("falls back to the asked login and its profile URL", () => {
    expect(toUserCard("bob-dev", null)).toMatchObject({ login: "bob-dev", htmlUrl: "https://github.com/bob-dev" });
  });
});

describe("isLogin", () => {
  it("accepts GitHub logins and bots, refuses the rest", () => {
    for (const ok of ["ann", "bob-dev", "A1", "github-actions[bot]"]) expect(isLogin(ok)).toBe(true);
    for (const bad of ["", null, undefined, "ghost", "-x", "a/b", "../x", "Carol Commit", "x".repeat(40)]) expect(isLogin(bad)).toBe(false);
  });
});

describe("pull request cards", () => {
  it("maps state to ADO's words", () => {
    expect(restPrStatus({ state: "open", draft: false })).toBe("active");
    expect(restPrStatus({ state: "open", draft: true })).toBe("draft");
    expect(restPrStatus({ state: "closed", merged: true })).toBe("completed");
    expect(restPrStatus({ state: "closed", merged_at: "2026-01-01T00:00:00Z" })).toBe("completed");
    expect(restPrStatus({ state: "closed", merged: false, merged_at: null })).toBe("abandoned");
  });
  it("counts each reviewer's latest deciding review", () => {
    const r = (login: string, state: string) => ({ user: { login }, state });
    expect(reviewCounts([r("a", "APPROVED"), r("a", "COMMENTED"), r("b", "CHANGES_REQUESTED"), r("b", "APPROVED"), r("c", "COMMENTED"), r("d", "CHANGES_REQUESTED"), r("d", "DISMISSED"), null], 2))
      .toEqual({ approved: 2, changes: 0, commented: 1, waiting: 2 });
  });
  it("summarises the non-zero counts", () => {
    expect(reviewSummary({ approved: 2, changes: 1, commented: 0, waiting: 1 })).toBe("2 approved · 1 requested changes · 1 waiting");
    expect(reviewSummary({ approved: 0, changes: 0, commented: 0, waiting: 0 })).toBeUndefined();
  });
  it("maps the REST pull request", () => {
    const pull = {
      number: 3, title: "Greeting", state: "open", draft: false, html_url: "https://github.com/o/r/pull/3",
      user: { login: "ann", avatar_url: "a.png" }, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
      head: { ref: "feature/greeting", label: "o:feature/greeting", repo: { full_name: "o/r" } }, base: { ref: "main", repo: { full_name: "o/r" } },
      requested_reviewers: [{ login: "bob" }], requested_teams: [{ slug: "devs" }],
    };
    expect(toPullCard(pull, [{ user: { login: "carol" }, state: "APPROVED" }])).toEqual({
      number: 3, title: "Greeting", status: "active", author: { login: "ann", avatarUrl: "a.png" }, source: "feature/greeting", target: "main",
      created: "2026-01-01T00:00:00Z", updated: "2026-01-02T00:00:00Z", htmlUrl: "https://github.com/o/r/pull/3",
      reviews: { approved: 1, changes: 0, commented: 0, waiting: 2 },
    });
  });
  it("names a fork's branch with its owner, and survives a deleted author", () => {
    const c = toPullCard({ number: 9, state: "closed", user: null, head: { ref: "fix", label: "someone:fix", repo: { full_name: "someone/r" } }, base: { ref: "main", repo: { full_name: "o/r" } } }, null);
    expect(c).toMatchObject({ title: "#9", status: "abandoned", author: undefined, source: "someone:fix", target: "main", reviews: { approved: 0, changes: 0, commented: 0, waiting: 0 } });
  });
});

describe("prLinkNumber", () => {
  it("finds links to a pull request in the page's repo only", () => {
    expect(prLinkNumber("https://github.com/O/R/pull/12", "o/r")).toBe(12);
    expect(prLinkNumber("https://github.com/o/r/pull/12/files#diff-1", "o/r")).toBe(12);
    expect(prLinkNumber("https://github.com/o/r/pull/12#issuecomment-1", "o/r")).toBe(12);
    expect(prLinkNumber("https://github.com/o/other/pull/12", "o/r")).toBeNull();
    expect(prLinkNumber("https://github.com/o/r/issues/12", "o/r")).toBeNull();
    expect(prLinkNumber("https://github.com/o/r/pull/12x", "o/r")).toBeNull();
    expect(prLinkNumber("#repo=o%2Fr&pr=12", "o/r")).toBeNull();
  });
});

describe("work item cards", () => {
  it("asks for the card's fields", () => {
    expect(workItemCardUrl("my org", 42)).toBe("https://dev.azure.com/my%20org/_apis/wit/workitems?ids=42&fields=System.Title,System.WorkItemType,System.State,System.AssignedTo,System.AreaPath,System.IterationPath&errorPolicy=omit&api-version=7.1");
  });
  it("maps the item, with AssignedTo as an identity ref", () => {
    const body = { value: [{ id: 42, fields: { "System.Title": "Fix it", "System.WorkItemType": "Bug", "System.State": "Active", "System.AssignedTo": { displayName: "Ann Author", _links: { avatar: { href: "https://x/a.png" } } }, "System.AreaPath": "Proj\\Area", "System.IterationPath": "Proj\\Sprint 1" } }] };
    expect(toWorkItemCard(42, body)).toEqual({ id: 42, title: "Fix it", type: "Bug", state: "Active", assignedTo: { name: "Ann Author", imageUrl: "https://x/a.png" }, area: "Proj\\Area", iteration: "Proj\\Sprint 1" });
  });
  it("reads an older string AssignedTo, and an unassigned item", () => {
    expect(toWorkItemCard(1, { value: [{ id: 1, fields: { "System.AssignedTo": "Ann Author <ann@example.com>" } }] })?.assignedTo).toEqual({ name: "Ann Author" });
    expect(toWorkItemCard(1, { value: [{ id: 1, fields: {} }] })?.assignedTo).toBeUndefined();
  });
  it("is null when ADO left the item out", () => {
    expect(toWorkItemCard(7, { value: [null] })).toBeNull();
    expect(toWorkItemCard(7, null)).toBeNull();
  });
});

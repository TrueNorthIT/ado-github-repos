import { describe, it, expect } from "vitest";
import { countRequest, countFromFirstPage, severityCounts } from "./securityCounts";
import type { AlertRow, Severity } from "./securityModel";
import { REPO, API, query, pathname, DEPENDABOT_NEXT_LINK, CODE_FIRST_LINK } from "./securityTestHelpers";

// Module under test: src/lib/securityCounts.ts (stubs until the developer implements them). Requirement AS-4: "Counts for the tab headers (open alerts per kind) and severity summaries, from a first page plus the `Link` "last" page
// if available. If not, show "100+". Pin that rule." The rule as pinned, and the live facts behind it, are in the header of securityCounts.ts.

describe("AS-4: the request that gives the open count", () => {
  it("code scanning: open alerts, one per page, so the last page number is the count", () => {
    const r = countRequest("code", REPO);
    expect(r.method, "Expected a GET").toBe("GET");
    expect(pathname(r), "Expected the code scanning list").toBe(`/repos/${REPO}/code-scanning/alerts`);
    expect(query(r), "Expected state=open and per_page=1").toEqual({ state: "open", per_page: "1" });
  });

  it("code scanning: scopes to a branch with a full ref", () => {
    expect(query(countRequest("code", REPO, { branch: "main" })), "Expected ref=refs/heads/main as well").toEqual({ state: "open", per_page: "1", ref: "refs/heads/main" });
  });

  it("secret scanning: open alerts, one per page, with the secret hidden", () => {
    const r = countRequest("secret", REPO);
    expect(pathname(r), "Expected the secret scanning list").toBe(`/repos/${REPO}/secret-scanning/alerts`);
    expect(query(r), "Expected state=open, per_page=1 and hide_secret=true").toEqual({ state: "open", per_page: "1", hide_secret: "true" });
  });

  it("Dependabot: open alerts, a full page of 100 (it never has a last page to count from)", () => {
    const r = countRequest("dependabot", REPO);
    expect(pathname(r), "Expected the Dependabot list").toBe(`/repos/${REPO}/dependabot/alerts`);
    expect(query(r), "Expected state=open and per_page=100").toEqual({ state: "open", per_page: "100" });
  });

  it("a branch changes nothing for Dependabot and secret scanning, which are not branch-scoped", () => {
    expect(query(countRequest("dependabot", REPO, { branch: "main" })), "Expected the same Dependabot request").toEqual(query(countRequest("dependabot", REPO)));
    expect(query(countRequest("secret", REPO, { branch: "main" })), "Expected the same secret request").toEqual(query(countRequest("secret", REPO)));
  });
});

describe("AS-4: the count from the first page", () => {
  it("no next page: the first page is the whole list, so the count is exact", () => {
    expect(countFromFirstPage(37, null), "Expected 37 exactly").toEqual({ count: 37, capped: false, label: "37" });
    expect(countFromFirstPage(0, undefined), "Expected 0 exactly (an empty list sends no Link)").toEqual({ count: 0, capped: false, label: "0" });
    expect(countFromFirstPage(1, ""), "Expected 1 exactly").toEqual({ count: 1, capped: false, label: "1" });
  });

  it("exactly one full page of 100 and no next page is 100, not '100+'", () => {
    expect(countFromFirstPage(100, `<${API}/repositories/1/dependabot/alerts?per_page=100&after=abc>; rel="prev"`), "Expected exactly 100").toEqual({ count: 100, capped: false, label: "100" });
  });

  it("code scanning and secrets, one per page: the last page number is the count (live: 5 alerts gave page=5)", () => {
    expect(countFromFirstPage(1, CODE_FIRST_LINK), "Expected exactly 5").toEqual({ count: 5, capped: false, label: "5" });
  });

  it("Dependabot, a full page and a next cursor but no last page: capped, shown as '100+'", () => {
    const link = `<${API}/repositories/1/dependabot/alerts?per_page=100&after=Y3Vyc29yOnYy%3D>; rel="next"`;
    expect(countFromFirstPage(100, link), "Expected the lower bound 100 shown as 100+").toEqual({ count: 100, capped: true, label: "100+" });
  });

  it("a next cursor without a last page is capped at the first page's size, whatever it is", () => {
    expect(countFromFirstPage(30, DEPENDABOT_NEXT_LINK), "Expected 30+ for a page of 30").toEqual({ count: 30, capped: true, label: "30+" });
  });

  it("a garbage Link header is treated as no next page and never throws", () => {
    expect(() => countFromFirstPage(4, "garbage"), "Expected garbage not to throw").not.toThrow();
    expect(countFromFirstPage(4, "garbage"), "Expected 4 exactly").toEqual({ count: 4, capped: false, label: "4" });
  });
});

describe("AS-4: severity summary", () => {
  const row = (severity: Severity, number: number): AlertRow => ({ kind: "code", number, severity, title: "t", location: "", firstDetected: new Date(0), state: "Open", url: "u" });

  it("counts the rows of each severity, with every severity present", () => {
    const rows = [row("Critical", 1), row("High", 2), row("High", 3), row("Low", 4), row("None", 5), row("High", 6), row("Note", 7)];
    expect(severityCounts(rows), "Expected 1 Critical, 3 High, 0 Medium, 1 Low, 1 Note and 1 None").toEqual({ Critical: 1, High: 3, Medium: 0, Low: 1, Note: 1, None: 1 });
  });

  it("no rows gives six zeros", () => {
    expect(severityCounts([]), "Expected zero for every severity").toEqual({ Critical: 0, High: 0, Medium: 0, Low: 0, Note: 0, None: 0 });
  });
});

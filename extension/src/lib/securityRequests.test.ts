import { describe, it, expect } from "vitest";
import {
  dependabotAlertsRequest,
  codeScanningAlertsRequest,
  secretScanningAlertsRequest,
  parsePaging,
  alertRequest,
  codeScanningInstancesRequest,
  secretLocationsRequest,
  dismissReasons,
  dismissRequest,
  reopenRequest,
} from "./securityRequests";
import type { AlertKind } from "./securityTypes";
import { NASTY } from "./ciTestHelpers";
import { REPO, query, pathname, list, expectGet, DEPENDABOT_NEXT_LINK, DEPENDABOT_NEXT_CURSOR, CODE_FIRST_LINK, CODE_MIDDLE_LINK } from "./securityTestHelpers";

// Module under test: src/lib/securityRequests.ts (stubs until the developer implements them). Requirement AS-1: "Request builders for the three lists, with filters mapped to query params, plus paging (Link-header cursor
// parsing for Dependabot `after`; page numbers for the other two). Builders for one alert, instances and locations, dismiss and reopen, each validating its reason enum."
// The facts (live captures, the OpenAPI description) and the decisions these tests fix are in the header of securityRequests.ts. The builders throw for bad input, so those tests match the message (a bare toThrow() would be satisfied by "Not implemented").

const DEP = `/repos/${REPO}/dependabot/alerts`;
const CODE = `/repos/${REPO}/code-scanning/alerts`;
const SECRET = `/repos/${REPO}/secret-scanning/alerts`;

describe("AS-1: the list requests", () => {
  // Given no filters, each builder GETs its endpoint with only the page size (30 by default); secrets always hide the literal.
  it("Dependabot: GET .../dependabot/alerts with just per_page=30", () => {
    expectGet(dependabotAlertsRequest(REPO, {}), DEP, { per_page: "30" }, "the Dependabot list");
  });

  it("code scanning: GET .../code-scanning/alerts with just per_page=30", () => {
    expectGet(codeScanningAlertsRequest(REPO, {}), CODE, { per_page: "30" }, "the code scanning list");
  });

  it("secret scanning: GET .../secret-scanning/alerts with per_page=30 and hide_secret=true so the secret literal is never fetched", () => {
    expectGet(secretScanningAlertsRequest(REPO, {}), SECRET, { per_page: "30", hide_secret: "true" }, "the secret scanning list");
  });

  it("per_page is the given size, clamped to 1..100", () => {
    for (const build of [dependabotAlertsRequest, codeScanningAlertsRequest, secretScanningAlertsRequest]) {
      expect(query(build(REPO, {}, { perPage: 100 })).per_page, "Expected 100 to be kept").toBe("100");
      expect(query(build(REPO, {}, { perPage: 500 })).per_page, "Expected 500 to be cut to 100").toBe("100");
      expect(query(build(REPO, {}, { perPage: 0 })).per_page, "Expected 0 to be raised to 1").toBe("1");
    }
  });

  it("the sort and direction filters are sent to all three lists", () => {
    for (const build of [dependabotAlertsRequest, codeScanningAlertsRequest, secretScanningAlertsRequest]) {
      const q = query(build(REPO, { sort: "updated", direction: "asc" }));
      expect(q.sort, "Expected sort=updated").toBe("updated");
      expect(q.direction, "Expected direction=asc").toBe("asc");
    }
  });

  it("a repository that is not owner/name, or tries to climb out of /repos, is refused", () => {
    for (const bad of ["", "acme", "../web", "acme/..", "acme/web/extra", "ac me/web"]) {
      expect(() => dependabotAlertsRequest(bad, {}), `Expected ${JSON.stringify(bad)} to be refused with a message naming the repository`).toThrow(/repo/i);
    }
  });
});

describe("AS-1: Dependabot filters", () => {
  const q = (f: Parameters<typeof dependabotAlertsRequest>[1]) => query(dependabotAlertsRequest(REPO, f));

  it("maps the state filter: Open, Dismissed (including auto-dismissed), Fixed and Closed (all three)", () => {
    expect(list(q({ state: "open" }).state), "Expected Open to send state=open").toEqual(["open"]);
    expect(list(q({ state: "dismissed" }).state), "Expected Dismissed to send dismissed and auto_dismissed").toEqual(["auto_dismissed", "dismissed"]);
    expect(list(q({ state: "fixed" }).state), "Expected Fixed to send state=fixed").toEqual(["fixed"]);
    expect(list(q({ state: "closed" }).state), "Expected Closed to send every non-open state").toEqual(["auto_dismissed", "dismissed", "fixed"]);
  });

  it("sends no state when none is chosen (GitHub then returns every state)", () => {
    expect(q({}).state, "Expected no state parameter when the filter is unset").toBeUndefined();
  });

  it("sends severity lower-case, and ecosystem, package and scope as given", () => {
    const r = q({ severity: "Critical", ecosystem: "npm", package: "widget-parser", scope: "runtime" });
    expect(r.severity, "Expected severity=critical").toBe("critical");
    expect(r.ecosystem, "Expected ecosystem=npm").toBe("npm");
    expect(r.package, "Expected package=widget-parser").toBe("widget-parser");
    expect(r.scope, "Expected scope=runtime").toBe("runtime");
  });

  it("carries the cursor in `after`, decoded back to what the Link header held", () => {
    expect(query(dependabotAlertsRequest(REPO, {}, { after: DEPENDABOT_NEXT_CURSOR })).after, "Expected the cursor, with its '=' intact, as the after parameter").toBe(DEPENDABOT_NEXT_CURSOR);
  });

  it("keeps awkward package names intact through the query string", () => {
    for (const v of NASTY) expect(q({ package: v }).package, `Expected ${JSON.stringify(v)} to survive encoding`).toBe(v);
  });
});

describe("AS-1: code scanning filters", () => {
  const q = (f: Parameters<typeof codeScanningAlertsRequest>[1], paging = {}) => query(codeScanningAlertsRequest(REPO, f, paging));

  it("sends the state filter as given: open, closed, dismissed, fixed", () => {
    for (const s of ["open", "closed", "dismissed", "fixed"] as const) expect(q({ state: s }).state, `Expected state=${s}`).toBe(s);
  });

  it("turns a branch into a full ref, and leaves a ref alone", () => {
    expect(q({ branch: "main" }).ref, "Expected main to be sent as refs/heads/main").toBe("refs/heads/main");
    expect(q({ branch: "feature/x y" }).ref, "Expected a slash and a space to survive").toBe("refs/heads/feature/x y");
    expect(q({ branch: "refs/heads/dev" }).ref, "Expected a full ref to be unchanged").toBe("refs/heads/dev");
    expect(q({ branch: "refs/pull/5/merge" }).ref, "Expected a pull request ref to be unchanged").toBe("refs/pull/5/merge");
  });

  it("sends the tool as tool_name and the severity lower-case (Note included)", () => {
    expect(q({ tool: "CodeQL" }).tool_name, "Expected tool_name=CodeQL").toBe("CodeQL");
    expect(q({ severity: "High" }).severity, "Expected severity=high").toBe("high");
    expect(q({ severity: "Note" }).severity, "Expected severity=note").toBe("note");
  });

  it("pages by number", () => {
    expect(q({}, { page: 3 }).page, "Expected page=3").toBe("3");
  });

  it("keeps awkward tool and branch names intact through the query string", () => {
    for (const v of NASTY) {
      expect(q({ tool: v }).tool_name, `Expected tool ${JSON.stringify(v)} to survive`).toBe(v);
      expect(q({ branch: v }).ref, `Expected branch ${JSON.stringify(v)} to survive`).toBe(`refs/heads/${v}`);
    }
  });
});

describe("AS-1: secret scanning filters", () => {
  const q = (f: Parameters<typeof secretScanningAlertsRequest>[1], paging = {}) => query(secretScanningAlertsRequest(REPO, f, paging));

  it("maps the state filter onto open or resolved, and the resolution that tells Dismissed from Fixed", () => {
    expect(q({ state: "open" }).state, "Expected Open to send state=open").toBe("open");
    const closed = q({ state: "closed" });
    expect(closed.state, "Expected Closed to send state=resolved").toBe("resolved");
    expect(closed.resolution, "Expected Closed to send no resolution").toBeUndefined();
    const dismissed = q({ state: "dismissed" });
    expect(dismissed.state, "Expected Dismissed to send state=resolved").toBe("resolved");
    expect(list(dismissed.resolution), "Expected Dismissed to be the three non-revoked resolutions").toEqual(["false_positive", "used_in_tests", "wont_fix"]);
    const fixed = q({ state: "fixed" });
    expect(fixed.state, "Expected Fixed to send state=resolved").toBe("resolved");
    expect(list(fixed.resolution), "Expected Fixed to be the revoked resolution").toEqual(["revoked"]);
  });

  it("sends the rule as secret_type and the validity as given", () => {
    expect(q({ rule: "github_personal_access_token" }).secret_type, "Expected secret_type").toBe("github_personal_access_token");
    expect(q({ validity: "active" }).validity, "Expected validity=active").toBe("active");
  });

  it("pages by number", () => {
    expect(q({}, { page: 2 }).page, "Expected page=2").toBe("2");
  });
});

describe("AS-1: Link header paging", () => {
  // Real shapes: Dependabot sends a cursor in rel="next" and never a rel="last"; code scanning and secret scanning send page numbers and a rel="last".
  it("Dependabot: reads the next cursor, URL-decoded, and has no page numbers", () => {
    expect(parsePaging(DEPENDABOT_NEXT_LINK), "Expected the cursor from rel=next and nulls for the page numbers").toEqual({ nextAfter: DEPENDABOT_NEXT_CURSOR, nextPage: null, lastPage: null });
  });

  it("code scanning, first page: reads next and last page numbers", () => {
    expect(parsePaging(CODE_FIRST_LINK), "Expected next 2 and last 5").toEqual({ nextAfter: null, nextPage: 2, lastPage: 5 });
  });

  it("code scanning, a middle page with prev and first as well: reads next and last", () => {
    expect(parsePaging(CODE_MIDDLE_LINK), "Expected next 4 and last 5").toEqual({ nextAfter: null, nextPage: 4, lastPage: 5 });
  });

  it("the last page has no next", () => {
    const link = `<https://api.github.com/repositories/1/code-scanning/alerts?per_page=1&page=4>; rel="prev", <https://api.github.com/repositories/1/code-scanning/alerts?per_page=1&page=1>; rel="first"`;
    expect(parsePaging(link), "Expected no next and no last on the final page").toEqual({ nextAfter: null, nextPage: null, lastPage: null });
  });

  it("no header, an empty one or garbage gives all nulls and never throws", () => {
    for (const bad of [null, undefined, "", "garbage", "<>; rel=", `<not a url>; rel="next"`]) {
      expect(() => parsePaging(bad), `Expected ${JSON.stringify(bad)} not to throw`).not.toThrow();
      expect(parsePaging(bad), `Expected ${JSON.stringify(bad)} to give all nulls`).toEqual({ nextAfter: null, nextPage: null, lastPage: null });
    }
  });
});

describe("AS-1: one alert, its instances and its locations", () => {
  it("GETs the alert from the endpoint of its kind", () => {
    const paths: [AlertKind, string][] = [
      ["dependabot", `${DEP}/7`],
      ["code", `${CODE}/7`],
      ["secret", `${SECRET}/7`],
    ];
    for (const [kind, path] of paths) expectGet(alertRequest(kind, REPO, 7), path, {}, `the ${kind} alert`);
  });

  it("GETs a code scanning alert's instances, for one ref when given", () => {
    expectGet(codeScanningInstancesRequest(REPO, 5), `${CODE}/5/instances`, {}, "the instances");
    expect(query(codeScanningInstancesRequest(REPO, 5, { ref: "refs/heads/main", page: 2, perPage: 50 })), "Expected ref, page and per_page").toEqual({ ref: "refs/heads/main", page: "2", per_page: "50" });
  });

  it("GETs a secret scanning alert's locations", () => {
    expectGet(secretLocationsRequest(REPO, 3), `${SECRET}/3/locations`, {}, "the locations");
    expect(query(secretLocationsRequest(REPO, 3, { page: 2, perPage: 10 })), "Expected page and per_page").toEqual({ page: "2", per_page: "10" });
  });

  it("refuses an alert number that is not a positive integer", () => {
    for (const bad of [0, -1, 1.5, NaN]) {
      expect(() => alertRequest("code", REPO, bad), `Expected ${bad} to be refused with a message naming the alert number`).toThrow(/number/i);
      expect(() => codeScanningInstancesRequest(REPO, bad), `Expected ${bad} to be refused for instances`).toThrow(/number/i);
      expect(() => secretLocationsRequest(REPO, bad), `Expected ${bad} to be refused for locations`).toThrow(/number/i);
    }
  });
});

describe("AS-1: the dismiss reasons offered", () => {
  const values = (k: AlertKind) => dismissReasons(k).map((r) => r.value);

  it("Dependabot: fix_started, inaccurate, no_bandwidth, not_used, tolerable_risk", () => {
    expect(values("dependabot"), "Expected the five Dependabot reasons").toEqual(["fix_started", "inaccurate", "no_bandwidth", "not_used", "tolerable_risk"]);
  });

  it("code scanning: false positive, won't fix, used in tests, and mitigated (the spec's fourth)", () => {
    expect(values("code").sort(), "Expected the four code scanning reasons").toEqual(["false positive", "mitigated", "used in tests", "won't fix"]);
  });

  it("secrets: false_positive, wont_fix, revoked, used_in_tests", () => {
    expect(values("secret").sort(), "Expected the four secret scanning resolutions").toEqual(["false_positive", "revoked", "used_in_tests", "wont_fix"]);
  });

  it("every reason has a label to show", () => {
    for (const k of ["dependabot", "code", "secret"] as const) for (const r of dismissReasons(k)) expect(r.label.trim(), `Expected a label for ${k} reason ${r.value}`).not.toBe("");
  });
});

describe("AS-1: dismiss", () => {
  it("Dependabot: PATCH .../dependabot/alerts/{n} with state, dismissed_reason and dismissed_comment", () => {
    const r = dismissRequest("dependabot", REPO, 7, "tolerable_risk", "Dev dependency only");
    expect(r.method, "Expected a PATCH").toBe("PATCH");
    expect(pathname(r), "Expected the Dependabot alert's path").toBe(`${DEP}/7`);
    expect(r.body, "Expected the documented body").toEqual({ state: "dismissed", dismissed_reason: "tolerable_risk", dismissed_comment: "Dev dependency only" });
  });

  it("code scanning: PATCH .../code-scanning/alerts/{n}; the reason keeps its spaces and apostrophe", () => {
    const r = dismissRequest("code", REPO, 5, "won't fix", "Accepted");
    expect(r.method, "Expected a PATCH").toBe("PATCH");
    expect(pathname(r), "Expected the code scanning alert's path").toBe(`${CODE}/5`);
    expect(r.body, "Expected the documented body").toEqual({ state: "dismissed", dismissed_reason: "won't fix", dismissed_comment: "Accepted" });
    expect(dismissRequest("code", REPO, 5, "false positive").body?.dismissed_reason, "Expected 'false positive' as given").toBe("false positive");
  });

  it("secret scanning: PATCH with state=resolved, resolution and resolution_comment", () => {
    const r = dismissRequest("secret", REPO, 3, "revoked", "Rotated");
    expect(r.method, "Expected a PATCH").toBe("PATCH");
    expect(pathname(r), "Expected the secret alert's path").toBe(`${SECRET}/3`);
    expect(r.body, "Expected the documented body").toEqual({ state: "resolved", resolution: "revoked", resolution_comment: "Rotated" });
  });

  it("leaves the comment key out when there is none or it is blank", () => {
    expect(dismissRequest("dependabot", REPO, 7, "inaccurate").body, "Expected no dismissed_comment key").toEqual({ state: "dismissed", dismissed_reason: "inaccurate" });
    expect(dismissRequest("code", REPO, 5, "used in tests", "   ").body, "Expected a blank comment to be left out").toEqual({ state: "dismissed", dismissed_reason: "used in tests" });
    expect(dismissRequest("secret", REPO, 3, "wont_fix", "").body, "Expected an empty comment to be left out").toEqual({ state: "resolved", resolution: "wont_fix" });
  });

  it("accepts a 280-character comment and refuses 281 (the spec's maxLength) for Dependabot and code scanning", () => {
    expect(dismissRequest("dependabot", REPO, 7, "inaccurate", "x".repeat(280)).body?.dismissed_comment, "Expected 280 characters to be kept").toBe("x".repeat(280));
    expect(() => dismissRequest("dependabot", REPO, 7, "inaccurate", "x".repeat(281)), "Expected 281 characters to be refused with a message about the comment").toThrow(/comment/i);
    expect(() => dismissRequest("code", REPO, 5, "mitigated", "x".repeat(281)), "Expected 281 characters to be refused for code scanning").toThrow(/comment/i);
  });

  it("refuses a reason that is not in the kind's enum, naming the allowed values", () => {
    expect(() => dismissRequest("dependabot", REPO, 7, "false positive"), "Expected a code scanning reason to be refused for Dependabot").toThrow(/tolerable_risk/);
    expect(() => dismissRequest("code", REPO, 5, "tolerable_risk"), "Expected a Dependabot reason to be refused for code scanning").toThrow(/false positive/);
    expect(() => dismissRequest("code", REPO, 5, "wont_fix"), "Expected the secret spelling wont_fix to be refused for code scanning").toThrow(/won't fix/);
    expect(() => dismissRequest("secret", REPO, 3, "false positive"), "Expected the code scanning spelling to be refused for secrets").toThrow(/false_positive/);
    expect(() => dismissRequest("secret", REPO, 3, ""), "Expected an empty reason to be refused").toThrow(/reason|resolution/i);
  });

  it("refuses a mangled repository or alert number before building a PATCH", () => {
    expect(() => dismissRequest("dependabot", "../web", 7, "inaccurate"), "Expected a bad repository to be refused").toThrow(/repo/i);
    expect(() => dismissRequest("dependabot", REPO, 0, "inaccurate"), "Expected alert 0 to be refused").toThrow(/number/i);
  });
});

describe("AS-1: reopen", () => {
  it("PATCHes the alert of its kind with { state: 'open' } and nothing else", () => {
    const paths: [AlertKind, string][] = [
      ["dependabot", `${DEP}/7`],
      ["code", `${CODE}/7`],
      ["secret", `${SECRET}/7`],
    ];
    for (const [kind, path] of paths) {
      const r = reopenRequest(kind, REPO, 7);
      expect(r.method, `Expected reopening a ${kind} alert to be a PATCH`).toBe("PATCH");
      expect(pathname(r), `Expected the ${kind} alert's path`).toBe(path);
      expect(r.body, `Expected the body { state: "open" } for ${kind}`).toEqual({ state: "open" });
    }
  });

  it("refuses a mangled repository or alert number", () => {
    expect(() => reopenRequest("code", "nope", 7), "Expected a bad repository to be refused").toThrow(/repo/i);
    expect(() => reopenRequest("code", REPO, -3), "Expected a negative alert number to be refused").toThrow(/number/i);
  });
});

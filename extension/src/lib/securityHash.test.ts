import { describe, it, expect } from "vitest";
import { parseSecurity, serializeSecurity, applySecurity, securityPageHash, alertDetailHash, tabForKind, kindForTab, type SecTab } from "./securityHash";
import { parse, serialize } from "./browseState";
import { applyNewPr, parseNewPr } from "./newPrHash";
import { applyListFilters, parseListFilters } from "./prListFilters";
import { NASTY } from "./ciTestHelpers";

// Module under test: src/lib/securityHash.ts (stubs until the developer implements them). Requirement AS-5: "Hash state: `view=security`, `secTab=dependencies|code|secrets`, `alert=N`, and filters. A new module sits alongside
// `browseState` and round-trips through it, like `src/lib/prListFilters.ts` and `newPrHash.ts`, which you can copy." Decisions (browseState drops view=security, so the app reads parseSecurity first; key names) are in the header of securityHash.ts.

const REPO = "octo/demo";
const ENC = "repo=octo%2Fdemo";

describe("AS-5: serializeSecurity", () => {
  it("writes repo, view=security and the tab, alert and filters in that order, encoded", () => {
    const hash = serializeSecurity({ repo: REPO, tab: "code", alert: 12, state: "dismissed", severity: "High", branch: "release/1.0", tool: "CodeQL", rule: "js/sql-injection", text: "sql inject" });
    expect(hash, "Expected every key, in order, encoded").toBe(
      `#${ENC}&view=security&secTab=code&alert=12&secState=dismissed&secSeverity=high&secBranch=release%2F1.0&secTool=CodeQL&secRule=js%2Fsql-injection&secText=sql%20inject`
    );
  });

  it("leaves out anything absent or blank", () => {
    expect(serializeSecurity({ repo: REPO }), "Expected only repo and view").toBe(`#${ENC}&view=security`);
    expect(serializeSecurity({ repo: REPO, tab: "secrets", branch: "  ", tool: "", text: " " }), "Expected blank filters to be left out").toBe(`#${ENC}&view=security&secTab=secrets`);
  });

  it("writes the alert number only with a tab", () => {
    expect(serializeSecurity({ repo: REPO, alert: 5 }), "Expected the alert to be left out without a tab").toBe(`#${ENC}&view=security`);
  });

  it("writes the severity lower-case", () => {
    for (const s of ["Critical", "High", "Medium", "Low", "Note"] as const) expect(serializeSecurity({ repo: REPO, severity: s }), `Expected ${s} lower-case`).toBe(`#${ENC}&view=security&secSeverity=${s.toLowerCase()}`);
  });

  it("caps branch, tool and rule at 255 characters and text at 200", () => {
    const back = parseSecurity(serializeSecurity({ repo: REPO, branch: "b".repeat(400), tool: "t".repeat(400), rule: "r".repeat(400), text: "x".repeat(400) }));
    expect(back, "Expected the values cut to their caps").toEqual({ repo: REPO, branch: "b".repeat(255), tool: "t".repeat(255), rule: "r".repeat(255), text: "x".repeat(200) });
  });
});

describe("AS-5: parseSecurity", () => {
  it("reads every key", () => {
    const hash = `#${ENC}&view=security&secTab=dependencies&alert=7&secState=open&secSeverity=critical&secBranch=main&secTool=CodeQL&secRule=GHSA-aaaa&secText=parser`;
    expect(parseSecurity(hash), "Expected the whole state").toEqual({ repo: REPO, tab: "dependencies", alert: 7, state: "open", severity: "Critical", branch: "main", tool: "CodeQL", rule: "GHSA-aaaa", text: "parser" });
  });

  it("reads the three tabs: dependencies, code and secrets", () => {
    for (const tab of ["dependencies", "code", "secrets"] as SecTab[]) expect(parseSecurity(`#${ENC}&view=security&secTab=${tab}`)?.tab, `Expected tab ${tab}`).toBe(tab);
  });

  it("accepts a hash without '#' or with several (ADO's breadcrumb prefixes its own)", () => {
    expect(parseSecurity(`${ENC}&view=security`), "Expected no leading # to be fine").toEqual({ repo: REPO });
    expect(parseSecurity(`##${ENC}&view=security`), "Expected '##' to be fine").toEqual({ repo: REPO });
  });

  it("is null unless the view is security", () => {
    expect(parseSecurity(`#${ENC}&secTab=code`), "Expected null without a view").toBeNull();
    expect(parseSecurity(`#${ENC}&view=prs&secTab=code`), "Expected null for another view").toBeNull();
    expect(parseSecurity(`#${ENC}&view=newpr`), "Expected null for the New pull request view").toBeNull();
    expect(parseSecurity(""), "Expected null for an empty hash").toBeNull();
  });

  it("is null without a valid repository", () => {
    expect(parseSecurity("#view=security&secTab=code"), "Expected null without a repo").toBeNull();
    expect(parseSecurity("#repo=../x&view=security"), "Expected null for an invalid repo").toBeNull();
    expect(parseSecurity("#repo=nonsense&view=security"), "Expected null for a repo without an owner").toBeNull();
  });

  it("drops an unknown tab, state or severity (and 'none', which is not a filter)", () => {
    expect(parseSecurity(`#${ENC}&view=security&secTab=docs&secState=all&secSeverity=none`), "Expected all three dropped").toEqual({ repo: REPO });
  });

  it("reads the alert only with a valid tab, and only as a positive integer", () => {
    expect(parseSecurity(`#${ENC}&view=security&alert=7`), "Expected the alert dropped without a tab").toEqual({ repo: REPO });
    expect(parseSecurity(`#${ENC}&view=security&secTab=docs&alert=7`), "Expected the alert dropped with an invalid tab").toEqual({ repo: REPO });
    for (const bad of ["0", "-3", "1.5", "abc", "", "007x", "99999999999999999999"]) {
      expect(parseSecurity(`#${ENC}&view=security&secTab=code&alert=${bad}`), `Expected alert=${bad} dropped`).toEqual({ repo: REPO, tab: "code" });
    }
  });

  it("trims values and drops blank ones", () => {
    expect(parseSecurity(`#${ENC}&view=security&secBranch=%20main%20&secTool=&secText=%20`), "Expected main, trimmed, and no tool or text").toEqual({ repo: REPO, branch: "main" });
  });

  it("never throws", () => {
    for (const bad of ["#%E0%A4%A", `#${ENC}&view=security&secText=%E0%A4%A`, "#&&&", "=", "#repo=%"]) expect(() => parseSecurity(bad), `Expected ${bad} not to throw`).not.toThrow();
  });
});

describe("AS-5: round trips", () => {
  it("parseSecurity reads back what serializeSecurity wrote, awkward values included", () => {
    for (const v of NASTY) {
      const s = { repo: REPO, tab: "code" as const, alert: 3, state: "closed" as const, severity: "Note" as const, branch: v, tool: v, rule: v, text: v };
      expect(parseSecurity(serializeSecurity(s)), `Expected ${JSON.stringify(v)} to survive the hash`).toEqual(s);
    }
  });

  it("applySecurity keeps other segments in order, drops earlier view and its own keys, and puts its own last", () => {
    expect(applySecurity(`#${ENC}&view=prs&prTab=active&secTab=code&alert=1&secText=old`, { tab: "secrets", alert: 2 }), "Expected prTab kept and the old keys replaced").toBe(`#${ENC}&prTab=active&view=security&secTab=secrets&alert=2`);
    expect(applySecurity("view=prs", { tab: "code" }), "Expected a leading #").toBe("#view=security&secTab=code");
    expect(applySecurity(`#${ENC}&secTab=code&secState=open`, {}), "Expected absent keys to remove the old ones").toBe(`#${ENC}&view=security`);
  });

  it("browseState keeps the repository of a Security hash but not its view or keys", () => {
    const hash = serializeSecurity({ repo: REPO, tab: "code", alert: 4, state: "open", branch: "main", text: "sql" });
    expect(parse(hash), "Expected browseState to read the repo and ignore the Security keys (no key collision)").toEqual({ repo: REPO });
  });

  it("applySecurity puts the keys back on a hash that browseState rewrote", () => {
    const state = { tab: "code" as const, alert: 4, state: "open" as const, severity: "High" as const, branch: "main", tool: "CodeQL", rule: "js/x", text: "sql" };
    const original = serializeSecurity({ repo: REPO, ...state });
    expect(applySecurity(serialize(parse(original)), state), "Expected the original hash back").toBe(original);
  });

  it("turns a pull request list hash into a Security hash that both modules can read", () => {
    const hash = applySecurity(serialize({ repo: REPO, view: "prs", prTab: "active" }), { tab: "dependencies" });
    expect(parse(hash), "Expected browseState to read the repo").toEqual({ repo: REPO });
    expect(parseSecurity(hash), "Expected parseSecurity to read the tab").toEqual({ repo: REPO, tab: "dependencies" });
  });

  it("does not collide with the pull request filter keys or the New pull request keys", () => {
    const hash = applyListFilters(serializeSecurity({ repo: REPO, tab: "code", text: "sql", branch: "main" }), { author: "ada", text: "pr text", base: "main" });
    expect(parseSecurity(hash), "Expected the Security text and branch to be untouched by the PR filters").toEqual({ repo: REPO, tab: "code", text: "sql", branch: "main" });
    expect(parseListFilters(hash), "Expected the PR filters to be untouched by the Security keys").toEqual({ author: "ada", text: "pr text", base: "main" });
    expect(parseNewPr(applyNewPr(hash, { source: "a" })), "Expected the New pull request view to take over cleanly").toEqual({ repo: REPO, source: "a" });
  });
});

describe("AS-5: entry points and tab names", () => {
  it("the Repos menu entry opens the page on its default tab", () => {
    expect(securityPageHash(REPO), "Expected repo and view=security only").toBe(`#${ENC}&view=security`);
    expect(parseSecurity(securityPageHash(REPO)), "Expected no tab").toEqual({ repo: REPO });
  });

  it("a table row's link opens that alert on its tab", () => {
    expect(alertDetailHash(REPO, "code", 12), "Expected secTab=code and alert=12").toBe(`#${ENC}&view=security&secTab=code&alert=12`);
    expect(alertDetailHash(REPO, "dependabot", 7), "Expected the Dependabot tab to be dependencies").toBe(`#${ENC}&view=security&secTab=dependencies&alert=7`);
    expect(alertDetailHash(REPO, "secret", 3), "Expected the secret tab to be secrets").toBe(`#${ENC}&view=security&secTab=secrets&alert=3`);
  });

  it("maps alert kinds to tabs and back", () => {
    expect([tabForKind("dependabot"), tabForKind("code"), tabForKind("secret")], "Expected dependencies, code, secrets").toEqual(["dependencies", "code", "secrets"]);
    expect([kindForTab("dependencies"), kindForTab("code"), kindForTab("secrets")], "Expected dependabot, code, secret").toEqual(["dependabot", "code", "secret"]);
  });
});

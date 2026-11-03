import { describe, it, expect } from "vitest";
import { availability, type SecurityApiError } from "./securityAvailability";
import type { AlertKind } from "./securityTypes";
import { REPO } from "./securityTestHelpers";

// Module under test: src/lib/securityAvailability.ts (stubs until the developer implements them). Requirement AS-3: "Availability. Classify errors into states: feature disabled ("Dependabot alerts are disabled for this repository",
// "Advanced Security must be enabled", "no analysis found", "Secret scanning is disabled"); no permission (403 "Resource not accessible by integration" means the app lacks the permission, giving its own message naming the missing permission);
// not found; rate limit. Give `availability(kind, error)` returning one of `ok / disabled / noPermission / notFound / error`, with the call-to-action URL (`https://github.com/{o}/{r}/settings/security_analysis`). [...] the GitHub App behind the
// extension currently has Dependabot and code scanning permissions but not secret scanning, so the noPermission message must be right."
// The status and message pairs below are real bodies captured with `gh api` on 2026-11-03, except where a test says it is documented wording (the header of securityAvailability.ts lists which). The third argument, `repo`, is added to the
// requirement's signature because the call-to-action URL needs it.

const SETTINGS_URL = `https://github.com/${REPO}/settings/security_analysis`;
const KINDS: AlertKind[] = ["dependabot", "code", "secret"];
const err = (status: number, message?: string, extra: Partial<SecurityApiError> = {}): SecurityApiError => ({ status, message, ...extra });

describe("AS-3: ok", () => {
  it("no error is ok, with no message and no call to action", () => {
    for (const kind of KINDS) {
      for (const none of [null, undefined]) {
        const a = availability(kind, none, REPO);
        expect(a.state, `Expected ${kind} with no error to be ok`).toBe("ok");
        expect(a.message, "Expected no message when ok").toBe("");
        expect(a.actionUrl, "Expected no call to action when ok").toBeUndefined();
      }
    }
  });
});

describe("AS-3: disabled features, from real bodies", () => {
  const cases: [AlertKind, SecurityApiError, string][] = [
    ["dependabot", err(403, "Dependabot alerts are disabled for this repository."), "Dependabot alerts (a 403 live)"],
    ["code", err(403, "Code Security must be enabled for this repository to use code scanning."), "code scanning without Code Security (a 403 live)"],
    ["code", err(403, "Advanced Security must be enabled for this repository to use code scanning."), "code scanning, the older Advanced Security wording"],
    ["code", err(404, "no analysis found"), "code scanning with no analysis (a 404 live)"],
    ["secret", err(404, "Secret scanning is disabled on this repository."), "secret scanning (a 404 live, not a 403)"],
  ];

  it("classifies each as disabled, whatever the status", () => {
    for (const [kind, error, what] of cases) expect(availability(kind, error, REPO).state, `Expected ${what} to be disabled, not notFound or noPermission`).toBe("disabled");
  });

  it("offers the repository's security settings as the call to action, with an Enable label", () => {
    for (const [kind, error, what] of cases) {
      const a = availability(kind, error, REPO);
      expect(a.actionUrl, `Expected ${what} to link to the repository's security_analysis settings`).toBe(SETTINGS_URL);
      expect(a.actionLabel, `Expected ${what} to have an Enable call to action`).toMatch(/^enable/i);
    }
  });

  it("builds the settings link from the repository it is given", () => {
    expect(availability("dependabot", err(403, "Dependabot alerts are disabled for this repository."), "other-org/other-repo").actionUrl, "Expected the link to follow the repository").toBe("https://github.com/other-org/other-repo/settings/security_analysis");
  });

  it("explains in a sentence which feature is off", () => {
    expect(availability("dependabot", cases[0][1], REPO).message, "Expected the Dependabot message to name Dependabot alerts").toMatch(/dependabot alerts/i);
    expect(availability("code", cases[1][1], REPO).message, "Expected the code scanning message to name code scanning").toMatch(/code scanning/i);
    expect(availability("secret", cases[4][1], REPO).message, "Expected the secret message to name secret scanning").toMatch(/secret scanning/i);
  });

  it("reads the message case-insensitively", () => {
    expect(availability("secret", err(404, "SECRET SCANNING IS DISABLED ON THIS REPOSITORY."), REPO).state, "Expected the case not to matter").toBe("disabled");
  });
});

describe("AS-3: the GitHub App lacks the permission (403 'Resource not accessible by integration', GitHub's documented wording)", () => {
  const forbidden = err(403, "Resource not accessible by integration");

  it("is noPermission for every kind, with no enable link (switching a feature on would not help)", () => {
    for (const kind of KINDS) {
      const a = availability(kind, forbidden, REPO);
      expect(a.state, `Expected ${kind} to be noPermission`).toBe("noPermission");
      expect(a.actionUrl, `Expected no call to action for ${kind}`).toBeUndefined();
    }
  });

  it("secret scanning: the message says the GitHub App lacks Secret scanning alerts read permission (the permission it really is missing today)", () => {
    const m = availability("secret", forbidden, REPO).message;
    expect(m, "Expected the message to name the Secret scanning alerts permission").toContain("Secret scanning alerts");
    expect(m, "Expected the message to blame the GitHub App").toMatch(/github app/i);
    expect(m, "Expected the message to ask for read access").toMatch(/read/i);
    expect(m, "Expected no other permission named").not.toMatch(/Dependabot alerts|Code scanning alerts/);
  });

  it("Dependabot: names the Dependabot alerts permission only", () => {
    const m = availability("dependabot", forbidden, REPO).message;
    expect(m, "Expected the Dependabot alerts permission").toContain("Dependabot alerts");
    expect(m, "Expected the GitHub App to be blamed").toMatch(/github app/i);
    expect(m, "Expected no other permission named").not.toMatch(/Secret scanning alerts|Code scanning alerts/);
  });

  it("code scanning: names the Code scanning alerts permission only", () => {
    const m = availability("code", forbidden, REPO).message;
    expect(m, "Expected the Code scanning alerts permission").toContain("Code scanning alerts");
    expect(m, "Expected the GitHub App to be blamed").toMatch(/github app/i);
    expect(m, "Expected no other permission named").not.toMatch(/Secret scanning alerts|Dependabot alerts/);
  });
});

describe("AS-3: the signed-in user lacks access (real 403 bodies from a user token)", () => {
  const cases: [AlertKind, SecurityApiError][] = [
    ["dependabot", err(403, "You are not authorized to perform this operation.")],
    ["code", err(403, "You are not authorized to read code scanning alerts.")],
  ];

  it("is noPermission", () => {
    for (const [kind, e] of cases) expect(availability(kind, e, REPO).state, `Expected ${kind} "${e.message}" to be noPermission`).toBe("noPermission");
  });

  it("blames the user's access to the repository, not the GitHub App", () => {
    for (const [kind, e] of cases) {
      const m = availability(kind, e, REPO).message;
      expect(m, `Expected the ${kind} message to speak of the user's access to the repository`).toMatch(/access|permission/i);
      expect(m, `Expected the ${kind} message not to blame the GitHub App`).not.toMatch(/github app/i);
    }
  });

  it("a bare 403 with no message is also noPermission", () => {
    expect(availability("code", err(403), REPO).state, "Expected a 403 without a body to be noPermission").toBe("noPermission");
  });
});

describe("AS-3: not found", () => {
  it("a 404 'Not Found' is notFound for every kind (live: a missing repository, and secret scanning on a repository the caller cannot administer)", () => {
    for (const kind of KINDS) expect(availability(kind, err(404, "Not Found"), REPO).state, `Expected ${kind} 404 Not Found to be notFound`).toBe("notFound");
  });

  it("a 404 with no message is notFound and has a message to show", () => {
    const a = availability("code", err(404), REPO);
    expect(a.state, "Expected a bodiless 404 to be notFound").toBe("notFound");
    expect(a.message.trim(), "Expected a sentence for the empty state").not.toBe("");
  });
});

describe("AS-3: rate limit and other failures", () => {
  // The extension marks a primary rate limit by x-ratelimit-remaining: 0 (githubBrowse.ts); the message wordings are GitHub's documented ones, not captured live.
  const reset = new Date("2030-01-01T12:00:00Z");

  it("a rateLimited flag is an error that says the rate limit was reached, and passes the reset time on", () => {
    const a = availability("dependabot", err(403, "API rate limit exceeded for user ID 1.", { rateLimited: true, resetAt: reset }), REPO);
    expect(a.state, "Expected error").toBe("error");
    expect(a.message, "Expected the message to mention the rate limit").toMatch(/rate limit/i);
    expect(a.resetAt, "Expected the reset time to be passed through").toEqual(reset);
  });

  it("a rate limit is not mistaken for missing permission, even as a 403", () => {
    expect(availability("code", err(403, "API rate limit exceeded for user ID 1.", { rateLimited: true }), REPO).state, "Expected rate limit to beat noPermission").toBe("error");
  });

  it("recognises a secondary rate limit by its message, and a 429 by its status", () => {
    expect(availability("secret", err(403, "You have exceeded a secondary rate limit. Please wait a few minutes before you try again."), REPO).state, "Expected the secondary limit to be an error").toBe("error");
    expect(availability("secret", err(429, "Too Many Requests"), REPO).message, "Expected a 429 to mention the rate limit").toMatch(/rate limit/i);
  });

  it("a server error or a network failure is an error with a message", () => {
    for (const e of [err(500, "Server Error"), err(502), err(503, "Service Unavailable"), err(0)]) {
      const a = availability("dependabot", e, REPO);
      expect(a.state, `Expected status ${e.status} to be an error`).toBe("error");
      expect(a.message.trim(), `Expected a message for status ${e.status}`).not.toBe("");
    }
  });
});

describe("AS-3: precedence", () => {
  it("the message beats the status: a 403 that says disabled is disabled, not noPermission", () => {
    expect(availability("dependabot", err(403, "Dependabot alerts are disabled for this repository."), REPO).state, "Expected disabled").toBe("disabled");
  });

  it("the message beats the status: a 404 that says disabled is disabled, not notFound", () => {
    expect(availability("secret", err(404, "Secret scanning is disabled on this repository."), REPO).state, "Expected disabled").toBe("disabled");
  });

  it("never throws, whatever the error holds", () => {
    for (const e of [err(NaN), err(403, ""), { status: 404, message: undefined } as SecurityApiError, err(418, "I'm a teapot")]) {
      expect(() => availability("code", e, REPO), `Expected ${JSON.stringify(e)} not to throw`).not.toThrow();
    }
  });
});

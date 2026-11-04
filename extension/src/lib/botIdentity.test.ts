import { describe, it, expect } from "vitest";
import { botIdentity, actorName, COPILOT_AVATAR, COPILOT_REVIEW_DOCS } from "./botIdentity";

describe("botIdentity", () => {
  it.each(["copilot-pull-request-reviewer", "copilot-pull-request-reviewer[bot]", "Copilot", "COPILOT-PULL-REQUEST-REVIEWER"])("recognises Copilot's review bot as %s", (login) => {
    expect(botIdentity({ login })).toEqual({ kind: "copilot", name: "Copilot", label: "AI", url: COPILOT_REVIEW_DOCS, avatarUrl: COPILOT_AVATAR });
  });

  it("trusts REST's is_copilot_code_review whatever the login", () => {
    expect(botIdentity({ login: "some-app[bot]", isCopilotReview: true })?.kind).toBe("copilot");
  });

  it("shows another app by its slug with a Bot label and its app page", () => {
    expect(botIdentity({ login: "dependabot[bot]" })).toEqual({ kind: "app", name: "dependabot", label: "Bot", url: "https://github.com/apps/dependabot" });
    expect(botIdentity({ login: "github-actions[bot]" })?.url).toBe("https://github.com/apps/github-actions");
  });

  it("recognises a GraphQL Bot by its type, as its login has no [bot] suffix", () => {
    expect(botIdentity({ login: "dependabot", type: "Bot" })).toEqual({ kind: "app", name: "dependabot", label: "Bot", url: "https://github.com/apps/dependabot" });
    expect(botIdentity({ login: "dependabot" })).toBeNull();
  });

  it("is null for people and for no login", () => {
    expect(botIdentity({ login: "ann", type: "User" })).toBeNull();
    expect(botIdentity({ login: "copilot-fan" })).toBeNull();
    expect(botIdentity({ login: "" })).toBeNull();
    expect(botIdentity({ login: null })).toBeNull();
  });

  it("names a login by its identity, else leaves it", () => {
    expect(actorName("copilot-pull-request-reviewer")).toBe("Copilot");
    expect(actorName("renovate[bot]")).toBe("renovate");
    expect(actorName("ann")).toBe("ann");
  });
});

import { describe, it, expect } from "vitest";
import { chooseCard, pickAdoIdentity } from "./identityCard";

describe("chooseCard", () => {
  it("gives a GitHub login the person card", () => {
    expect(chooseCard({ login: "ann", name: "Ann Author", email: "ann@example.com" })).toEqual({ kind: "github", login: "ann" });
  });

  it("gives Copilot and other apps the bot card, before the login rule", () => {
    expect(chooseCard({ login: "copilot-pull-request-reviewer" })).toMatchObject({ kind: "bot", bot: { name: "Copilot", label: "AI" } });
    expect(chooseCard({ login: "dependabot[bot]" })).toMatchObject({ kind: "bot", bot: { name: "dependabot", label: "Bot" } });
    expect(chooseCard({ login: "github-actions", type: "Bot" })).toMatchObject({ kind: "bot", bot: { label: "Bot" } });
  });

  it("gives a commit whose email is on no GitHub account the git card, keyed on its email", () => {
    expect(chooseCard({ login: null, name: "Bogdan", email: "BMichon@example.com" })).toEqual({ kind: "git", name: "Bogdan", email: "BMichon@example.com" });
    expect(chooseCard({ name: "Bogdan" })).toEqual({ kind: "git", name: "Bogdan" });
    expect(chooseCard({ email: "x@example.com" })).toEqual({ kind: "git", name: "x@example.com", email: "x@example.com" });
  });

  it("treats a login that is not a valid GitHub login as no login", () => {
    expect(chooseCard({ login: "Bogdan Michon", name: "Bogdan Michon", email: "b@example.com" })).toEqual({ kind: "git", name: "Bogdan Michon", email: "b@example.com" });
  });

  it("shows nothing for the ghost or an empty identity", () => {
    expect(chooseCard({ login: "ghost", name: "ghost" })).toBeNull();
    expect(chooseCard({ login: null, name: "ghost" })).toBeNull();
    expect(chooseCard({})).toBeNull();
    expect(chooseCard({ name: "  ", email: "" })).toBeNull();
  });
});

describe("pickAdoIdentity", () => {
  const ann = { entityId: "1", entityType: "User", mail: "Ann@Example.com", displayName: "Ann" };
  const bob = { entityId: "2", entityType: "User", signInAddress: "bob@example.com", displayName: "Bob" };
  const group = { entityId: "3", entityType: "Group", mail: "team@example.com" };

  it("takes the result whose mail or sign-in address is the email, ignoring case", () => {
    expect(pickAdoIdentity("ann@example.com", [bob, ann])).toBe(ann);
    expect(pickAdoIdentity(" BOB@example.com ", [ann, bob])).toBe(bob);
  });

  it("refuses near matches, groups and empty answers", () => {
    expect(pickAdoIdentity("an@example.com", [ann])).toBeNull();
    expect(pickAdoIdentity("team@example.com", [group])).toBeNull();
    expect(pickAdoIdentity("ann@example.com", [])).toBeNull();
    expect(pickAdoIdentity("ann@example.com", null)).toBeNull();
    expect(pickAdoIdentity("", [ann])).toBeNull();
  });
});

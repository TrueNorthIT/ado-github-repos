import { describe, it, expect } from "vitest";
import { detectMention, rankMentions, mentionHandle, insertMention } from "./mentions";
import type { Candidate } from "./reviewerSearch";

// Module under test: src/lib/mentions.ts (stubs until the developer implements them). Requirement CM-8: "@mentions".
// Search itself is reviewerSearch.ts (userSearchQuery, teamSearchQuery, userCandidates, teamCandidates), reused unchanged and already tested there. Decisions fixed by these tests:
//  - a mention is the text between an "@" and the caret; the "@" must start a word (start of text, whitespace, an opening bracket or a quote), so emails and URLs never trigger it.
//  - code spans and fenced code blocks never trigger it.
//  - ranking is rankCandidates' tiers plus "participants first within a tier"; nobody is excluded.
//  - inserting writes "@handle" plus one space, and does not double an existing space.

/** Finds the caret marked with "|" in `text`, returning the value without it and the caret index. */
function at(text: string): [string, number] {
  const i = text.indexOf("|");
  return [text.slice(0, i) + text.slice(i + 1), i];
}
const detect = (marked: string) => detectMention(...at(marked));

const user = (login: string, name?: string): Candidate => ({ kind: "user", id: `U_${login}`, login, name });
const team = (slug: string, name?: string): Candidate => ({ kind: "team", id: `T_${slug}`, login: slug, name });
const logins = (cs: Candidate[]) => cs.map((c) => `${c.kind === "team" ? "team:" : ""}${c.login}`);

describe("CM-8: detectMention finds an in-progress @query and its replacement range", () => {
  // Given the textarea value and caret, the match carries the typed query and the range to replace.
  it("finds a mention at the end of the text", () => {
    expect(detect("Thanks @bo|"), "Expected query 'bo' from the @ at index 7 to the caret at 10").toEqual({ query: "bo", start: 7, end: 10 });
  });

  it("finds a bare @ with an empty query", () => {
    expect(detect("hi @|"), "Expected an empty query so the list can show everyone").toEqual({ query: "", start: 3, end: 4 });
  });

  it("finds a mention at the very start of the text", () => {
    expect(detect("@ada|"), "Expected the mention at index 0").toEqual({ query: "ada", start: 0, end: 4 });
  });

  it("finds a mention at the start of a later line", () => {
    expect(detect("first line\n@ad|"), "Expected a newline to count as a word boundary").toMatchObject({ query: "ad", start: 11 });
  });

  it("accepts hyphens, digits, underscores and a slash for team handles", () => {
    expect(detect("@acme/dev-team_2|"), "Expected the whole handle as the query").toMatchObject({ query: "acme/dev-team_2" });
  });

  it("finds a mention after an opening bracket or a quote", () => {
    expect(detect("(cc @bo|"), "Expected a mention after a space inside brackets").toMatchObject({ query: "bo" });
    expect(detect("see (@bo|"), "Expected a mention directly after '('").toMatchObject({ query: "bo", start: 5 });
    expect(detect("say \"@bo|"), "Expected a mention directly after a double quote").toMatchObject({ query: "bo" });
  });

  it("uses only the text before the caret as the query", () => {
    expect(detect("hi @bo|b and more"), "Expected query 'bo' with the range ending at the caret").toEqual({ query: "bo", start: 3, end: 6 });
  });

  it("returns null once a space ends the mention", () => {
    expect(detect("hi @bob |"), "Expected no mention after the space").toBeNull();
  });

  it("returns null after punctuation that cannot be part of a handle", () => {
    expect(detect("hi @bob,|"), "Expected no mention after a comma").toBeNull();
    expect(detect("hi @bob.|"), "Expected no mention after a full stop").toBeNull();
  });

  it("returns null when there is no @ before the caret", () => {
    expect(detect("plain text|"), "Expected null without an @").toBeNull();
  });

  it("returns null for an email address", () => {
    expect(detect("write to joe@exa|"), "Expected no mention when the @ follows a letter").toBeNull();
    expect(detect("joe.smith@|"), "Expected no mention when the @ follows a letter, even with an empty query").toBeNull();
  });

  it("returns null for an @ inside a URL or a doubled @", () => {
    expect(detect("https://example.test/@bo|"), "Expected no mention after a slash").toBeNull();
    expect(detect("@@bo|"), "Expected no mention for the second @").toBeNull();
  });

  it("returns null inside an inline code span", () => {
    expect(detect("run `npm i @sc|"), "Expected no mention inside an unclosed code span").toBeNull();
  });

  it("finds a mention after a closed code span on the same line", () => {
    expect(detect("`code` then @bo|"), "Expected a mention once the span is closed").toMatchObject({ query: "bo" });
  });

  it("a code span on an earlier line does not hide a mention on a later one", () => {
    expect(detect("an odd ` backtick\n@bo|"), "Expected the later line to be judged on its own").toMatchObject({ query: "bo" });
  });

  it("returns null inside a fenced code block", () => {
    expect(detect("```ts\nconst a = '@bo|"), "Expected no mention inside an open ``` fence").toBeNull();
    expect(detect("~~~\n@bo|"), "Expected no mention inside an open ~~~ fence").toBeNull();
  });

  it("finds a mention after a fenced code block has closed", () => {
    expect(detect("```\ncode\n```\n@bo|"), "Expected a mention after the closing fence").toMatchObject({ query: "bo" });
  });

  it("returns null for a caret outside the text", () => {
    expect(detectMention("hi @bo", 99), "Expected null for a caret past the end").toBeNull();
    expect(detectMention("hi @bo", -1), "Expected null for a negative caret").toBeNull();
  });
});

describe("CM-8: rankMentions orders users and teams for the list", () => {
  it("orders exact login, then prefix, then fuzzy, like rankCandidates", () => {
    const out = rankMentions([user("joanne"), user("annabel"), user("ann"), user("hannah")], "ann");
    expect(logins(out)[0], "Expected the exact login first").toBe("ann");
    expect(logins(out)[1], "Expected the prefix match second").toBe("annabel");
    expect(logins(out.slice(2)).sort(), "Expected the fuzzy matches last").toEqual(["hannah", "joanne"]);
  });

  it("puts participants first within the same tier, even when their login is longer", () => {
    expect(logins(rankMentions([user("alex"), user("alexander")], "ale", { participants: ["alexander"] })), "Expected the participant before the shorter login").toEqual(["alexander", "alex"]);
  });

  it("does not let a participant jump a better tier", () => {
    expect(logins(rankMentions([user("alice"), user("al")], "al", { participants: ["alice"] })), "Expected the exact login 'al' before the participant prefix match").toEqual(["al", "alice"]);
  });

  it("compares participant logins ignoring case", () => {
    expect(logins(rankMentions([user("alex"), user("Alexander")], "ale", { participants: ["ALEXANDER"] })), "Expected a case-insensitive participant match").toEqual(["Alexander", "alex"]);
  });

  it("falls back to shorter login, then alphabetical, within a tier with no participants", () => {
    expect(logins(rankMentions([user("annabel"), user("annie"), user("anne")], "ann")), "Expected anne, annie, annabel").toEqual(["anne", "annie", "annabel"]);
  });

  it("with a blank query lists participants first, then everyone alphabetically, users before teams", () => {
    const out = rankMentions([user("bob"), team("bob"), user("carol"), user("ada")], "  ", { participants: ["carol"] });
    expect(logins(out), "Expected carol (participant), then ada, bob, team:bob").toEqual(["carol", "ada", "bob", "team:bob"]);
  });

  it("does not exclude anyone: the pull request author and reviewers can be mentioned", () => {
    expect(logins(rankMentions([user("author"), user("reviewer")], "", { participants: ["author", "reviewer"] })), "Expected both to stay in the list").toEqual(["author", "reviewer"]);
  });

  it("drops candidates that do not match", () => {
    expect(rankMentions([user("bob"), user("carol")], "zed"), "Expected no results").toEqual([]);
  });

  it("finds a user by name when the login does not match", () => {
    expect(logins(rankMentions([user("js42", "Jane Smith"), user("bob", "Bob Brown")], "jane")), "Expected Jane Smith found by name").toEqual(["js42"]);
  });

  it("includes teams in the same ranking", () => {
    expect(logins(rankMentions([user("devon"), team("dev", "Developers")], "dev")), "Expected the exact team slug before the prefix user").toEqual(["team:dev", "devon"]);
  });

  it("limits to 10 results by default and honours a custom limit", () => {
    const many = Array.from({ length: 15 }, (_, i) => user(`user${String(i).padStart(2, "0")}`));
    expect(rankMentions(many, "").length, "Expected the default limit of 10").toBe(10);
    expect(rankMentions(many, "", { limit: 3 }).length, "Expected a limit of 3").toBe(3);
  });

  it("treats org/slug as a team search for that organisation only", () => {
    const out = rankMentions([user("dewi"), team("dev", "Developers"), team("design"), team("ops")], "acme/de", { org: "acme" });
    expect(logins(out), "Expected only the teams whose slug matches 'de', shortest first").toEqual(["team:dev", "team:design"]);
  });

  it("matches the organisation ignoring case", () => {
    expect(logins(rankMentions([team("dev")], "ACME/dev", { org: "acme" })), "Expected a case-insensitive org match").toEqual(["team:dev"]);
  });

  it("finds nothing for another organisation's prefix", () => {
    expect(rankMentions([team("dev")], "other/dev", { org: "acme" }), "Expected no teams for a different org").toEqual([]);
  });

  it("lists every team for 'org/' with nothing after the slash", () => {
    expect(logins(rankMentions([user("u"), team("b"), team("a")], "acme/", { org: "acme" })), "Expected both teams, alphabetical, and no users").toEqual(["team:a", "team:b"]);
  });
});

describe("CM-8: mentionHandle gives the text after the @", () => {
  it("is the login for a user", () => {
    expect(mentionHandle(user("ada"), "acme"), "Expected the plain login").toBe("ada");
  });

  it("is org/slug for a team", () => {
    expect(mentionHandle(team("devs", "Developers"), "acme"), "Expected acme/devs").toBe("acme/devs");
  });

  it("rejects a team without an organisation", () => {
    expect(() => mentionHandle(team("devs")), "Expected a team handle to need its org").toThrow(/org is required for a team/);
  });
});

describe("CM-8: insertMention writes @login and a space at the range", () => {
  it("replaces the typed query and adds a trailing space", () => {
    const [value, caret] = at("hi @bo|");
    expect(insertMention(value, { query: "bo", start: 3, end: caret }, "bob"), "Expected 'hi @bob ' with the caret after the space").toEqual({ value: "hi @bob ", caret: 8 });
  });

  it("fills a bare @", () => {
    expect(insertMention("@", { query: "", start: 0, end: 1 }, "ada"), "Expected '@ada ' and the caret after it").toEqual({ value: "@ada ", caret: 5 });
  });

  it("does not double an existing space after the range", () => {
    const [value, caret] = at("hi @bo| there");
    expect(insertMention(value, { query: "bo", start: 3, end: caret }, "bob"), "Expected 'hi @bob there' with the caret after the existing space").toEqual({ value: "hi @bob there", caret: 8 });
  });

  it("adds a space before a newline rather than joining the lines", () => {
    expect(insertMention("@bo\nnext", { query: "bo", start: 0, end: 3 }, "bob"), "Expected '@bob \\nnext' with the caret after the added space").toEqual({ value: "@bob \nnext", caret: 5 });
  });

  it("writes a team handle", () => {
    expect(insertMention("cc @de", { query: "de", start: 3, end: 6 }, "acme/devs"), "Expected '@acme/devs '").toEqual({ value: "cc @acme/devs ", caret: 14 });
  });

  it("leaves text before the @ and after the range untouched", () => {
    const out = insertMention("line one\nping @b|ob, thanks".replace("|", ""), { query: "b", start: 14, end: 16 }, "bob");
    expect(out.value, "Expected only the typed part to be replaced").toBe("line one\nping @bob ob, thanks");
  });
});

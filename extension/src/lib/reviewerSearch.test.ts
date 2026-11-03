import { describe, it, expect } from "vitest";
import {
  userSearchQuery,
  teamSearchQuery,
  userCandidates,
  teamCandidates,
  rankCandidates,
  requestReviewsMutation,
  removeReviewRequestsRequest,
  toRequestedReviewers,
  addAssigneesMutation,
  removeAssigneesMutation,
  type Candidate,
} from "./reviewerSearch";
import { expectMutation, expectNotInQuery, NASTY } from "./ciTestHelpers";
import { expectConnectionCall, expectQueryOperation, expectSelection } from "./editTestHelpers";

// Module under test: src/lib/reviewerSearch.ts (stubs until the developer implements them). Schema facts are in its header.
// Requirements:
//  ED-2 "Reviewers. Add users or teams with requestReviews(input:{pullRequestId, userIds?, teamIds?, union: true}), and remove with removeReviewRequests ... A reviewer search query uses the repo's assignable
//        users (repository.assignableUsers(query:)) and the org's teams (organization.teams(query:)). Merge and rank the results: exact login, then prefix, then fuzzy. Exclude the PR author and current
//        reviewers. Code owners: reviewRequests.nodes.asCodeOwner marks a reviewer as 'Code owner'".
//  ED-5 "Assignees. addAssigneesToAssignable and removeAssigneesFromAssignable, searching assignableUsers."
// Decisions fixed by these tests:
//  - removal is REST (DELETE .../requested_reviewers): GraphQL has no removeReviewRequests mutation. The body always has `reviewers`.
//  - users and teams are searched with two requests (organization(login:) fails for user-owned repositories).
//  - ranking: exact login, login prefix, fuzzy over login and name; shorter login first within a tier, then alphabetical, users before teams.

const user = (login: string, name: string | null = null): Candidate => ({ kind: "user", id: `U_${login}`, login, name });
const team = (slug: string, name: string | null = null): Candidate => ({ kind: "team", id: `T_${slug}`, login: slug, name });
const logins = (cs: Candidate[]) => cs.map((c) => c.login);

describe("ED-2 / ED-5: userSearchQuery (repository.assignableUsers)", () => {
  // Given owner, name and a query, the request searches repository.assignableUsers with the query as a variable.
  it("is a variables-only query on repository.assignableUsers", () => {
    const req = userSearchQuery({ owner: "octo", name: "repo", query: "ann" });
    expectQueryOperation(req);
    expect(req.query, "Expected $owner, $name and $query variables").toMatch(/\$owner:\s*String!.*\$name:\s*String!.*\$query:\s*String\b/s);
    expect(req.query, "Expected repository(owner: $owner, name: $name)").toMatch(/repository\(owner:\s*\$owner,\s*name:\s*\$name\)/);
    expectConnectionCall(req, "assignableUsers", ["query:$query", "first:20"]);
    expect(req.variables, "Expected variables { owner, name, query }").toEqual({ owner: "octo", name: "repo", query: "ann" });
  });

  it("selects id, login, name and avatarUrl", () => {
    expectSelection(userSearchQuery({ owner: "o", name: "r", query: "" }), /assignableUsers\([^)]*\)\s*\{\s*nodes/, ["id", "login", "name", "avatarUrl"], "the user fields");
  });

  it("trims the query, and sends null when it is blank (null lists everyone)", () => {
    expect(userSearchQuery({ owner: "o", name: "r", query: "  ann  " }).variables, "Expected a trimmed query").toMatchObject({ query: "ann" });
    expect(userSearchQuery({ owner: "o", name: "r", query: "   " }).variables, "Expected null for a blank query").toMatchObject({ query: null });
  });

  it("keeps awkward owner, name and query text out of the query string", () => {
    const req = userSearchQuery({ owner: NASTY[0], name: NASTY[1], query: NASTY[2] });
    expectNotInQuery(req, [NASTY[0], NASTY[1], NASTY[2]]);
    expect(req.variables, "Expected the values verbatim in variables").toEqual({ owner: NASTY[0], name: NASTY[1], query: NASTY[2] });
  });
});

describe("ED-2: teamSearchQuery (organization.teams)", () => {
  it("is a variables-only query on organization(login: $org).teams", () => {
    const req = teamSearchQuery({ org: "octo-org", query: "core" });
    expectQueryOperation(req);
    expect(req.query, "Expected $org: String!").toMatch(/\$org:\s*String!/);
    expect(req.query, "Expected organization(login: $org)").toMatch(/organization\(login:\s*\$org\)/);
    expectConnectionCall(req, "teams", ["query:$query", "first:20"]);
    expect(req.variables, "Expected variables { org, query }").toEqual({ org: "octo-org", query: "core" });
  });

  it("selects id, slug, name and avatarUrl", () => {
    expectSelection(teamSearchQuery({ org: "o", query: "" }), /teams\([^)]*\)\s*\{\s*nodes/, ["id", "slug", "name", "avatarUrl"], "the team fields");
  });

  it("trims the query and sends null when blank", () => {
    expect(teamSearchQuery({ org: "o", query: " core " }).variables, "Expected a trimmed query").toEqual({ org: "o", query: "core" });
    expect(teamSearchQuery({ org: "o", query: "" }).variables, "Expected null for a blank query").toEqual({ org: "o", query: null });
  });

  it("keeps awkward text out of the query string", () => {
    const req = teamSearchQuery({ org: NASTY[0], query: NASTY[4] });
    expectNotInQuery(req, [NASTY[0], NASTY[4]]);
  });
});

describe("ED-2: userCandidates and teamCandidates", () => {
  it("maps assignable users to user candidates, in order", () => {
    const out = userCandidates({ repository: { assignableUsers: { nodes: [{ id: "U1", login: "ann", name: "Ann Lee", avatarUrl: "https://x/a.png" }, null, { id: "U2", login: "bob", name: null }] } } });
    expect(out, "Expected two user candidates, the null node dropped").toEqual([
      { kind: "user", id: "U1", login: "ann", name: "Ann Lee", avatarUrl: "https://x/a.png" },
      { kind: "user", id: "U2", login: "bob", name: null, avatarUrl: undefined },
    ]);
  });

  it("maps teams to team candidates whose login is the slug", () => {
    const out = teamCandidates({ organization: { teams: { nodes: [{ id: "T1", slug: "core-team", name: "Core Team", avatarUrl: "https://x/t.png" }] } } });
    expect(out, "Expected the slug as login and the name as name").toEqual([{ kind: "team", id: "T1", login: "core-team", name: "Core Team", avatarUrl: "https://x/t.png" }]);
  });

  it("gives [] for missing data (a failed teams request for a user-owned repository has organization: null)", () => {
    expect(userCandidates(null), "Expected [] for null").toEqual([]);
    expect(userCandidates({ repository: null }), "Expected [] for a null repository").toEqual([]);
    expect(teamCandidates({ organization: null }), "Expected [] for a null organization").toEqual([]);
    expect(teamCandidates(undefined), "Expected [] for undefined").toEqual([]);
  });
});

describe("ED-2: rankCandidates", () => {
  it("orders exact login, then login prefix, then fuzzy", () => {
    const out = rankCandidates([user("joanne"), user("annabel"), user("ann"), user("hannah")], "ann");
    expect(out[0].login, "Expected the exact login first").toBe("ann");
    expect(out[1].login, "Expected the prefix match second").toBe("annabel");
    expect(logins(out.slice(2)).sort(), "Expected the fuzzy matches after, whatever their order").toEqual(["hannah", "joanne"]);
  });

  it("matches case-insensitively", () => {
    expect(logins(rankCandidates([user("Ann"), user("ANNABEL")], "aNN")), "Expected both to match, exact first").toEqual(["Ann", "ANNABEL"]);
  });

  it("trims the query", () => {
    expect(logins(rankCandidates([user("ann"), user("bob")], "  ann ")), "Expected 'ann' to match after trimming").toEqual(["ann"]);
  });

  it("puts an exact login ahead of a prefix match even when it is listed later", () => {
    expect(logins(rankCandidates([user("anna"), user("ann")], "ann")), "Expected ann before anna").toEqual(["ann", "anna"]);
  });

  it("within the prefix tier, the shorter login comes first, then alphabetical", () => {
    expect(logins(rankCandidates([user("annabel"), user("annie"), user("anne"), user("annex")], "ann")), "Expected anne, annex, annie, annabel (by length, then alphabet)").toEqual(["anne", "annex", "annie", "annabel"]);
  });

  it("drops candidates that do not match at all", () => {
    expect(rankCandidates([user("bob"), user("carol")], "zed"), "Expected no results when nothing matches").toEqual([]);
  });

  it("finds a user by a fuzzy match on their name when the login does not match", () => {
    expect(logins(rankCandidates([user("js42", "Jane Smith"), user("bob", "Bob Brown")], "jane")), "Expected Jane Smith found by name").toEqual(["js42"]);
  });

  it("ranks a login prefix above a name-only match", () => {
    expect(logins(rankCandidates([user("zz1", "Jane Smith"), user("janet")], "jane")), "Expected janet (login prefix) before zz1 (name only)").toEqual(["janet", "zz1"]);
  });

  it("ranks teams in the same tiers as users, users first on a tie", () => {
    expect(logins(rankCandidates([team("core"), user("core"), team("core-team")], "core")), "Expected user core, team core (same login: user first), then the prefix match").toEqual(["core", "core", "core-team"]);
    expect(rankCandidates([team("core"), user("core")], "core").map((c) => c.kind), "Expected the user before the team").toEqual(["user", "team"]);
  });

  it("excludes the pull request author, whatever the case", () => {
    expect(logins(rankCandidates([user("Author"), user("author2")], "auth", { authorLogin: "author" })), "Expected the author left out").toEqual(["author2"]);
  });

  it("excludes the author with a blank query too", () => {
    expect(logins(rankCandidates([user("amy"), user("bob")], "", { authorLogin: "AMY" })), "Expected amy left out").toEqual(["bob"]);
  });

  it("excludes current reviewers by kind and login", () => {
    const out = rankCandidates([user("amy"), user("bob"), team("core")], "", { current: [{ kind: "user", login: "AMY" }, { kind: "team", login: "core" }] });
    expect(logins(out), "Expected the requested user and team left out").toEqual(["bob"]);
  });

  it("excludes a current team by its display name as well as its slug (the PR page labels teams by name)", () => {
    const out = rankCandidates([team("core-team", "Core Team"), team("docs", "Docs")], "", { current: [{ kind: "team", login: "Core Team" }] });
    expect(logins(out), "Expected the Core Team team left out").toEqual(["docs"]);
  });

  it("does not exclude a team that merely shares the author's login", () => {
    expect(logins(rankCandidates([team("amy")], "", { authorLogin: "amy" })), "Expected the team kept: the author is a user").toEqual(["amy"]);
  });

  it("does not exclude a user that merely shares a current team's slug", () => {
    expect(logins(rankCandidates([user("core")], "", { current: [{ kind: "team", login: "core" }] })), "Expected the user kept").toEqual(["core"]);
  });

  it("lists everything alphabetically for a blank query", () => {
    expect(logins(rankCandidates([user("carol"), user("amy"), user("bob")], "   ")), "Expected alphabetical order").toEqual(["amy", "bob", "carol"]);
  });

  it("limits the result, defaulting to 10", () => {
    const many = Array.from({ length: 25 }, (_, i) => user(`user${String(i).padStart(2, "0")}`));
    expect(rankCandidates(many, "user"), "Expected 10 results by default").toHaveLength(10);
    expect(rankCandidates(many, "user", { limit: 3 }), "Expected the given limit").toHaveLength(3);
  });

  it("applies the limit after ranking and exclusion", () => {
    const out = rankCandidates([user("amy"), user("ab"), user("a")], "a", { authorLogin: "a", limit: 1 });
    expect(logins(out), "Expected the best remaining candidate, 'ab'").toEqual(["ab"]);
  });

  it("does not change its input", () => {
    const input = [user("b"), user("a")];
    rankCandidates(input, "");
    expect(logins(input), "Expected the input order kept").toEqual(["b", "a"]);
  });
});

describe("ED-2: requestReviewsMutation", () => {
  it("is a mutation taking $input: RequestReviewsInput!", () => {
    expectMutation(requestReviewsMutation({ pullRequestId: "PR1", userIds: ["U1"] }), "RequestReviewsInput", "requestReviews");
  });

  it("adds without replacing: union is true", () => {
    expect(requestReviewsMutation({ pullRequestId: "PR1", userIds: ["U1"], teamIds: ["T1"] }).variables, "Expected union: true so existing reviewers stay").toEqual({
      input: { pullRequestId: "PR1", userIds: ["U1"], teamIds: ["T1"], union: true },
    });
  });

  it("leaves out an empty or missing id list", () => {
    expect(requestReviewsMutation({ pullRequestId: "PR1", userIds: ["U1"], teamIds: [] }).variables, "Expected no teamIds key for []").toEqual({ input: { pullRequestId: "PR1", userIds: ["U1"], union: true } });
    expect(requestReviewsMutation({ pullRequestId: "PR1", teamIds: ["T1"] }).variables, "Expected no userIds key when missing").toEqual({ input: { pullRequestId: "PR1", teamIds: ["T1"], union: true } });
  });

  it("selects the pull request id back", () => {
    expectSelection(requestReviewsMutation({ pullRequestId: "PR1", userIds: ["U1"] }), /requestReviews\(input:\s*\$input\)\s*\{\s*pullRequest/, ["id"], "the pull request payload");
  });

  it("keeps ids out of the query text", () => {
    expectNotInQuery(requestReviewsMutation({ pullRequestId: NASTY[0], userIds: [NASTY[1]] }), [NASTY[0], NASTY[1]]);
  });

  it("refuses a blank pull request id", () => {
    expect(() => requestReviewsMutation({ pullRequestId: " ", userIds: ["U1"] }), "Expected a blank id to be refused").toThrow(/pullRequestId is required/);
  });

  it("refuses a request with no reviewers", () => {
    expect(() => requestReviewsMutation({ pullRequestId: "PR1" }), "Expected no reviewers to be refused").toThrow(/at least one reviewer is required/);
    expect(() => requestReviewsMutation({ pullRequestId: "PR1", userIds: [], teamIds: [] }), "Expected empty lists to be refused").toThrow(/at least one reviewer is required/);
  });
});

describe("ED-2: removeReviewRequestsRequest (REST: there is no GraphQL removeReviewRequests)", () => {
  it("is a DELETE on the pull request's requested_reviewers with user logins in `reviewers`", () => {
    expect(removeReviewRequestsRequest("octo/repo", 7, { users: ["ann", "bob"] }), "Expected DELETE /repos/octo/repo/pulls/7/requested_reviewers").toEqual({
      method: "DELETE",
      path: "/repos/octo/repo/pulls/7/requested_reviewers",
      body: { reviewers: ["ann", "bob"] },
    });
  });

  it("puts team slugs in team_reviewers and still sends reviewers: [] (REST requires it)", () => {
    expect(removeReviewRequestsRequest("octo/repo", 7, { teams: ["core"] }).body, "Expected reviewers: [] alongside team_reviewers").toEqual({ reviewers: [], team_reviewers: ["core"] });
  });

  it("sends both lists when both are given", () => {
    expect(removeReviewRequestsRequest("octo/repo", 7, { users: ["ann"], teams: ["core"] }).body, "Expected users and teams").toEqual({ reviewers: ["ann"], team_reviewers: ["core"] });
  });

  it("refuses to remove nobody", () => {
    expect(() => removeReviewRequestsRequest("octo/repo", 7, {}), "Expected an empty removal to be refused").toThrow(/at least one reviewer is required/);
    expect(() => removeReviewRequestsRequest("octo/repo", 7, { users: [], teams: [] }), "Expected empty lists to be refused").toThrow(/at least one reviewer is required/);
  });
});

describe("ED-2: toRequestedReviewers (Code owner badge)", () => {
  it("maps users, teams and bots, in order", () => {
    const out = toRequestedReviewers([
      { asCodeOwner: false, requestedReviewer: { __typename: "User", id: "U1", login: "ann", name: "Ann Lee", avatarUrl: "https://x/a.png" } },
      { asCodeOwner: false, requestedReviewer: { __typename: "Team", id: "T1", slug: "core-team", name: "Core Team", avatarUrl: "https://x/t.png" } },
      { asCodeOwner: false, requestedReviewer: { __typename: "Bot", id: "B1", login: "some-bot" } },
    ]);
    expect(out, "Expected a user, a team (login is the slug, name the team name) and a bot").toEqual([
      { kind: "user", id: "U1", login: "ann", name: "Ann Lee", avatarUrl: "https://x/a.png", codeOwner: false },
      { kind: "team", id: "T1", login: "core-team", name: "Core Team", avatarUrl: "https://x/t.png", codeOwner: false },
      { kind: "bot", id: "B1", login: "some-bot", name: "some-bot", avatarUrl: undefined, codeOwner: false },
    ]);
  });

  it("labels a code-owner request with the 'Code owner' badge, and no other", () => {
    const [co, plain] = toRequestedReviewers([
      { asCodeOwner: true, requestedReviewer: { __typename: "User", id: "U1", login: "ann" } },
      { asCodeOwner: false, requestedReviewer: { __typename: "User", id: "U2", login: "bob" } },
    ]);
    expect(co.codeOwner, "Expected ann marked as a code owner").toBe(true);
    expect(co.badge, "Expected the 'Code owner' badge on ann").toBe("Code owner");
    expect(plain.codeOwner, "Expected bob not marked").toBe(false);
    expect(plain.badge, "Expected no badge on bob").toBeUndefined();
  });

  it("treats a missing asCodeOwner as false", () => {
    const [r] = toRequestedReviewers([{ requestedReviewer: { __typename: "User", id: "U1", login: "ann" } }]);
    expect(r.codeOwner, "Expected codeOwner false when the flag is absent").toBe(false);
    expect(r.badge, "Expected no badge").toBeUndefined();
  });

  it("falls back to the login when a user has no profile name", () => {
    const [r] = toRequestedReviewers([{ asCodeOwner: false, requestedReviewer: { __typename: "User", id: "U1", login: "ann", name: null } }]);
    expect(r.name, "Expected the login as the display name").toBe("ann");
  });

  it("shows the Copilot bot as 'Copilot' (copilotReview.ts reviewerName)", () => {
    const [r] = toRequestedReviewers([{ asCodeOwner: false, requestedReviewer: { __typename: "Bot", id: "B1", login: "copilot-pull-request-reviewer" } }]);
    expect(r.name, "Expected the display name Copilot").toBe("Copilot");
    expect(r.login, "Expected the real login kept for removal").toBe("copilot-pull-request-reviewer");
  });

  // Seen live on cli/cli#14846: { asCodeOwner: true, requestedReviewer: null } (a team the viewer cannot see).
  it("drops a request whose reviewer the viewer cannot see, and unknown reviewer types", () => {
    const out = toRequestedReviewers([
      { asCodeOwner: true, requestedReviewer: null },
      { asCodeOwner: false, requestedReviewer: { __typename: "Mannequin", login: "ghost-import" } },
      { asCodeOwner: false, requestedReviewer: { __typename: "User", id: "U1", login: "ann" } },
    ]);
    expect(logins(out as unknown as Candidate[]), "Expected only ann").toEqual(["ann"]);
  });

  it("gives [] for missing nodes", () => {
    expect(toRequestedReviewers(null), "Expected [] for null").toEqual([]);
    expect(toRequestedReviewers(undefined), "Expected [] for undefined").toEqual([]);
  });
});

describe("ED-5: assignee mutations", () => {
  it("addAssigneesMutation is a mutation taking $input: AddAssigneesToAssignableInput!", () => {
    const req = addAssigneesMutation("PR1", ["U1", "U2"]);
    expectMutation(req, "AddAssigneesToAssignableInput", "addAssigneesToAssignable");
    expect(req.variables, "Expected { assignableId, assigneeIds }").toEqual({ input: { assignableId: "PR1", assigneeIds: ["U1", "U2"] } });
  });

  it("removeAssigneesMutation is a mutation taking $input: RemoveAssigneesFromAssignableInput!", () => {
    const req = removeAssigneesMutation("PR1", ["U1"]);
    expectMutation(req, "RemoveAssigneesFromAssignableInput", "removeAssigneesFromAssignable");
    expect(req.variables, "Expected { assignableId, assigneeIds }").toEqual({ input: { assignableId: "PR1", assigneeIds: ["U1"] } });
  });

  it("both select the pull request's assignees back", () => {
    for (const req of [addAssigneesMutation("PR1", ["U1"]), removeAssigneesMutation("PR1", ["U1"])])
      expectSelection(req, /assignable\s*\{\s*\.\.\. on PullRequest/, ["id", "assignees"], "the pull request payload");
  });

  it("keep ids out of the query text", () => {
    expectNotInQuery(addAssigneesMutation(NASTY[0], [NASTY[1]]), [NASTY[0], NASTY[1]]);
    expectNotInQuery(removeAssigneesMutation(NASTY[0], [NASTY[1]]), [NASTY[0], NASTY[1]]);
  });

  it("refuse a blank assignable id", () => {
    expect(() => addAssigneesMutation(" ", ["U1"]), "Expected a blank id to be refused (add)").toThrow(/assignableId is required/);
    expect(() => removeAssigneesMutation("", ["U1"]), "Expected a blank id to be refused (remove)").toThrow(/assignableId is required/);
  });

  it("refuse an empty assignee list", () => {
    expect(() => addAssigneesMutation("PR1", []), "Expected no assignees to be refused (add)").toThrow(/at least one assignee is required/);
    expect(() => removeAssigneesMutation("PR1", []), "Expected no assignees to be refused (remove)").toThrow(/at least one assignee is required/);
  });
});

import { describe, expect, it } from "vitest";
import { decide, learnIds, type GuardCtx } from "../src/dev/liveGuard";

const S = "TrueNorthIT/gh-repos-sandbox";
const gql = (query: string, variables: Record<string, unknown> = {}) => ({ method: "POST", url: "https://api.github.com/graphql", body: JSON.stringify({ query, variables }) });
const rest = (method: string, path: string, body?: string) => ({ method, url: `https://api.github.com${path}`, body });
const ctx = (): GuardCtx => {
  const c: GuardCtx = { sandboxId: 42, seenIds: new Set() };
  learnIds('{"id":"PR_kwDOAbCdEf12","x":"MDExOlB1bGxSZXF1ZXN0MQ=="}', c);
  return c;
};

const CASES: [string, { method: string; url: string; body?: string }, boolean][] = [
  ["repo REST", rest("GET", `/repos/${S}/pulls/3`), true],
  ["repo REST, other case", rest("GET", "/repos/trueNORTHit/GH-repos-sandbox/branches"), true],
  ["repo REST write", rest("PUT", `/repos/${S}/contents/a.txt`, "{}"), true],
  ["other repo REST", rest("GET", "/repos/TrueNorthIT/TrueTunes/pulls/234"), false],
  ["other owner, same name", rest("GET", "/repos/octocat/gh-repos-sandbox"), false],
  ["sandbox prefix only", rest("GET", `/repos/${S}-copy/pulls`), false],
  ["other repo write", rest("DELETE", "/repos/TrueNorthIT/TrueTunes/git/refs/heads/x"), false],
  ["repositories by sandbox id", rest("GET", "/repositories/42/pulls"), true],
  ["repositories by other id", rest("GET", "/repositories/43/pulls"), false],
  ["/user", rest("GET", "/user"), true],
  ["/user write", rest("PATCH", "/user", "{}"), false],
  ["org teams", rest("GET", "/orgs/TrueNorthIT/teams?per_page=100"), true],
  ["org team members", rest("GET", "/orgs/TrueNorthIT/teams/dev/members"), true],
  ["org members", rest("GET", "/orgs/TrueNorthIT/members"), true],
  ["other org teams", rest("GET", "/orgs/Other/teams"), false],
  ["org write", rest("POST", "/orgs/TrueNorthIT/teams", "{}"), false],
  ["org repos listing", rest("GET", "/orgs/TrueNorthIT/repos"), false],
  ["user repos listing", rest("GET", "/user/repos"), false],
  ["a profile", rest("GET", "/users/octocat"), true],
  ["a bot's profile", rest("GET", "/users/github-actions%5Bbot%5D"), true],
  ["a profile write", rest("PATCH", "/users/octocat", "{}"), false],
  ["a user's repos", rest("GET", "/users/octocat/repos"), false],
  ["a user's events", rest("GET", "/users/octocat/events"), false],
  ["markdown", rest("POST", "/markdown", '{"text":"hi"}'), true],
  ["markdown for the sandbox", rest("POST", "/markdown", `{"text":"#1","context":"${S}"}`), true],
  ["markdown for another repo", rest("POST", "/markdown", '{"text":"#1","context":"TrueNorthIT/TrueTunes"}'), false],
  ["search REST in sandbox", rest("GET", `/search/issues?q=${encodeURIComponent(`repo:${S} is:pr bug`)}`), true],
  ["search REST other repo", rest("GET", `/search/issues?q=${encodeURIComponent("repo:TrueNorthIT/TrueTunes is:pr")}`), false],
  ["search REST mixed", rest("GET", `/search/issues?q=${encodeURIComponent(`repo:${S} repo:x/y`)}`), false],
  ["search REST no repo", rest("GET", `/search/code?q=${encodeURIComponent("org:TrueNorthIT token")}`), false],
  ["unknown path", rest("GET", "/gists"), false],
  ["blob host, no auth", { method: "GET", url: "https://productionresultssa1.blob.core.windows.net/x?sig=1" }, true],
  ["gql repository", gql("query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id}}", { owner: "TrueNorthIT", name: "gh-repos-sandbox" }), true],
  ["gql repository other", gql("query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id}}", { owner: "TrueNorthIT", name: "TrueTunes" }), false],
  ["gql repository literal", gql('{ repository(owner: "TrueNorthIT", name: "TrueTunes") { id } }'), false],
  ["gql repository literal sandbox", gql(`{ repository(owner: "TrueNorthIT", name: "gh-repos-sandbox") { id } }`), true],
  ["gql second repository hidden in an alias", gql("query($o:String!,$n:String!){a:repository(owner:$o,name:$n){id} b:repository(owner:\"x\",name:\"y\"){id}}", { o: "TrueNorthIT", n: "gh-repos-sandbox" }), false],
  ["gql search sandbox", gql("query($q:String!){search(query:$q,type:ISSUE,first:5){issueCount}}", { q: `repo:${S} is:pr is:open` }), true],
  ["gql search other repo", gql("query($q:String!){search(query:$q,type:ISSUE,first:5){issueCount}}", { q: "repo:TrueNorthIT/TrueTunes is:pr" }), false],
  ["gql search no repo", gql("query($q:String!){search(query:$q,type:ISSUE,first:5){issueCount}}", { q: "is:pr author:@me" }), false],
  ["gql organization", gql("query($org:String!){organization(login:$org){teams(first:5){nodes{slug}}}}", { org: "TrueNorthIT" }), true],
  ["gql other organization", gql("query($org:String!){organization(login:$org){teams(first:5){nodes{slug}}}}", { org: "Other" }), false],
  ["gql repositoryOwner", gql('{ repositoryOwner(login: "TrueNorthIT") { repositories(first: 5) { nodes { name } } } }'), false],
  ["gql viewer pull requests", gql("{ viewer { pullRequests(first: 5) { nodes { id } } } }"), false],
  ["gql viewer login", gql("{ viewer { login } }"), true],
  ["gql node, seen id", gql("query($id:ID!){node(id:$id){id}}", { id: "PR_kwDOAbCdEf12" }), true],
  ["gql node, unseen id", gql("query($id:ID!){node(id:$id){id}}", { id: "PR_kwDOZzZzZz99" }), false],
  ["gql node, unseen literal", gql('{ node(id: "R_kgDOOther123") { id } }'), false],
  ["gql nodes, one unseen", gql("query($ids:[ID!]!){nodes(ids:$ids){id}}", { ids: ["PR_kwDOAbCdEf12", "PRRT_kwDOnope1234"] }), false],
  ["gql node, non-node-shaped id", gql("query($id:ID!){node(id:$id){id}}", { id: "123" }), false],
  ["gql mutation with an unseen id", gql("mutation($input:AddReactionInput!){addReaction(input:$input){reaction{id}}}", { input: { subjectId: "IC_kwDOunseen123", content: "HEART" } }), false],
  ["gql mutation with a seen id", gql("mutation($input:AddReactionInput!){addReaction(input:$input){reaction{id}}}", { input: { subjectId: "PR_kwDOAbCdEf12", content: "HEART" } }), true],
  ["gql cursor is not a node id", gql("query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){id}}", { owner: "TrueNorthIT", name: "gh-repos-sandbox", after: "Y3Vyc29yOnYyOpK5MjAyNS0wMS0wMVQwMDowMDowMFrOAAAAAA==" }), true],
  ["gql unreadable body", { method: "POST", url: "https://api.github.com/graphql", body: "not json" }, false],
];

describe("live guard", () => {
  it.each(CASES)("%s", (_n, r, allowed) => {
    const d = decide({ method: r.method, url: new URL(r.url), body: r.body }, ctx());
    expect(d.ok, d.ok ? "" : d.reason).toBe(allowed);
  });
  it("refuses /repositories/{id} until the sandbox id is known", () => {
    expect(decide({ method: "GET", url: new URL("https://api.github.com/repositories/42") }, { seenIds: new Set() }).ok).toBe(false);
  });
});

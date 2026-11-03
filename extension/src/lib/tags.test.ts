import { describe, it, expect } from "vitest";
import { tagListQuery, mapTag, mapTagsPage, createTagMutation, createTagObjectRequest, branchFromTagMutation, type GqlTagNode } from "./tags";
import { buildRefTree, type RefNode } from "./branches";
import { GHOST_AVATAR } from "./commitsQuery";

// Module under test: src/lib/tags.ts, T-1 "Tags list" and T-2 "Tag actions".
// Shared rule, as in feedQuery.ts / actionsQuery.ts: caller-supplied values travel in `variables`; query text is constant.
// Conventions fixed by these tests:
//  - Ref.target is a Tag (annotated: name, message, tagger, target commit) or a Commit (lightweight). Both are selected with __typename.
//  - annotated: author is the tagger and date is tagger.date; lightweight: the commit's author and authoredDate, and no `message` key.
//  - TAG_COMMIT_DATE DESC works for tags (live on cli/cli: newest first, and different from ALPHABETICAL where tags skip the sort), unlike for branches.
//  - deleting a tag reuses deleteRefMutation (actionsQuery.ts) with TagRow.id; name validation is validateRefName (refName.test.ts covers T-2 names).
//  - the annotated flow is two calls: createTagObjectRequest (REST POST /repos/{o}/{r}/git/tags) then createTagMutation(repoId, name, <new tag object sha>).
//    Not exercised live: the POST writes to the repository. Body fields follow GitHub's "Create a tag object" REST docs (tag, message, object, type).
// GitHub names: Repository.refs, Ref.target (GitObject), Tag.message, Tag.tagger (GitActor with date), Tag.target, CreateRefInput.

const norm = (s: string) => s.replace(/\s+/g, " ");
const NASTY = ['we"ird', "back\\slash", "ünï cødé 日本", "sp ace #hash", "q{uery}", "$var"];
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("T-1: tagListQuery lists tags newest first", () => {
  const req = () => tagListQuery({ owner: "acme", name: "web" });
  const q = () => norm(req().query);

  it("sends owner, name and a null cursor as variables", () => {
    expect(req().variables, "Expected { owner, name, after: null }").toEqual({ owner: "acme", name: "web", after: null });
    expect(tagListQuery({ owner: "o", name: "n", after: "MTAw" }).variables.after, "Expected the cursor in variables.after").toBe("MTAw");
  });

  it("reads refs/tags/ 100 at a time ordered by TAG_COMMIT_DATE DESC", () => {
    expect(q(), 'Expected refs(refPrefix: "refs/tags/", first: 100, after: $after, ...)').toMatch(/refs\(refPrefix:\s*"refs\/tags\/",\s*first:\s*100,\s*after:\s*\$after,/);
    expect(q(), "Expected orderBy {field: TAG_COMMIT_DATE, direction: DESC}").toMatch(/orderBy:\s*\{\s*field:\s*TAG_COMMIT_DATE,\s*direction:\s*DESC\s*\}/);
  });

  it("asks for the page info, the repository id and each ref's id and name", () => {
    expect(q(), "Expected pageInfo { hasNextPage endCursor }").toMatch(/pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/);
    expect(q(), "Expected repository { id ... } for createRef").toMatch(/repository\(owner:\s*\$owner,\s*name:\s*\$name\)\s*\{\s*id\b/);
    expect(q(), "Expected id and name on each ref").toMatch(/nodes\s*\{\s*id\s+name\b/);
  });

  it("selects both target kinds: annotated Tag and lightweight Commit", () => {
    expect(q(), "Expected __typename on the target").toMatch(/target\s*\{\s*__typename/);
    expect(q(), "Expected Tag { message tagger { name date user { login avatarUrl } } target { oid } }").toMatch(
      /\.\.\.\s*on Tag\s*\{[^]*\bmessage\b[^]*tagger\s*\{\s*name\s+date\s+user\s*\{\s*login\s+avatarUrl\s*\}\s*\}[^]*target\s*\{\s*oid\s*\}/
    );
    expect(q(), "Expected Commit { oid authoredDate author { name user { login avatarUrl } } }").toMatch(
      /\.\.\.\s*on Commit\s*\{[^]*\boid\b[^]*\bauthoredDate\b[^]*author\s*\{\s*name\s+user\s*\{\s*login\s+avatarUrl\s*\}\s*\}/
    );
  });

  it.each(NASTY)("never puts caller text in the query string: %s", (nasty) => {
    const a = tagListQuery({ owner: nasty, name: nasty, after: nasty });
    expect(a.query, "Expected constant query text").toBe(req().query);
    expect(a.variables, "Expected the text in variables").toMatchObject({ owner: nasty, name: nasty, after: nasty });
  });

  it("is a single query operation", () => {
    expect(q().match(/\b(query|mutation|subscription)\b\s*[\w]*\s*\(/g), "Expected exactly one operation").toHaveLength(1);
  });
});

const annotated = (over: Partial<Extract<NonNullable<GqlTagNode["target"]>, { __typename: "Tag" }>> = {}): GqlTagNode => ({
  id: "REF_v1",
  name: "v1.0.0",
  target: {
    __typename: "Tag",
    message: "First stable release",
    tagger: { name: "Rae Releaser", date: "2026-09-01T10:00:00+01:00", user: { login: "rae", avatarUrl: "https://example.test/r.png" } },
    target: { oid: COMMIT },
    ...over,
  },
});
const lightweight = (): GqlTagNode => ({
  id: "REF_v0",
  name: "v0.9.0",
  target: { __typename: "Commit", oid: COMMIT, authoredDate: "2026-08-01T08:00:00Z", author: { name: "Alex Example", user: { login: "alex", avatarUrl: "https://example.test/a.png" } } },
});

describe("T-1: mapTag builds a tag row", () => {
  it("maps an annotated tag using the tagger, the tag's date and its message", () => {
    expect(mapTag(annotated()), "Expected the annotated tag row").toEqual({
      id: "REF_v1",
      name: "v1.0.0",
      sha: COMMIT,
      shortSha: "01234567",
      annotated: true,
      message: "First stable release",
      author: { name: "Rae Releaser", login: "rae", avatarUrl: "https://example.test/r.png" },
      date: new Date("2026-09-01T10:00:00+01:00"),
    });
  });

  it("maps a lightweight tag using the commit's author and authored date, with no message", () => {
    const t = mapTag(lightweight());
    expect(t, "Expected the lightweight tag row").toEqual({
      id: "REF_v0",
      name: "v0.9.0",
      sha: COMMIT,
      shortSha: "01234567",
      annotated: false,
      author: { name: "Alex Example", login: "alex", avatarUrl: "https://example.test/a.png" },
      date: new Date("2026-08-01T08:00:00Z"),
    });
    expect("message" in t, "Expected the message key to be absent for a lightweight tag").toBe(false);
  });

  it("falls back to the ghost when an annotated tag has no tagger", () => {
    expect(mapTag(annotated({ tagger: null })).author, "Expected the ghost tagger").toEqual({ name: "ghost", login: "ghost", avatarUrl: GHOST_AVATAR });
  });

  it("keeps the tagger's name, with no login and the ghost avatar, when the email has no account", () => {
    const t = mapTag(annotated({ tagger: { name: "Sam Unlinked", date: "2026-09-01T10:00:00Z", user: null } }));
    expect(t.author, "Expected the name kept, login null and the ghost avatar").toEqual({ name: "Sam Unlinked", login: null, avatarUrl: GHOST_AVATAR });
  });
});

describe("T-1: mapTagsPage maps a whole response", () => {
  const body = { data: { repository: { id: "REPO_1", refs: { pageInfo: { hasNextPage: false, endCursor: "end" }, nodes: [annotated(), lightweight()] } } } };

  it("maps the tags in order with the repository id and paging cursor", () => {
    const p = mapTagsPage(body);
    expect(p.tags.map((t) => [t.name, t.annotated]), "Expected the tags in response order with their kind").toEqual([["v1.0.0", true], ["v0.9.0", false]]);
    expect(p.repoId, "Expected repository.id").toBe("REPO_1");
    expect(p.hasNextPage, "Expected hasNextPage").toBe(false);
    expect(p.endCursor, "Expected endCursor").toBe("end");
  });

  it("gives an empty list for a repository with no tags", () => {
    const empty = { data: { repository: { id: "REPO_1", refs: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } };
    expect(mapTagsPage(empty).tags, "Expected no tags (the page shows its empty state)").toEqual([]);
  });
});

describe("T-1: tags group into folders and search like branches", () => {
  // Reuses buildRefTree (B-2) with tag rows as the items.
  const tags = () => [mapTag({ ...lightweight(), name: "release/v1" }), mapTag({ ...lightweight(), name: "release/v2" }), mapTag({ ...lightweight(), name: "nightly" })];
  const shape = (nodes: RefNode<{ name: string }>[]): unknown[] => nodes.map((n) => (n.kind === "folder" ? { [n.name + "/"]: shape(n.children) } : n.name));

  it("nests a tag named release/v1 under the folder release, with refs in input order", () => {
    expect(shape(buildRefTree(tags())), "Expected release/ then the nightly tag").toEqual([{ "release/": ["v1", "v2"] }, "nightly"]);
  });

  it("searches tag names case-insensitively and keeps the folder path", () => {
    expect(shape(buildRefTree(tags(), { query: "V2" })), "Expected only release/v2 under its folder").toEqual([{ "release/": ["v2"] }]);
  });

  it("keeps the tag row on each leaf", () => {
    const [folder] = buildRefTree(tags()) as any[];
    expect(folder.children[0].item.sha, "Expected the leaf to hold the TagRow").toBe(COMMIT);
  });
});

describe("T-2: createTagMutation (lightweight, and the ref step of an annotated tag)", () => {
  it("builds createRef with refs/tags/<name>, the repository id and the oid, as one $input variable", () => {
    const req = createTagMutation("REPO_1", "release/v1", COMMIT);
    expect(req.variables, "Expected { input: { repositoryId, name: refs/tags/release/v1, oid } }").toEqual({ input: { repositoryId: "REPO_1", name: "refs/tags/release/v1", oid: COMMIT } });
    expect(norm(req.query), "Expected a createRef mutation typed with CreateRefInput!").toMatch(/^\s*mutation\b[^{]*\(\s*\$input:\s*CreateRefInput!\s*\)\s*\{\s*createRef\(input:\s*\$input\)/);
  });

  it("takes the new tag object's sha as the oid for an annotated tag", () => {
    const TAG_OBJECT = "f".repeat(40);
    expect(createTagMutation("REPO_1", "v2", TAG_OBJECT).variables, "Expected the tag object sha as oid").toEqual({ input: { repositoryId: "REPO_1", name: "refs/tags/v2", oid: TAG_OBJECT } });
  });

  it.each(NASTY)("never puts caller text in the mutation string: %s", (nasty) => {
    const a = createTagMutation(nasty, nasty, nasty);
    expect(a.query, "Expected constant mutation text").toBe(createTagMutation("R", "n", "o").query);
    expect(a.variables, "Expected the text in variables").toEqual({ input: { repositoryId: nasty, name: `refs/tags/${nasty}`, oid: nasty } });
  });
});

describe("T-2: createTagObjectRequest (step 1 of an annotated tag)", () => {
  it("POSTs { tag, message, object, type: 'commit' } to the repository's git/tags endpoint", () => {
    expect(createTagObjectRequest("acme/web", { tag: "v2", message: "Second release", oid: COMMIT }), "Expected POST /repos/acme/web/git/tags with the tag object fields").toEqual({
      method: "POST",
      path: "/repos/acme/web/git/tags",
      body: { tag: "v2", message: "Second release", object: COMMIT, type: "commit" },
    });
  });

  it("sends the message exactly as written, so multi-line text survives", () => {
    const message = "Release 2\n\n- one\n- two\n";
    expect(createTagObjectRequest("acme/web", { tag: "v2", message, oid: COMMIT }).body.message, "Expected no trimming").toBe(message);
  });

  it.each(["", "   ", "\n"])("throws for a blank message %j, before any request exists", (message) => {
    expect(() => createTagObjectRequest("acme/web", { tag: "v2", message, oid: COMMIT }), "Expected an annotated tag to need a message").toThrow(/message/i);
  });
});

describe("New branch from tag: createRef at the tag's commit", () => {
  it("uses the commit oid for a lightweight tag", () => {
    expect(branchFromTagMutation("REPO_1", mapTag(lightweight()), "hotfix").variables, "Expected refs/heads/hotfix at the commit").toEqual({ input: { repositoryId: "REPO_1", name: "refs/heads/hotfix", oid: COMMIT } });
  });
  it("uses the commit oid, not the tag object's, for an annotated tag", () => {
    const node = annotated();
    const input = (branchFromTagMutation("REPO_1", mapTag(node), "hotfix").variables as any).input;
    expect(input.oid, "Expected the commit the tag object points at").toBe(COMMIT);
  });
  it("throws when the tag has no commit to branch from", () => {
    expect(() => branchFromTagMutation("REPO_1", mapTag({ id: "x", name: "bad", target: null }), "hotfix")).toThrow(/commit/i);
  });
});

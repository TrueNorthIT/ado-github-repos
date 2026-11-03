import { describe, it, expect } from "vitest";
import {
  releasesQuery,
  toReleasesPage,
  releaseBadges,
  filterReleases,
  pageReleases,
  RELEASES_PAGE_SIZE,
  formatBytes,
  sourceArchives,
  releaseForTag,
  latestReleaseQuery,
  toLatestRelease,
  RELEASE_REACTIONS,
  validateReleaseForm,
  isNewTag,
  saveReleaseRequest,
  generateNotesRequest,
  deleteReleaseRequest,
  deleteAssetRequest,
  getReleaseRequest,
  restAssetIds,
  releaseEditUrl,
  defaultPreviousTag,
  type ReleaseForm,
  type ReleaseFormContext,
} from "./releases";
import { validateRefName } from "./refName";
import { norm } from "./ciTestHelpers";

// Module under test: src/lib/releases.ts (stubs until the developer implements them). Requirements REQ-2 to REQ-16 and REQ-18 of the Releases feature
// (the Tags page's Releases tab). Every doc comment in releases.ts is the spec; the tests below say which requirement each group serves.
// Conventions fixed by these tests:
//  - releasesQuery keeps caller-supplied values in `variables` (as tags.ts does): owner, name and after (null for the first page).
//  - toReleasesPage maps the GraphQL shape data.repository.{ viewerPermission, releases { nodes, pageInfo } }; dates become Date.
//  - Request builders return data (RestRequest), never perform the call; paths are /repos/{owner}/{repo}/... with the repo not encoded.

// ---------- fixtures ----------

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

const node = (over: Record<string, unknown> = {}) => ({
  id: "RE_kwDOAAA",
  databaseId: 101,
  name: "Spring release",
  tagName: "v1.2.0",
  tagCommit: { oid: COMMIT },
  author: { login: "octocat", avatarUrl: "https://avatars.example/octocat.png" },
  createdAt: "2026-03-01T10:00:00Z",
  publishedAt: "2026-03-02T09:30:00Z",
  isDraft: false,
  isPrerelease: false,
  isLatest: true,
  description: "## Notes\n- faster",
  descriptionHTML: "<h2>Notes</h2><ul><li>faster</li></ul>",
  releaseAssets: {
    nodes: [
      { name: "web-1.2.0.zip", size: 2907697, downloadCount: 42, downloadUrl: "https://github.com/acme/web/releases/download/v1.2.0/web-1.2.0.zip" },
      { name: "web-1.2.0.sha256", size: 64, downloadCount: 3, downloadUrl: "https://github.com/acme/web/releases/download/v1.2.0/web-1.2.0.sha256" },
    ],
  },
  reactionGroups: [
    { content: "THUMBS_UP", reactors: { totalCount: 2 }, viewerHasReacted: true },
    { content: "HEART", reactors: { totalCount: 0 }, viewerHasReacted: false },
  ],
  viewerCanReact: true,
  url: "https://github.com/acme/web/releases/tag/v1.2.0",
  ...over,
});

const response = (nodes: unknown[], over: { viewerPermission?: string | null; hasNextPage?: boolean; endCursor?: string | null } = {}) => ({
  repository: {
    viewerPermission: "viewerPermission" in over ? over.viewerPermission : "WRITE",
    releases: { nodes, pageInfo: { hasNextPage: over.hasNextPage ?? false, endCursor: "endCursor" in over ? over.endCursor : null } },
  },
});

const form = (over: Partial<ReleaseForm> = {}): ReleaseForm => ({ tagName: "v1.0", target: "main", name: "First", body: "## Notes", prerelease: false, makeLatest: true, ...over });
const ctx = (over: Partial<ReleaseFormContext> = {}): ReleaseFormContext => ({ existingTags: [], releasedTags: [], ...over });

// ---------- REQ-2/3/4/5/6: the list query and its mapping ----------

describe("REQ-2: releasesQuery asks for one page of releases, newest first", () => {
  const req = (after?: string | null) => (after === undefined ? releasesQuery("acme/web") : releasesQuery("acme/web", after));
  const q = () => norm(req().query);

  it("sends owner and name as variables and a null cursor for the first page", () => {
    expect(req().variables, "Expected { owner, name, after: null } for the first page").toEqual({ owner: "acme", name: "web", after: null });
  });

  it("passes the cursor through variables.after", () => {
    expect(req("Y3Vyc29y").variables.after, "Expected the cursor in variables.after").toBe("Y3Vyc29y");
    expect(req("Y3Vyc29y").query, "Expected constant query text: the cursor must not be pasted into it").not.toContain("Y3Vyc29y");
  });

  it("reads releases 100 at a time ordered by CREATED_AT DESC, from a cursor", () => {
    expect(q(), "Expected releases(first: 100, after: $after, ...)").toMatch(/releases\([^)]*first:\s*100/);
    expect(q(), "Expected the cursor variable $after to be used").toMatch(/after:\s*\$after/);
    expect(q(), "Expected orderBy {field: CREATED_AT, direction: DESC}").toMatch(/orderBy:\s*\{\s*field:\s*CREATED_AT,\s*direction:\s*DESC\s*\}/);
  });

  it("asks for the page info and the viewer's permission", () => {
    expect(q(), "Expected pageInfo { hasNextPage endCursor }").toMatch(/pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/);
    expect(q(), "Expected repository.viewerPermission for the draft/edit/delete controls").toContain("viewerPermission");
  });

  it.each(["tagName", "name", "isDraft", "isPrerelease", "isLatest", "createdAt", "publishedAt", "description", "descriptionHTML", "databaseId", "viewerCanReact", "url", "author", "reactionGroups", "releaseAssets", "tagCommit"])(
    "selects %s on each release",
    (field) => {
      expect(q(), `Expected the query to select ${field}, which toReleasesPage maps`).toMatch(new RegExp(`\\b${field}\\b`));
    }
  );

  it("selects name, size, downloadCount and downloadUrl on each asset, and oid on the tag commit", () => {
    expect(q(), "Expected releaseAssets { nodes { name size downloadCount downloadUrl } }").toMatch(/releaseAssets\([^)]*\)\s*\{\s*nodes\s*\{[^}]*\bname\b[^}]*\bsize\b[^}]*\bdownloadCount\b[^}]*\bdownloadUrl\b/);
    expect(q(), "Expected tagCommit { oid }").toMatch(/tagCommit\s*\{\s*oid\b/);
  });

  it("selects each reaction group's content, reactors totalCount and viewerHasReacted", () => {
    expect(q(), "Expected reactionGroups { content reactors { totalCount } viewerHasReacted }").toMatch(/reactionGroups\s*\{[^}]*\bcontent\b[^}]*reactors\s*\{\s*totalCount\s*\}[^}]*viewerHasReacted/);
  });

  it("is a single query operation", () => {
    expect(q().match(/\b(query|mutation|subscription)\b\s*\w*\s*\(/g), "Expected exactly one query operation").toHaveLength(1);
  });
});

describe("REQ-2/3/4: toReleasesPage maps the releasesQuery response", () => {
  it("maps a published release field by field", () => {
    const page = toReleasesPage(response([node()], { hasNextPage: true, endCursor: "MTAw" }));
    expect(page.releases, "Expected one release").toHaveLength(1);
    const r = page.releases[0]!;
    expect(r, "Expected the scalar fields to be carried across").toMatchObject({
      id: "RE_kwDOAAA",
      databaseId: 101,
      name: "Spring release",
      tagName: "v1.2.0",
      commitOid: COMMIT,
      isDraft: false,
      isPrerelease: false,
      isLatest: true,
      description: "## Notes\n- faster",
      descriptionHTML: "<h2>Notes</h2><ul><li>faster</li></ul>",
      viewerCanReact: true,
      url: "https://github.com/acme/web/releases/tag/v1.2.0",
    });
    expect(r.author, "Expected the author's login and avatar to be carried across").toMatchObject({ login: "octocat", avatarUrl: "https://avatars.example/octocat.png" });
  });

  it("carries the page info across", () => {
    const page = toReleasesPage(response([node()], { hasNextPage: true, endCursor: "MTAw" }));
    expect(page.hasNextPage, "Expected hasNextPage from pageInfo").toBe(true);
    expect(page.endCursor, "Expected endCursor from pageInfo").toBe("MTAw");
    const last = toReleasesPage(response([node()], { hasNextPage: false, endCursor: null }));
    expect(last.hasNextPage, "Expected no further page").toBe(false);
    expect(last.endCursor, "Expected a null endCursor").toBeNull();
  });

  it("turns createdAt and publishedAt into Dates", () => {
    const r = toReleasesPage(response([node()])).releases[0]!;
    expect(r.createdAt, "Expected createdAt to be a Date").toBeInstanceOf(Date);
    expect(r.createdAt.getTime(), "Expected createdAt to be 2026-03-01T10:00:00Z").toBe(Date.parse("2026-03-01T10:00:00Z"));
    expect(r.publishedAt, "Expected publishedAt to be a Date").toBeInstanceOf(Date);
    expect(r.publishedAt?.getTime(), "Expected publishedAt to be 2026-03-02T09:30:00Z").toBe(Date.parse("2026-03-02T09:30:00Z"));
  });

  it("keeps the order GitHub returned (newest first)", () => {
    const page = toReleasesPage(response([node({ tagName: "v2", name: "Two" }), node({ tagName: "v1", name: "One", id: "RE_2", databaseId: 100 })]));
    expect(page.releases.map((r) => r.tagName), "Expected v2 then v1, as returned").toEqual(["v2", "v1"]);
  });

  it("maps assets with name, size, download count and download URL", () => {
    const r = toReleasesPage(response([node()])).releases[0]!;
    expect(r.assets, "Expected both assets, in order").toEqual([
      { name: "web-1.2.0.zip", size: 2907697, downloadCount: 42, downloadUrl: "https://github.com/acme/web/releases/download/v1.2.0/web-1.2.0.zip" },
      { name: "web-1.2.0.sha256", size: 64, downloadCount: 3, downloadUrl: "https://github.com/acme/web/releases/download/v1.2.0/web-1.2.0.sha256" },
    ]);
  });

  it("passes the reaction groups through for the reactions module", () => {
    const r = toReleasesPage(response([node()])).releases[0]!;
    expect(r.reactions, "Expected the raw reaction groups").toEqual([
      { content: "THUMBS_UP", reactors: { totalCount: 2 }, viewerHasReacted: true },
      { content: "HEART", reactors: { totalCount: 0 }, viewerHasReacted: false },
    ]);
  });

  it.each([
    ["is null", { releaseAssets: null }],
    ["has no nodes", { releaseAssets: {} }],
    ["is absent", { releaseAssets: undefined }],
  ])("gives an empty asset list when releaseAssets %s", (_label, over) => {
    expect(toReleasesPage(response([node(over)])).releases[0]!.assets, "Expected [] for a release with no assets").toEqual([]);
  });

  it.each([
    ["is null", { reactionGroups: null }],
    ["is absent", { reactionGroups: undefined }],
  ])("gives an empty reaction list when reactionGroups %s", (_label, over) => {
    expect(toReleasesPage(response([node(over)])).releases[0]!.reactions, "Expected [] for a release with no reaction groups").toEqual([]);
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
  ])("falls back to the tag name when the name is %s", (_label, name) => {
    expect(toReleasesPage(response([node({ name })])).releases[0]!.name, "Expected the title to be the tag name, as GitHub shows it").toBe("v1.2.0");
  });

  it("maps a draft: no publishedAt and no tagCommit", () => {
    const draft = node({ isDraft: true, isLatest: false, publishedAt: null, tagCommit: null, name: "Next" });
    const r = toReleasesPage(response([draft])).releases[0]!;
    expect(r.isDraft, "Expected isDraft").toBe(true);
    expect(r.publishedAt, "Expected a draft to have no publishedAt").toBeUndefined();
    expect(r.commitOid, "Expected a draft whose tag does not exist yet to have no commitOid").toBeUndefined();
    expect(r.createdAt, "Expected createdAt to still be a Date").toBeInstanceOf(Date);
  });

  it.each(["ADMIN", "MAINTAIN", "WRITE"])("lets a viewer with %s permission write", (viewerPermission) => {
    expect(toReleasesPage(response([node()], { viewerPermission })).viewerCanWrite, `Expected viewerCanWrite for ${viewerPermission}`).toBe(true);
  });

  it.each(["READ", "TRIAGE", null])("does not let a viewer with %s permission write", (viewerPermission) => {
    expect(toReleasesPage(response([node()], { viewerPermission })).viewerCanWrite, `Expected no write access for ${String(viewerPermission)}`).toBe(false);
  });

  it("maps a repository with no releases to an empty page", () => {
    const page = toReleasesPage(response([]));
    expect(page.releases, "Expected no releases").toEqual([]);
    expect(page.hasNextPage, "Expected no next page").toBe(false);
  });
});

// ---------- REQ-3: badges ----------

describe("REQ-3: releaseBadges", () => {
  const flags = (isDraft: boolean, isPrerelease: boolean, isLatest: boolean) => ({ isDraft, isPrerelease, isLatest });

  it("shows only draft for a draft, even if flagged latest and pre-release", () => {
    expect(releaseBadges(flags(true, false, false)), "Expected [draft]").toEqual(["draft"]);
    expect(releaseBadges(flags(true, true, true)), "Expected a draft flagged latest and pre-release to show only draft").toEqual(["draft"]);
  });

  it("shows only prerelease for a pre-release, never latest", () => {
    expect(releaseBadges(flags(false, true, false)), "Expected [prerelease]").toEqual(["prerelease"]);
    expect(releaseBadges(flags(false, true, true)), "Expected a pre-release flagged latest to show only prerelease").toEqual(["prerelease"]);
  });

  it("shows latest for the latest release", () => {
    expect(releaseBadges(flags(false, false, true)), "Expected [latest]").toEqual(["latest"]);
  });

  it("shows no badge for a plain release", () => {
    expect(releaseBadges(flags(false, false, false)), "Expected []").toEqual([]);
  });
});

// ---------- REQ-6: search and pages of 10 ----------

describe("REQ-6: filterReleases searches title and tag", () => {
  const list = [
    { name: "Spring Launch", tagName: "v2.0.0" },
    { name: "Hotfix", tagName: "v1.9.1-RC1" },
    { name: "Autumn", tagName: "autumn-2025" },
  ];

  it("matches the name case-insensitively", () => {
    expect(filterReleases(list, "spring").map((r) => r.tagName), "Expected 'spring' to match 'Spring Launch'").toEqual(["v2.0.0"]);
    expect(filterReleases(list, "HOTFIX").map((r) => r.tagName), "Expected 'HOTFIX' to match 'Hotfix'").toEqual(["v1.9.1-RC1"]);
  });

  it("matches the tag name case-insensitively", () => {
    expect(filterReleases(list, "rc1").map((r) => r.name), "Expected 'rc1' to match tag 'v1.9.1-RC1'").toEqual(["Hotfix"]);
    expect(filterReleases(list, "AUTUMN-20").map((r) => r.name), "Expected 'AUTUMN-20' to match tag 'autumn-2025'").toEqual(["Autumn"]);
  });

  it("matches part of a word and keeps the list order", () => {
    expect(filterReleases(list, "u").map((r) => r.name), "Expected Spring Launch then Autumn ('u' is in neither Hotfix nor its tag)").toEqual(["Spring Launch", "Autumn"]);
  });

  it("returns nothing when neither name nor tag matches", () => {
    expect(filterReleases(list, "zzz"), "Expected no matches").toEqual([]);
  });

  it.each(["", " ", "   ", "\t\n"])("returns the same items in the same order for the blank query %j", (query) => {
    expect(filterReleases(list, query), "Expected a blank query to leave the list unchanged").toEqual(list);
  });

  it("returns the items themselves, not copies", () => {
    expect(filterReleases(list, "hotfix")[0], "Expected the original object back").toBe(list[1]);
  });
});

describe("REQ-6: pageReleases pages the list ten at a time", () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1);

  it("uses a page size of 10", () => {
    expect(RELEASES_PAGE_SIZE, "Expected RELEASES_PAGE_SIZE to be 10").toBe(10);
    expect(pageReleases(items, 1).items, "Expected the default size to be 10").toHaveLength(10);
  });

  it("gives three pages for 23 items, 10 at a time", () => {
    expect(pageReleases(items, 1), "Expected page 1 of 3 with items 1 to 10").toEqual({ items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], page: 1, pageCount: 3 });
    expect(pageReleases(items, 2), "Expected page 2 of 3 with items 11 to 20").toEqual({ items: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], page: 2, pageCount: 3 });
  });

  it("gives the last page the remaining three items", () => {
    expect(pageReleases(items, 3), "Expected page 3 of 3 with items 21 to 23").toEqual({ items: [21, 22, 23], page: 3, pageCount: 3 });
  });

  it("gives exactly two pages for 20 items", () => {
    expect(pageReleases(items.slice(0, 20), 2).pageCount, "Expected a full last page not to add an empty one").toBe(2);
  });

  it.each([0, -1, -50])("clamps page %d up to page 1", (page) => {
    const r = pageReleases(items, page);
    expect(r.page, "Expected the page to clamp to 1").toBe(1);
    expect(r.items[0], "Expected the first item on the clamped page").toBe(1);
  });

  it("clamps a page past the end down to the last page", () => {
    expect(pageReleases(items, 99), "Expected page 99 to clamp to page 3").toEqual({ items: [21, 22, 23], page: 3, pageCount: 3 });
  });

  it("treats an empty list as page 1 of 1 with no items", () => {
    expect(pageReleases([], 1), "Expected one empty page").toEqual({ items: [], page: 1, pageCount: 1 });
    expect(pageReleases([], 5), "Expected an out-of-range page on an empty list to clamp to 1").toEqual({ items: [], page: 1, pageCount: 1 });
  });

  it("honours an explicit page size", () => {
    expect(pageReleases(items, 2, 5), "Expected page 2 of 5 at size 5").toEqual({ items: [6, 7, 8, 9, 10], page: 2, pageCount: 5 });
  });
});

// ---------- REQ-4/5: assets and download links ----------

describe("REQ-4: formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1229, "1.2 KB"],
    [2907697, "2.8 MB"],
    [15728640, "15 MB"],
    [1610612736, "1.5 GB"],
  ])("formats %d as %s (the doc comment's examples)", (bytes, expected) => {
    expect(formatBytes(bytes), `Expected ${bytes} bytes to read "${expected}"`).toBe(expected);
  });

  it("shows 1023 bytes as a whole number of bytes", () => {
    expect(formatBytes(1023), "Expected '1023 B': bytes stay whole below 1024").toBe("1023 B");
  });

  it("is 1024-based: 1024 bytes is 1.0 KB, one decimal place below 10 of the unit", () => {
    expect(formatBytes(1024), "Expected '1.0 KB' for 1024 bytes").toBe("1.0 KB");
    expect(formatBytes(1048576), "Expected '1.0 MB' for 1024 * 1024 bytes").toBe("1.0 MB");
    expect(formatBytes(1073741824), "Expected '1.0 GB' for 1024^3 bytes").toBe("1.0 GB");
  });

  it("drops the decimal place at 10 of the unit", () => {
    expect(formatBytes(10240), "Expected '10 KB' for 10 * 1024 bytes").toBe("10 KB");
    expect(formatBytes(10 * 1048576), "Expected '10 MB' for 10 * 1024^2 bytes").toBe("10 MB");
    expect(formatBytes(10 * 1073741824), "Expected '10 GB' for 10 * 1024^3 bytes").toBe("10 GB");
  });
});

describe("REQ-4: sourceArchives lists the two archives GitHub offers for every release", () => {
  it("names them Source code (zip) and Source code (tar.gz), in that order", () => {
    expect(sourceArchives("acme/web", "v1.0").map((a) => a.name), "Expected zip then tar.gz").toEqual(["Source code (zip)", "Source code (tar.gz)"]);
  });

  it("links them to github.com/{repo}/archive/refs/tags/{tag}", () => {
    expect(sourceArchives("acme/web", "v1.0").map((a) => a.url), "Expected the .zip and .tar.gz archive URLs").toEqual([
      "https://github.com/acme/web/archive/refs/tags/v1.0.zip",
      "https://github.com/acme/web/archive/refs/tags/v1.0.tar.gz",
    ]);
  });

  it("URL-encodes the tag per path segment, keeping the slash", () => {
    expect(sourceArchives("acme/web", "release/v1 beta").map((a) => a.url), "Expected 'release/v1%20beta' in both URLs").toEqual([
      "https://github.com/acme/web/archive/refs/tags/release/v1%20beta.zip",
      "https://github.com/acme/web/archive/refs/tags/release/v1%20beta.tar.gz",
    ]);
  });
});

// ---------- REQ-15: tag -> release link ----------

describe("REQ-15: releaseForTag finds the release for a tag", () => {
  const list = [
    { tagName: "v2.0", name: "Two" },
    { tagName: "v1.0", name: "One" },
  ];

  it("returns the release whose tag name matches", () => {
    expect(releaseForTag(list, "v1.0"), "Expected the v1.0 release").toBe(list[1]);
  });

  it("returns undefined when no release has that tag", () => {
    expect(releaseForTag(list, "v3.0"), "Expected undefined for a tag with no release").toBeUndefined();
    expect(releaseForTag([], "v1.0"), "Expected undefined for an empty list").toBeUndefined();
  });
});

// ---------- REQ-16: latest release on the Files page ----------

describe("REQ-16: latestReleaseQuery and toLatestRelease", () => {
  it("sends owner and name as variables", () => {
    expect(latestReleaseQuery("acme/web").variables, "Expected { owner, name }").toEqual({ owner: "acme", name: "web" });
  });

  it("selects latestRelease { tagName name publishedAt url }", () => {
    expect(norm(latestReleaseQuery("acme/web").query), "Expected repository { latestRelease { tagName name publishedAt url } }").toMatch(
      /latestRelease\s*\{\s*tagName\s+name\s+publishedAt\s+url\s*\}/
    );
  });

  it("maps latestRelease with a Date for publishedAt", () => {
    const latest = toLatestRelease({
      repository: { latestRelease: { tagName: "v1.2.0", name: "Spring release", publishedAt: "2026-03-02T09:30:00Z", url: "https://github.com/acme/web/releases/tag/v1.2.0" } },
    });
    expect(latest?.tagName, "Expected the tag name").toBe("v1.2.0");
    expect(latest?.name, "Expected the release name").toBe("Spring release");
    expect(latest?.url, "Expected the release URL").toBe("https://github.com/acme/web/releases/tag/v1.2.0");
    expect(latest?.publishedAt, "Expected publishedAt to be a Date").toBeInstanceOf(Date);
    expect(latest?.publishedAt.getTime(), "Expected publishedAt to be 2026-03-02T09:30:00Z").toBe(Date.parse("2026-03-02T09:30:00Z"));
  });

  it("returns undefined when the repository has no latest release", () => {
    expect(toLatestRelease({ repository: { latestRelease: null } }), "Expected undefined for a null latestRelease").toBeUndefined();
  });
});

// ---------- REQ-14: reactions ----------

describe("REQ-14: RELEASE_REACTIONS", () => {
  it("is exactly the six reactions GitHub allows on a release, in order", () => {
    expect(RELEASE_REACTIONS, "Expected +1, laugh, hooray, heart, rocket, eyes (no -1, no confused)").toEqual(["THUMBS_UP", "LAUGH", "HOORAY", "HEART", "ROCKET", "EYES"]);
  });
});

// ---------- REQ-8: the draft / edit form ----------

describe("REQ-8: validateReleaseForm", () => {
  it("accepts a valid form for a new tag", () => {
    expect(validateReleaseForm(form(), ctx()), "Expected {} for a valid form").toEqual({});
  });

  it("requires a tag", () => {
    const errors = validateReleaseForm(form({ tagName: "" }), ctx());
    expect(errors.tagName, "Expected an error on tagName when the tag is empty").toBeTruthy();
  });

  it.each(["has space", "v1..0", "-leading-dash", "bad:char", "ends.lock", "/leading", "double//slash"])("rejects the invalid ref name %j", (tagName) => {
    const check = validateRefName(tagName, []);
    expect(check.ok, `Fixture check: validateRefName should reject ${tagName}`).toBe(false);
    const errors = validateReleaseForm(form({ tagName }), ctx());
    expect(errors.tagName, `Expected an error on tagName for ${JSON.stringify(tagName)}`).toBeTruthy();
  });

  it.each(["v1.0", "release/v1", "2026.03-rc.1", "ünï-1"])("accepts the valid ref name %j", (tagName) => {
    expect(validateRefName(tagName, []).ok, `Fixture check: validateRefName should accept ${tagName}`).toBe(true);
    expect(validateReleaseForm(form({ tagName }), ctx()).tagName, `Expected no tagName error for ${JSON.stringify(tagName)}`).toBeUndefined();
  });

  it("rejects a tag that already has a release", () => {
    const errors = validateReleaseForm(form({ tagName: "v1.0" }), ctx({ existingTags: ["v1.0"], releasedTags: ["v1.0"] }));
    expect(errors.tagName, 'Expected "A release for v1.0 already exists"').toBe("A release for v1.0 already exists");
  });

  it("rejects a tag that has a draft release (drafts are in releasedTags)", () => {
    const errors = validateReleaseForm(form({ tagName: "v2.0" }), ctx({ existingTags: [], releasedTags: ["v2.0"] }));
    expect(errors.tagName, 'Expected "A release for v2.0 already exists"').toBe("A release for v2.0 already exists");
  });

  it("lets an edit keep its own tag even though that tag has a release", () => {
    const errors = validateReleaseForm(form({ tagName: "v1.0" }), ctx({ existingTags: ["v1.0"], releasedTags: ["v1.0"], editingTag: "v1.0" }));
    expect(errors, "Expected {} when editing a release and keeping its tag").toEqual({});
  });

  it("rejects an edit that moves to a tag which already has another release", () => {
    const errors = validateReleaseForm(form({ tagName: "v2.0" }), ctx({ existingTags: ["v1.0", "v2.0"], releasedTags: ["v1.0", "v2.0"], editingTag: "v1.0" }));
    expect(errors.tagName, 'Expected "A release for v2.0 already exists" when editing v1.0 onto v2.0').toBe("A release for v2.0 already exists");
  });

  it("requires a target when the tag is new", () => {
    expect(validateReleaseForm(form({ target: "" }), ctx({ existingTags: [] })).target, "Expected a target error for a new tag with no target").toBeTruthy();
    expect(validateReleaseForm(form({ target: "   " }), ctx({ existingTags: [] })).target, "Expected a target error for a new tag with a blank target").toBeTruthy();
  });

  it("does not require a target when the tag already exists", () => {
    const errors = validateReleaseForm(form({ target: "" }), ctx({ existingTags: ["v1.0"] }));
    expect(errors, "Expected {} for an existing tag with no target").toEqual({});
  });

  it("requires a target when an edit moves the release onto a new tag", () => {
    const errors = validateReleaseForm(form({ tagName: "v1.1", target: "" }), ctx({ existingTags: ["v1.0"], releasedTags: ["v1.0"], editingTag: "v1.0" }));
    expect(errors.target, "Expected a target error when the edit's tag does not exist yet").toBeTruthy();
  });

  it("accepts a name of exactly 1024 characters", () => {
    expect(validateReleaseForm(form({ name: "n".repeat(1024) }), ctx()).name, "Expected no name error at 1024 characters").toBeUndefined();
  });

  it("rejects a name over 1024 characters", () => {
    expect(validateReleaseForm(form({ name: "n".repeat(1025) }), ctx()).name, "Expected a name error at 1025 characters").toBeTruthy();
  });

  it("accepts a blank name (GitHub then shows the tag)", () => {
    expect(validateReleaseForm(form({ name: "" }), ctx()), "Expected {} for a blank name").toEqual({});
  });

  it("reports several errors at once, by field", () => {
    const errors = validateReleaseForm(form({ tagName: "bad tag", target: "", name: "n".repeat(1025) }), ctx());
    expect(Object.keys(errors).sort(), "Expected errors on tagName, target and name").toEqual(["name", "tagName", "target"]);
  });
});

describe("REQ-8: isNewTag", () => {
  it("is false when the tag exists", () => {
    expect(isNewTag({ tagName: "v1.0" }, { existingTags: ["v0.9", "v1.0"] }), "Expected an existing tag not to be new").toBe(false);
  });

  it("is true when the tag does not exist yet", () => {
    expect(isNewTag({ tagName: "v1.1" }, { existingTags: ["v0.9", "v1.0"] }), "Expected an unknown tag to be new").toBe(true);
    expect(isNewTag({ tagName: "v1.1" }, { existingTags: [] }), "Expected any tag to be new in a repo with no tags").toBe(true);
  });
});

// ---------- REQ-10/11: saving ----------

describe("REQ-10: saveReleaseRequest creates a release", () => {
  const create = (f: ReleaseForm, c: ReleaseFormContext, draft: boolean) => saveReleaseRequest("acme/web", f, c, { draft });

  it("POSTs to /repos/acme/web/releases", () => {
    const r = create(form(), ctx(), true);
    expect(r.method, "Expected POST to create").toBe("POST");
    expect(r.path, "Expected the releases collection path").toBe("/repos/acme/web/releases");
  });

  it("sends the full body for a new tag, with target_commitish, saved as a draft", () => {
    expect(create(form({ makeLatest: true }), ctx(), true).body, "Expected tag_name, target_commitish, name, body, draft, prerelease, make_latest").toEqual({
      tag_name: "v1.0",
      target_commitish: "main",
      name: "First",
      body: "## Notes",
      draft: true,
      prerelease: false,
      make_latest: "true",
    });
  });

  it("sets draft from the button pressed: false for Publish", () => {
    expect(create(form(), ctx(), false).body?.draft, "Expected draft: false when publishing").toBe(false);
    expect(create(form(), ctx(), true).body?.draft, "Expected draft: true when saving a draft").toBe(true);
  });

  it("omits target_commitish when the tag already exists", () => {
    const body = create(form(), ctx({ existingTags: ["v1.0"] }), true).body!;
    expect(body, "Expected no target_commitish key for an existing tag").not.toHaveProperty("target_commitish");
    expect(body.tag_name, "Expected the tag to be sent").toBe("v1.0");
  });

  it('sends make_latest "false" when "Set as the latest release" is off', () => {
    expect(create(form({ makeLatest: false }), ctx(), false).body?.make_latest, 'Expected make_latest "false"').toBe("false");
  });

  it('sends make_latest "false" for a pre-release even when makeLatest is on', () => {
    const body = create(form({ prerelease: true, makeLatest: true }), ctx(), false).body!;
    expect(body.prerelease, "Expected prerelease: true").toBe(true);
    expect(body.make_latest, 'Expected a pre-release to force make_latest "false"').toBe("false");
  });

  it('sends a blank name as ""', () => {
    expect(create(form({ name: "" }), ctx(), true).body?.name, 'Expected name: "" for a blank name').toBe("");
  });

  it("sends the notes body as written", () => {
    expect(create(form({ body: "line one\n\n- two" }), ctx(), true).body?.body, "Expected the markdown unchanged").toBe("line one\n\n- two");
  });
});

describe("REQ-11: saveReleaseRequest edits a release", () => {
  const editCtx = ctx({ existingTags: ["v1.0"], releasedTags: ["v1.0"], editingTag: "v1.0" });

  it("PATCHes /repos/acme/web/releases/{id} when a release id is given", () => {
    const r = saveReleaseRequest("acme/web", form(), editCtx, { draft: false, releaseId: 123 });
    expect(r.method, "Expected PATCH to edit").toBe("PATCH");
    expect(r.path, "Expected the release's own path").toBe("/repos/acme/web/releases/123");
  });

  it("sends the edited fields, without target_commitish for an existing tag", () => {
    const r = saveReleaseRequest("acme/web", form({ name: "Renamed", body: "New notes", prerelease: false, makeLatest: false }), editCtx, { draft: false, releaseId: 123 });
    expect(r.body, "Expected the edited fields and no target_commitish").toEqual({
      tag_name: "v1.0",
      name: "Renamed",
      body: "New notes",
      draft: false,
      prerelease: false,
      make_latest: "false",
    });
  });

  it("keeps a draft a draft when Save draft is pressed on an edit", () => {
    expect(saveReleaseRequest("acme/web", form(), editCtx, { draft: true, releaseId: 7 }).body?.draft, "Expected draft: true").toBe(true);
  });

  it("sends target_commitish when the edit moves the release to a tag that does not exist yet", () => {
    const r = saveReleaseRequest("acme/web", form({ tagName: "v1.1", target: "develop" }), editCtx, { draft: true, releaseId: 123 });
    expect(r.body?.target_commitish, "Expected target_commitish for a new tag on an edit").toBe("develop");
  });
});

// ---------- REQ-9: generate notes ----------

describe("REQ-9: generateNotesRequest", () => {
  it("POSTs to /repos/acme/web/releases/generate-notes", () => {
    const r = generateNotesRequest("acme/web", { tagName: "v1.0", target: "main" }, { existingTags: [] });
    expect(r.method, "Expected POST").toBe("POST");
    expect(r.path, "Expected the generate-notes path").toBe("/repos/acme/web/releases/generate-notes");
  });

  it("sends tag_name and target_commitish for a new tag, with no previous tag by default", () => {
    const r = generateNotesRequest("acme/web", { tagName: "v1.1", target: "main" }, { existingTags: ["v1.0"] });
    expect(r.body, "Expected { tag_name, target_commitish } only").toEqual({ tag_name: "v1.1", target_commitish: "main" });
  });

  it("omits target_commitish when the tag already exists", () => {
    const r = generateNotesRequest("acme/web", { tagName: "v1.0", target: "main" }, { existingTags: ["v1.0"] });
    expect(r.body, "Expected { tag_name } only for an existing tag").toEqual({ tag_name: "v1.0" });
  });

  it("sends previous_tag_name when one is given", () => {
    const r = generateNotesRequest("acme/web", { tagName: "v1.1", target: "main" }, { existingTags: ["v1.0"] }, "v1.0");
    expect(r.body, "Expected previous_tag_name alongside the others").toEqual({ tag_name: "v1.1", target_commitish: "main", previous_tag_name: "v1.0" });
  });

  it("sends previous_tag_name for an existing tag too", () => {
    const r = generateNotesRequest("acme/web", { tagName: "v1.1", target: "" }, { existingTags: ["v1.0", "v1.1"] }, "v1.0");
    expect(r.body, "Expected { tag_name, previous_tag_name }").toEqual({ tag_name: "v1.1", previous_tag_name: "v1.0" });
  });
});

describe("REQ-9: defaultPreviousTag offers the previous tag for notes", () => {
  it("returns the newest non-draft tag other than the given one", () => {
    const list = [
      { tagName: "v2.0", isDraft: false },
      { tagName: "v1.5", isDraft: false },
      { tagName: "v1.0", isDraft: false },
    ];
    expect(defaultPreviousTag(list, "v2.0"), "Expected v1.5 (v2.0 is the tag itself)").toBe("v1.5");
  });

  it("skips drafts", () => {
    const list = [
      { tagName: "v3.0", isDraft: true },
      { tagName: "v1.5", isDraft: false },
    ];
    expect(defaultPreviousTag(list, "v4.0"), "Expected the draft v3.0 to be skipped").toBe("v1.5");
  });

  it("uses the newest release when the tag has no release yet", () => {
    const list = [
      { tagName: "v1.5", isDraft: false },
      { tagName: "v1.0", isDraft: false },
    ];
    expect(defaultPreviousTag(list, "v1.6"), "Expected v1.5, the newest, for an unreleased tag").toBe("v1.5");
  });

  it("returns undefined when there is nothing to offer", () => {
    expect(defaultPreviousTag([], "v1.0"), "Expected undefined for no releases").toBeUndefined();
    expect(defaultPreviousTag([{ tagName: "v1.0", isDraft: false }], "v1.0"), "Expected undefined when the only release is the tag itself").toBeUndefined();
    expect(defaultPreviousTag([{ tagName: "v0.1", isDraft: true }], "v1.0"), "Expected undefined when the only other release is a draft").toBeUndefined();
  });
});

// ---------- REQ-11/12: edit assets and delete ----------

describe("REQ-12: deleteReleaseRequest", () => {
  it("DELETEs /repos/acme/web/releases/{id} (the tag is not touched)", () => {
    const r = deleteReleaseRequest("acme/web", 123);
    expect(r.method, "Expected DELETE").toBe("DELETE");
    expect(r.path, "Expected the release path only, not a git ref path").toBe("/repos/acme/web/releases/123");
    expect(r.body, "Expected no body").toBeUndefined();
  });
});

describe("REQ-11: asset requests for the edit form", () => {
  it("deleteAssetRequest DELETEs /repos/acme/web/releases/assets/{assetId}", () => {
    const r = deleteAssetRequest("acme/web", 555);
    expect(r.method, "Expected DELETE").toBe("DELETE");
    expect(r.path, "Expected the asset path").toBe("/repos/acme/web/releases/assets/555");
    expect(r.body, "Expected no body").toBeUndefined();
  });

  it("getReleaseRequest GETs /repos/acme/web/releases/{id}", () => {
    const r = getReleaseRequest("acme/web", 123);
    expect(r.method, "Expected GET").toBe("GET");
    expect(r.path, "Expected the release path").toBe("/repos/acme/web/releases/123");
    expect(r.body, "Expected no body").toBeUndefined();
  });

  it("restAssetIds maps asset names to REST ids", () => {
    expect(
      restAssetIds({ id: 123, assets: [{ id: 9001, name: "web.zip", size: 1 }, { id: 9002, name: "web.sha256" }] }),
      "Expected { name -> id } for each asset"
    ).toEqual({ "web.zip": 9001, "web.sha256": 9002 });
  });

  it.each([
    ["an empty list", { assets: [] }],
    ["no assets key", { id: 123 }],
  ])("restAssetIds gives {} for %s", (_label, body) => {
    expect(restAssetIds(body), "Expected {} when the release has no assets").toEqual({});
  });
});

describe("REQ-11: releaseEditUrl sends the user to GitHub's edit page to attach files", () => {
  it("builds https://github.com/{repo}/releases/edit/{tag}", () => {
    expect(releaseEditUrl("acme/web", "v1.0"), "Expected the edit page URL").toBe("https://github.com/acme/web/releases/edit/v1.0");
  });

  it("URL-encodes the tag per segment, keeping the slash", () => {
    expect(releaseEditUrl("acme/web", "release/v1 beta"), "Expected 'release/v1%20beta'").toBe("https://github.com/acme/web/releases/edit/release/v1%20beta");
    expect(releaseEditUrl("acme/web", "v1.0-é#1"), "Expected '#' and non-ASCII to be percent-encoded").toBe("https://github.com/acme/web/releases/edit/v1.0-%C3%A9%231");
  });
});

describe("defaultPreviousTag: older than the tag, in the newest-first list", () => {
  it("returns the release just below the tag", () => {
    const list = [
      { tagName: "v3.0", isDraft: false },
      { tagName: "v2.0", isDraft: false },
      { tagName: "v1.0", isDraft: false },
    ];
    expect(defaultPreviousTag(list, "v2.0"), "Expected v1.0 for v2.0, not the newer v3.0").toBe("v1.0");
  });
});

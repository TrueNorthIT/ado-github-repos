// __TN_MOCK__ Mock GraphQL answers for the Releases feature: the list, the Files page's latest release, reactions, and DELETE of a release.
// Only truenorthit/github-repos has releases (15, newest first); the other repos have none. Scenario `noReleases` empties it, `releasesFail` answers 403.
// Tags with releases: v1.2.0 (latest), v1.1.0, v1.0.0, v2.0.0-beta.1 (pre-release), v2.0.0 (DRAFT, tag does not exist), release/2025.06 (2 assets, 1 reaction mix),
// release/2025.01 (no notes), plus v0.1.0..v0.9.0 (so there are 15 and the list pages).
import { avatar } from "./fixtures/refs";
import { refsOf } from "./fixtures/refs";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const REPO = "truenorthit/github-repos";
const DAY = 86400e3;
const NOW = Date.now();
const iso = (days: number) => new Date(NOW - days * DAY).toISOString();
const person = (login: string) => ({ login, avatarUrl: avatar(login) });
const GROUPS = ["THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "CONFUSED", "HEART", "ROCKET", "EYES"];
const groups = (counts: Record<string, number>, mine: string[] = []) => GROUPS.map((c) => ({ content: c, reactors: { totalCount: counts[c] ?? 0 }, viewerHasReacted: mine.includes(c) }));
const asset = (tag: string, name: string, size: number, downloadCount: number) => ({ name, size, downloadCount, downloadUrl: `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${name}` });

interface MockRelease { [k: string]: any }
let nextId = 5000;
const make = (tagName: string, over: MockRelease): MockRelease => {
  const id = nextId++;
  const tag = refsOf(REPO).tags.find((t) => t.name === tagName);
  return {
    id: `RE_${id}`, databaseId: id, name: tagName, tagName,
    tagCommit: tag ? { oid: tag.commit } : { oid: (id.toString(16).padStart(8, "0") + "0123456789abcdef0123456789abcdef01234567").slice(0, 40) },
    author: person("ann"), createdAt: iso(10), publishedAt: iso(10),
    isDraft: false, isPrerelease: false, isLatest: false,
    description: "", descriptionHTML: "", releaseAssets: { nodes: [] }, reactionGroups: groups({}), viewerCanReact: true,
    url: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tagName)}`,
    ...over,
  };
};
const notes = (title: string, items: string[]) => ({
  description: `## ${title}\n${items.map((i) => `- ${i}`).join("\n")}`,
  descriptionHTML: `<h2>${title}</h2><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul><p>Full changelog: <a href="https://github.com/${REPO}/compare/v1.1.0...v1.2.0">v1.1.0...v1.2.0</a></p>`,
});

let releases: MockRelease[] | undefined;
const all = () =>
  (releases ??= [
    make("v2.0.0", { name: "Second major (draft)", isDraft: true, publishedAt: null, tagCommit: null, createdAt: iso(1), author: person("bob-dev"), ...notes("Draft notes", ["Work in progress"]) }),
    make("v2.0.0-beta.1", { name: "Second major, first beta", isPrerelease: true, createdAt: iso(3), author: person("bob-dev"), releaseAssets: { nodes: [asset("v2.0.0-beta.1", "app-2.0.0-beta.1.zip", 8_400_000, 17)] }, ...notes("Beta 1", ["New engine", "Breaking: config format"]) }),
    make("v1.2.0", { name: "Spring release", isLatest: true, createdAt: iso(10), reactionGroups: groups({ THUMBS_UP: 4, HEART: 2, ROCKET: 1 }, ["THUMBS_UP"]), releaseAssets: { nodes: [asset("v1.2.0", "app-1.2.0.zip", 2907697, 142), asset("v1.2.0", "app-1.2.0.sha256", 64, 31)] }, ...notes("What's new", ["Retry handling", "Login fixes", "Faster tree loading"]) }),
    make("release/2025.06", { name: "June release", createdAt: iso(40), author: person("carol"), releaseAssets: { nodes: [asset("release/2025.06", "june.tar.gz", 1229, 5), asset("release/2025.06", "june-docs.pdf", 15728640, 9)] }, reactionGroups: groups({ HOORAY: 3, EYES: 1 }), ...notes("June", ["Dependency updates"]) }),
    make("v1.1.0", { name: "v1.1.0", createdAt: iso(70), ...notes("1.1.0", ["Search improvements"]) }),
    make("release/2025.01", { name: "January release", createdAt: iso(120), author: person("carol") }), // no notes
    make("v1.0.0", { name: "First stable release", createdAt: iso(160), reactionGroups: groups({ LAUGH: 1 }), ...notes("1.0.0", ["First stable release"]) }),
    ...Array.from({ length: 9 }, (_, i) => make(`v0.${9 - i}.0`, { createdAt: iso(200 + i * 14), author: person(i % 2 ? "bob-dev" : "ann"), ...notes(`0.${9 - i}.0`, [`Early preview ${9 - i}`]) })),
  ]);

const repoOk = (v: Record<string, any>) => `${v?.owner}/${v?.name}`.toLowerCase() === REPO;

export function releasesGraphql(query: string, v: Record<string, any>, sc: string): Response | undefined {
  const react = /\b(add|remove)Reaction\(input: \$input\)/.exec(query);
  if (react && String(v.input?.subjectId).startsWith("RE_")) {
    const r = all().find((x) => x.id === v.input.subjectId);
    if (!r) return json({ data: null, errors: [{ message: "Not found" }] });
    const g = r.reactionGroups.find((x: any) => x.content === v.input.content);
    const add = react[1] === "add";
    g.viewerHasReacted = add;
    g.reactors.totalCount = Math.max(0, g.reactors.totalCount + (add ? 1 : -1));
    return json({ data: { [`${react[1]}Reaction`]: { reaction: { content: g.content }, subject: { id: r.id, reactionGroups: r.reactionGroups } } } });
  }
  const list = /releases\(first: 100/.test(query);
  const latest = /latestRelease\s*\{/.test(query);
  if (!list && !latest) return undefined;
  if (sc === "releasesFail") return new Response("{}", { status: 403 });
  const mine = repoOk(v) && sc !== "noReleases";
  if (latest) {
    const l = mine ? all().find((r) => r.isLatest) : undefined;
    return json({ data: { repository: { latestRelease: l ? { tagName: l.tagName, name: l.name, publishedAt: l.publishedAt, url: l.url } : null } } });
  }
  return json({ data: { repository: { viewerPermission: sc === "readOnly" ? "READ" : "WRITE", releases: { nodes: mine ? all() : [], pageInfo: { hasNextPage: false, endCursor: null } } } } });
}

/** DELETE /repos/{repo}/releases/{id}; returns undefined for anything else. */
export function releasesRest(repo: string, rest: string, init?: RequestInit): Response | undefined {
  const m = /^\/releases\/(\d+)$/.exec(rest);
  if (!m || init?.method !== "DELETE" || repo.toLowerCase() !== REPO) return undefined;
  releases = all().filter((r) => r.databaseId !== Number(m[1]));
  return new Response(null, { status: 204 });
}

// ---------- helpers for the form's REST mocks (src/dev/releaseFormMock.ts) ----------
const mine = (repo: string) => repo.toLowerCase() === REPO;
/** The live in-memory GraphQL release nodes (newest first); [] for other repos. */
export const releaseNodes = (repo: string): any[] => (mine(repo) ? all() : []);
/** Adds a node at the top of the list (a new release is the newest). */
export function addRelease(repo: string, node: MockRelease) {
  if (!mine(repo)) return;
  if (node.isLatest) all().forEach((r) => (r.isLatest = false));
  all().unshift(node);
}
/** Merges fields into a release; making one latest clears the flag on the others. */
export function updateRelease(repo: string, databaseId: number, patch: MockRelease) {
  if (!mine(repo)) return;
  if (patch.isLatest) all().forEach((r) => (r.isLatest = false));
  const r = all().find((x) => x.databaseId === databaseId);
  if (r) Object.assign(r, patch);
}
/** Removes one asset by name. */
export function removeAsset(repo: string, databaseId: number, assetName: string) {
  const r = mine(repo) ? all().find((x) => x.databaseId === databaseId) : undefined;
  if (r) r.releaseAssets = { nodes: r.releaseAssets.nodes.filter((a: any) => a.name !== assetName) };
}

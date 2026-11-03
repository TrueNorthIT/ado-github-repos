// __TN_MOCK__ REST mocks for the release form: create, update, generate notes, read one release (asset ids) and delete an asset.
// Scenario `releaseSaveFails` makes save, generate-notes and asset delete answer 422 with GitHub's message (REQ-18: the form keeps the input);
// `releaseNoAccess` answers 403 (REQ-13). Releases live in releasesMock.ts, so the list shows what the form saved.
import { addRelease, releaseNodes, removeAsset, updateRelease } from "./releasesMock";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let nextId = 9000;
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** A REST asset id that survives other assets being deleted. */
const assetId = (releaseId: number, name: string) => releaseId * 1000 + (hash(name) % 1000);

const fail = (sc: string): Response | undefined =>
  sc === "releaseSaveFails" ? json({ message: "Validation Failed: tag_name is not a valid tag name for this repository" }, 422)
    : sc === "releaseNoAccess" ? json({ message: "Resource not accessible by personal access token" }, 403)
    : undefined;

/** Fields of the REST body mapped onto the GraphQL node the list reads. */
function toNode(b: Record<string, any>): Record<string, any> {
  const draft = !!b.draft;
  return {
    tagName: b.tag_name, name: b.name || b.tag_name, description: b.body ?? "", descriptionHTML: `<p>${String(b.body ?? "").replace(/</g, "&lt;")}</p>`,
    isDraft: draft, isPrerelease: !!b.prerelease, isLatest: !draft && !b.prerelease && b.make_latest !== "false",
    ...(draft ? {} : { publishedAt: new Date().toISOString() }),
  };
}

export function releaseFormRest(repo: string, rest: string, init: RequestInit | undefined, sc: string): Response | undefined {
  const method = init?.method ?? "GET";
  const body = () => JSON.parse(String(init?.body ?? "{}"));
  if (rest === "/releases" && method === "POST") {
    const bad = fail(sc);
    if (bad) return bad;
    const b = body();
    const id = nextId++;
    const node = {
      id: `RE_${id}`, databaseId: id, author: { login: "ann", avatarUrl: "" }, createdAt: new Date().toISOString(), publishedAt: null,
      tagCommit: b.target_commitish ? null : { oid: "0".repeat(40) }, releaseAssets: { nodes: [] }, reactionGroups: [], viewerCanReact: true,
      url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(b.tag_name)}`, ...toNode(b),
    };
    addRelease(repo, node);
    return json({ id, tag_name: b.tag_name, draft: !!b.draft }, 201);
  }
  const one = /^\/releases\/(\d+)$/.exec(rest);
  if (one && method === "PATCH") {
    const bad = fail(sc);
    if (bad) return bad;
    const id = Number(one[1]);
    updateRelease(repo, id, toNode(body()));
    return json({ id });
  }
  if (one && method === "GET") {
    const r = releaseNodes(repo).find((x) => x.databaseId === Number(one[1]));
    return r ? json({ id: r.databaseId, tag_name: r.tagName, assets: r.releaseAssets.nodes.map((a: any) => ({ id: assetId(r.databaseId, a.name), name: a.name })) }) : json({ message: "Not Found" }, 404);
  }
  if (rest === "/releases/generate-notes" && method === "POST") {
    const bad = fail(sc);
    if (bad) return bad;
    const b = body();
    const from = b.previous_tag_name ?? "the previous release";
    return json({ name: `Release ${b.tag_name}`, body: `## What's Changed\n* Fix login redirect by @ann in #412\n* Add retry handling to the sync job by @bob-dev in #418\n\n**Full Changelog**: https://github.com/${repo}/compare/${from}...${b.tag_name}` });
  }
  const del = /^\/releases\/assets\/(\d+)$/.exec(rest);
  if (del && method === "DELETE") {
    const bad = fail(sc);
    if (bad) return bad;
    const id = Number(del[1]);
    const r = releaseNodes(repo).find((x) => x.databaseId === Math.floor(id / 1000));
    const a = r?.releaseAssets.nodes.find((x: any) => assetId(r.databaseId, x.name) === id);
    if (!r || !a) return json({ message: "Not Found" }, 404);
    removeAsset(repo, r.databaseId, a.name);
    return new Response(null, { status: 204 });
  }
  return undefined;
}

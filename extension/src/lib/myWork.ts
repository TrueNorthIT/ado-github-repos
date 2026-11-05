// The "GitHub" tab in Azure DevOps's My work flyout (src/myWorkTab.tsx): the viewer's open pull requests across every repository the
// GitHub App can see. REST /search/issues, not GraphQL, so it also works where GraphQL is refused (cloud sessions' egress proxy).
export type MyWorkSection = "created" | "review-requested";

export const MY_WORK_SECTIONS: { id: MyWorkSection; title: string; qualifier: string }[] = [
  { id: "created", title: "Created by me", qualifier: "author:@me" },
  { id: "review-requested", title: "Review requested", qualifier: "review-requested:@me" },
];

// Search answers come back before the connected-repos filter, so ask for a full page (GitHub's maximum).
export const MY_WORK_PAGE = 100;

/** GET path of one section's search: open pull requests, newest activity first. */
export function myWorkSearchPath(section: MyWorkSection): string {
  const q = `is:pr is:open archived:false ${MY_WORK_SECTIONS.find((s) => s.id === section)!.qualifier}`;
  return `/search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=${MY_WORK_PAGE}`;
}

export interface MyWorkRow {
  repo: string; // owner/name
  number: number;
  title: string;
  url: string;
  draft: boolean;
  authorLogin: string;
  avatarUrl?: string;
  updatedAt: Date;
}

/** One search answer as rows; items that are not pull requests, or whose repository can't be read, are dropped. */
export function toMyWorkRows(body: { total_count?: number; items?: any[] }): { total: number; rows: MyWorkRow[] } {
  const rows: MyWorkRow[] = [];
  for (const it of body.items ?? []) {
    const repo = /\/repos\/([^/]+\/[^/]+)$/.exec(String(it?.repository_url ?? ""))?.[1];
    if (!repo || !it.pull_request || typeof it.number !== "number") continue;
    rows.push({
      repo,
      number: it.number,
      title: String(it.title ?? ""),
      url: String(it.html_url ?? `https://github.com/${repo}/pull/${it.number}`),
      draft: !!it.draft,
      authorLogin: it.user?.login ?? "ghost",
      avatarUrl: it.user?.avatar_url,
      updatedAt: new Date(it.updated_at ?? it.created_at ?? 0),
    });
  }
  return { total: typeof body.total_count === "number" ? body.total_count : rows.length, rows };
}

// ---------- which ADO projects connect each repository ----------

/** One project's connected repositories ("owner/name", github.com only), as found by listing its GitHub connections. */
export interface ProjectRepos {
  project: string;
  repos: string[];
}

/** github.com repositories of a project's connections, as "owner/name" (case kept), deduplicated. */
export function connectedRepos(connections: { repos: { gitHubRepositoryUrl?: string }[] }[]): string[] {
  const seen = new Map<string, string>();
  for (const c of connections)
    for (const r of c.repos) {
      const m = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(r.gitHubRepositoryUrl?.trim() ?? "");
      if (m) seen.set(`${m[1]}/${m[2]}`.toLowerCase(), `${m[1]}/${m[2]}`);
    }
  return [...seen.values()];
}

/** Lower-cased "owner/name" → the projects that connect it, in project order. */
export function projectIndex(list: ProjectRepos[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of list)
    for (const r of p.repos) {
      const k = r.toLowerCase();
      const ps = out.get(k) ?? [];
      if (!ps.includes(p.project)) ps.push(p.project);
      out.set(k, ps);
    }
  return out;
}

export type ConnectedRow = MyWorkRow & { projects: string[] };

/** Keeps the rows whose repository a project connects (an Azure Boards GitHub connection), with those projects. */
export const onlyConnected = (rows: MyWorkRow[], index: Map<string, string[]>): ConnectedRow[] =>
  rows.flatMap((r) => {
    const projects = index.get(r.repo.toLowerCase());
    return projects?.length ? [{ ...r, projects }] : [];
  });

// The project scan costs a request per project and per connection, so it is kept per organisation and refreshed in the background.
export const PROJECT_CACHE_TTL = 30 * 60e3;
export interface ProjectCache { at: number; list: ProjectRepos[] }

/** A stored scan, if it reads back as one; `fresh` says whether it is young enough to skip the background refresh. */
export function readProjectCache(raw: string | null, now: number): { list: ProjectRepos[]; fresh: boolean } | undefined {
  try {
    const c = JSON.parse(raw ?? "") as ProjectCache;
    if (typeof c?.at !== "number" || !Array.isArray(c.list)) return undefined;
    if (!c.list.every((p) => typeof p?.project === "string" && Array.isArray(p.repos) && p.repos.every((r) => typeof r === "string"))) return undefined;
    return { list: c.list, fresh: now - c.at < PROJECT_CACHE_TTL };
  } catch {
    return undefined;
  }
}

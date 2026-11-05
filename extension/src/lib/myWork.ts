// The "GitHub" tab in Azure DevOps's My work flyout (src/myWorkTab.tsx): the viewer's open pull requests across every repository the
// GitHub App can see. REST /search/issues, not GraphQL, so it also works where GraphQL is refused (cloud sessions' egress proxy).
export type MyWorkSection = "created" | "review-requested";

export const MY_WORK_SECTIONS: { id: MyWorkSection; title: string; qualifier: string }[] = [
  { id: "created", title: "Created by me", qualifier: "author:@me" },
  { id: "review-requested", title: "Review requested", qualifier: "review-requested:@me" },
];

export const MY_WORK_PAGE = 20;

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

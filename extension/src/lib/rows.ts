import { parseRepoUrl, repoKey, isGitHubDotCom } from "./repoUrl";

export interface Connection {
  id: string;
  isConnectionValid?: boolean;
  /** Set when fetching this connection's repos failed. */
  fetchError?: string;
  repos: { gitHubRepositoryUrl?: string; errorMessage?: string }[];
}

export interface RepoMeta {
  description: string | null;
  language: string | null;
  private: boolean;
  pushedAt: string | null;
}

/** Outcome of the GitHub metadata call for one repo. */
export type MetaResult = { ok: true; meta: RepoMeta } | { ok: false; status: number };

export interface Row {
  key: string;
  label: string; // owner/repo
  url: string;
  /** undefined: no metadata (signed out, not github.com, or failed). */
  meta?: RepoMeta;
  /** true: GitHub said 404/403 for this signed-in user. */
  unavailable: boolean;
}

export interface Merged {
  rows: Row[];
  warnings: string[];
}

export function mergeRows(connections: Connection[], metadata?: Record<string, MetaResult>): Merged {
  const byKey = new Map<string, Row>();
  const warnings: string[] = [];
  connections.forEach((c, i) => {
    const n = i + 1;
    if (c.isConnectionValid === false) warnings.push(`Connection ${n} is no longer valid.`);
    if (c.fetchError) warnings.push(`Connection ${n}: ${c.fetchError}`);
    for (const r of c.repos) {
      if (r.errorMessage) warnings.push(`Connection ${n}: ${r.errorMessage}`);
      const ref = parseRepoUrl(r.gitHubRepositoryUrl);
      if (!ref) continue;
      const key = repoKey(ref);
      if (byKey.has(key)) continue;
      const m = metadata?.[key];
      byKey.set(key, {
        key,
        label: `${ref.owner}/${ref.repo}`,
        url: `https://${ref.host}/${ref.owner}/${ref.repo}`,
        meta: m && m.ok ? m.meta : undefined,
        unavailable: !!m && !m.ok && (m.status === 404 || m.status === 403) && isGitHubDotCom(ref),
      });
    }
  });
  const rows = [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  return { rows, warnings: [...new Set(warnings)] };
}

export function filterRows(rows: Row[], text: string): Row[] {
  const t = text.trim().toLowerCase();
  return t ? rows.filter((r) => r.label.toLowerCase().includes(t)) : rows;
}

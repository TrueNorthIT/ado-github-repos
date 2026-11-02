import { parseRepoUrl, isGitHubDotCom, repoKey } from "./lib/repoUrl";
import type { MetaResult } from "./lib/rows";

async function one(owner: string, repo: string, token: string): Promise<MetaResult> {
  try {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const j = await res.json();
    return { ok: true, meta: { description: j.description, language: j.language, private: !!j.private, pushedAt: j.pushed_at } };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Metadata for github.com repos, keyed by repoKey. ponytail: unbounded parallelism; add a pool if a project has hundreds of repos. */
export async function fetchMetadata(urls: string[], token: string): Promise<Record<string, MetaResult>> {
  const out: Record<string, MetaResult> = {};
  await Promise.all(
    urls.map(async (u) => {
      const ref = parseRepoUrl(u);
      if (ref && isGitHubDotCom(ref)) out[repoKey(ref)] = await one(ref.owner, ref.repo, token);
    })
  );
  return out;
}

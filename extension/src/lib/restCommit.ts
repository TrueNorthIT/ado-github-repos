// REST commit (compare `commits[]`) to the Commits list's row, for a push's expanded commits. No PR or check status: REST does not carry them.
import { GHOST_AVATAR, type CommitRow } from "./commitsQuery";

export interface RestCommit {
  sha: string;
  commit: { message: string; author?: { name?: string; date?: string } | null; committer?: { date?: string } | null };
  author?: { login: string; avatar_url: string } | null;
  parents?: { sha: string }[];
}

export function mapRestCommit(c: RestCommit): CommitRow {
  const message = c.commit.message ?? "";
  const authored = new Date(c.commit.author?.date ?? c.commit.committer?.date ?? 0);
  return {
    sha: c.sha,
    shortSha: c.sha.slice(0, 8),
    title: message.split("\n")[0],
    message,
    author: c.author
      ? { name: c.commit.author?.name ?? c.author.login, login: c.author.login, avatarUrl: c.author.avatar_url }
      : { name: c.commit.author?.name ?? "ghost", login: c.commit.author?.name ? null : "ghost", avatarUrl: GHOST_AVATAR },
    date: authored,
    committedDate: new Date(c.commit.committer?.date ?? authored),
    parents: (c.parents ?? []).map((p) => p.sha),
    prNumber: null,
    status: null,
  };
}

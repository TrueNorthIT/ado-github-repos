// The branch comparison page's data: REST `/repos/{o}/{r}/compare/{base}...{head}` (commitDetail.comparePath), mapped to the Commits table's rows.
// Facts from the live API (TrueNorthIT/TrueTunes): ahead_by, behind_by, status, total_commits and commits (OLDEST first) come on every page;
// commits carry sha, commit.message, commit.author { name date }, commit.committer { date }, author { login avatar_url } | null and parents [{ sha }].
// The compare endpoint carries no PR or check status, so those cells of the table stay empty.
import { GHOST_AVATAR, type CommitRow } from "./commitsQuery";

export interface RestCompareCommit {
  sha: string;
  commit?: { message?: string; author?: { name?: string; date?: string } | null; committer?: { date?: string } | null };
  author?: { login?: string; avatar_url?: string } | null;
  parents?: { sha: string }[];
}

export interface RestComparePage {
  ahead_by?: number;
  behind_by?: number;
  status?: string;
  total_commits?: number;
  commits?: RestCompareCommit[];
}

export interface BranchCompare {
  ahead: number;
  behind: number;
  status: string;
  total: number;
  /** Newest first. */
  commits: CommitRow[];
}

/** REST commits (oldest first) as rows, newest first. */
export function mapCompareCommits(commits: RestCompareCommit[] | undefined): CommitRow[] {
  return (commits ?? [])
    .map((c): CommitRow => {
      const message = c.commit?.message ?? "";
      const authored = c.commit?.author?.date ?? c.commit?.committer?.date ?? 0;
      return {
        sha: c.sha,
        shortSha: c.sha.slice(0, 8),
        title: message.split("\n")[0],
        message,
        author: { name: c.commit?.author?.name ?? c.author?.login ?? "ghost", login: c.author?.login ?? null, avatarUrl: c.author?.avatar_url ?? GHOST_AVATAR },
        date: new Date(authored),
        committedDate: new Date(c.commit?.committer?.date ?? authored),
        parents: (c.parents ?? []).map((p) => p.sha),
        prNumber: null,
        status: null,
      };
    })
    .reverse();
}

/** The counts from the first page, the commits of every page. Throws for no pages. */
export function mergeCompare(pages: RestComparePage[]): BranchCompare {
  if (!pages.length) throw new Error("No pages");
  const first = pages[0];
  return {
    ahead: first.ahead_by ?? 0,
    behind: first.behind_by ?? 0,
    status: first.status ?? "identical",
    total: first.total_commits ?? 0,
    commits: mapCompareCommits(pages.flatMap((p) => p.commits ?? [])),
  };
}

const commits = (n: number) => `${n} commit${n === 1 ? "" : "s"}`;

/** "feat is 3 commits ahead of and 1 commit behind main." */
export function compareSummary(base: string, head: string, ahead: number, behind: number): string {
  if (!ahead && !behind) return `${head} and ${base} are identical.`;
  if (!behind) return `${head} is ${commits(ahead)} ahead of ${base}.`;
  if (!ahead) return `${head} is ${commits(behind)} behind ${base}.`;
  return `${head} is ${commits(ahead)} ahead of and ${commits(behind)} behind ${base}.`;
}

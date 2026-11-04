// Cherry-pick and Revert (native ADO: a commit's ⋯ menu and a completed pull request's ⋯ menu). Both put the change on a NEW topic branch
// made from a target branch, then offer a pull request into the target.
//
// GitHub has no cherry-pick or revert API, so it is built from REST Git data plus the merges API. To apply the change `from → to` onto
// the target's head H:
//  1. X = `to` itself when its only parent is `from` (a plain cherry-pick), else a new commit with to's tree and parent `from` (a revert,
//     or a merge commit picked against a mainline other than its first parent). Either way merge-base(X, S) below is exactly `from`.
//  2. S = a new commit with H's tree and parent `from`, and a temporary branch `tmp/…` created AT S (never a force-update of anything).
//  3. POST /merges with base = the temporary branch and head = X: GitHub does the three-way merge (base `from`, ours H's tree, theirs
//     to's tree) and answers with a merge commit M whose tree is H plus the change, or 409 on a conflict. (A revert can't simply merge
//     C's parent into a branch whose parent is C: that parent is already an ancestor, so GitHub would answer 204 "nothing to merge".)
//  4. F = a new commit with M's tree, parent H, the cherry-pick or revert message and (for a cherry-pick) the original author.
//  5. The topic branch is created at F. The temporary branch is deleted in a finally, whatever happened.
// Nothing is ever written to an existing branch. A conflict can't be resolved here; GitHub doesn't say which files clash.
import type { RestRequest } from "./restRequest";

export type PickKind = "cherryPick" | "revert";

export interface GitPerson { name: string; email: string; date?: string }

/** The fields of REST `GET /git/commits/{sha}` that are used. */
export interface GitCommit {
  sha: string;
  tree: string;
  parents: string[];
  message: string;
  author?: GitPerson;
}

export function toGitCommit(raw: any): GitCommit {
  return {
    sha: String(raw?.sha ?? ""),
    tree: String(raw?.tree?.sha ?? ""),
    parents: (raw?.parents ?? []).map((p: any) => String(p.sha)),
    message: String(raw?.message ?? ""),
    ...(raw?.author?.name ? { author: { name: raw.author.name, email: raw.author.email ?? "", ...(raw.author.date && { date: raw.author.date }) } } : {}),
  };
}

export const shortSha = (sha: string) => sha.slice(0, 8);
export const subjectOf = (message: string) => message.split("\n")[0].trim();
export const KIND_LABEL: Record<PickKind, string> = { cherryPick: "Cherry-pick", revert: "Revert" };
const SLUG: Record<PickKind, string> = { cherryPick: "cherry-pick", revert: "revert" };

/** Native's default topic branch: `<target>-cherry-pick-<short>` (or `-revert-`); `-2`, `-3`… when that name is taken. `label` is a short sha or `pr-<n>`. */
export function defaultTopicBranch(kind: PickKind, target: string, label: string, existing: Iterable<string> = []): string {
  const taken = new Set(existing);
  const base = `${target}-${SLUG[kind]}-${label}`;
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** The temporary branch the merge runs on. `rand` keeps two runs apart. */
export const tempBranchName = (kind: PickKind, sha: string, rand: string) => `tmp/${SLUG[kind]}-${shortSha(sha)}-${rand}`;
export const randomSuffix = (r: () => number = Math.random) => Math.floor(r() * 36 ** 6).toString(36).padStart(6, "0");

/** git's own messages: the original plus "(cherry picked from commit …)", or `Revert "<subject>"` with "This reverts commit …". */
export function pickMessage(kind: PickKind, c: Pick<GitCommit, "sha" | "message">): string {
  if (kind === "revert") return `Revert "${subjectOf(c.message)}"\n\nThis reverts commit ${c.sha}.`;
  return `${c.message.trimEnd()}\n\n(cherry picked from commit ${c.sha})`;
}

/** A merged pull request's cherry-pick message: its title and number, as GitHub's squash merge words it, plus the cherry-pick line. */
export const prPickMessage = (title: string, number: number, mergeSha: string) => `${title.trim()} (#${number})\n\n(cherry picked from commit ${mergeSha})`;

export class PickError extends Error {
  constructor(public code: "conflict" | "exists" | "nothingToPick" | "rootCommit" | "mainline" | "access" | "targetMissing" | "other", message: string) {
    super(message);
  }
}

/** The change to apply, as `from → to`: a cherry-pick applies parent → commit, a revert commit → parent. A merge commit needs `mainline` (1-based, as `git cherry-pick -m`). */
export function pickRange(kind: PickKind, c: Pick<GitCommit, "sha" | "parents">, mainline?: number): { from: string; to: string } {
  if (!c.parents.length) throw new PickError("rootCommit", `The first commit in a repository has no parent, so it can't be ${kind === "revert" ? "reverted" : "cherry-picked"} from here.`);
  if (c.parents.length > 1 && !mainline) throw new PickError("mainline", "This is a merge commit. Choose which parent is the mainline.");
  const m = c.parents.length > 1 ? mainline! : 1;
  const parent = c.parents[m - 1];
  if (!parent) throw new PickError("mainline", `This commit has no parent ${m}.`);
  return kind === "cherryPick" ? { from: parent, to: c.sha } : { from: c.sha, to: parent };
}

/** How a merged pull request landed, from its merge commit: a merge commit (pick with mainline 1), a squash (one commit) or a rebase of `count` commits. */
export type PrLanding = { how: "merge" } | { how: "squash" } | { how: "rebase"; count: number };

/** GitHub's REST doesn't say which merge method was used. Two parents: a merge commit. One parent and one PR commit, or a message unlike
 *  the PR's last commit: a squash. Otherwise a rebase (the rebased commits keep their messages), and its first commit's parent is `count` back. */
export function prLanding(merge: Pick<GitCommit, "parents" | "message">, prCommits: number, lastPrCommitMessage: string | undefined): PrLanding {
  if (merge.parents.length > 1) return { how: "merge" };
  if (prCommits <= 1 || lastPrCommitMessage === undefined || lastPrCommitMessage.trim() !== merge.message.trim()) return { how: "squash" };
  return { how: "rebase", count: prCommits };
}

/** A rebase-merged pull request is walked back one first parent per commit; past this it is refused. */
export const MAX_REBASE_WALK = 100;

// ---------- the REST calls ----------

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
export const branchRefRequest = (repo: string, branch: string): RestRequest => ({ method: "GET", path: `/repos/${repo}/git/ref/heads/${enc(branch)}` });
export const gitCommitRequest = (repo: string, sha: string): RestRequest => ({ method: "GET", path: `/repos/${repo}/git/commits/${encodeURIComponent(sha)}` });
export function createCommitRequest(repo: string, p: { message: string; tree: string; parents: string[]; author?: GitPerson }): RestRequest {
  const body: Record<string, unknown> = { message: p.message, tree: p.tree, parents: p.parents };
  if (p.author) body.author = p.author;
  return { method: "POST", path: `/repos/${repo}/git/commits`, body };
}
export const createRefRequest = (repo: string, branch: string, sha: string): RestRequest => ({ method: "POST", path: `/repos/${repo}/git/refs`, body: { ref: `refs/heads/${branch}`, sha } });
/** Deletes a branch. Only ever called for the temporary `tmp/…` branch; refuses anything else. */
export function deleteTempRefRequest(repo: string, branch: string): RestRequest {
  if (!branch.startsWith("tmp/")) throw new Error("Only a temporary branch may be deleted here");
  return { method: "DELETE", path: `/repos/${repo}/git/refs/heads/${enc(branch)}` };
}
export const mergeRequest = (repo: string, base: string, head: string, message: string): RestRequest => ({ method: "POST", path: `/repos/${repo}/merges`, body: { base, head, commit_message: message } });
export const pullRestRequest = (repo: string, number: number): RestRequest => ({ method: "GET", path: `/repos/${repo}/pulls/${number}` });
export const pullCommitsRequest = (repo: string, number: number): RestRequest => ({ method: "GET", path: `/repos/${repo}/pulls/${number}/commits?per_page=100` });
export const canPushRequest = (repo: string): RestRequest => ({ method: "GET", path: `/repos/${repo}` });

// ---------- running it ----------

export type PickStep = "prepare" | "apply" | "commit" | "branch";
export const STEP_TEXT: Record<PickStep, string> = {
  prepare: "Reading the target branch…",
  apply: "Applying the changes…",
  commit: "Creating the commit…",
  branch: "Creating the topic branch…",
};

/** A failed call's HTTP status, from whatever the sender threw (GhError carries `status`). */
const statusOf = (e: unknown): number => (typeof (e as any)?.status === "number" ? (e as any).status : 0);

/** Words a failure of `step` for the dialog. Errors that aren't HTTP failures (sign-in, rate limit) are passed on for the caller to word. */
export function pickErrorFor(e: unknown, step: "target" | "merge" | "topic" | "other", ctx: { kind: PickKind; target: string; topic: string }): unknown {
  if (e instanceof PickError) return e;
  const s = statusOf(e);
  const verb = ctx.kind === "revert" ? "reverted" : "cherry-picked";
  if (step === "target" && s === 404) return new PickError("targetMissing", `The branch ${ctx.target} doesn't exist any more.`);
  if (step === "merge" && s === 409)
    return new PickError("conflict", `The changes can't be ${verb} onto ${ctx.target} cleanly: they conflict with changes already there. GitHub doesn't say which files conflict. Do it locally with git ${ctx.kind === "revert" ? "revert" : "cherry-pick"}, resolve the conflicts and push a branch.`);
  if (step === "topic" && s === 422) return new PickError("exists", `A branch called ${ctx.topic} already exists. Choose another name.`);
  if (s === 403 || s === 404) return new PickError("access", "Your GitHub sign-in isn't allowed to write to this repository.");
  return e;
}

/** Sends one REST call; answers the parsed body, or undefined for 204. Throws (with a numeric `status`) on failure. */
export type PickSend = (r: RestRequest) => Promise<any>;

export interface PickRun {
  repo: string;
  kind: PickKind;
  /** The change to apply (pickRange, or a pull request's base → merge commit). */
  range: { from: string; to: string };
  message: string;
  /** The final commit's author (a cherry-pick keeps the original's); omitted: the signed-in user. */
  author?: GitPerson;
  target: string;
  topic: string;
  /** The temporary branch (tempBranchName). */
  temp: string;
  onStep?: (s: PickStep) => void;
}

/** Runs the steps in the header comment; answers the topic branch's new commit. The temporary branch is always deleted afterwards. */
export async function runPick(send: PickSend, p: PickRun): Promise<{ branch: string; sha: string; base: string }> {
  const ctx = { kind: p.kind, target: p.target, topic: p.topic };
  const at = async <T>(step: Parameters<typeof pickErrorFor>[1], f: () => Promise<T>): Promise<T> => {
    try { return await f(); } catch (e) { throw pickErrorFor(e, step, ctx); }
  };
  p.onStep?.("prepare");
  const head: string = await at("target", async () => (await send(branchRefRequest(p.repo, p.target)))?.object?.sha);
  if (!head) throw new PickError("targetMissing", `The branch ${p.target} doesn't exist any more.`);
  const [h, to] = await at("other", () => Promise.all([send(gitCommitRequest(p.repo, head)), send(gitCommitRequest(p.repo, p.range.to))]).then((v) => v.map(toGitCommit)));

  p.onStep?.("apply");
  const plain = to.parents.length === 1 && to.parents[0] === p.range.from;
  const theirs = plain ? to.sha : toGitCommit(await at("other", () => send(createCommitRequest(p.repo, { message: "Temporary commit for a cherry-pick", tree: to.tree, parents: [p.range.from] })))).sha;
  const ours = toGitCommit(await at("other", () => send(createCommitRequest(p.repo, { message: "Temporary commit for a cherry-pick", tree: h.tree, parents: [p.range.from] }))));
  await at("other", () => send(createRefRequest(p.repo, p.temp, ours.sha)));
  try {
    const merged = await at("merge", () => send(mergeRequest(p.repo, p.temp, theirs, "Temporary merge for a cherry-pick")));
    const tree: string | undefined = merged?.commit?.tree?.sha;
    if (!tree || tree === h.tree)
      throw new PickError("nothingToPick", `${p.target} already has these changes, so there is nothing to ${p.kind === "revert" ? "revert" : "cherry-pick"}.`);

    p.onStep?.("commit");
    const final = toGitCommit(await at("other", () => send(createCommitRequest(p.repo, { message: p.message, tree, parents: [head], ...(p.author && { author: p.author }) }))));

    p.onStep?.("branch");
    await at("topic", () => send(createRefRequest(p.repo, p.topic, final.sha)));
    return { branch: p.topic, sha: final.sha, base: head };
  } finally {
    await send(deleteTempRefRequest(p.repo, p.temp)).catch(() => {});
  }
}

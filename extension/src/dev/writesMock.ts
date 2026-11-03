// __TN_MOCK__ Mock GitHub answers for the web editor: the write-context query, createCommitOnBranch and createRef for branches.
// Writes change shared state, so a reload shows them: the tree (repo.files) and the file bytes (served by writtenFile). The mock keeps one copy of the files per repo, not one per branch.
// Scenarios: `readOnlyViewer` (permission READ, so the edit actions are hidden and a commit is refused) and `staleHead` (the first commit finds the branch has moved).
import { repoOf } from "./fixtures/repos";
import { refsOf } from "./fixtures/refs";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const notFound = (message: string) => json({ data: null, errors: [{ type: "NOT_FOUND", message }] });
const REPO_ID = (fullName: string) => `REPO_${fullName.toLowerCase()}`;

const heads = new Map<string, string>();
const written = new Map<string, Uint8Array>();
let counter = 0;
let staleFired = false;
const newOid = () => `9e1${String(++counter).padStart(37, "0")}`;
const headKey = (repo: string, branch: string) => `${repo.toLowerCase()}|${branch}`;

/** The branch's head oid; a branch without its own fixture tip starts at the main tip. undefined for a name that is not a branch. */
export function headOf(repo: string, branch: string): string | undefined {
  const r = repoOf(repo);
  if (!r || !r.branches.includes(branch)) return undefined;
  const k = headKey(repo, branch);
  if (!heads.has(k)) {
    const rr = refsOf(repo);
    heads.set(k, rr.branches.find((b) => b.name === branch)?.tip ?? rr.main);
  }
  return heads.get(k);
}

/** Bytes written through the editor, upload or rename for a path; undefined when it was never written. */
export const writtenFile = (repo: string, path: string): Uint8Array | undefined => written.get(`${repo.toLowerCase()}|${path}`);

const fromBase64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

export function writesGraphql(query: string, v: Record<string, any>, sc: string): Response | undefined {
  if (!/^\s*mutation\b/.test(query) && query.includes("qualifiedName: $qualifiedName")) {
    const full = `${v.owner}/${v.name}`;
    const r = repoOf(full);
    if (!r || r.missing) return notFound("Could not resolve to a Repository");
    const branch = String(v.qualifiedName).replace(/^refs\/heads\//, "");
    const oid = String(v.qualifiedName).startsWith("refs/heads/") ? headOf(full, branch) : undefined;
    return json({ data: { repository: { id: REPO_ID(r.fullName), viewerPermission: sc === "readOnlyViewer" ? "READ" : "ADMIN", ref: oid ? { target: { oid } } : null } } });
  }

  if (/\bcreateCommitOnBranch\(input: \$input\)/.test(query)) {
    if (sc === "readOnlyViewer") return json({ data: null, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }] });
    const { branch, expectedHeadOid, message, fileChanges } = v.input;
    const full = String(branch.repositoryNameWithOwner);
    const r = repoOf(full);
    const head = headOf(full, branch.branchName);
    if (!r || !head) return notFound(`Could not resolve to a Ref with the name '${branch.branchName}'.`);
    if (sc === "staleHead" && !staleFired) {
      staleFired = true;
      heads.set(headKey(full, branch.branchName), newOid()); // someone else pushed
    }
    if (expectedHeadOid !== heads.get(headKey(full, branch.branchName)))
      return json({ data: { createCommitOnBranch: null }, errors: [{ type: "UNPROCESSABLE", message: `Expected branch to point to "${expectedHeadOid}" but it did not. Pull and try again.` }] });
    for (const a of fileChanges?.additions ?? []) {
      const bytes = fromBase64(a.contents);
      written.set(`${full.toLowerCase()}|${a.path}`, bytes);
      r.files[a.path] = { size: bytes.length };
    }
    for (const d of fileChanges?.deletions ?? []) {
      written.delete(`${full.toLowerCase()}|${d.path}`);
      delete r.files[d.path];
    }
    const oid = newOid();
    heads.set(headKey(full, branch.branchName), oid);
    return json({ data: { createCommitOnBranch: { commit: { oid, url: `https://github.com/${full}/commit/${oid}`, headline: message.headline }, ref: { name: branch.branchName, target: { oid } } } } });
  }

  // A new branch (also from a commit, for the Commits actions). Tags and the REF_ deletes stay with refsMock.
  if (/\bcreateRef\(input: \$input\)/.test(query) && String(v.input?.name).startsWith("refs/heads/")) {
    if (sc === "refsFail") return new Response("{}", { status: 403 });
    const { repositoryId, name, oid } = v.input;
    const full = String(repositoryId).replace(/^REPO_/, "");
    const r = repoOf(full);
    if (!r) return notFound("Could not resolve to a Repository");
    const rr = refsOf(r.fullName);
    const known = rr.bySha.has(oid) || [...heads.values()].includes(oid);
    if (!known) return json({ data: null, errors: [{ message: "Object does not exist" }] });
    const n = String(name).slice("refs/heads/".length);
    if (r.branches.includes(n)) return json({ data: null, errors: [{ message: "A ref with that name already exists." }] });
    r.branches.push(n);
    rr.branches.push({ name: n, tip: rr.bySha.has(oid) ? oid : rr.main, protected: false, pr: null });
    heads.set(headKey(r.fullName, n), oid);
    return json({ data: { createRef: { ref: { id: `REF_heads_${n}`, name: n } } } });
  }
  return undefined;
}

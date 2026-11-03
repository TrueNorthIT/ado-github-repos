import { describe, it, expect } from "vitest";
import {
  MAX_UPLOAD_BYTES, MAX_UPLOAD_TOTAL_BYTES, bytesToBase64, canWrite, checkUploads, commitOnBranchMutation, decodeForEdit, defaultMessage, deleteChanges, isStaleHeadError,
  joinPath, mapWriteContext, planCommit, prepareEdited, renameChanges, suggestBranchName, treeLookup, utf8ToBase64, validateCommitForm, validatePath, writeContextQuery,
} from "./fileCommit";
import { expectMutation, expectNotInQuery, NASTY } from "./ciTestHelpers";

const OID = "a".repeat(40);
const b64ToText = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));

describe("canWrite", () => {
  it.each([["WRITE", true], ["MAINTAIN", true], ["ADMIN", true], ["TRIAGE", false], ["READ", false], [null, false], [undefined, false], ["", false]])("%s -> %s", (p, ok) => {
    expect(canWrite(p as string | null | undefined)).toBe(ok);
  });
});

describe("base64", () => {
  it("encodes UTF-8, not Latin-1 or UTF-16", () => {
    expect(utf8ToBase64("héllo ✓ 日本 😀")).toBe("aMOpbGxvIOKckyDml6XmnKwg8J+YgA==");
    expect(b64ToText(utf8ToBase64("naïve – café"))).toBe("naïve – café");
  });
  it("encodes bytes, including large inputs and every byte value", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesToBase64(all)).toBe(btoa(Array.from(all, (b) => String.fromCharCode(b)).join("")));
    const big = new Uint8Array(300_000).map((_, i) => i % 251);
    expect(Uint8Array.from(atob(bytesToBase64(big)), (c) => c.charCodeAt(0))).toEqual(big);
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });
});

describe("decodeForEdit", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("decodes UTF-8 text", () => expect(decodeForEdit(enc("a\nb ✓"))).toEqual({ ok: true, text: "a\nb ✓", bom: false }));
  it("keeps track of a BOM instead of losing it", () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...enc("x")]);
    expect(decodeForEdit(bytes)).toEqual({ ok: true, text: "x", bom: true });
  });
  it("refuses bytes that are not valid UTF-8, rather than writing replacement characters back", () => {
    expect(decodeForEdit(Uint8Array.from([0x68, 0xe9, 0x6c]))).toEqual({ ok: false });
  });
  it("refuses a file with NUL bytes (binary)", () => expect(decodeForEdit(Uint8Array.from([0x61, 0, 0x62]))).toEqual({ ok: false }));
  it("accepts an empty file", () => expect(decodeForEdit(new Uint8Array())).toEqual({ ok: true, text: "", bom: false }));
});

describe("prepareEdited keeps the file's line endings and BOM", () => {
  it("leaves LF files alone", () => expect(prepareEdited("a\nb\n", { original: "x\ny\n" })).toBe("a\nb\n"));
  it("writes CRLF when the original was CRLF, even if the editor handed back LF", () => expect(prepareEdited("a\nb\n", { original: "x\r\ny\r\n" })).toBe("a\r\nb\r\n"));
  it("does not double an existing CR", () => expect(prepareEdited("a\r\nb", { original: "x\r\ny" })).toBe("a\r\nb"));
  it("turns CRLF into LF when the original was LF", () => expect(prepareEdited("a\r\nb", { original: "x\ny" })).toBe("a\nb"));
  it("uses the dominant ending of a mixed original", () => {
    expect(prepareEdited("a\nb\nc", { original: "1\r\n2\r\n3\n" })).toBe("a\r\nb\r\nc");
    expect(prepareEdited("a\r\nb", { original: "1\n2\n3\r\n" })).toBe("a\nb");
  });
  it("defaults to LF for a file with no line breaks or a new file", () => {
    expect(prepareEdited("a\r\nb", { original: "single" })).toBe("a\nb");
    expect(prepareEdited("a\nb", {})).toBe("a\nb");
  });
  it("does not add or remove the final newline", () => {
    expect(prepareEdited("a\n", { original: "x\r\n" })).toBe("a\r\n");
    expect(prepareEdited("a", { original: "x\r\n" })).toBe("a");
  });
  it("puts the BOM back", () => expect(prepareEdited("a", { original: "x", bom: true })).toBe("﻿a"));
});

describe("isStaleHeadError", () => {
  it("recognises GitHub's message", () => expect(isStaleHeadError('Expected branch to point to "abc123" but it did not. Pull and try again.')).toBe(true));
  it("is case-insensitive and ignores other errors", () => {
    expect(isStaleHeadError("EXPECTED BRANCH TO POINT TO x")).toBe(true);
    expect(isStaleHeadError("Branch protection rule violated")).toBe(false);
    expect(isStaleHeadError(undefined)).toBe(false);
  });
});

describe("validatePath", () => {
  const none = () => undefined;
  const files = (...f: string[]) => (p: string) => (f.includes(p) ? ("file" as const) : f.some((x) => x.startsWith(p + "/")) ? ("folder" as const) : undefined);
  it("accepts a plain or nested path", () => {
    expect(validatePath("a.txt", none)).toBeNull();
    expect(validatePath("src/lib/a.txt", none)).toBeNull();
  });
  it.each([["", /enter a path/i], ["  ", /enter a path/i], ["/a", /start or end/i], ["a/", /start or end/i], ["a//b", /empty/i], ["a/../b", /\.\./], ["./a", /\./], [".git/config", /\.git/], ["a/.GIT/x", /\.git/], ["a\\b", /backslash/i], ["a\nb", /control/i]])("rejects %j", (p, why) => {
    expect(validatePath(p, none)).toMatch(why);
  });
  it("rejects a path that already exists as a file or a folder", () => {
    expect(validatePath("a.txt", files("a.txt"))).toMatch(/already exists/i);
    expect(validatePath("src", files("src/x.ts"))).toMatch(/already exists/i);
  });
  it("accepts a new file inside an existing folder, but not beneath a file", () => {
    expect(validatePath("src/new.ts", files("src/x.ts"))).toBeNull();
    expect(validatePath("a.txt/b", files("a.txt"))).toMatch(/is a file/i);
    expect(validatePath("x/a.txt/b/c", files("x/a.txt"))).toMatch(/is a file/i);
  });
  it("trims surrounding spaces before checking", () => expect(validatePath("  a.txt ", none)).toBeNull());
});

describe("joinPath", () => {
  it("joins a folder and a name", () => {
    expect(joinPath("", "a.txt")).toBe("a.txt");
    expect(joinPath("src", "a.txt")).toBe("src/a.txt");
    expect(joinPath("src/", "a.txt")).toBe("src/a.txt");
  });
});

describe("validateCommitForm", () => {
  const direct = { headline: "Update a.txt", body: "", target: { kind: "direct" as const } };
  it("needs a headline", () => {
    expect(validateCommitForm({ ...direct, headline: "  " }, [])).toEqual({ ok: false, field: "headline", reason: "Enter a commit message." });
  });
  it("returns the trimmed headline and leaves the body out when blank", () => {
    expect(validateCommitForm({ ...direct, headline: "  Update a.txt " }, [])).toEqual({ ok: true, message: { headline: "Update a.txt" } });
  });
  it("keeps a body, trimmed at the end only", () => {
    expect(validateCommitForm({ ...direct, body: "Why\n\n  more  \n" }, [])).toEqual({ ok: true, message: { headline: "Update a.txt", body: "Why\n\n  more" } });
  });
  it("checks a new branch name against ref rules and existing branches", () => {
    const t = (name: string) => validateCommitForm({ ...direct, target: { kind: "branch", name } }, ["main", "dev"]);
    expect(t("")).toMatchObject({ ok: false, field: "branch" });
    expect(t("has space")).toMatchObject({ ok: false, field: "branch" });
    expect(t("dev")).toMatchObject({ ok: false, field: "branch" });
    expect(t("feature/x")).toMatchObject({ ok: true });
  });
  it("does not check the branch name for a direct commit", () => expect(validateCommitForm(direct, ["main"]).ok).toBe(true));
});

describe("planCommit", () => {
  it("direct: commits on the current branch and does not open a PR", () => {
    expect(planCommit({ kind: "direct" }, "main", OID)).toEqual({ branch: "main", expectedHeadOid: OID, openPr: false });
  });
  it("new branch: creates it at the loaded head, commits there against the same head, and opens a PR", () => {
    expect(planCommit({ kind: "branch", name: "fix/a" }, "main", OID)).toEqual({ branch: "fix/a", createFrom: OID, expectedHeadOid: OID, openPr: true });
  });
});

describe("commitOnBranchMutation", () => {
  const base = { repo: "o/r", branch: "main", expectedHeadOid: OID, message: { headline: "h" }, changes: { additions: [{ path: "a.txt", contents: "aGk=" }], deletions: [] as { path: string }[] } };
  it("is createCommitOnBranch with the documented input", () => {
    const m = commitOnBranchMutation(base);
    expectMutation(m, "CreateCommitOnBranchInput", "createCommitOnBranch");
    expect(m.variables).toEqual({ input: { branch: { repositoryNameWithOwner: "o/r", branchName: "main" }, expectedHeadOid: OID, message: { headline: "h" }, fileChanges: { additions: [{ path: "a.txt", contents: "aGk=" }] } } });
  });
  it("includes the body and deletions only when present", () => {
    const m = commitOnBranchMutation({ ...base, message: { headline: "h", body: "b" }, changes: { additions: [{ path: "n.txt", contents: "eA==" }], deletions: [{ path: "o.txt" }] } });
    expect((m.variables.input as any).message).toEqual({ headline: "h", body: "b" });
    expect((m.variables.input as any).fileChanges).toEqual({ additions: [{ path: "n.txt", contents: "eA==" }], deletions: [{ path: "o.txt" }] });
  });
  it("allows a delete-only commit", () => {
    const m = commitOnBranchMutation({ ...base, changes: { additions: [], deletions: [{ path: "o.txt" }] } });
    expect((m.variables.input as any).fileChanges).toEqual({ deletions: [{ path: "o.txt" }] });
  });
  it("keeps caller values out of the query text", () => {
    for (const v of NASTY) expectNotInQuery(commitOnBranchMutation({ ...base, branch: v, message: { headline: v } }), [v]);
  });
  it("refuses bad input", () => {
    expect(() => commitOnBranchMutation({ ...base, repo: "nope" })).toThrow("repo must be owner/name");
    expect(() => commitOnBranchMutation({ ...base, branch: " " })).toThrow("branchName is required");
    expect(() => commitOnBranchMutation({ ...base, expectedHeadOid: "" })).toThrow("expectedHeadOid is required");
    expect(() => commitOnBranchMutation({ ...base, changes: { additions: [], deletions: [] } })).toThrow("at least one file change is required");
  });
});

describe("renameChanges and deleteChanges", () => {
  it("rename is an addition at the new path plus a deletion of the old one", () => {
    expect(renameChanges("a/old.txt", "b/new.txt", "eA==")).toEqual({ additions: [{ path: "b/new.txt", contents: "eA==" }], deletions: [{ path: "a/old.txt" }] });
  });
  it("delete is a single deletion", () => expect(deleteChanges("a.txt")).toEqual({ additions: [], deletions: [{ path: "a.txt" }] }));
});

describe("checkUploads", () => {
  const f = (name: string, size: number) => ({ name, size });
  it("accepts files under the cap and rejects bigger ones with a message that names the cap", () => {
    const r = checkUploads([f("ok.bin", 10), f("big.bin", MAX_UPLOAD_BYTES + 1), f("edge.bin", MAX_UPLOAD_BYTES)], "", () => false);
    expect(r.accepted.map((x) => x.name)).toEqual(["ok.bin", "edge.bin"]);
    expect(r.rejected).toEqual([{ name: "big.bin", reason: expect.stringMatching(/25 MB/) }]);
  });
  it("rejects what would take the total past the total cap", () => {
    const r = checkUploads([f("a", MAX_UPLOAD_BYTES), f("b", MAX_UPLOAD_BYTES), f("c", 10)], "", () => false);
    expect(r.accepted.map((x) => x.name)).toEqual(["a", "b"]);
    expect(r.rejected).toEqual([{ name: "c", reason: expect.stringMatching(/total/i) }]);
  });
  it("rejects repeated names, and marks the files that replace an existing one", () => {
    const r = checkUploads([f("a.txt", 1), f("a.txt", 2), f("new.txt", 3)], "docs", (p) => p === "docs/a.txt");
    expect(r.accepted.map((x) => [x.path, x.replaces])).toEqual([["docs/a.txt", true], ["docs/new.txt", false]]);
    expect(r.rejected).toEqual([{ name: "a.txt", reason: expect.stringMatching(/more than once/i) }]);
  });
  it("accepts an empty file", () => expect(checkUploads([f("empty", 0)], "", () => false).accepted).toHaveLength(1));
});

describe("defaultMessage", () => {
  it("words each kind", () => {
    expect(defaultMessage({ kind: "edit", path: "src/a.ts" })).toBe("Update src/a.ts");
    expect(defaultMessage({ kind: "create", path: "a.md" })).toBe("Create a.md");
    expect(defaultMessage({ kind: "delete", path: "a.md" })).toBe("Delete a.md");
    expect(defaultMessage({ kind: "rename", from: "a.md", to: "b/a.md" })).toBe("Rename a.md to b/a.md");
    expect(defaultMessage({ kind: "upload", paths: ["a.png"] })).toBe("Add a.png");
    expect(defaultMessage({ kind: "upload", paths: ["a", "b", "c"] })).toBe("Add 3 files");
  });
});

describe("suggestBranchName", () => {
  it("uses the login and the first free number", () => {
    expect(suggestBranchName("ann", [])).toBe("ann-patch-1");
    expect(suggestBranchName("ann", ["ann-patch-1", "ann-patch-2"])).toBe("ann-patch-3");
  });
  it("falls back when the login is unknown", () => expect(suggestBranchName("", [])).toBe("patch-1"));
});

describe("writeContextQuery and mapWriteContext", () => {
  it("asks for the id, the permission and the branch head, with every value in variables", () => {
    const q = writeContextQuery({ owner: "o", name: "r", branch: "feature/x" });
    expect(q.query).toMatch(/viewerPermission/);
    expect(q.query).toMatch(/ref\(qualifiedName: \$qualifiedName\) \{ target \{ oid \} \}/);
    expect(q.variables).toEqual({ owner: "o", name: "r", qualifiedName: "refs/heads/feature/x" });
    for (const v of NASTY) expectNotInQuery(writeContextQuery({ owner: v, name: v, branch: v }), [v]);
  });
  it("maps a writer on a branch", () => {
    expect(mapWriteContext({ data: { repository: { id: "R1", viewerPermission: "WRITE", ref: { target: { oid: OID } } } } })).toEqual({ repoId: "R1", headOid: OID, canWrite: true });
  });
  it("has no head for a tag or a commit (ref is null), and cannot write as a reader", () => {
    expect(mapWriteContext({ data: { repository: { id: "R1", viewerPermission: "READ", ref: null } } })).toEqual({ repoId: "R1", headOid: null, canWrite: false });
    expect(mapWriteContext(null)).toEqual({ repoId: "", headOid: null, canWrite: false });
  });
});

describe("treeLookup", () => {
  const look = treeLookup({ tree: [{ path: "src", type: "tree" }, { path: "src/a.ts", type: "blob" }, { path: "vendor", type: "commit" }] });
  it("says what is at a path", () => {
    expect(look("src")).toBe("folder");
    expect(look("src/a.ts")).toBe("file");
    expect(look("vendor")).toBe("file");
    expect(look("nope")).toBeUndefined();
  });
});

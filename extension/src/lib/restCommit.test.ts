import { describe, it, expect } from "vitest";
import { mapRestCommit } from "./restCommit";
import { GHOST_AVATAR } from "./commitsQuery";

const base = { sha: "a".repeat(40), commit: { message: "Fix it\n\nBody", author: { name: "Alex", date: "2026-03-04T09:00:00Z" }, committer: { date: "2026-03-05T09:00:00Z" } }, parents: [{ sha: "b".repeat(40) }] };

describe("mapRestCommit", () => {
  it("maps title, dates, parents and a linked author", () => {
    const r = mapRestCommit({ ...base, author: { login: "alex", avatar_url: "u" } });
    expect(r).toMatchObject({ shortSha: "aaaaaaaa", title: "Fix it", message: "Fix it\n\nBody", parents: ["b".repeat(40)], prNumber: null, status: null });
    expect(r.author).toEqual({ name: "Alex", login: "alex", avatarUrl: "u" });
    expect(r.date).toEqual(new Date("2026-03-04T09:00:00Z"));
    expect(r.committedDate).toEqual(new Date("2026-03-05T09:00:00Z"));
  });
  it("keeps the git name with a null login and the ghost avatar when no account is linked", () => {
    expect(mapRestCommit({ ...base, author: null }).author).toEqual({ name: "Alex", login: null, avatarUrl: GHOST_AVATAR });
  });
});

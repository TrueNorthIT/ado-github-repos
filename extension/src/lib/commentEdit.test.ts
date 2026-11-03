import { describe, it, expect } from "vitest";
import {
  MINIMIZE_CLASSIFIERS,
  editCommentMutation,
  deleteCommentMutation,
  commentActions,
  applyCommentDelete,
  applyCommentEdit,
  commentMetaQueries,
  editHistoryQuery,
  toEditInfo,
  toMinimizedView,
  toCommentMeta,
  minimizeMutation,
  unminimizeMutation,
  type MinimizeClassifier,
} from "./commentEdit";
import type { CommentItem, FeedItem, ThreadItem } from "./feedModel";
import { expectMutation, expectNotInQuery, norm, NASTY } from "./ciTestHelpers";
import { expectQueryOperation } from "./editTestHelpers";

// Module under test: src/lib/commentEdit.ts (stubs until the developer implements them). Requirements: CM-4 (edit and delete your own comments), CM-5 (edit history), CM-6 (minimise).
// Schema facts (including what `diff` really is, and the lower-case minimizedReason) are in the header of src/lib/commentEdit.ts. Decisions fixed by these tests:
//  - the mutation is picked from __typename; a submitted PullRequestReview can be edited but not deleted (only a pending one can be discarded, see pendingReview.ts).
//  - `diff` is read as the full text of that revision (`body` in EditEntry); the oldest entry is flagged isCreation when includesCreatedEdit is true.
//  - the label for a minimised comment is "This comment was marked as {reason}" with GitHub's own wording of the reason; LOW_QUALITY is not offered as a classifier.
//  - deleting a comment from a thread removes just that comment; the thread keeps its position and its dates are recomputed.

const KINDS = ["IssueComment", "PullRequestReviewComment", "PullRequestReview"] as const;

describe("CM-4: editCommentMutation picks the right mutation from __typename", () => {
  // Given a comment's __typename and id, the builder returns the matching update mutation with the right id field in $input.
  const cases = [
    { typename: "IssueComment", inputType: "UpdateIssueCommentInput", field: "updateIssueComment", idKey: "id" },
    { typename: "PullRequestReviewComment", inputType: "UpdatePullRequestReviewCommentInput", field: "updatePullRequestReviewComment", idKey: "pullRequestReviewCommentId" },
    { typename: "PullRequestReview", inputType: "UpdatePullRequestReviewInput", field: "updatePullRequestReview", idKey: "pullRequestReviewId" },
  ];

  it.each(cases)("$typename uses $field with $idKey", ({ typename, inputType, field, idKey }) => {
    const req = editCommentMutation({ __typename: typename, id: "N_1" }, "New text\n");
    expectMutation(req, inputType, field);
    expect(req.variables, `Expected { input: { ${idKey}, body } } for ${typename}`).toEqual({ input: { [idKey]: "N_1", body: "New text\n" } });
  });

  it.each(cases)("$typename selects the fields the UI reconciles from", ({ typename }) => {
    const words = norm(editCommentMutation({ __typename: typename, id: "N_1" }, "x").query).split(/[^A-Za-z0-9_]+/);
    for (const f of ["id", "body", "bodyHTML", "lastEditedAt"]) expect(words, `Expected the ${typename} payload to select ${f}`).toContain(f);
  });

  it("keeps the id and body out of the query text", () => {
    NASTY.forEach((v) => KINDS.forEach((k) => expectNotInQuery(editCommentMutation({ __typename: k, id: v }, v), [v])));
  });

  it("rejects a blank body", () => {
    expect(() => editCommentMutation({ __typename: "IssueComment", id: "N_1" }, " \n"), "Expected a blank body to be rejected").toThrow(/body is required/);
  });

  it("rejects a type it cannot edit", () => {
    expect(() => editCommentMutation({ __typename: "PullRequestReviewThread", id: "N_1" }, "x"), "Expected an unknown __typename to be rejected").toThrow(/unsupported comment type/);
  });
});

describe("CM-4: deleteCommentMutation picks the right delete mutation", () => {
  it("deletes an issue comment with deleteIssueComment { id }", () => {
    const req = deleteCommentMutation({ __typename: "IssueComment", id: "IC_1" });
    expectMutation(req, "DeleteIssueCommentInput", "deleteIssueComment");
    expect(req.variables, "Expected { input: { id } }").toEqual({ input: { id: "IC_1" } });
  });

  it("deletes a review comment with deletePullRequestReviewComment { id }", () => {
    const req = deleteCommentMutation({ __typename: "PullRequestReviewComment", id: "PRRC_1" });
    expectMutation(req, "DeletePullRequestReviewCommentInput", "deletePullRequestReviewComment");
    expect(req.variables, "Expected { input: { id } }").toEqual({ input: { id: "PRRC_1" } });
  });

  it("refuses to delete a submitted review", () => {
    expect(() => deleteCommentMutation({ __typename: "PullRequestReview", id: "PRR_1" }), "Expected a review to be refused (GitHub only deletes pending reviews)").toThrow(/a submitted review cannot be deleted/);
  });

  it("rejects an unknown type", () => {
    expect(() => deleteCommentMutation({ __typename: "Commit", id: "C_1" }), "Expected an unknown __typename to be rejected").toThrow(/unsupported comment type/);
  });

  it("keeps the id out of the query text", () => {
    NASTY.forEach((v) => expectNotInQuery(deleteCommentMutation({ __typename: "IssueComment", id: v }), [v]));
  });
});

describe("CM-4 / CM-6: commentActions gates buttons on the viewer's permissions", () => {
  const all = { viewerCanUpdate: true, viewerCanDelete: true, viewerCanMinimize: true, viewerCanUnminimize: true, isMinimized: false };

  it("offers edit, delete and minimise on an own issue comment that is not minimised", () => {
    expect(commentActions({ __typename: "IssueComment", ...all }), "Expected edit, delete and minimise, but not unminimise").toEqual({ canEdit: true, canDelete: true, canMinimize: true, canUnminimize: false });
  });

  it("offers edit and delete on a review comment too", () => {
    const a = commentActions({ __typename: "PullRequestReviewComment", ...all });
    expect([a.canEdit, a.canDelete], "Expected edit and delete on a PullRequestReviewComment").toEqual([true, true]);
  });

  it("offers edit but never delete on a submitted review, even when viewerCanDelete is true", () => {
    const a = commentActions({ __typename: "PullRequestReview", ...all });
    expect([a.canEdit, a.canDelete], "Expected edit without delete: no delete mutation exists for a submitted review").toEqual([true, false]);
  });

  it("follows each flag independently", () => {
    expect(commentActions({ __typename: "IssueComment", viewerCanUpdate: false, viewerCanDelete: true, viewerCanMinimize: false }), "Expected only delete").toEqual({ canEdit: false, canDelete: true, canMinimize: false, canUnminimize: false });
  });

  it("offers unminimise, not minimise, on a minimised comment", () => {
    const a = commentActions({ __typename: "IssueComment", ...all, isMinimized: true });
    expect([a.canMinimize, a.canUnminimize], "Expected unminimise only when the comment is already minimised").toEqual([false, true]);
  });

  it("does not offer unminimise on a comment that is not minimised even when viewerCanUnminimize is true", () => {
    expect(commentActions({ __typename: "IssueComment", ...all, isMinimized: false }).canUnminimize, "Expected no unminimise for a visible comment").toBe(false);
  });

  it("treats missing or null flags as false", () => {
    expect(commentActions({ __typename: "IssueComment", viewerCanUpdate: null }), "Expected everything false").toEqual({ canEdit: false, canDelete: false, canMinimize: false, canUnminimize: false });
  });

  it("gives an unknown type no actions", () => {
    expect(commentActions({ __typename: "Commit", ...all }), "Expected nothing for a type we cannot act on").toEqual({ canEdit: false, canDelete: false, canMinimize: false, canUnminimize: false });
  });
});

describe("CM-4: applyCommentEdit and applyCommentDelete update the feed optimistically", () => {
  const at = (iso: string) => new Date(iso);
  const c = (id: string, iso: string, html = `<p>${id}</p>`) => ({ id, author: "ada", avatarUrl: "", html, date: at(iso), url: "" });
  const top = (id: string, iso: string): CommentItem => ({ kind: "comment", ...c(id, iso) });
  const thread = (id: string, comments: ReturnType<typeof c>[]): ThreadItem => ({
    kind: "thread", id, status: "active", outdated: false, path: "a.ts", line: 1, startLine: null, side: "RIGHT",
    comments, date: comments[0].date, lastActivity: comments[comments.length - 1].date,
  });
  const feed = (): FeedItem[] => [top("top1", "2026-01-05T00:00:00Z"), thread("t1", [c("a", "2026-01-04T00:00:00Z"), c("b", "2026-01-03T00:00:00Z"), c("d", "2026-01-02T00:00:00Z")]), top("top2", "2026-01-01T00:00:00Z")];

  it("replaces the html of a top-level comment", () => {
    const next = applyCommentEdit(feed(), "top1", "<p>edited</p>");
    expect((next[0] as CommentItem).html, "Expected the top-level comment html to change").toBe("<p>edited</p>");
  });

  it("replaces the html of a comment inside a thread and leaves its neighbours alone", () => {
    const next = applyCommentEdit(feed(), "b", "<p>edited</p>");
    expect((next[1] as ThreadItem).comments.map((x) => x.html), "Expected only comment b to change").toEqual(["<p>a</p>", "<p>edited</p>", "<p>d</p>"]);
  });

  it("returns an equal array for an unknown comment id when editing", () => {
    expect(applyCommentEdit(feed(), "nope", "<p>x</p>"), "Expected nothing to change").toEqual(feed());
  });

  it("does not change the array it was given when editing", () => {
    const items = feed();
    applyCommentEdit(items, "top1", "<p>x</p>");
    expect((items[0] as CommentItem).html, "Expected the input to be left alone (pure)").toBe("<p>top1</p>");
  });

  it("removes a deleted top-level comment", () => {
    expect(applyCommentDelete(feed(), "top1").map((i) => i.id), "Expected top1 to disappear").toEqual(["t1", "top2"]);
  });

  it("removes a deleted reply and moves the thread's lastActivity back", () => {
    const t = applyCommentDelete(feed(), "d")[1] as ThreadItem;
    expect([t.comments.map((x) => x.id), t.lastActivity], "Expected a and b to remain, last activity = b's date").toEqual([["a", "b"], at("2026-01-03T00:00:00Z")]);
  });

  it("moves the thread's date to the next comment when the first one is deleted", () => {
    const t = applyCommentDelete(feed(), "a")[1] as ThreadItem;
    expect([t.comments.map((x) => x.id), t.date], "Expected b and d to remain, thread date = b's date").toEqual([["b", "d"], at("2026-01-03T00:00:00Z")]);
  });

  it("removes a thread when its last comment is deleted, keeping the other items in place", () => {
    const items: FeedItem[] = [top("top1", "2026-01-05T00:00:00Z"), thread("t1", [c("only", "2026-01-04T00:00:00Z")]), top("top2", "2026-01-01T00:00:00Z")];
    expect(applyCommentDelete(items, "only").map((i) => i.id), "Expected the empty thread to go").toEqual(["top1", "top2"]);
  });

  it("returns an equal array for an unknown comment id when deleting", () => {
    expect(applyCommentDelete(feed(), "nope"), "Expected nothing to change").toEqual(feed());
  });

  it("does not change the array it was given when deleting", () => {
    const items = feed();
    applyCommentDelete(items, "top1");
    expect(items, "Expected the input to be left alone (pure)").toHaveLength(3);
  });
});

describe("CM-5: commentMetaQueries reads comment metadata by node id", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `N_${i}`);

  it("is one variables-only query for up to 100 ids", () => {
    const reqs = commentMetaQueries(["N_1", "N_2"]);
    expect(reqs, "Expected a single request").toHaveLength(1);
    expectQueryOperation(reqs[0]);
    expect(reqs[0].variables, "Expected { ids }").toEqual({ ids: ["N_1", "N_2"] });
    expect(norm(reqs[0].query), "Expected nodes(ids: $ids) with $ids: [ID!]!").toMatch(/\$ids:\s*\[ID!\]!/);
    expect(norm(reqs[0].query), "Expected nodes(ids: $ids)").toMatch(/nodes\(ids:\s*\$ids\)/);
  });

  it("selects the type-specific fields for all three comment types", () => {
    const q = norm(commentMetaQueries(["N_1"])[0].query);
    for (const t of KINDS) expect(q, `Expected an inline fragment on ${t}`).toMatch(new RegExp(`\\.\\.\\.\\s*on ${t}\\s*\\{`));
    const words = q.split(/[^A-Za-z0-9_]+/);
    for (const f of ["__typename", "id", "body", "state", "viewerDidAuthor", "lastEditedAt", "includesCreatedEdit", "viewerCanUpdate", "viewerCanDelete", "viewerCanMinimize", "viewerCanUnminimize", "isMinimized", "minimizedReason", "viewerCanReact", "reactionGroups", "reactors", "totalCount"])
      expect(words, `Expected the query to select ${f}`).toContain(f);
  });

  it("splits more than 100 ids into chunks of 100 (GitHub's nodes limit)", () => {
    const reqs = commentMetaQueries(ids(250));
    expect(reqs.map((r) => (r.variables.ids as string[]).length), "Expected 100, 100 and 50 ids").toEqual([100, 100, 50]);
    expect((reqs[2].variables.ids as string[])[0], "Expected chunks in the original order").toBe("N_200");
  });

  it("sends exactly 100 ids in one request", () => {
    expect(commentMetaQueries(ids(100)), "Expected a single request for 100 ids").toHaveLength(1);
  });

  it("drops duplicate and blank ids, keeping first-seen order", () => {
    expect(commentMetaQueries(["b", "a", "b", " ", "", "a"])[0].variables.ids, "Expected [b, a]").toEqual(["b", "a"]);
  });

  it("returns no requests for no ids", () => {
    expect(commentMetaQueries([]), "Expected nothing to fetch").toEqual([]);
  });

  it("keeps ids out of the query text", () => {
    NASTY.forEach((v) => expectNotInQuery(commentMetaQueries([v])[0], [v]));
  });
});

describe("CM-5: editHistoryQuery loads the edit history of one comment", () => {
  it("is a variables-only node query", () => {
    const req = editHistoryQuery("IC_1");
    expectQueryOperation(req);
    expect(req.variables, "Expected { id }").toEqual({ id: "IC_1" });
    expect(norm(req.query), "Expected node(id: $id)").toMatch(/node\(id:\s*\$id\)/);
    expect(norm(req.query), "Expected $id: ID!").toMatch(/\$id:\s*ID!/);
  });

  it("asks for up to 20 edits with time, editor and content", () => {
    const q = norm(editHistoryQuery("IC_1").query);
    expect(q, "Expected userContentEdits(first: 20)").toMatch(/userContentEdits\(first:\s*20\)/);
    const words = q.split(/[^A-Za-z0-9_]+/);
    for (const f of ["lastEditedAt", "includesCreatedEdit", "editedAt", "deletedAt", "editor", "login", "diff"]) expect(words, `Expected the query to select ${f}`).toContain(f);
  });

  it("keeps the id out of the query text", () => {
    NASTY.forEach((v) => expectNotInQuery(editHistoryQuery(v), [v]));
  });

  it("rejects a blank id", () => {
    expect(() => editHistoryQuery(" "), "Expected a blank id to be rejected").toThrow(/id is required/);
  });
});

describe("CM-5: toEditInfo gives the Edited label and the history list", () => {
  const edit = (editedAt: string, diff: string | null, editor: string | null = "ada", deletedAt: string | null = null) => ({ editedAt, deletedAt, editor: editor ? { login: editor } : null, diff });

  it("is not edited when lastEditedAt is missing", () => {
    expect(toEditInfo({ lastEditedAt: null, includesCreatedEdit: false, userContentEdits: { nodes: [] } }), "Expected no label and no history for an untouched comment").toEqual({ edited: false, label: null, lastEditedAt: null, history: [] });
  });

  it("labels an edited comment Edited and reports when", () => {
    const info = toEditInfo({ lastEditedAt: "2026-02-02T10:00:00Z", includesCreatedEdit: false, userContentEdits: { nodes: [edit("2026-02-02T10:00:00Z", "v2")] } });
    expect([info.edited, info.label, info.lastEditedAt], "Expected edited with the label and date").toEqual([true, "Edited", new Date("2026-02-02T10:00:00Z")]);
  });

  it("lists revisions newest first with the editor and the full text of each", () => {
    const info = toEditInfo({
      lastEditedAt: "2026-02-03T00:00:00Z", includesCreatedEdit: false,
      userContentEdits: { nodes: [edit("2026-02-03T00:00:00Z", "third", "grace"), edit("2026-02-02T00:00:00Z", "second", "ada")] },
    });
    expect(info.history.map((h) => [h.editor, h.body, h.isCreation]), "Expected newest first, none flagged as the creation").toEqual([["grace", "third", false], ["ada", "second", false]]);
  });

  it("sorts by editedAt even when GitHub returns the nodes out of order", () => {
    const info = toEditInfo({ lastEditedAt: "2026-02-03T00:00:00Z", userContentEdits: { nodes: [edit("2026-02-01T00:00:00Z", "old"), edit("2026-02-03T00:00:00Z", "new"), edit("2026-02-02T00:00:00Z", "mid")] } });
    expect(info.history.map((h) => h.body), "Expected new, mid, old").toEqual(["new", "mid", "old"]);
  });

  it("flags the oldest entry as the creation when includesCreatedEdit is true", () => {
    const info = toEditInfo({
      lastEditedAt: "2026-02-02T00:00:00Z", includesCreatedEdit: true,
      userContentEdits: { nodes: [edit("2026-02-02T00:00:00Z", "edited"), edit("2026-02-01T00:00:00Z", "as first written")] },
    });
    expect(info.history.map((h) => h.isCreation), "Expected only the last (oldest) entry to be the creation").toEqual([false, true]);
  });

  it("reads editedAt as a Date", () => {
    const info = toEditInfo({ lastEditedAt: "2026-02-02T00:00:00Z", userContentEdits: { nodes: [edit("2026-02-02T00:00:00Z", "x")] } });
    expect(info.history[0].editedAt, "Expected a Date").toEqual(new Date("2026-02-02T00:00:00Z"));
  });

  it("names a missing editor ghost", () => {
    const info = toEditInfo({ lastEditedAt: "2026-02-02T00:00:00Z", userContentEdits: { nodes: [edit("2026-02-02T00:00:00Z", "x", null)] } });
    expect(info.history[0].editor, "Expected ghost for a deleted account").toBe("ghost");
  });

  it("marks a revision whose content GitHub deleted", () => {
    const info = toEditInfo({ lastEditedAt: "2026-02-02T00:00:00Z", userContentEdits: { nodes: [edit("2026-02-02T00:00:00Z", null, "ada", "2026-02-05T00:00:00Z")] } });
    expect([info.history[0].deleted, info.history[0].body], "Expected deleted: true and a null body").toEqual([true, null]);
  });

  it("skips null nodes and tolerates a missing edits connection", () => {
    expect(toEditInfo({ lastEditedAt: "2026-02-02T00:00:00Z", userContentEdits: { nodes: [null, edit("2026-02-02T00:00:00Z", "x")] } }).history, "Expected the null node to be skipped").toHaveLength(1);
    expect(toEditInfo({ lastEditedAt: "2026-02-02T00:00:00Z", userContentEdits: null }).history, "Expected an empty history without a connection").toEqual([]);
  });
});

describe("CM-6: minimizeMutation and unminimizeMutation", () => {
  it.each<MinimizeClassifier>(["SPAM", "ABUSE", "OFF_TOPIC", "OUTDATED", "DUPLICATE", "RESOLVED"])("minimises with the %s classifier", (classifier) => {
    const req = minimizeMutation("IC_1", classifier);
    expectMutation(req, "MinimizeCommentInput", "minimizeComment");
    expect(req.variables, `Expected { input: { subjectId, classifier: ${classifier} } }`).toEqual({ input: { subjectId: "IC_1", classifier } });
  });

  it("selects the minimised state back", () => {
    const words = norm(minimizeMutation("IC_1", "SPAM").query).split(/[^A-Za-z0-9_]+/);
    for (const f of ["minimizedComment", "isMinimized", "minimizedReason", "viewerCanMinimize", "viewerCanUnminimize"]) expect(words, `Expected the payload to select ${f}`).toContain(f);
  });

  it("rejects a classifier outside the six, including the schema's LOW_QUALITY", () => {
    expect([...MINIMIZE_CLASSIFIERS], "Expected the six classifiers GitHub offers, in its order").toEqual(["SPAM", "ABUSE", "OFF_TOPIC", "OUTDATED", "DUPLICATE", "RESOLVED"]);
    expect(() => minimizeMutation("IC_1", "LOW_QUALITY" as unknown as MinimizeClassifier), "Expected LOW_QUALITY to be refused").toThrow(/classifier must be one of/);
    expect(() => minimizeMutation("IC_1", "spam" as unknown as MinimizeClassifier), "Expected lower-case input to be refused (the enum is upper-case)").toThrow(/classifier must be one of/);
  });

  it("rejects a blank subject id", () => {
    expect(() => minimizeMutation(" ", "SPAM"), "Expected a blank subjectId to be rejected").toThrow(/subjectId is required/);
    expect(() => unminimizeMutation(""), "Expected a blank subjectId to be rejected").toThrow(/subjectId is required/);
  });

  it("unminimises with { input: { subjectId } }", () => {
    const req = unminimizeMutation("IC_1");
    expectMutation(req, "UnminimizeCommentInput", "unminimizeComment");
    expect(req.variables, "Expected { input: { subjectId } }").toEqual({ input: { subjectId: "IC_1" } });
    expect(norm(req.query).split(/[^A-Za-z0-9_]+/), "Expected the unminimizedComment payload").toContain("unminimizedComment");
  });

  it("keeps the id out of the query text", () => {
    NASTY.forEach((v) => {
      expectNotInQuery(minimizeMutation(v, "SPAM"), [v]);
      expectNotInQuery(unminimizeMutation(v), [v]);
    });
  });
});

describe("CM-6: toMinimizedView collapses a minimised comment and says why", () => {
  it("does not collapse a visible comment", () => {
    expect(toMinimizedView({ isMinimized: false, minimizedReason: null }), "Expected an ordinary comment to stay expanded").toEqual({ collapsed: false, label: null });
  });

  it.each([
    ["abuse", "abuse"],
    ["off-topic", "off-topic"],
    ["outdated", "outdated"],
    ["resolved", "resolved"],
    ["duplicate", "duplicate"],
    ["spam", "spam"],
    ["low-quality", "low quality"],
  ])("labels the API reason %s as '%s'", (reason, shown) => {
    expect(toMinimizedView({ isMinimized: true, minimizedReason: reason }), `Expected 'This comment was marked as ${shown}'`).toEqual({ collapsed: true, label: `This comment was marked as ${shown}` });
  });

  it("reads the reason ignoring case and underscores, because the API and the mutation differ", () => {
    expect(toMinimizedView({ isMinimized: true, minimizedReason: "OFF_TOPIC" }).label, "Expected OFF_TOPIC to read as off-topic").toBe("This comment was marked as off-topic");
  });

  it("shows an unrecognised reason as given", () => {
    expect(toMinimizedView({ isMinimized: true, minimizedReason: "sensitive" }).label, "Expected a future reason to be shown rather than lost").toBe("This comment was marked as sensitive");
  });

  it("says the comment was hidden when no reason is given", () => {
    expect(toMinimizedView({ isMinimized: true, minimizedReason: null }), "Expected a collapsed comment with a generic label").toEqual({ collapsed: true, label: "This comment was hidden" });
  });

  it("ignores a reason on a comment that is not minimised", () => {
    expect(toMinimizedView({ isMinimized: false, minimizedReason: "spam" }), "Expected no collapse without isMinimized").toEqual({ collapsed: false, label: null });
  });
});

describe("CM-4 / CM-5 / CM-6: toCommentMeta combines actions, edit info and minimised state for one node", () => {
  const issue = {
    __typename: "IssueComment", id: "IC_1", body: "Hello\r\nworld", viewerDidAuthor: true, lastEditedAt: "2026-02-02T00:00:00Z", includesCreatedEdit: false,
    viewerCanUpdate: true, viewerCanDelete: true, viewerCanMinimize: true, viewerCanUnminimize: false, isMinimized: false, minimizedReason: null,
  };

  it("maps an issue comment, keeping the raw body for the edit box", () => {
    const meta = toCommentMeta(issue);
    expect(meta, "Expected a CommentMeta for an IssueComment").not.toBeNull();
    expect([meta!.id, meta!.kind, meta!.body, meta!.viewerDidAuthor, meta!.pending], "Expected id, kind, raw body, authorship and pending flag").toEqual(["IC_1", "IssueComment", "Hello\r\nworld", true, false]);
    expect(meta!.actions, "Expected the actions from the viewer flags").toEqual({ canEdit: true, canDelete: true, canMinimize: true, canUnminimize: false });
    expect(meta!.edit.label, "Expected the Edited label").toBe("Edited");
    expect(meta!.minimized, "Expected a visible comment").toEqual({ collapsed: false, label: null });
  });

  it("marks a review comment of a pending review as pending", () => {
    expect(toCommentMeta({ ...issue, __typename: "PullRequestReviewComment", id: "PRRC_1", state: "PENDING" })?.pending, "Expected pending: true for state PENDING").toBe(true);
    expect(toCommentMeta({ ...issue, __typename: "PullRequestReviewComment", id: "PRRC_2", state: "SUBMITTED" })?.pending, "Expected pending: false for state SUBMITTED").toBe(false);
  });

  it("carries a minimised comment's label", () => {
    expect(toCommentMeta({ ...issue, isMinimized: true, minimizedReason: "resolved" })?.minimized.label, "Expected the resolved label").toBe("This comment was marked as resolved");
  });

  it("passes the reaction groups and viewerCanReact through for reactions.ts", () => {
    const groups = [{ content: "HEART", reactors: { totalCount: 2 }, viewerHasReacted: true }];
    const meta = toCommentMeta({ ...issue, viewerCanReact: true, reactionGroups: groups });
    expect([meta?.viewerCanReact, meta?.reactionGroups], "Expected the raw groups to be passed on untouched").toEqual([true, groups]);
    const bare = toCommentMeta(issue);
    expect([bare?.viewerCanReact, bare?.reactionGroups], "Expected false and [] when the node has neither").toEqual([false, []]);
  });

  it("maps a review", () => {
    expect(toCommentMeta({ ...issue, __typename: "PullRequestReview", id: "PRR_1" })?.kind, "Expected kind PullRequestReview").toBe("PullRequestReview");
  });

  it("treats a missing body as an empty string", () => {
    expect(toCommentMeta({ ...issue, body: null })?.body, "Expected '' for a null body").toBe("");
  });

  it("returns null for null and for types it does not know", () => {
    expect(toCommentMeta(null), "Expected null for a null node (an id GitHub could not resolve)").toBeNull();
    expect(toCommentMeta({ ...issue, __typename: "Commit" }), "Expected null for another type").toBeNull();
  });
});

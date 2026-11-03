// __TN_MOCK__ Comments, round 2 (batch 3): the data and the writes behind new line and file comments, suggestions, pending reviews, edit and delete, edit history,
// hide, and reactions, on pull request #200. Scenarios (?scenario=) seed extra state once per page load:
//   pendingReview, suggestions, editedComment, minimisedComment, reactions, readOnlyViewer. Any other scenario gets the everyday set.
import { ME, PR_REPO } from "./prs";
import { PR_FILES, contentAt, headSha } from "./prDetail";
import { ago, feeds, nextSerial, url, who, type Node } from "./feed";
import { hunkUpTo } from "./patch";

const NL = String.fromCharCode(10);
const PR = 200;
const CONTENTS = ["THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "CONFUSED", "HEART", "ROCKET", "EYES"];
const html = (body: string) => `<p>${String(body).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`;
const patchOf = (path: string) => PR_FILES[PR].find((f) => f.path === path)?.patch;

let seeded = "";
let pending: { id: string; pr: number } | null = null;
const reactions = new Map<string, Record<string, { count: number; mine: boolean }>>();
const minimised = new Map<string, { reason: string }>();
const edits = new Map<string, { editedAt: string; editor: string; diff: string | null; deletedAt?: string }[]>(); // newest first, creation last
const editedAt = new Map<string, string>();
const bodies = new Map<string, string>();
const commitCount = { n: 0 };

const comment = (id: string, login: string, hours: number, body: string, state: "SUBMITTED" | "PENDING", path: string, line: number, side: "LEFT" | "RIGHT", replyTo: string | null = null): Node => ({
  id, databaseId: nextSerial(), author: who(login), bodyHTML: html(body.replace(/```suggestion[^]*?```/g, "").trim()), body, createdAt: ago(hours), url: url(PR, `discussion_r${id}`), replyTo: replyTo ? { id: replyTo } : null,
  state, diffHunk: hunkUpTo(patchOf(path), line, side),
});
const thread = (id: string, path: string, line: number | null, startLine: number | null, side: "LEFT" | "RIGHT", comments: Node[], over: Node = {}): Node => ({
  id, isResolved: false, isOutdated: false, path, line, originalLine: line, startLine, diffSide: side, subjectType: "LINE", comments: { nodes: comments }, ...over,
});

const SUGGEST = (replacement: string[]) => "```suggestion" + NL + replacement.join(NL) + NL + "```";

function seed(sc: string) {
  if (seeded) return;
  seeded = sc || "ok";
  const f = feeds[PR];
  // everyday: a few reactions on a comment and the description
  reactions.set("IC_1", { THUMBS_UP: { count: 2, mine: false }, HEART: { count: 1, mine: false } });
  reactions.set(f.prId, { ROCKET: { count: 3, mine: false }, HOORAY: { count: 1, mine: false } });
  if (sc === "reactions") {
    reactions.set("IC_1", Object.fromEntries(CONTENTS.map((c, i) => [c, { count: i + 1, mine: i % 3 === 0 }])));
    reactions.set("IC_2", { EYES: { count: 4, mine: true } });
    reactions.set("RC_1", { LAUGH: { count: 2, mine: false }, THUMBS_UP: { count: 1, mine: true } });
  }
  if (sc === "suggestions") {
    f.threads.push(
      thread("PRRT_S1", "src/retry.ts", 2, null, "RIGHT", [comment("RC_S1", "carol", 6, "Three attempts is plenty for the sync job." + NL + NL + SUGGEST(["export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {"]), "SUBMITTED", "src/retry.ts", 2, "RIGHT")]),
      thread("PRRT_S2", "src/retry.ts", 9, 8, "RIGHT", [comment("RC_S2", "dave", 5, "Cap the delay and keep the error:" + NL + NL + SUGGEST(["      last = e;", "      await new Promise((r) => setTimeout(r, Math.min(2 ** i * 100, 2000) + Math.random() * 50));"]), "SUBMITTED", "src/retry.ts", 9, "RIGHT")]),
      thread("PRRT_S3", "src/retry.ts", null, null, "RIGHT", [comment("RC_S3", "carol", 40, "Old suggestion, before the rewrite:" + NL + NL + SUGGEST(["  throw new Error(String(last));"]), "SUBMITTED", "src/retry.ts", 12, "RIGHT")], { isOutdated: true, originalLine: 12 })
    );
  }
  if (sc === "pendingReview") {
    pending = { id: "PRR_pending", pr: PR };
    f.threads.push(thread("PRRT_P1", "src/util/greet.ts", 14, null, "RIGHT", [comment("RC_P1", ME, 1, "Is this step still needed?", "PENDING", "src/util/greet.ts", 14, "RIGHT")]));
    const first = f.threads.find((t) => t.id === "PRRT_1")!;
    first.comments.nodes.push(comment("RC_P2", ME, 0.5, "One more thing: add a test for this.", "PENDING", "src/util/greet.ts", 12, "RIGHT", "RC_1"));
    first.comments.nodes.push(comment("RC_P3", "dave", 0.4, "Dave's own pending note: you should never see this.", "PENDING", "src/util/greet.ts", 12, "RIGHT", "RC_1"));
  }
  if (sc === "editedComment") {
    const ic2 = f.timeline.find((n) => n.id === "IC_2")!;
    bodies.set("IC_2", "Added. Could you take another look?" + NL + NL + "- empty name" + NL + "- whitespace name" + NL + "- no name at all");
    ic2.bodyHTML = "<p>Added. Could you take another look?</p><ul><li>empty name</li><li>whitespace name</li><li>no name at all</li></ul>";
    editedAt.set("IC_2", ago(2));
    edits.set("IC_2", [
      { editedAt: ago(2), editor: ME, diff: bodies.get("IC_2")! },
      { editedAt: ago(10), editor: ME, diff: "Added. Could you take another look?" + NL + NL + "- empty name" + NL + "- whitespace name" },
      { editedAt: ago(19), editor: ME, diff: "Added a test. Could you take another look?" },
    ]);
    const rc4 = f.threads[0].comments.nodes.find((c: Node) => c.id === "RC_3")!;
    editedAt.set("RC_3", ago(21));
    edits.set("RC_3", [
      { editedAt: ago(21), editor: "carol", diff: "Thanks. Something like this would do:" + NL + "```ts" + NL + 'const who = name || "there";' + NL + "```" },
      { editedAt: ago(23), editor: "carol", diff: "Thanks. Maybe a fallback?", deletedAt: ago(1) },
    ]);
    void rc4;
  }
  if (sc === "minimisedComment") {
    minimised.set("IC_1", { reason: "off-topic" });
    minimised.set("RC_2", { reason: "resolved" });
    minimised.set("IC_3", { reason: "spam" });
  }
}

const isRo = (sc: string) => sc === "readOnlyViewer";

function allComments(): { node: Node; thread?: Node; list: Node[]; pr: number; kind: "IssueComment" | "PullRequestReviewComment" | "PullRequestReview" }[] {
  const out: ReturnType<typeof allComments> = [];
  for (const [n, f] of Object.entries(feeds)) {
    for (const t of f.timeline) {
      if (t.__typename === "IssueComment") out.push({ node: t, list: f.timeline, pr: Number(n), kind: "IssueComment" });
      if (t.__typename === "PullRequestReview") out.push({ node: t, list: f.timeline, pr: Number(n), kind: "PullRequestReview" });
    }
    for (const t of f.threads) for (const c of t.comments.nodes) out.push({ node: c, thread: t, list: t.comments.nodes, pr: Number(n), kind: "PullRequestReviewComment" });
  }
  return out;
}

function groups(id: string) {
  const r = reactions.get(id) ?? {};
  return CONTENTS.map((content) => ({ content, reactors: { totalCount: r[content]?.count ?? 0 }, viewerHasReacted: !!r[content]?.mine }));
}

function metaNode(c: ReturnType<typeof allComments>[number], sc: string): Node {
  const id = c.node.id as string;
  const mine = c.node.author?.login === ME;
  const ro = isRo(sc);
  const hidden = minimised.get(id);
  const hist = edits.get(id);
  return {
    __typename: c.kind, id, body: bodies.get(id) ?? c.node.body ?? "", ...(c.kind === "PullRequestReviewComment" ? { state: c.node.state ?? "SUBMITTED" } : c.kind === "PullRequestReview" ? { state: c.node.state } : {}),
    viewerDidAuthor: mine, lastEditedAt: editedAt.get(id) ?? null, includesCreatedEdit: !!hist,
    viewerCanUpdate: mine && !ro, viewerCanDelete: mine && !ro, viewerCanMinimize: !ro && !hidden, viewerCanUnminimize: !ro && !!hidden,
    isMinimized: !!hidden, minimizedReason: hidden?.reason ?? null, viewerCanReact: !ro, reactionGroups: groups(id),
  };
}

/** The feed query's data, with the scenario's state seeded and the fields batch 3 reads added (state, diffHunk, subjectType). */
export function overlayFeed(data: any, n: number, sc: string) {
  if (n !== PR) return data;
  seed(sc);
  const pr = data.repository.pullRequest;
  const ensure = (t: Node) => {
    for (const c of t.comments.nodes) {
      c.state ??= "SUBMITTED";
      c.diffHunk ??= hunkUpTo(patchOf(t.path), t.line ?? t.originalLine ?? 1, t.diffSide);
      if (bodies.has(c.id)) c.body = bodies.get(c.id);
    }
    t.subjectType ??= "LINE";
    return t;
  };
  pr.reviewThreads = { nodes: feeds[PR].threads.map(ensure) };
  pr.timelineItems = { ...pr.timelineItems, nodes: feeds[PR].timeline };
  return data;
}

const dataOf = (v: Record<string, any>) => v.input ?? {};
const forbidden = { code: 403 };

/** Reads batch 3 asks for. Returns the response body, `{ code }` for a bare status, or undefined when the query is not one of ours. */
export function commentsGraphql(query: string, v: Record<string, any>, sc: string): Record<string, unknown> | { code: number } | undefined {
  seed(sc);
  const f = feeds[PR];
  if (/^\s*mutation\b/.test(query)) return mutation(query, v, sc);
  if (query.includes("nodes(ids: $ids)")) {
    const found = new Map(allComments().map((c) => [c.node.id as string, c]));
    return { data: { nodes: (v.ids as string[]).map((id) => (found.get(id) ? metaNode(found.get(id)!, sc) : null)) } };
  }
  if (query.includes("userContentEdits(first: 20)")) {
    const c = allComments().find((x) => x.node.id === v.id);
    if (!c) return { data: { node: null } };
    return { data: { node: { __typename: c.kind, id: v.id, lastEditedAt: editedAt.get(v.id) ?? null, includesCreatedEdit: !!edits.get(v.id), userContentEdits: { totalCount: edits.get(v.id)?.length ?? 0, nodes: (edits.get(v.id) ?? []).map((e) => ({ editedAt: e.editedAt, deletedAt: e.deletedAt ?? null, editor: { login: e.editor }, diff: e.deletedAt ? null : e.diff })) } } } };
  }
  if (query.includes("reviews(states: [PENDING]")) {
    const mine = f.threads.flatMap((t) => t.comments.nodes).filter((c: Node) => c.state === "PENDING" && c.author?.login === ME).length;
    return { data: { viewer: { login: ME }, repository: { pullRequest: { id: f.prId, reviews: { nodes: pending ? [{ id: pending.id, state: "PENDING", body: "", viewerDidAuthor: true, author: { login: ME }, comments: { totalCount: mine } }] : [] } } } } };
  }
  if (query.includes("viewerCanApplySuggestion") && query.includes("headRefOid")) {
    return { data: { repository: { pullRequest: { id: f.prId, state: "OPEN", headRefName: "feature/retry", headRefOid: headSha(PR), isCrossRepository: false, maintainerCanModify: true, viewerCanApplySuggestion: !isRo(sc), headRepository: { nameWithOwner: PR_REPO } } } } };
  }
  if (query.includes("viewerCanReact viewerCanApplySuggestion")) {
    return { data: { node: { viewerCanReact: !isRo(sc), viewerCanApplySuggestion: !isRo(sc), reactionGroups: groups(v.id) } } };
  }
  if (query.includes("object(expression: $expression)")) {
    const [oid, ...rest] = String(v.expression).split(":");
    const text = contentAt(oid, rest.join(":"));
    return { data: { repository: { object: text === undefined ? null : { text, isBinary: false, byteSize: text.length } } } };
  }
  return undefined;
}

function mutation(query: string, v: Record<string, any>, sc: string) {
  const input = dataOf(v);
  const f = feeds[PR];
  const ours = /addPullRequestReview\(|addPullRequestReviewThread\(|submitPullRequestReview\(|deletePullRequestReview\(|updateIssueComment\(|updatePullRequestReviewComment\(|updatePullRequestReview\(|deleteIssueComment\(|deletePullRequestReviewComment\(|minimizeComment\(|unminimizeComment\(|addReaction\(|removeReaction\(|createCommitOnBranch\(/.test(query)
    || (query.includes("addPullRequestReviewThreadReply(") && input.pullRequestReviewId);
  if (!ours) return undefined;
  if (isRo(sc)) return forbidden;
  const all = allComments();
  const byId = (id: string) => all.find((c) => c.node.id === id);
  if (query.includes("addPullRequestReview(")) {
    pending = { id: `PRR_new_${nextSerial()}`, pr: PR };
    return { data: { addPullRequestReview: { pullRequestReview: { id: pending.id, state: "PENDING" } } } };
  }
  if (query.includes("addPullRequestReviewThreadReply(")) {
    const t = f.threads.find((x) => x.id === input.pullRequestReviewThreadId);
    if (!t) return { data: { addPullRequestReviewThreadReply: null } };
    const node = comment(`RC_new_${nextSerial()}`, ME, 0, input.body, "PENDING", t.path, t.line ?? t.originalLine ?? 1, t.diffSide, t.comments.nodes[0].id);
    t.comments.nodes.push(node);
    return { data: { addPullRequestReviewThreadReply: { comment: node } } };
  }
  if (query.includes("addPullRequestReviewThread(")) {
    const asReview = !!input.pullRequestReviewId;
    const file = input.subjectType === "FILE";
    const line = file ? null : input.line;
    const side = input.side ?? "RIGHT";
    const c = comment(`RC_new_${nextSerial()}`, ME, 0, input.body, asReview ? "PENDING" : "SUBMITTED", input.path, line ?? 1, side);
    if (file) c.diffHunk = "";
    const t = thread(`PRRT_new_${nextSerial()}`, input.path, line, input.startLine ?? null, side, [c], file ? { subjectType: "FILE", originalLine: null } : {});
    f.threads.push(t);
    return { data: { addPullRequestReviewThread: { thread: t } } };
  }
  if (query.includes("submitPullRequestReview(")) {
    const event = String(input.event);
    for (const t of f.threads) for (const c of t.comments.nodes) if (c.state === "PENDING" && c.author?.login === ME) c.state = "SUBMITTED";
    f.timeline.push({ __typename: "PullRequestReview", id: `RV_new_${nextSerial()}`, author: who(ME), state: event === "APPROVE" ? "APPROVED" : event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED", body: input.body ?? "", bodyHTML: input.body ? html(input.body) : "", submittedAt: ago(0), createdAt: ago(0), url: url(PR, "pullrequestreview-new") });
    const id = pending?.id;
    pending = null;
    return { data: { submitPullRequestReview: { pullRequestReview: { id, state: event === "APPROVE" ? "APPROVED" : event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED" } } } };
  }
  if (query.includes("deletePullRequestReview(") && !query.includes("deletePullRequestReviewComment(")) {
    for (const t of f.threads) t.comments.nodes = t.comments.nodes.filter((c: Node) => !(c.state === "PENDING" && c.author?.login === ME));
    f.threads = f.threads.filter((t) => t.comments.nodes.length);
    const id = pending?.id;
    pending = null;
    return { data: { deletePullRequestReview: { pullRequestReview: { id, state: "PENDING" } } } };
  }
  if (query.includes("updateIssueComment(") || query.includes("updatePullRequestReviewComment(")) {
    const id = input.id ?? input.pullRequestReviewCommentId;
    const c = byId(id);
    if (!c) return { data: null, errors: [{ message: "Could not resolve to a node" }] };
    const now = ago(0);
    bodies.set(id, input.body);
    c.node.body = input.body;
    c.node.bodyHTML = html(String(input.body).replace(/```suggestion[^]*?```/g, "").trim());
    editedAt.set(id, now);
    const hist = edits.get(id) ?? [{ editedAt: c.node.createdAt, editor: c.node.author?.login ?? "ghost", diff: c.node.body === input.body ? input.body : String(c.node.body) }];
    edits.set(id, [{ editedAt: now, editor: ME, diff: input.body }, ...hist]);
    const out = { id, body: input.body, bodyHTML: c.node.bodyHTML, lastEditedAt: now };
    return { data: c.kind === "IssueComment" ? { updateIssueComment: { issueComment: out } } : { updatePullRequestReviewComment: { pullRequestReviewComment: out } } };
  }
  if (query.includes("deleteIssueComment(") || query.includes("deletePullRequestReviewComment(")) {
    const c = byId(input.id);
    if (c) {
      const at = c.list.indexOf(c.node);
      c.list.splice(at, 1);
      if (c.thread && !c.thread.comments.nodes.length) f.threads = f.threads.filter((t) => t !== c.thread);
    }
    return { data: query.includes("deleteIssueComment(") ? { deleteIssueComment: { clientMutationId: null } } : { deletePullRequestReviewComment: { pullRequestReview: null, pullRequestReviewComment: { id: input.id } } } };
  }
  if (query.includes("unminimizeComment(") || query.includes("minimizeComment(")) {
    const un = query.includes("unminimizeComment(");
    if (un) minimised.delete(input.subjectId);
    else minimised.set(input.subjectId, { reason: String(input.classifier).toLowerCase().replace(/_/g, "-") });
    const hidden = minimised.get(input.subjectId);
    const r = { isMinimized: !!hidden, minimizedReason: hidden?.reason ?? null, viewerCanMinimize: !hidden, viewerCanUnminimize: !!hidden };
    return { data: un ? { unminimizeComment: { unminimizedComment: r } } : { minimizeComment: { minimizedComment: r } } };
  }
  if (query.includes("addReaction(") || query.includes("removeReaction(")) {
    const add = query.includes("addReaction(");
    const r = reactions.get(input.subjectId) ?? {};
    const cur = r[input.content] ?? { count: 0, mine: false };
    r[input.content] = add ? { count: cur.count + 1, mine: true } : { count: Math.max(0, cur.count - 1), mine: false };
    reactions.set(input.subjectId, r);
    return { data: { [add ? "addReaction" : "removeReaction"]: { reaction: { content: input.content }, subject: { id: input.subjectId, reactionGroups: groups(input.subjectId) } } } };
  }
  if (query.includes("createCommitOnBranch(")) {
    if (input.expectedHeadOid !== headSha(PR)) return { data: null, errors: [{ message: "Expected branch to point to the head commit" }] };
    const paths = new Set<string>((input.fileChanges?.additions ?? []).map((a: { path: string }) => a.path));
    // GitHub marks the threads of changed lines outdated once the code under them changes
    for (const t of f.threads) if (paths.has(t.path) && t.comments.nodes.some((c: Node) => /```suggestion/.test(String(c.body)))) Object.assign(t, { isOutdated: true, line: null, startLine: null });
    const oid = (0xfeed0000 + ++commitCount.n).toString(16).padEnd(40, "0");
    return { data: { createCommitOnBranch: { commit: { oid, url: `https://github.com/${PR_REPO}/commit/${oid}` }, ref: { name: "feature/retry", target: { oid } } } } };
  }
  return undefined;
}

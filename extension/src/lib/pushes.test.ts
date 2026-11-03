import { describe, it, expect } from "vitest";
import {
  ZERO_SHA,
  formatLocalDay,
  pushesPath,
  isPushActivity,
  mapActivity,
  groupPushesByDate,
  pushHeadsQuery,
  mapPushHeads,
  pushTitle,
  pushExpansion,
  type PushRow,
  type PushHead,
  type RestActivity,
} from "./pushes";
import { GHOST_AVATAR } from "./commitsQuery";
import { comparePath } from "./commitDetail";

// Module under test: src/lib/pushes.ts, C-4 "Pushes for a branch".
// DECISION, from a live check against cli/cli on 2026-11-02 (the requirement says `activity_type=push,force_push`):
//   GET /repos/{o}/{r}/activity takes a SINGLE activity_type. `push,force_push` is not a valid value, so GitHub ignores it and returns
//   every activity. Real values: push, force_push, pr_merge, merge_queue_merge, branch_creation, branch_deletion. Pushes made by merging a PR
//   come back as `pr_merge`, and a branch's first push as `branch_creation` (before = 40 zeros), which a push/force_push filter would hide.
//   So pushesPath sends NO activity_type, and isPushActivity drops `branch_deletion` client-side. Change these two tests if you decide otherwise.
// Other conventions fixed here:
//  - the `ref` query value is the whole `refs/heads/{branch}` passed through encodeURIComponent (so `feature/x` is refs%2Fheads%2Ffeature%2Fx).
//  - a null actor is the ghost. `forced` flags force_push for the UI; it does not change the title text.
//  - groupPushesByDate takes an injected day formatter, so tests do not depend on locale or time zone. Its default is formatLocalDay (dd/MM/yyyy, local time).
//  - header text is `${day} (${n} updates)`. The singular wording for one update is not pinned (the requirement only shows "N updates").
// GitHub names: REST "List repository activities" (before, after, ref, timestamp, activity_type, actor); GraphQL Commit.associatedPullRequests, PullRequest.mergeCommit.

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const norm = (s: string) => s.replace(/\s+/g, " ");

describe("C-4: pushesPath builds the activity URL for a branch", () => {
  it("asks for the branch's ref, 30 per page, with no activity_type filter", () => {
    expect(pushesPath("acme/web", "main"), "Expected /repos/{o}/{r}/activity?ref=refs%2Fheads%2Fmain&per_page=30").toBe("/repos/acme/web/activity?ref=refs%2Fheads%2Fmain&per_page=30");
  });

  it("encodes the slashes of a branch name", () => {
    expect(pushesPath("acme/web", "feature/jdp/tooling"), "Expected the whole ref to be percent-encoded").toBe(
      "/repos/acme/web/activity?ref=refs%2Fheads%2Ffeature%2Fjdp%2Ftooling&per_page=30"
    );
  });

  it.each([
    ["a b", "a%20b"],
    ["x&y=1", "x%26y%3D1"],
    ["50%", "50%25"],
    ["q#1", "q%231"],
  ])("encodes %j so it cannot add query parameters", (branch, enc) => {
    expect(pushesPath("acme/web", branch), `Expected "${branch}" to be encoded as ${enc}`).toBe(`/repos/acme/web/activity?ref=refs%2Fheads%2F${enc}&per_page=30`);
  });

  it("takes the page size as an argument", () => {
    expect(pushesPath("acme/web", "main", 100), "Expected per_page=100").toBe("/repos/acme/web/activity?ref=refs%2Fheads%2Fmain&per_page=100");
  });
});

describe("C-4: isPushActivity keeps the activities that moved the branch", () => {
  it.each(["push", "force_push", "pr_merge", "merge_queue_merge", "branch_creation"])("keeps %s", (type) => {
    expect(isPushActivity(type), `Expected ${type} to appear on the Pushes page`).toBe(true);
  });

  it("drops branch_deletion", () => {
    expect(isPushActivity("branch_deletion"), "Expected a deletion not to be listed as a push").toBe(false);
  });
});

const act = (over: Partial<RestActivity> = {}): RestActivity => ({
  before: A,
  after: B,
  activity_type: "push",
  timestamp: "2026-11-02T09:15:00Z",
  actor: { login: "alex", avatar_url: "https://example.test/a.png" },
  ...over,
});

describe("C-4: mapActivity builds a push row", () => {
  it("maps before, after, the 8-character short SHA, actor and date", () => {
    const p = mapActivity(act());
    expect(p.before, "Expected before").toBe(A);
    expect(p.after, "Expected after").toBe(B);
    expect(p.shortAfter, "Expected the first 8 characters of after").toBe("bbbbbbbb");
    expect(p.actor, "Expected the actor's login as name and login, with the avatar").toEqual({ name: "alex", login: "alex", avatarUrl: "https://example.test/a.png" });
    expect(p.date, "Expected the timestamp as a Date").toEqual(new Date("2026-11-02T09:15:00Z"));
  });

  it("flags a force push", () => {
    expect(mapActivity(act({ activity_type: "force_push" })).forced, "Expected forced for force_push").toBe(true);
  });

  it.each(["push", "pr_merge", "branch_creation"])("does not flag %s as forced", (type) => {
    expect(mapActivity(act({ activity_type: type })).forced, `Expected ${type} not to be forced`).toBe(false);
  });

  it("flags a branch creation (before is 40 zeros)", () => {
    expect(ZERO_SHA, "Expected 40 zeros").toBe("0".repeat(40));
    expect(mapActivity(act({ before: ZERO_SHA, activity_type: "branch_creation" })).created, "Expected created when before is all zeros").toBe(true);
    expect(mapActivity(act()).created, "Expected a normal push not to be a creation").toBe(false);
  });

  it("uses the ghost when the actor is gone", () => {
    expect(mapActivity(act({ actor: null })).actor, "Expected the ghost actor").toEqual({ name: "ghost", login: "ghost", avatarUrl: GHOST_AVATAR });
  });
});

describe("C-4: formatLocalDay is dd/MM/yyyy in local time", () => {
  // Dates are built from local components, so the expectation holds in any time zone.
  it("zero-pads day and month", () => {
    expect(formatLocalDay(new Date(2026, 0, 5, 0, 0, 0)), "Expected 05/01/2026").toBe("05/01/2026");
    expect(formatLocalDay(new Date(2026, 10, 2, 23, 59, 59)), "Expected 02/11/2026 late in the day").toBe("02/11/2026");
    expect(formatLocalDay(new Date(2026, 11, 31, 12)), "Expected 31/12/2026").toBe("31/12/2026");
  });
});

describe("C-4: groupPushesByDate groups by day, newest first", () => {
  const push = (iso: string, after: string): PushRow => mapActivity(act({ timestamp: iso, after }));
  // Injected formatter: the UTC day as dd/MM/yyyy, so the result does not depend on the machine's time zone.
  const utcDay = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

  it("puts pushes of one day in one group with an 'N updates' header", () => {
    const groups = groupPushesByDate([push("2026-11-02T08:00:00Z", A), push("2026-11-02T12:00:00Z", B), push("2026-11-02T10:00:00Z", C)], utcDay);
    expect(groups, "Expected a single group").toHaveLength(1);
    expect(groups[0].day, "Expected the formatted day").toBe("02/11/2026");
    expect(groups[0].header, "Expected `dd/MM/yyyy (N updates)`").toBe("02/11/2026 (3 updates)");
  });

  it("writes a plural header for two updates", () => {
    const groups = groupPushesByDate([push("2026-11-02T08:00:00Z", A), push("2026-11-02T09:00:00Z", B)], utcDay);
    expect(groups[0].header, "Expected 2 updates").toBe("02/11/2026 (2 updates)");
  });

  it("orders groups newest day first and pushes newest first within a group, whatever the input order", () => {
    const groups = groupPushesByDate(
      [push("2026-10-30T09:00:00Z", A), push("2026-11-02T08:00:00Z", B), push("2026-11-01T09:00:00Z", C), push("2026-11-02T12:00:00Z", "d".repeat(40))],
      utcDay
    );
    expect(groups.map((g) => g.day), "Expected days newest first").toEqual(["02/11/2026", "01/11/2026", "30/10/2026"]);
    expect(groups[0].pushes.map((p) => p.after), "Expected the 12:00 push before the 08:00 push").toEqual(["d".repeat(40), B]);
  });

  it("groups by the injected formatter's day, so a different formatter can split the same pushes", () => {
    const byHour = (d: Date) => `h${d.getUTCHours()}`;
    const groups = groupPushesByDate([push("2026-11-02T08:10:00Z", A), push("2026-11-02T08:50:00Z", B), push("2026-11-02T09:10:00Z", C)], byHour);
    expect(groups.map((g) => g.day), "Expected groups keyed by the formatter's output").toEqual(["h9", "h8"]);
    expect(groups[1].pushes, "Expected both 08:xx pushes together").toHaveLength(2);
  });

  it("returns no groups for no pushes", () => {
    expect(groupPushesByDate([], utcDay), "Expected an empty list").toEqual([]);
  });

  it("defaults to the local-day formatter", () => {
    const local = new Date(2026, 10, 2, 9, 0, 0);
    const groups = groupPushesByDate([{ ...push("2026-11-02T09:00:00Z", A), date: local }]);
    expect(groups[0].day, "Expected formatLocalDay's dd/MM/yyyy by default").toBe("02/11/2026");
  });
});

describe("C-4: pushHeadsQuery looks up the after commits in one request", () => {
  const req = () => pushHeadsQuery({ owner: "acme", name: "web", shas: [A, B] });

  it("sends each oid as a variable and returns the alias map", () => {
    expect(req().variables, "Expected { owner, name, o0, o1 }").toEqual({ owner: "acme", name: "web", o0: A, o1: B });
    expect(req().aliases, "Expected alias c0 to be the first oid and c1 the second").toEqual({ c0: A, c1: B });
  });

  it("declares the oids as GitObjectID! and selects them with object(oid: $oN)", () => {
    const q = norm(req().query);
    expect(q, "Expected $o0: GitObjectID!").toMatch(/\$o0:\s*GitObjectID!/);
    expect(q, "Expected $o1: GitObjectID!").toMatch(/\$o1:\s*GitObjectID!/);
    expect(q, "Expected c0: object(oid: $o0)").toMatch(/c0:\s*object\(oid:\s*\$o0\)/);
    expect(q, "Expected c1: object(oid: $o1)").toMatch(/c1:\s*object\(oid:\s*\$o1\)/);
  });

  it("selects the headline and the associated PRs with their merge commit", () => {
    const q = norm(req().query);
    expect(q, "Expected messageHeadline").toMatch(/messageHeadline/);
    expect(q, "Expected associatedPullRequests with number, title, state and mergeCommit { oid }").toMatch(
      /associatedPullRequests\([^)]*\)\s*\{\s*nodes\s*\{\s*number\s+title\s+state\s+mergeCommit\s*\{\s*oid\s*\}\s*\}\s*\}/
    );
  });

  it("keeps caller text out of the query", () => {
    const nasty = pushHeadsQuery({ owner: 'o"x', name: "n{", shas: ["$bad", "q uery"] });
    expect(nasty.query, "Expected the same text for any caller values with the same number of oids").toBe(req().query);
    expect(nasty.variables, "Expected the values in variables").toMatchObject({ owner: 'o"x', name: "n{", o0: "$bad", o1: "q uery" });
  });
});

describe("C-4: mapPushHeads finds the merged PR whose merge commit is the pushed commit", () => {
  const aliases = { c0: A, c1: B, c2: C };
  const pr = (number: number, state: string, merge: string | null) => ({ number, title: `PR ${number}`, state, mergeCommit: merge ? { oid: merge } : null });
  const body = {
    data: {
      repository: {
        // A is the merge commit of PR 7.
        c0: { oid: A, messageHeadline: "Merge pull request #7", associatedPullRequests: { nodes: [pr(7, "MERGED", A)] } },
        // B is a commit inside PR 7 (a different merge commit): not a merge push.
        c1: { oid: B, messageHeadline: "Fix typo", associatedPullRequests: { nodes: [pr(7, "MERGED", A)] } },
        // C has no PR; its headline is the only detail.
        c2: { oid: C, messageHeadline: "Direct push", associatedPullRequests: { nodes: [] } },
      },
    },
  };
  const heads = () => mapPushHeads(body, aliases);

  it("attaches the PR when its merge commit is the commit", () => {
    expect(heads()[A], "Expected PR 7 on the merge commit").toEqual({ sha: A, headline: "Merge pull request #7", pullRequest: { number: 7, title: "PR 7" } });
  });

  it("attaches no PR when the commit only belongs to a PR merged elsewhere", () => {
    expect(heads()[B], "Expected a null pullRequest when the PR's merge commit is another commit").toEqual({ sha: B, headline: "Fix typo", pullRequest: null });
  });

  it("attaches no PR when there is none", () => {
    expect(heads()[C].pullRequest, "Expected null with no associated PRs").toBeNull();
  });

  it("ignores an open PR even if its mergeCommit field were set", () => {
    const open = { data: { repository: { c0: { oid: A, messageHeadline: "h", associatedPullRequests: { nodes: [pr(8, "OPEN", A)] } } } } };
    expect(mapPushHeads(open, { c0: A })[A].pullRequest, "Expected only MERGED PRs to count").toBeNull();
  });

  it("picks the matching PR among several associated PRs", () => {
    const many = { data: { repository: { c0: { oid: A, messageHeadline: "h", associatedPullRequests: { nodes: [pr(3, "MERGED", C), pr(4, "MERGED", A)] } } } } };
    expect(mapPushHeads(many, { c0: A })[A].pullRequest, "Expected PR 4, whose merge commit is the commit").toEqual({ number: 4, title: "PR 4" });
  });

  it("leaves out commits GitHub did not return", () => {
    const missing = { data: { repository: { c0: null } } };
    expect(mapPushHeads(missing, { c0: A }), "Expected no entry for an unknown commit").toEqual({});
  });
});

describe("C-4: pushTitle", () => {
  const row = (over: Partial<RestActivity> = {}): PushRow => mapActivity(act(over));
  const head = (over: Partial<PushHead> = {}): PushHead => ({ sha: B, headline: "Fix the retry loop", pullRequest: null, ...over });

  it("reads 'Pull Request {n}: {pr title}' when a merged PR produced the push", () => {
    expect(pushTitle(row(), head({ pullRequest: { number: 3759, title: "Retry the sync" } })), "Expected the PR title form").toBe("Pull Request 3759: Retry the sync");
  });

  it("reads 'Updated to {short sha}: {headline}' otherwise", () => {
    expect(pushTitle(row(), head()), "Expected the update form with the 8-character SHA").toBe("Updated to bbbbbbbb: Fix the retry loop");
  });

  it("does not change the title for a force push (it is flagged on the row)", () => {
    expect(pushTitle(row({ activity_type: "force_push" }), head()), "Expected the same text; the UI shows the forced flag").toBe("Updated to bbbbbbbb: Fix the retry loop");
  });
});

describe("C-4: pushExpansion says which commits an expanded push lists", () => {
  it("compares before...after for a normal push", () => {
    const p = mapActivity(act());
    expect(pushExpansion("acme/web", p), "Expected the compare path for before...after").toEqual({ kind: "compare", path: comparePath("acme/web", A, B) });
  });

  it("compares before...after for a force push too", () => {
    const p = mapActivity(act({ activity_type: "force_push" }));
    expect(pushExpansion("acme/web", p), "Expected the compare path for a force push").toEqual({ kind: "compare", path: comparePath("acme/web", A, B) });
  });

  it("uses just the after commit for a branch creation", () => {
    const p = mapActivity(act({ before: ZERO_SHA, activity_type: "branch_creation" }));
    expect(pushExpansion("acme/web", p), "Expected only the after commit when before is all zeros").toEqual({ kind: "single", sha: B });
  });
});

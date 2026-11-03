import { describe, it, expect } from "vitest";
import { parseActions, serializeActions, applyActions, RUN_STATUS_FILTERS, type ActionsHashState } from "./actionsHash";
import { parse, serialize } from "./browseState";
import { applyListFilters, parseListFilters } from "./prListFilters";
import { NASTY } from "./ciTestHelpers";

// Module under test: src/lib/actionsHash.ts (frozen contract; parseActions, serializeActions and applyActions throw "not implemented" until the developer fills them in).
// Requirement ACT-17: the Actions page's place in the location hash. The rules are in the header of actionsHash.ts and are quoted by the tests below.
// Mirrors securityHash.ts and its test: the keys are `view=actions`, then `actTab`, `actWorkflow`, `actRun`, `actAttempt`, `actJob`, `actLine`, and the run filters
// `actBranch`, `actStatus`, `actActor`, `actEvent`. The header's "tab=runs" is the `actTab` key; a bare `tab` key belongs to browseState.

const REPO = "octo/demo";
const ENC = "repo=octo%2Fdemo";
const base = `#${ENC}&view=actions`;

describe("ACT-17: serializeActions", () => {
  // serializeActions writes `#repo=...&view=actions` then the keys in the order listed above, leaving out anything absent, and never writes tab=recent.
  it("writes just the repo and view for the landing page", () => {
    expect(serializeActions({ repo: REPO }), "Expected only repo and view").toBe(base);
  });

  it("writes every key in the documented order, encoded", () => {
    const s: ActionsHashState = {
      repo: REPO,
      tab: "runs",
      workflow: 404735568,
      run: 41617937185,
      attempt: 2,
      job: 125855973951,
      line: 42,
      branch: "release/1.0",
      status: "failure",
      actor: "JoePittsy",
      event: "push",
    };
    expect(serializeActions(s), "Expected actTab, actWorkflow, actRun, actAttempt, actJob, actLine, actBranch, actStatus, actActor, actEvent in that order").toBe(
      `${base}&actTab=runs&actWorkflow=404735568&actRun=41617937185&actAttempt=2&actJob=125855973951&actLine=42&actBranch=release%2F1.0&actStatus=failure&actActor=JoePittsy&actEvent=push`
    );
  });

  it("writes a workflow's runs page with its filters", () => {
    expect(serializeActions({ repo: REPO, workflow: 404735568, branch: "main", status: "in_progress" }), "Expected actWorkflow then the filters").toBe(
      `${base}&actWorkflow=404735568&actBranch=main&actStatus=in_progress`
    );
  });

  it("writes a run page with its attempt, job and line", () => {
    expect(serializeActions({ repo: REPO, run: 41617937185, attempt: 2, job: 125855973951, line: 7 }), "Expected actRun, actAttempt, actJob, actLine").toBe(
      `${base}&actRun=41617937185&actAttempt=2&actJob=125855973951&actLine=7`
    );
  });

  it("writes the 'all' and 'runs' tabs", () => {
    expect(serializeActions({ repo: REPO, tab: "all" }), "Expected actTab=all").toBe(`${base}&actTab=all`);
    expect(serializeActions({ repo: REPO, tab: "runs" }), "Expected actTab=runs").toBe(`${base}&actTab=runs`);
  });

  it("never writes tab=recent, the default", () => {
    expect(serializeActions({ repo: REPO, tab: "recent" }), "Expected the default tab to be left out").toBe(base);
  });

  it("leaves out blank filters", () => {
    expect(serializeActions({ repo: REPO, tab: "runs", branch: "  ", actor: "", event: " " }), "Expected blank filters to be left out").toBe(`${base}&actTab=runs`);
  });

  it("encodes the repository, so its slash is %2F", () => {
    expect(serializeActions({ repo: "TrueNorthIT/ado-github-repos" }), "Expected the repo slash encoded").toBe("#repo=TrueNorthIT%2Fado-github-repos&view=actions");
  });

  it("encodes filter values (slash, space and ampersand)", () => {
    const hash = serializeActions({ repo: REPO, tab: "runs", branch: "feature/a b", actor: "a&b" });
    expect(hash, "Expected the branch and actor encoded").toBe(`${base}&actTab=runs&actBranch=feature%2Fa%20b&actActor=a%26b`);
  });

  it("writes each documented status filter as is", () => {
    for (const status of RUN_STATUS_FILTERS) {
      expect(serializeActions({ repo: REPO, tab: "runs", status }), `Expected actStatus=${status}`).toBe(`${base}&actTab=runs&actStatus=${status}`);
    }
  });

  it("caps branch at 255 characters, actor at 100 and event at 50 (seen when read back)", () => {
    const back = parseActions(serializeActions({ repo: REPO, tab: "runs", branch: "b".repeat(400), actor: "a".repeat(400), event: "e".repeat(400) }));
    expect(back, "Expected the values cut to their caps").toEqual({ repo: REPO, tab: "runs", branch: "b".repeat(255), actor: "a".repeat(100), event: "e".repeat(50) });
  });

  it("trims filter values (seen when read back)", () => {
    const back = parseActions(serializeActions({ repo: REPO, tab: "runs", branch: "  main  ", actor: " ada ", event: " push " }));
    expect(back, "Expected the whitespace trimmed").toEqual({ repo: REPO, tab: "runs", branch: "main", actor: "ada", event: "push" });
  });
});

describe("ACT-17: parseActions", () => {
  it("reads the landing page, with no tab", () => {
    expect(parseActions(base), "Expected only the repo").toEqual({ repo: REPO });
  });

  it("reads the 'all' and 'runs' tabs", () => {
    expect(parseActions(`${base}&actTab=all`), "Expected tab all").toEqual({ repo: REPO, tab: "all" });
    expect(parseActions(`${base}&actTab=runs`), "Expected tab runs").toEqual({ repo: REPO, tab: "runs" });
  });

  it("drops an unknown tab", () => {
    expect(parseActions(`${base}&actTab=history`), "Expected the unknown tab dropped").toEqual({ repo: REPO });
  });

  it("reads a workflow's runs page with its filters (actWorkflow is a workflow's numeric id)", () => {
    const hash = `${base}&actWorkflow=404735568&actBranch=main&actStatus=failure&actActor=JoePittsy&actEvent=push`;
    expect(parseActions(hash), "Expected the workflow and all four filters").toEqual({ repo: REPO, workflow: 404735568, branch: "main", status: "failure", actor: "JoePittsy", event: "push" });
  });

  it("reads a run page (actRun is a run's numeric id, which may exceed 32 bits)", () => {
    expect(parseActions(`${base}&actRun=41617937185`), "Expected the run id").toEqual({ repo: REPO, run: 41617937185 });
  });

  it("reads a run page's attempt", () => {
    expect(parseActions(`${base}&actRun=41617937185&actAttempt=2`), "Expected run and attempt").toEqual({ repo: REPO, run: 41617937185, attempt: 2 });
  });

  it("reads a job's log view and a line to scroll to", () => {
    expect(parseActions(`${base}&actRun=41617937185&actJob=125855973951&actLine=42`), "Expected run, job and line").toEqual({ repo: REPO, run: 41617937185, job: 125855973951, line: 42 });
  });

  it("accepts a hash without '#' or with several (ADO's breadcrumb prefixes its own)", () => {
    expect(parseActions(`${ENC}&view=actions`), "Expected no leading # to be fine").toEqual({ repo: REPO });
    expect(parseActions(`##${ENC}&view=actions`), "Expected '##' to be fine").toEqual({ repo: REPO });
  });

  it("is null unless the view is actions", () => {
    expect(parseActions(`#${ENC}&actTab=runs`), "Expected null without a view").toBeNull();
    expect(parseActions(`#${ENC}&view=prs&actTab=runs`), "Expected null for another view").toBeNull();
    expect(parseActions(`#${ENC}&view=security`), "Expected null for the Security view").toBeNull();
    expect(parseActions(""), "Expected null for an empty hash").toBeNull();
  });

  it("is null without a valid repository", () => {
    expect(parseActions("#view=actions&actTab=runs"), "Expected null without a repo").toBeNull();
    expect(parseActions("#repo=../x&view=actions"), "Expected null for an invalid repo").toBeNull();
    expect(parseActions("#repo=nonsense&view=actions"), "Expected null for a repo without an owner").toBeNull();
  });

  const BAD_NUMBERS = ["0", "-3", "1.5", "abc", "", "007x", "1e3", "0x10", "99999999999999999999", "9007199254740992"];

  it("drops an actWorkflow that is not a positive safe integer", () => {
    for (const bad of BAD_NUMBERS) expect(parseActions(`${base}&actWorkflow=${bad}`), `Expected actWorkflow=${bad} dropped`).toEqual({ repo: REPO });
  });

  it("drops an actRun that is not a positive safe integer", () => {
    for (const bad of BAD_NUMBERS) expect(parseActions(`${base}&actRun=${bad}`), `Expected actRun=${bad} dropped`).toEqual({ repo: REPO });
  });

  it("drops an actAttempt that is not a positive safe integer, keeping the run", () => {
    for (const bad of BAD_NUMBERS) expect(parseActions(`${base}&actRun=5&actAttempt=${bad}`), `Expected actAttempt=${bad} dropped`).toEqual({ repo: REPO, run: 5 });
  });

  it("drops an actJob that is not a positive safe integer, keeping the run", () => {
    for (const bad of BAD_NUMBERS) expect(parseActions(`${base}&actRun=5&actJob=${bad}`), `Expected actJob=${bad} dropped`).toEqual({ repo: REPO, run: 5 });
  });

  it("drops an actLine that is not a positive safe integer, keeping the job", () => {
    for (const bad of BAD_NUMBERS) expect(parseActions(`${base}&actRun=5&actJob=9&actLine=${bad}`), `Expected actLine=${bad} dropped`).toEqual({ repo: REPO, run: 5, job: 9 });
  });

  it("accepts the largest safe integer", () => {
    expect(parseActions(`${base}&actRun=9007199254740991`), "Expected 2^53 - 1 accepted").toEqual({ repo: REPO, run: 9007199254740991 });
  });

  it("drops actAttempt, actJob and actLine when there is no actRun", () => {
    expect(parseActions(`${base}&actAttempt=2&actJob=9&actLine=3`), "Expected the children dropped without a run").toEqual({ repo: REPO });
  });

  it("drops a run's children when the actRun is invalid", () => {
    expect(parseActions(`${base}&actRun=abc&actAttempt=2&actJob=9&actLine=3`), "Expected a dropped parent to drop its children").toEqual({ repo: REPO });
  });

  it("drops actLine when there is no actJob", () => {
    expect(parseActions(`${base}&actRun=5&actLine=3`), "Expected the line dropped without a job").toEqual({ repo: REPO, run: 5 });
  });

  it("drops actLine when the actJob is invalid, keeping the run", () => {
    expect(parseActions(`${base}&actRun=5&actJob=abc&actLine=3`), "Expected the line dropped with its job").toEqual({ repo: REPO, run: 5 });
  });

  it("keeps the job when only the attempt is invalid (the attempt is not the job's parent)", () => {
    expect(parseActions(`${base}&actRun=5&actAttempt=abc&actJob=9&actLine=3`), "Expected run, job and line kept").toEqual({ repo: REPO, run: 5, job: 9, line: 3 });
  });

  it("keeps the filters with an actWorkflow", () => {
    expect(parseActions(`${base}&actWorkflow=12&actBranch=main&actStatus=queued&actActor=ada&actEvent=schedule`), "Expected every filter kept").toEqual({
      repo: REPO,
      workflow: 12,
      branch: "main",
      status: "queued",
      actor: "ada",
      event: "schedule",
    });
  });

  it("keeps the filters with tab=runs", () => {
    expect(parseActions(`${base}&actTab=runs&actBranch=main&actStatus=success&actActor=ada&actEvent=push`), "Expected every filter kept").toEqual({
      repo: REPO,
      tab: "runs",
      branch: "main",
      status: "success",
      actor: "ada",
      event: "push",
    });
  });

  it("drops the filters without an actWorkflow or tab=runs", () => {
    expect(parseActions(`${base}&actBranch=main&actStatus=failure&actActor=ada&actEvent=push`), "Expected filters dropped on the landing page with no tab").toEqual({ repo: REPO });
    expect(parseActions(`${base}&actTab=all&actBranch=main&actActor=ada`), "Expected filters dropped on tab=all").toEqual({ repo: REPO, tab: "all" });
    expect(parseActions(`${base}&actRun=5&actBranch=main&actStatus=failure`), "Expected filters dropped on a run page").toEqual({ repo: REPO, run: 5 });
  });

  it("drops the filters when the actWorkflow is invalid and the tab is not runs", () => {
    expect(parseActions(`${base}&actWorkflow=abc&actBranch=main&actActor=ada`), "Expected a dropped workflow to drop the filters").toEqual({ repo: REPO });
  });

  it("reads every documented status filter and drops any other", () => {
    for (const status of RUN_STATUS_FILTERS) expect(parseActions(`${base}&actTab=runs&actStatus=${status}`)?.status, `Expected status ${status} read`).toBe(status);
    expect(parseActions(`${base}&actTab=runs&actStatus=done`), "Expected an unknown status dropped").toEqual({ repo: REPO, tab: "runs" });
    expect(parseActions(`${base}&actTab=runs&actStatus=`), "Expected a blank status dropped").toEqual({ repo: REPO, tab: "runs" });
  });

  it("trims filter values and drops blank ones", () => {
    expect(parseActions(`${base}&actTab=runs&actBranch=%20main%20&actActor=&actEvent=%20`), "Expected main trimmed, no actor or event").toEqual({ repo: REPO, tab: "runs", branch: "main" });
  });

  it("caps branch at 255 characters, actor at 100 and event at 50", () => {
    const hash = `${base}&actTab=runs&actBranch=${"b".repeat(300)}&actActor=${"a".repeat(300)}&actEvent=${"e".repeat(300)}`;
    expect(parseActions(hash), "Expected the long values cut to their caps").toEqual({ repo: REPO, tab: "runs", branch: "b".repeat(255), actor: "a".repeat(100), event: "e".repeat(50) });
  });

  it("keeps a value exactly at its cap whole", () => {
    const hash = `${base}&actTab=runs&actBranch=${"b".repeat(255)}&actActor=${"a".repeat(100)}&actEvent=${"e".repeat(50)}`;
    expect(parseActions(hash), "Expected values of exactly the cap length kept whole").toEqual({ repo: REPO, tab: "runs", branch: "b".repeat(255), actor: "a".repeat(100), event: "e".repeat(50) });
  });

  it("never throws", () => {
    for (const bad of ["#%E0%A4%A", `${base}&actBranch=%E0%A4%A`, `${base}&actTab=runs&actActor=%E0%A4%A`, "#&&&", "=", "#repo=%"]) {
      expect(() => parseActions(bad), `Expected ${bad} not to throw`).not.toThrow();
    }
  });
});

describe("ACT-17: round trips", () => {
  const states: [string, ActionsHashState][] = [
    ["the landing page", { repo: REPO }],
    ["the all tab", { repo: REPO, tab: "all" }],
    ["the runs tab with filters", { repo: REPO, tab: "runs", branch: "main", status: "failure", actor: "ada", event: "push" }],
    ["a workflow's runs page with filters", { repo: REPO, workflow: 404735568, branch: "release/1.0", status: "in_progress", actor: "ada", event: "workflow_dispatch" }],
    ["a run page", { repo: REPO, run: 41617937185 }],
    ["a run page at an attempt", { repo: REPO, run: 41617937185, attempt: 3 }],
    ["a job's log view", { repo: REPO, run: 41617937185, attempt: 2, job: 125855973951 }],
    ["a log line", { repo: REPO, run: 41617937185, job: 125855973951, line: 117 }],
  ];
  for (const [name, state] of states) {
    it(`parseActions reads back what serializeActions wrote for ${name}`, () => {
      expect(parseActions(serializeActions(state)), `Expected ${name} to survive the hash`).toEqual(state);
    });
  }

  it("reads back every documented status filter", () => {
    for (const status of RUN_STATUS_FILTERS) {
      const s: ActionsHashState = { repo: REPO, tab: "runs", status };
      expect(parseActions(serializeActions(s)), `Expected status ${status} to survive the hash`).toEqual(s);
    }
  });

  it("reads back awkward filter values", () => {
    for (const v of NASTY) {
      const s: ActionsHashState = { repo: REPO, tab: "runs", branch: v, actor: v, event: v };
      expect(parseActions(serializeActions(s)), `Expected ${JSON.stringify(v)} to survive the hash`).toEqual(s);
    }
  });

  it("reads back a repository name with dots and hyphens", () => {
    const s: ActionsHashState = { repo: "TrueNorthIT/ado-github-repos" };
    expect(parseActions(serializeActions(s)), "Expected the repo to survive").toEqual(s);
  });
});

describe("ACT-17: applyActions", () => {
  // applyActions(hash, s) keeps the hash's other segments verbatim and in order, drops every earlier `view` and every key of this module,
  // and appends `view=actions` then the module's keys in the order above.
  it("keeps other segments in order, drops the earlier view and its own keys, and puts its own last", () => {
    expect(applyActions(`#${ENC}&view=prs&prTab=active&actTab=all&actRun=1&actBranch=old`, { tab: "runs", branch: "main" }), "Expected prTab kept and the old keys replaced").toBe(
      `#${ENC}&prTab=active&view=actions&actTab=runs&actBranch=main`
    );
  });

  it("keeps the other segments verbatim, encoding and all", () => {
    expect(applyActions(`#${ENC}&ref=feature%2Fa%20b&path=src%2Findex.ts&view=repos`, { run: 5 }), "Expected ref and path untouched").toBe(
      `#${ENC}&ref=feature%2Fa%20b&path=src%2Findex.ts&view=actions&actRun=5`
    );
  });

  it("adds a leading # to a hash without one", () => {
    expect(applyActions("view=prs", { tab: "runs" }), "Expected a leading #").toBe("#view=actions&actTab=runs");
  });

  it("removes the old keys when the new state has none", () => {
    expect(applyActions(`#${ENC}&actTab=runs&actStatus=failure&actRun=3&actJob=4&actLine=5`, {}), "Expected absent keys to remove the old ones").toBe(base);
  });

  it("writes a run page's keys in the documented order", () => {
    expect(applyActions(`#${ENC}`, { run: 41617937185, attempt: 2, job: 125855973951, line: 9 }), "Expected actRun, actAttempt, actJob, actLine").toBe(
      `${base}&actRun=41617937185&actAttempt=2&actJob=125855973951&actLine=9`
    );
  });

  it("writes a workflow page's keys in the documented order, encoded", () => {
    expect(applyActions(`#${ENC}`, { workflow: 12, branch: "feature/a b", status: "success", actor: "ada", event: "push" }), "Expected actWorkflow then the filters").toBe(
      `${base}&actWorkflow=12&actBranch=feature%2Fa%20b&actStatus=success&actActor=ada&actEvent=push`
    );
  });

  it("never writes tab=recent", () => {
    expect(applyActions(`#${ENC}&actTab=all`, { tab: "recent" }), "Expected the default tab left out and the old one removed").toBe(base);
  });

  it("leaves the other modules' keys alone (Security's secTab is not this module's key)", () => {
    expect(applyActions(`#${ENC}&view=security&secTab=code&alert=4`, { tab: "all" }), "Expected the Security view replaced but secTab and alert kept").toBe(`#${ENC}&secTab=code&alert=4&view=actions&actTab=all`);
  });

  it("gives the same hash as serializeActions for a bare repo hash", () => {
    const s = { tab: "runs" as const, branch: "main", status: "failure" as const };
    expect(applyActions(`#${ENC}`, s), "Expected apply on '#repo=...' to equal serialize").toBe(serializeActions({ repo: REPO, ...s }));
  });
});

describe("ACT-17: alongside browseState and the other hash modules", () => {
  it("browseState keeps the repository of an Actions hash but not its view or keys", () => {
    const hash = serializeActions({ repo: REPO, run: 41617937185, attempt: 2, job: 125855973951, line: 3 });
    expect(parse(hash), "Expected browseState to read the repo and ignore the Actions keys (no key collision)").toEqual({ repo: REPO });
  });

  it("browseState ignores a filtered runs-page hash too", () => {
    const hash = serializeActions({ repo: REPO, tab: "runs", branch: "main", status: "failure", actor: "ada", event: "push" });
    expect(parse(hash), "Expected the filters not to collide with a browseState key").toEqual({ repo: REPO });
  });

  it("applyActions puts the keys back on a hash that browseState rewrote", () => {
    const state = { run: 41617937185, attempt: 2, job: 125855973951, line: 3 };
    const original = serializeActions({ repo: REPO, ...state });
    expect(applyActions(serialize(parse(original)), state), "Expected the original hash back").toBe(original);
  });

  it("turns a pull request list hash into an Actions hash that both modules can read", () => {
    const hash = applyActions(serialize({ repo: REPO, view: "prs", prTab: "active" }), { tab: "all" });
    expect(parse(hash), "Expected browseState to read the repo").toEqual({ repo: REPO });
    expect(parseActions(hash), "Expected parseActions to read the tab").toEqual({ repo: REPO, tab: "all" });
  });

  it("does not collide with the pull request filter keys", () => {
    const hash = applyListFilters(serializeActions({ repo: REPO, tab: "runs", branch: "main", actor: "ada", event: "push" }), { author: "ada", text: "pr text", base: "main" });
    expect(parseActions(hash), "Expected the Actions filters to be untouched by the PR filters").toEqual({ repo: REPO, tab: "runs", branch: "main", actor: "ada", event: "push" });
    expect(parseListFilters(hash), "Expected the PR filters to be untouched by the Actions keys").toEqual({ author: "ada", text: "pr text", base: "main" });
  });
});

describe("Environments tab: actTab=environments and actEnv", () => {
  it("writes and reads the tab and an environment", () => {
    expect(serializeActions({ repo: REPO, tab: "environments" })).toBe(`${base}&actTab=environments`);
    expect(serializeActions({ repo: REPO, tab: "environments", env: "staging & qa" })).toBe(`${base}&actTab=environments&actEnv=staging%20%26%20qa`);
    expect(parseActions(`${base}&actTab=environments&actEnv=staging%20%26%20qa`)).toEqual({ repo: REPO, tab: "environments", env: "staging & qa" });
  });

  it("writes and reads actEnv only with tab=environments", () => {
    expect(serializeActions({ repo: REPO, env: "prod" })).toBe(base);
    expect(serializeActions({ repo: REPO, tab: "runs", env: "prod" })).toBe(`${base}&actTab=runs`);
    expect(parseActions(`${base}&actEnv=prod`)).toEqual({ repo: REPO });
    expect(parseActions(`${base}&actTab=runs&actEnv=prod`)).toEqual({ repo: REPO, tab: "runs" });
  });

  it("drops actEnv beside a workflow or a run, and a blank one", () => {
    expect(parseActions(`${base}&actTab=environments&actWorkflow=5&actEnv=prod`)).toEqual({ repo: REPO, tab: "environments", workflow: 5 });
    expect(parseActions(`${base}&actTab=environments&actRun=5&actEnv=prod`)).toEqual({ repo: REPO, tab: "environments", run: 5 });
    expect(parseActions(`${base}&actTab=environments&actEnv=%20%20`)).toEqual({ repo: REPO, tab: "environments" });
  });

  it("caps the name at 255 characters and round-trips through applyActions", () => {
    const long = "e".repeat(300);
    expect(parseActions(`${base}&actTab=environments&actEnv=${long}`)?.env).toHaveLength(255);
    const h = applyActions("#repo=octo%2Fdemo&view=actions&actTab=environments&actEnv=old&other=1", { tab: "environments", env: "new" });
    expect(h).toBe("#repo=octo%2Fdemo&other=1&view=actions&actTab=environments&actEnv=new");
  });
});

import { describe, it, expect } from "vitest";
import { createPullRequestMutation, planCreatePr, executeCreatePlan, type CreatePrParams, type CreatedPr } from "./createPrPlan";
import { requestReviewsMutation, addAssigneesMutation } from "./reviewerSearch";
import { addLabelsMutation } from "./labels";
import { setMilestoneMutation } from "./milestones";
import { addProjectItemMutation } from "./projects";
import { enableAutoMergeMutation } from "./actionsQuery";
import { MAX_TITLE_LENGTH } from "./prEdit";
import type { GraphQlRequest } from "./prQuery";
import { expectMutation, expectNotInQuery, NASTY } from "./ciTestHelpers";
import { expectNestedSelection } from "./b4TestHelpers";

// Module under test: src/lib/createPrPlan.ts (stubs until the developer implements them). Requirement CP-4: "createPullRequest(input:{repositoryId, baseRefName, headRefName, title, body, draft,
// maintainerCanModify}), plus follow-ups once the PR id is known: requestReviews (users and teams), addLabelsToLabelable, addAssigneesToAssignable, updatePullRequest(milestoneId), and project adds.
// Build a pure plan: an ordered list of requests. Report partial failure ("Created PR #12, but adding reviewers failed: ...") without losing the created PR. An auto-complete option enables auto-merge
// after creation (enablePullRequestAutoMerge) if autoMergeAllowed, reusing existing builders where they exist." Schema facts and decisions are in the header of src/lib/createPrPlan.ts.

const BASE: CreatePrParams = { repositoryId: "R_1", baseRefName: "main", headRefName: "feature/x", title: "Add login" };
const PR: CreatedPr = { id: "PR_node", number: 12, url: "https://github.com/octo/demo/pull/12", headRefOid: "0123456789abcdef0123456789abcdef01234567" };

describe("CP-4: createPullRequestMutation", () => {
  it("is a createPullRequest mutation taking $input: CreatePullRequestInput! and returning the id, number, url and head oid", () => {
    const req = createPullRequestMutation(BASE);
    expectMutation(req, "CreatePullRequestInput", "createPullRequest");
    expectNestedSelection(req, /createPullRequest\(input:\s*\$input\)/, ["pullRequest", "id", "number", "url", "headRefOid"], "the created pull request");
  });

  it("sends exactly the seven fields, with the GitHub defaults draft false and maintainerCanModify true", () => {
    expect(createPullRequestMutation(BASE).variables, "Expected the input with body '' and the defaults").toEqual({
      input: { repositoryId: "R_1", baseRefName: "main", headRefName: "feature/x", title: "Add login", body: "", draft: false, maintainerCanModify: true },
    });
  });

  it("sends the given body, draft and maintainerCanModify", () => {
    const { input } = createPullRequestMutation({ ...BASE, body: "Text\r\n\r\nAB#1", draft: true, maintainerCanModify: false }).variables as { input: Record<string, unknown> };
    expect([input.body, input.draft, input.maintainerCanModify], "Expected the options to be passed through").toEqual(["Text\r\n\r\nAB#1", true, false]);
  });

  it("trims the title", () => {
    const { input } = createPullRequestMutation({ ...BASE, title: "  Add login \n" }).variables as { input: { title: string } };
    expect(input.title, "Expected the title trimmed").toBe("Add login");
  });

  it("keeps awkward values out of the query text", () => {
    for (const v of NASTY) {
      const req = createPullRequestMutation({ repositoryId: v, baseRefName: v, headRefName: v, title: v, body: v });
      expectNotInQuery(req, [v]);
    }
  });

  it("refuses a missing repository id, branch name or title", () => {
    expect(() => createPullRequestMutation({ ...BASE, repositoryId: " " }), "Expected an error for a blank repository id").toThrow("repositoryId is required");
    expect(() => createPullRequestMutation({ ...BASE, baseRefName: "" }), "Expected an error for a blank target").toThrow("baseRefName is required");
    expect(() => createPullRequestMutation({ ...BASE, headRefName: "" }), "Expected an error for a blank source").toThrow("headRefName is required");
    expect(() => createPullRequestMutation({ ...BASE, title: "  " }), "Expected an error for a blank title").toThrow("title is required");
  });

  it("refuses a title over the limit, counting code points", () => {
    expect(() => createPullRequestMutation({ ...BASE, title: "😀".repeat(MAX_TITLE_LENGTH + 1) }), "Expected an error one code point over the limit").toThrow(`Title is too long (maximum is ${MAX_TITLE_LENGTH} characters)`);
    expect(() => createPullRequestMutation({ ...BASE, title: "😀".repeat(MAX_TITLE_LENGTH) }), "Expected a title at the limit to be accepted").not.toThrow();
  });
});

describe("CP-4: planCreatePr orders the requests", () => {
  it("is the create request and no follow-ups when nothing else was chosen", () => {
    const plan = planCreatePr(BASE);
    expect(plan.create, "Expected the create request to be createPullRequestMutation's").toEqual(createPullRequestMutation(BASE));
    expect(plan.followUps, "Expected no follow-ups").toEqual([]);
  });

  it("plans reviewers, labels, assignees, milestone, projects, then auto-complete, in that order", () => {
    const plan = planCreatePr({
      ...BASE,
      reviewerUserIds: ["U_1"],
      reviewerTeamIds: ["T_1"],
      labelIds: ["L_1"],
      assigneeIds: ["U_2"],
      milestoneId: "M_1",
      projectIds: ["P_1", "P_2"],
      autoComplete: { mergeMethod: "SQUASH" },
      autoMergeAllowed: true,
    });
    expect(plan.followUps.map((f) => f.kind), "Expected reviewers, labels, assignees, milestone, one project each, auto-complete last").toEqual([
      "reviewers",
      "labels",
      "assignees",
      "milestone",
      "project",
      "project",
      "autoComplete",
    ]);
    expect(plan.followUps.map((f) => f.doing), "Expected the phrases used in failure messages").toEqual([
      "adding reviewers",
      "adding labels",
      "adding assignees",
      "setting the milestone",
      "adding to a project",
      "adding to a project",
      "enabling auto-complete",
    ]);
  });

  it("builds the reviewers request with requestReviewsMutation for the new pull request's id, users and teams", () => {
    const [f] = planCreatePr({ ...BASE, reviewerUserIds: ["U_1", "U_2"], reviewerTeamIds: ["T_1"] }).followUps;
    expect(f.build(PR), "Expected requestReviewsMutation({ pullRequestId, userIds, teamIds })").toEqual(requestReviewsMutation({ pullRequestId: "PR_node", userIds: ["U_1", "U_2"], teamIds: ["T_1"] }));
  });

  it("plans reviewers when only teams were chosen", () => {
    const [f] = planCreatePr({ ...BASE, reviewerTeamIds: ["T_1"] }).followUps;
    expect(f.build(PR), "Expected a team-only requestReviews").toEqual(requestReviewsMutation({ pullRequestId: "PR_node", teamIds: ["T_1"] }));
  });

  it("builds the labels request with addLabelsMutation", () => {
    const [f] = planCreatePr({ ...BASE, labelIds: ["L_1", "L_2"] }).followUps;
    expect(f.build(PR), "Expected addLabelsMutation(prId, labelIds)").toEqual(addLabelsMutation("PR_node", ["L_1", "L_2"]));
  });

  it("builds the assignees request with addAssigneesMutation", () => {
    const [f] = planCreatePr({ ...BASE, assigneeIds: ["U_9"] }).followUps;
    expect(f.build(PR), "Expected addAssigneesMutation(prId, assigneeIds)").toEqual(addAssigneesMutation("PR_node", ["U_9"]));
  });

  it("builds the milestone request with setMilestoneMutation (updatePullRequest)", () => {
    const [f] = planCreatePr({ ...BASE, milestoneId: "M_1" }).followUps;
    expect(f.build(PR), "Expected setMilestoneMutation(prId, milestoneId)").toEqual(setMilestoneMutation("PR_node", "M_1"));
  });

  it("builds one project request per project with addProjectItemMutation, the pull request id as contentId", () => {
    const fs = planCreatePr({ ...BASE, projectIds: ["P_1", "P_2"] }).followUps;
    expect(fs.map((f) => f.build(PR)), "Expected addProjectItemMutation for each project in order").toEqual([
      addProjectItemMutation({ projectId: "P_1", contentId: "PR_node" }),
      addProjectItemMutation({ projectId: "P_2", contentId: "PR_node" }),
    ]);
  });

  it("builds the auto-complete request with enableAutoMergeMutation, using the created head oid and the message", () => {
    const [f] = planCreatePr({ ...BASE, autoMergeAllowed: true, autoComplete: { mergeMethod: "SQUASH", commitHeadline: "Add login (#12)", commitBody: "Body" } }).followUps;
    expect(f.build(PR), "Expected enableAutoMergeMutation with expectedHeadOid = headRefOid").toEqual(
      enableAutoMergeMutation({ pullRequestId: "PR_node", mergeMethod: "SQUASH", expectedHeadOid: PR.headRefOid, commitHeadline: "Add login (#12)", commitBody: "Body" }),
    );
  });

  it("leaves out follow-ups with nothing to do: empty lists and a null or missing milestone", () => {
    const plan = planCreatePr({ ...BASE, reviewerUserIds: [], reviewerTeamIds: [], labelIds: [], assigneeIds: [], milestoneId: null, projectIds: [] });
    expect(plan.followUps, "Expected no follow-ups for empty choices").toEqual([]);
  });

  it("plans auto-complete only when the repository allows auto-merge", () => {
    const ask = { autoComplete: { mergeMethod: "MERGE" as const } };
    expect(planCreatePr({ ...BASE, ...ask, autoMergeAllowed: false }).followUps, "Expected no auto-complete when autoMergeAllowed is false").toEqual([]);
    expect(planCreatePr({ ...BASE, ...ask }).followUps, "Expected no auto-complete when autoMergeAllowed is unknown").toEqual([]);
    expect(planCreatePr({ ...BASE, autoMergeAllowed: true }).followUps, "Expected no auto-complete when it was not asked for").toEqual([]);
  });

  it("does not plan auto-complete for a draft", () => {
    expect(planCreatePr({ ...BASE, draft: true, autoMergeAllowed: true, autoComplete: { mergeMethod: "SQUASH" } }).followUps, "Expected no auto-complete for a draft pull request").toEqual([]);
  });

  it("refuses what createPullRequestMutation refuses", () => {
    expect(() => planCreatePr({ ...BASE, title: "" }), "Expected the title guard to apply to the plan").toThrow("title is required");
  });
});

describe("CP-4: executeCreatePlan reports partial failure without losing the created pull request", () => {
  /** A fake `send`: answers the create request with the PR, and each follow-up from `answers` (by the mutation field in the query), recording every request. */
  function fake(answers: Record<string, () => unknown> = {}) {
    const sent: GraphQlRequest[] = [];
    const send = async (req: GraphQlRequest) => {
      sent.push(req);
      if (req.query.includes("createPullRequest(")) return answers.createPullRequest ? answers.createPullRequest() : { data: { createPullRequest: { pullRequest: PR } } };
      const field = Object.keys(answers).find((k) => k !== "createPullRequest" && req.query.includes(`${k}(`));
      return field ? answers[field]() : { data: {} };
    };
    return { sent, send };
  }
  const ALL: CreatePrParams = { ...BASE, reviewerUserIds: ["U_1"], labelIds: ["L_1"], assigneeIds: ["U_2"], milestoneId: "M_1", projectIds: ["P_1"], autoMergeAllowed: true, autoComplete: { mergeMethod: "SQUASH" } };

  it("sends the create request, then every follow-up in plan order, using the created pull request", async () => {
    const plan = planCreatePr(ALL);
    const { sent, send } = fake();
    const out = await executeCreatePlan(plan, send);
    expect(sent, "Expected create first, then each follow-up built from the created PR").toEqual([plan.create, ...plan.followUps.map((f) => f.build(PR))]);
    expect(out.created, "Expected the created PR in the outcome").toEqual(PR);
    expect(out.message, "Expected the plain success message").toBe("Created PR #12");
    expect("failures" in out ? out.failures : null, "Expected no failures").toEqual([]);
  });

  it("keeps the created PR and names the failed step when a follow-up rejects", async () => {
    const { sent, send } = fake({
      requestReviews: () => {
        throw new Error("Could not resolve to a User with the id 'U_1'");
      },
    });
    const out = await executeCreatePlan(planCreatePr(ALL), send);
    expect(out.created, "Expected the created PR not to be lost").toEqual(PR);
    expect(out.message, "Expected the partial-failure wording from the requirement").toBe("Created PR #12, but adding reviewers failed: Could not resolve to a User with the id 'U_1'");
    expect("failures" in out ? out.failures : null, "Expected one failure describing the reviewers step").toEqual([{ kind: "reviewers", doing: "adding reviewers", message: "Could not resolve to a User with the id 'U_1'" }]);
    expect(sent.length, "Expected the later follow-ups still to be sent (create + 6 follow-ups)").toBe(1 + 6);
  });

  it("lists several failures in plan order, separated by '; '", async () => {
    const { send } = fake({
      requestReviews: () => {
        throw new Error("A");
      },
      addLabelsToLabelable: () => {
        throw new Error("B");
      },
    });
    const out = await executeCreatePlan(planCreatePr(ALL), send);
    expect(out.message, "Expected both failures in one message").toBe("Created PR #12, but adding reviewers failed: A; adding labels failed: B");
  });

  it("treats a response carrying GraphQL errors as a failed follow-up", async () => {
    const { send } = fake({ addAssigneesToAssignable: () => ({ data: { addAssigneesToAssignable: null }, errors: [{ message: "Not a collaborator" }, { message: "Rate limited" }] }) });
    const out = await executeCreatePlan(planCreatePr(ALL), send);
    expect(out.message, "Expected the error messages joined with '; '").toBe("Created PR #12, but adding assignees failed: Not a collaborator; Rate limited");
  });

  it("reports a failed create and sends nothing else", async () => {
    const { sent, send } = fake({
      createPullRequest: () => {
        throw new Error("A pull request already exists for octo:feature/x.");
      },
    });
    const out = await executeCreatePlan(planCreatePr(ALL), send);
    expect(out.created, "Expected no created PR").toBeNull();
    expect(out.message, "Expected the create-failure wording").toBe("Could not create the pull request: A pull request already exists for octo:feature/x.");
    expect(sent.length, "Expected only the create request to be sent").toBe(1);
  });

  it("treats a create response with errors as a failed create", async () => {
    const { sent, send } = fake({ createPullRequest: () => ({ data: { createPullRequest: null }, errors: [{ message: "No commits between main and feature/x" }] }) });
    const out = await executeCreatePlan(planCreatePr(ALL), send);
    expect([out.created, out.message, sent.length], "Expected a failed create with the GraphQL message and no follow-ups").toEqual([null, "Could not create the pull request: No commits between main and feature/x", 1]);
  });

  it("treats a create response with no pull request as a failed create", async () => {
    const { send } = fake({ createPullRequest: () => ({ data: { createPullRequest: { pullRequest: null } } }) });
    const out = await executeCreatePlan(planCreatePr(BASE), send);
    expect(out.message, "Expected the no-pull-request reason").toBe("Could not create the pull request: createPullRequest returned no pull request");
  });
});

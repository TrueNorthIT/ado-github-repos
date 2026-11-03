// Batch 2, milestone (ED-6). STUBS: the developer implements them.
//
// Schema facts (checked live with `gh api graphql`; mutations were run with bogus node ids, so they passed validation and wrote nothing):
//  - mutation updatePullRequest(input: UpdatePullRequestInput!) takes milestoneId: ID (nullable, "The Node ID of the milestone for this pull request"). The mutation validates with milestoneId: null.
//    UNVERIFIED: that null really clears the milestone. Proving it needs a real write, which this batch was not allowed to do. The builder sends an explicit null; confirm on a scratch PR before shipping.
//  - Repository.milestones(states: [MilestoneState!], query: String, orderBy: MilestoneOrder, first: Int) { nodes { id number title description dueOn state } }. `query` "Filters milestones with a query on the title".
//    MilestoneOrderField is DUE_DATE | CREATED_AT | UPDATED_AT | NUMBER; MilestoneState is OPEN | CLOSED.
//  - orderBy DUE_DATE ASC puts milestones WITHOUT a due date FIRST, then the dated ones ascending (checked live: microsoft/vscode gave "NNNDD", golang/go "N...NDD", dotnet/runtime "NNNNDD"
//    where N is no due date), so the server order is not what the picker wants: sortMilestones reorders (dated ascending, undated last).
//  - PullRequest.milestone { id number title dueOn state } selects the current one (in prEdit.ts prEditQuery).
import type { GraphQlRequest } from "./prQuery";

export const SEARCH_PAGE = 20;

const NOT_IMPLEMENTED = () => new Error("Not implemented");

export interface MilestoneOption {
  id: string;
  number: number;
  title: string;
  /** "" when GitHub has none. */
  description: string;
  /** null when the milestone has no due date. */
  dueOn: Date | null;
}

/**
 * `query($owner: String!, $name: String!, $query: String)` over repository(owner: $owner, name: $name) { milestones(states: [OPEN], query: $query, first: 20, orderBy: {field: DUE_DATE, direction: ASC}) { nodes { id number title description dueOn state } } }.
 * Variables { owner, name, query }: the query is trimmed, and null when blank. Nothing user-supplied goes in the text.
 */
export function milestoneSearchQuery(_p: { owner: string; name: string; query: string }): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

/** Milestone node to option: description null becomes "", dueOn an ISO string becomes a Date, null stays null. */
export function toMilestoneOption(_node: { id: string; number: number; title: string; description?: string | null; dueOn?: string | null }): MilestoneOption {
  throw NOT_IMPLEMENTED();
}

/** A new array: milestones with a due date first, earliest first; those without a due date last; ties (and the undated) by milestone number ascending. Does not change its input. */
export function sortMilestones(_options: MilestoneOption[]): MilestoneOption[] {
  throw NOT_IMPLEMENTED();
}

/**
 * `mutation($input: UpdatePullRequestInput!)` calling updatePullRequest(input: $input), with variables.input exactly { pullRequestId, milestoneId }: milestoneId a node id to set it, or null (the key
 * present, value null) to clear it. Throws "pullRequestId is required" when blank, and "milestoneId must not be blank" for an empty or whitespace id (use null to clear).
 */
export function setMilestoneMutation(_pullRequestId: string, _milestoneId: string | null): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

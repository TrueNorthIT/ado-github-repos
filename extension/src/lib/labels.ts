// Batch 2, labels (ED-3; ADO calls them Tags). STUBS: the developer implements them.
//
// Schema facts (checked live with `gh api graphql`; mutations were run with bogus node ids, so they passed validation and wrote nothing):
//  - Repository.labels(query: String, orderBy: LabelOrder, first: Int) { nodes { id name color description } }: "If provided, searches labels by name and description". LabelOrderField is NAME | CREATED_AT | ISSUE_COUNT.
//    `color` is a hex string without "#" ("d73a4a"); description can be null.
//  - mutation addLabelsToLabelable(input: AddLabelsToLabelableInput!) { labelableId: ID!, labelIds: [ID!], labels: [LabelUpdateInput!] }, payload `labelable`.
//  - mutation removeLabelsFromLabelable(input: RemoveLabelsFromLabelableInput!) { labelableId: ID!, labelIds: [ID!]! }, payload `labelable`. labelIds is required here (not on add).
//  - PullRequest.viewerCanLabel gates the edit (see prEdit.ts editPermissions).
import type { GraphQlRequest } from "./prQuery";

export const SEARCH_PAGE = 20;

const NOT_IMPLEMENTED = () => new Error("Not implemented");

export interface LabelOption {
  id: string;
  name: string;
  /** Hex without "#", as GitHub returns it. */
  color: string;
  /** "#000000" or "#ffffff", whichever reads better on `color` (see labelTextColor). */
  textColor: "#000000" | "#ffffff";
  /** "" when GitHub has none. */
  description: string;
}

/**
 * `query($owner: String!, $name: String!, $query: String)` over repository(owner: $owner, name: $name) { labels(query: $query, first: 20, orderBy: {field: NAME, direction: ASC}) { nodes { id name color description } } }.
 * Variables { owner, name, query }: the query is trimmed, and null when blank. Nothing user-supplied goes in the text.
 */
export function labelSearchQuery(_p: { owner: string; name: string; query: string }): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

/**
 * The text colour for a label background: whichever of "#000000" and "#ffffff" has the higher WCAG 2.x contrast ratio against it (relative luminance from linearised sRGB; ties go to black).
 * Accepts "d73a4a", "#d73a4a", "D73A4A" and the 3-digit "fa0". Anything that is not a hex colour does not throw: it gives "#000000".
 */
export function labelTextColor(_hex: string): "#000000" | "#ffffff" {
  throw NOT_IMPLEMENTED();
}

/** GitHub label node to display shape: id, name and colour copied, textColor from labelTextColor, a null or missing description becomes "". */
export function toLabelOption(_node: { id: string; name: string; color: string; description?: string | null }): LabelOption {
  throw NOT_IMPLEMENTED();
}

/** Search results the picker offers: those whose id is not in `appliedIds`, order kept. */
export function availableLabels(_options: LabelOption[], _appliedIds: string[]): LabelOption[] {
  throw NOT_IMPLEMENTED();
}

/** `mutation($input: AddLabelsToLabelableInput!) { addLabelsToLabelable(input: $input) { labelable { ... on PullRequest { id labels(first: 50) { nodes { id name color description } } } } } }`. Input { labelableId, labelIds }. Throws "labelableId is required" / "at least one label is required". */
export function addLabelsMutation(_labelableId: string, _labelIds: string[]): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

/** `mutation($input: RemoveLabelsFromLabelableInput!) { removeLabelsFromLabelable(input: $input) { labelable { ... on PullRequest { id labels(first: 50) { nodes { id name color description } } } } } }`. Same input and guards. */
export function removeLabelsMutation(_labelableId: string, _labelIds: string[]): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

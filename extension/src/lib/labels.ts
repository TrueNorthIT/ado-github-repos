// Batch 2, labels (ED-3; ADO calls them Tags). STUBS: the developer implements them.
//
// Schema facts (checked live with `gh api graphql`; mutations were run with bogus node ids, so they passed validation and wrote nothing):
//  - Repository.labels(query: String, orderBy: LabelOrder, first: Int) { nodes{ id name color description } }: "If provided, searches labels by name and description". LabelOrderField is NAME | CREATED_AT | ISSUE_COUNT.
//    `color` is a hex string without "#" ("d73a4a"); description can be null.
//  - mutation addLabelsToLabelable(input: AddLabelsToLabelableInput!) { labelableId: ID!, labelIds: [ID!], labels: [LabelUpdateInput!] }, payload `labelable`.
//  - mutation removeLabelsFromLabelable(input: RemoveLabelsFromLabelableInput!) { labelableId: ID!, labelIds: [ID!]! }, payload `labelable`. labelIds is required here (not on add).
//  - PullRequest.viewerCanLabel gates the edit (see prEdit.ts editPermissions).
import type { GraphQlRequest } from "./prQuery";

export const SEARCH_PAGE = 20;

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
 * `query($owner: String!, $name: String!, $query: String)` over repository(owner: $owner, name: $name) { labels(query: $query, first: 20, orderBy: {field: NAME, direction: ASC}) { nodes{ id name color description } } }.
 * Variables { owner, name, query }: the query is trimmed, and null when blank. Nothing user-supplied goes in the text.
 */
export function labelSearchQuery(p: { owner: string; name: string; query: string }): GraphQlRequest {
  return {
    query: `query($owner: String!, $name: String!, $query: String) {
  repository(owner: $owner, name: $name) {
    labels(query: $query, first: ${SEARCH_PAGE}, orderBy: {field: NAME, direction: ASC}) { nodes{ id name color description } }
  }
}`,
    variables: { owner: p.owner, name: p.name, query: p.query.trim() || null },
  };
}

/**
 * The text colour for a label background: whichever of "#000000" and "#ffffff" has the higher WCAG 2.x contrast ratio against it (relative luminance from linearised sRGB; ties go to black).
 * Accepts "d73a4a", "#d73a4a", "D73A4A" and the 3-digit "fa0". Anything that is not a hex colour does not throw: it gives "#000000".
 */
export function labelTextColor(hex: string): "#000000" | "#ffffff" {
  let h = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return "#000000";
  const ch = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  // contrast with black is (L + .05) / .05, with white 1.05 / (L + .05); ties go to black.
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#000000" : "#ffffff";
}

/** GitHub label node to display shape: id, name and colour copied, textColor from labelTextColor, a null or missing description becomes "". */
export function toLabelOption(node: { id: string; name: string; color: string; description?: string | null }): LabelOption {
  return { id: node.id, name: node.name, color: node.color, textColor: labelTextColor(node.color), description: node.description ?? "" };
}

/** Search results the picker offers: those whose id is not in `appliedIds`, order kept. */
export function availableLabels(options: LabelOption[], appliedIds: string[]): LabelOption[] {
  const applied = new Set(appliedIds);
  return options.filter((o) => !applied.has(o.id));
}

function labelsMutation(inputType: string, field: string, labelableId: string, labelIds: string[]): GraphQlRequest {
  if (!labelableId.trim()) throw new Error("labelableId is required");
  if (!labelIds.length) throw new Error("at least one label is required");
  return {
    query: `mutation($input: ${inputType}!) { ${field}(input: $input) { labelable { ... on PullRequest{ id labels(first: 50) { nodes{ id name color description } } } } } }`,
    variables: { input: { labelableId, labelIds } },
  };
}

/** `mutation($input: AddLabelsToLabelableInput!) { addLabelsToLabelable(input: $input) { labelable { ... on PullRequest{ id labels(first: 50) { nodes{ id name color description } } } } } }`. Input { labelableId, labelIds }. Throws "labelableId is required" / "at least one label is required". */
export function addLabelsMutation(labelableId: string, labelIds: string[]): GraphQlRequest {
  return labelsMutation("AddLabelsToLabelableInput", "addLabelsToLabelable", labelableId, labelIds);
}

/** `mutation($input: RemoveLabelsFromLabelableInput!) { removeLabelsFromLabelable(input: $input) { labelable { ... on PullRequest{ id labels(first: 50) { nodes{ id name color description } } } } } }`. Same input and guards. */
export function removeLabelsMutation(labelableId: string, labelIds: string[]): GraphQlRequest {
  return labelsMutation("RemoveLabelsFromLabelableInput", "removeLabelsFromLabelable", labelableId, labelIds);
}

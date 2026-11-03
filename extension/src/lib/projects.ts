// Batch 2, Projects (v2) (ED-7). STUBS: the developer implements them.
//
// Schema facts (checked live with `gh api graphql`; mutations were run with bogus node ids):
//  - PullRequest.projectItems(first: Int, includeArchived: Boolean) { nodes { id project { id title url closed } fieldValueByName(name: "Status") { __typename ... on ProjectV2ItemFieldSingleSelectValue { name } } } }.
//    ProjectV2Item has id, project, fieldValueByName, fieldValues, content, isArchived. fieldValueByName returns a union, so a project with no Status field gives null and other field types have no `name`.
//  - SCOPES: every ProjectV2 field needs the `read:project` scope on a classic token (a GitHub App needs the organisation Projects permission, read for listing and read/write for edits).
//    Without it GitHub answers INSUFFICIENT_SCOPES per field (seen live), and the whole query fails. That is why projectItemsQuery is separate from prEdit.ts prEditQuery: a viewer without the scope
//    must still get the rest of the page. The mutations need the `project` scope (seen live). The shapes below passed validation (a wrong field name gives "undefinedField" instead; scope errors appear only for valid queries).
//  - Organization.projectsV2(query: String, orderBy, minPermissionLevel: ProjectV2PermissionLevel (READ | WRITE | ADMIN), first: Int) { nodes { id title url closed number } } and
//    Repository.projectsV2(same arguments) "List of projects linked to this repository". `query`: "A project to search for". Organization lookups fail with NOT_FOUND for user-owned repositories,
//    so org and repository searches are separate requests. minPermissionLevel: WRITE keeps the picker to projects the viewer can add to.
//  - mutation addProjectV2ItemById(input: { projectId: ID!, contentId: ID! }) payload `item { id }` (contentId is the pull request's node id).
//  - mutation deleteProjectV2Item(input: { projectId: ID!, itemId: ID! }) payload `deletedItemId`. itemId is the ProjectV2Item id from projectItems, NOT the pull request id.
import type { GraphQlRequest } from "./prQuery";

export const SEARCH_PAGE = 20;

const NOT_IMPLEMENTED = () => new Error("Not implemented");

/**
 * `query($owner: String!, $name: String!, $number: Int!)` over repository(owner: $owner, name: $name) { pullRequest(number: $number) { projectItems(first: 20) { nodes { id project { id title url closed }
 * fieldValueByName(name: "Status") { __typename ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } }. Variables { owner, name, number }.
 */
export function projectItemsQuery(_p: { owner: string; name: string; number: number }): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

export interface ProjectRow {
  /** ProjectV2Item id: what deleteProjectV2Item needs. */
  itemId: string;
  projectId: string;
  title: string;
  url: string;
  /** The Status field's option name, or null when the project has no Status field (or it is another field type) or the item has no value. */
  status: string | null;
  closed: boolean;
}

/** projectItems nodes as rows, in order. Null nodes and items whose project is null (not visible to the viewer) are dropped. Missing input gives []. */
export function toProjectRows(
  _nodes:
    | ({ id: string; project: { id: string; title: string; url: string; closed: boolean } | null; fieldValueByName?: { __typename?: string; name?: string } | null } | null)[]
    | null
    | undefined,
): ProjectRow[] {
  throw NOT_IMPLEMENTED();
}

/** `query($owner: String!, $name: String!, $query: String)` over repository(owner: $owner, name: $name) { projectsV2(query: $query, first: 20, minPermissionLevel: WRITE) { nodes { id title url closed number } } }. Query trimmed, null when blank. */
export function repoProjectsQuery(_p: { owner: string; name: string; query: string }): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

/** `query($org: String!, $query: String)` over organization(login: $org) { projectsV2(query: $query, first: 20, minPermissionLevel: WRITE) { nodes { id title url closed number } } }. Query trimmed, null when blank. */
export function orgProjectsQuery(_p: { org: string; query: string }): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

export interface ProjectOption {
  id: string;
  title: string;
  url: string;
}

/**
 * The picker's list: projects linked to the repository first, then the organisation's, each in the order given. A project appearing in both is listed once (in the repository group).
 * Closed projects, projects whose id is in `attachedProjectIds`, and null nodes are left out.
 */
export function mergeProjectOptions(
  _repoNodes: ({ id: string; title: string; url: string; closed: boolean } | null)[] | null | undefined,
  _orgNodes: ({ id: string; title: string; url: string; closed: boolean } | null)[] | null | undefined,
  _attachedProjectIds: string[],
): ProjectOption[] {
  throw NOT_IMPLEMENTED();
}

/** `mutation($input: AddProjectV2ItemByIdInput!) { addProjectV2ItemById(input: $input) { item { id } } }`. Input { projectId, contentId }. Throws "projectId is required" / "contentId is required" when blank. */
export function addProjectItemMutation(_p: { projectId: string; contentId: string }): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

/** `mutation($input: DeleteProjectV2ItemInput!) { deleteProjectV2Item(input: $input) { deletedItemId } }`. Input { projectId, itemId }. Throws "projectId is required" / "itemId is required" when blank. */
export function deleteProjectItemMutation(_p: { projectId: string; itemId: string }): GraphQlRequest {
  throw NOT_IMPLEMENTED();
}

// __TN_MOCK__ Batch 2 fixtures: the edit query, the picker searches, Projects, and the writes, all kept in module state so edits persist until reload.
// Scenarios: readOnlyViewer (no update, label or assign rights), editFails (every write is refused), noProjectsAccess (Projects answer INSUFFICIENT_SCOPES).
// A closed pull request is #306 (state CLOSED): only tags and projects stay editable.
import { findClosingIssueNumbers } from "../../lib/prEdit";
import { PRS, PR_REPO, avatar } from "./prs";

type Result = { code: number } | { data: unknown } | { data?: unknown; errors: { type?: string; message: string }[] };
const prOf = (n: number) => PRS.find((p) => p.node.number === n);
const num = (id: unknown) => Number(String(id).replace(/^\D+/, ""));
const fail = (message: string): Result => ({ errors: [{ message }] });
const has = (hay: string | null | undefined, q: string | null | undefined) => !q || (hay ?? "").toLowerCase().includes(q.toLowerCase());
const person = (login: string, name: string | null) => ({ id: `U_${login}`, login, name, avatarUrl: avatar(login) });
const USERS = [person("ann", "Ann Author"), person("bob-dev", null), person("carol", "Carol Commit"), person("mock-user", "Mock User"), person("dave", "Dave Developer"), person("joanne", "Joanne Jones"), person("annabel", "Annabel Lee")];
const TEAMS = [{ id: "T_core", slug: "core-team", name: "Core Team", avatarUrl: avatar("core") }, { id: "T_docs", slug: "docs", name: "Docs", avatarUrl: avatar("docs") }, { id: "T_platform", slug: "platform", name: "Platform", avatarUrl: avatar("platform") }];
const LABELS = [
  ["bug", "d73a4a", "Something isn't working"], ["enhancement", "a2eeef", "New feature or request"], ["documentation", "0075ca", "Improvements or additions to documentation"],
  ["good first issue", "7057ff", "Good for newcomers"], ["help wanted", "008672", "Extra attention is needed"], ["priority: high", "b60205", ""], ["wontfix", "ffffff", "This will not be worked on"],
  ["dependencies", "0366d6", ""], ["needs design", "fbca04", "Waiting for a design"],
].map(([name, color, description]) => ({ id: `L_${name}`, name, color, description: description || null }));
const MILESTONES = [ // GitHub's DUE_DATE ASC puts the undated first; the app re-sorts
  { id: "M_3", number: 3, title: "Backlog", description: null, dueOn: null, state: "OPEN" },
  { id: "M_4", number: 4, title: "v0.9 hotfixes", description: "Small fixes", dueOn: new Date(Date.now() + 7 * 864e5).toISOString(), state: "OPEN" },
  { id: "M_1", number: 1, title: "v1.0", description: "First release", dueOn: new Date(Date.now() + 30 * 864e5).toISOString(), state: "OPEN" },
  { id: "M_2", number: 2, title: "v1.1", description: null, dueOn: new Date(Date.now() + 90 * 864e5).toISOString(), state: "OPEN" },
];
const PROJECTS = [{ id: "PVT_1", title: "Roadmap", closed: false }, { id: "PVT_2", title: "Sprint board", closed: false }, { id: "PVT_3", title: "Archived work", closed: true }].map((p) => ({ ...p, number: num(p.id), url: `https://github.com/orgs/truenorthit/projects/${num(p.id)}` }));
const ISSUES: Record<number, { title: string; state: "OPEN" | "CLOSED" }> = { 12: { title: "Crash on start", state: "OPEN" }, 13: { title: "Slow repository list", state: "CLOSED" }, 14: { title: "Flaky retry test", state: "OPEN" } };

/** ADO work items the WIQL search and the id lookup know (ids 1000 to 1099 exist in mockFetch). */
export const WI_CATALOG: Record<number, string> = { 1000: "Retry failed sync jobs", 1001: "Back off between sync attempts", 1002: "Handle empty repositories", 1003: "Dark theme contrast", 1004: "Improve sync error messages" };

// #200 links two work items and closes issue #12 in its description (a keyword line, so removable).
prOf(200)!.node.body = "Adds a retry helper. Relates to AB#1000 and AB#1001; AB#999999 is a typo.\n\nCloses #12";

prOf(200)!.node.labels = { nodes: [{ name: "bug", color: "d73a4a" }, { name: "enhancement", color: "a2eeef" }, { name: "priority: high", color: "b60205" }] };

interface Request { kind: "user" | "team" | "bot"; id: string; login: string; name: string; asCodeOwner: boolean }
interface State { requests: Request[]; assignees: string[]; milestone: string | null; projects: { itemId: string; projectId: string; status: string | null }[]; linked: number[]; edited: boolean }
const state = new Map<number, State>();
const stateOf = (n: number): State => {
  let s = state.get(n);
  if (!s) {
    const rich = n === 200;
    s = {
      requests: rich ? [{ kind: "user", id: "U_bob-dev", login: "bob-dev", name: "bob-dev", asCodeOwner: true }, { kind: "team", id: "T_core", login: "core-team", name: "Core Team", asCodeOwner: false }] : n === 312 ? [{ kind: "user", id: "U_bob-dev", login: "bob-dev", name: "bob-dev", asCodeOwner: false }] : [],
      assignees: rich ? ["ann"] : [],
      milestone: rich ? "M_1" : null,
      projects: rich ? [{ itemId: "PVTI_200_PVT_1", projectId: "PVT_1", status: "In progress" }] : [],
      linked: rich ? [13] : [], // linked in the sidebar: not in the body, so not removable
      edited: false,
    };
    state.set(n, s);
  }
  return s;
};
const userOf = (login: string) => USERS.find((u) => u.login === login)!;

/** requestedReviewer nodes in the shape the detail query selects (a team's login is its name). */
export const reviewRequestNodes = (n: number) =>
  stateOf(n).requests.map((r) => ({ requestedReviewer: r.kind === "team" ? { login: r.name, avatarUrl: avatar(r.login) } : { login: r.login, avatarUrl: avatar(r.login) } }));

/** The page's rendered body once it was edited here (the fixture HTML is otherwise static). */
export const editedBodyHtml = (n: number): string | undefined => {
  const s = state.get(n);
  const body = prOf(n)?.node.body;
  return s?.edited && body !== undefined ? `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\r?\n/g, "<br>")}</p>` : undefined;
};

const labelNodes = (n: number) => (prOf(n)!.node.labels?.nodes ?? []).map((l) => LABELS.find((x) => x.name === l.name) ?? { id: `L_${l.name}`, name: l.name, color: l.color, description: null });
const milestoneOf = (n: number) => MILESTONES.find((m) => m.id === stateOf(n).milestone) ?? null;
const closingNodes = (n: number) => [...new Set([...stateOf(n).linked, ...findClosingIssueNumbers(prOf(n)!.node.body)])].map((k) => ({ number: k, title: ISSUES[k]?.title ?? `Issue ${k}`, state: ISSUES[k]?.state ?? "OPEN", url: `https://github.com/${PR_REPO}/issues/${k}` }));

function editNode(n: number, sc: string) {
  const p = prOf(n);
  if (!p) return null;
  const s = stateOf(n);
  const open = p.node.state === "OPEN";
  const ro = sc === "readOnlyViewer";
  return {
    id: `PR_${n}`, state: p.node.state, title: p.node.title, body: p.node.body, author: p.node.author ? { login: p.node.author.login } : null,
    viewerCanUpdate: !ro, viewerCanLabel: !ro, viewerCanAssign: open && !ro,
    reviewRequests: { nodes: s.requests.map((r) => ({ asCodeOwner: r.asCodeOwner, requestedReviewer: r.kind === "team" ? { __typename: "Team", id: r.id, slug: r.login, name: r.name, avatarUrl: avatar(r.login) } : { __typename: r.kind === "bot" ? "Bot" : "User", ...userOf(r.login) } })) },
    assignees: { nodes: s.assignees.map(userOf) },
    labels: { nodes: labelNodes(n) },
    milestone: milestoneOf(n),
    closingIssuesReferences: { nodes: closingNodes(n) },
  };
}

const PAYLOAD_FIELDS = /\b(requestReviews|addAssigneesToAssignable|removeAssigneesFromAssignable|addLabelsToLabelable|removeLabelsFromLabelable|updatePullRequest|addProjectV2ItemById|deleteProjectV2Item)\(input: \$input\)/;

/** GraphQL queries and mutations of batch 2. undefined when `query` is not one of ours. */
export function editGraphql(query: string, v: Record<string, any>, sc: string): Result | undefined {
  const mine = `${v.owner}/${v.name}`.toLowerCase() === PR_REPO;
  const repository = (x: unknown) => ({ data: { repository: mine ? x : null } });
  if (query.includes("viewerCanAssign") && !/^\s*mutation/.test(query)) {
    const node = mine ? editNode(v.number, sc) : null;
    return node ? { data: { repository: { pullRequest: node } } } : { data: { repository: { pullRequest: null } }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a PullRequest" }] };
  }
  if (query.includes("projectItems(first")) {
    if (sc === "noProjectsAccess") return { data: { repository: { pullRequest: { projectItems: null } } }, errors: [{ type: "INSUFFICIENT_SCOPES", message: "Your token has not been granted the required scopes to execute this query." }] };
    return repository({ pullRequest: { projectItems: { nodes: stateOf(v.number).projects.map((it) => ({ id: it.itemId, project: PROJECTS.find((p) => p.id === it.projectId), fieldValueByName: it.status ? { __typename: "ProjectV2ItemFieldSingleSelectValue", name: it.status } : null })) } } });
  }
  if (query.includes("assignableUsers(")) return repository({ assignableUsers: { nodes: USERS.filter((u) => has(u.login, v.query) || has(u.name, v.query)) } });
  if (query.includes("teams(query")) return { data: { organization: v.org === "truenorthit" ? { teams: { nodes: TEAMS.filter((t) => has(t.slug, v.query) || has(t.name, v.query)) } } : null } };
  if (query.includes("labels(query")) return repository({ labels: { nodes: LABELS.filter((l) => has(l.name, v.query) || has(l.description, v.query)) } });
  if (query.includes("milestones(")) return repository({ milestones: { nodes: MILESTONES.filter((m) => has(m.title, v.query)) } });
  if (query.includes("projectsV2(")) {
    const list = PROJECTS.filter((p) => has(p.title, v.query));
    return v.org !== undefined ? { data: { organization: v.org === "truenorthit" ? { projectsV2: { nodes: list } } : null } } : repository({ projectsV2: { nodes: list.filter((p) => p.id === "PVT_2") } });
  }
  const field = PAYLOAD_FIELDS.exec(query)?.[1];
  if (!field) return undefined;
  const input = v.input ?? {};
  if (field === "updatePullRequest" && "baseRefName" in input) return undefined; // batch 1's change of target branch
  if (sc === "readOnlyViewer") return { code: 403 };
  if (sc === "editFails") return fail("Mock refusal: GitHub would not accept this change.");
  const n = num(input.pullRequestId ?? input.labelableId ?? input.assignableId ?? input.contentId);
  const p = prOf(n);
  if (field !== "deleteProjectV2Item" && !p) return fail("Could not resolve to a node with the global id");
  const s = stateOf(n);
  const pr = () => ({ id: `PR_${n}` });
  switch (field) {
    case "updatePullRequest": {
      if (typeof input.title === "string") {
        if (!input.title.trim()) return fail("Title can't be blank");
        p!.node.title = input.title;
      }
      if (typeof input.body === "string") (p!.node.body = input.body, (s.edited = true));
      if ("milestoneId" in input) s.milestone = input.milestoneId;
      p!.node.updatedAt = new Date().toISOString();
      return { data: { updatePullRequest: { pullRequest: { ...pr(), title: p!.node.title, body: p!.node.body, milestone: milestoneOf(n) } } } };
    }
    case "requestReviews": {
      for (const id of input.userIds ?? []) {
        const u = USERS.find((x) => x.id === id);
        if (u && !s.requests.some((r) => r.id === id)) s.requests.push({ kind: "user", id, login: u.login, name: u.login, asCodeOwner: false });
      }
      for (const id of input.teamIds ?? []) {
        const t = TEAMS.find((x) => x.id === id);
        if (t && !s.requests.some((r) => r.id === id)) s.requests.push({ kind: "team", id, login: t.slug, name: t.name, asCodeOwner: false });
      }
      return { data: { requestReviews: { pullRequest: pr() } } };
    }
    case "addAssigneesToAssignable":
    case "removeAssigneesFromAssignable": {
      const logins = (input.assigneeIds as string[]).map((id) => id.replace(/^U_/, ""));
      s.assignees = field.startsWith("add") ? [...new Set([...s.assignees, ...logins])] : s.assignees.filter((l) => !logins.includes(l));
      return { data: { [field]: { assignable: { ...pr(), assignees: { nodes: s.assignees.map(userOf) } } } } };
    }
    case "addLabelsToLabelable":
    case "removeLabelsFromLabelable": {
      const picked = (input.labelIds as string[]).map((id) => LABELS.find((l) => l.id === id)).filter(Boolean) as typeof LABELS;
      const now = labelNodes(n);
      const next = field.startsWith("add") ? [...now, ...picked.filter((l) => !now.some((x) => x.id === l.id))] : now.filter((l) => !picked.some((x) => x.id === l.id));
      p!.node.labels = { nodes: next.map(({ name, color }) => ({ name, color })) };
      return { data: { [field]: { labelable: { ...pr(), labels: { nodes: next } } } } };
    }
    case "addProjectV2ItemById": {
      if (!s.projects.some((x) => x.projectId === input.projectId)) s.projects.push({ itemId: `PVTI_${n}_${input.projectId}`, projectId: input.projectId, status: "Todo" });
      return { data: { addProjectV2ItemById: { item: { id: `PVTI_${n}_${input.projectId}` } } } };
    }
    default: {
      // deleteProjectV2Item: the item id says which pull request it belongs to
      const owner = [...state.values()].find((st) => st.projects.some((x) => x.itemId === input.itemId));
      if (owner) owner.projects = owner.projects.filter((x) => x.itemId !== input.itemId);
      return { data: { deleteProjectV2Item: { deletedItemId: input.itemId } } };
    }
  }
}

/** DELETE /repos/{o}/{r}/pulls/{n}/requested_reviewers. 200 on success, 403 in the read-only and failing scenarios, 422 for nobody. */
export function removeRequestedReviewers(prNumber: number, body: { reviewers?: string[]; team_reviewers?: string[] } | undefined, sc: string): number {
  if (sc === "readOnlyViewer" || sc === "editFails") return sc === "editFails" ? 422 : 403;
  if (!body?.reviewers) return 422;
  const s = stateOf(prNumber);
  s.requests = s.requests.filter((r) => !(r.kind === "team" ? (body.team_reviewers ?? []).includes(r.login) : body.reviewers!.includes(r.login)));
  return 200;
}

/** POST .../_apis/wit/wiql: the catalog items whose title contains the text of the query. */
export function wiqlResult(query: string): { workItems: { id: number }[] } {
  const text = /CONTAINS '((?:[^']|'')*)'/.exec(query)?.[1]?.replace(/''/g, "'").toLowerCase() ?? "";
  return { workItems: Object.entries(WI_CATALOG).filter(([, title]) => title.toLowerCase().includes(text)).map(([id]) => ({ id: Number(id) })) };
}

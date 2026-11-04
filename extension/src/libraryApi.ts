// Actions > Library: reads and writes of Actions variables and secrets (lib/library.ts builds the requests).
import { rest, restJson } from "./githubBrowse";
import { nextPage } from "./lib/workflows";
import {
  createVariableRequest,
  deleteSecretRequest,
  deleteVariableRequest,
  listSecretsRequest,
  listVariablesRequest,
  toSecret,
  toVariable,
  updateVariableRequest,
  type LibSecret,
  type LibVariable,
  type Scope,
} from "./lib/library";

/** Every variable in the scope (GitHub pages variables 30 at a time; a repository holds at most 500). */
export async function listVariables(repo: string, scope: Scope): Promise<LibVariable[]> {
  const out: LibVariable[] = [];
  for (let page: number | undefined = 1; page && out.length < 1000; ) {
    const { body, link } = await restJson(listVariablesRequest(repo, scope, page));
    out.push(...(body.variables ?? []).map(toVariable));
    page = nextPage(link);
  }
  return out;
}

/** Every secret's name and date in the scope (never a value: GitHub has no way to read one back). */
export async function listSecrets(repo: string, scope: Scope): Promise<LibSecret[]> {
  const out: LibSecret[] = [];
  for (let page: number | undefined = 1; page && out.length < 1000; ) {
    const { body, link } = await restJson(listSecretsRequest(repo, scope, page));
    out.push(...(body.secrets ?? []).map(toSecret));
    page = nextPage(link);
  }
  return out;
}

export const createVariable = (repo: string, scope: Scope, name: string, value: string) => rest(createVariableRequest(repo, scope, name, value));
export const updateVariable = (repo: string, scope: Scope, oldName: string, name: string, value: string) => rest(updateVariableRequest(repo, scope, oldName, name, value));
export const deleteVariable = (repo: string, scope: Scope, name: string) => rest(deleteVariableRequest(repo, scope, name));
export const deleteSecret = (repo: string, scope: Scope, name: string) => rest(deleteSecretRequest(repo, scope, name));

/** Whether the viewer is an admin of the repository (GET /repos/{repo} permissions.admin): GitHub's own settings pages for variables and
 *  secrets are admin-only, so the Library shows edit controls only to admins. False when unknown. */
export async function isRepoAdmin(repo: string): Promise<boolean> {
  try {
    return !!(await restJson({ method: "GET", path: `/repos/${repo}` })).body.permissions?.admin;
  } catch {
    return false;
  }
}

// Actions > Library (native ADO: Pipelines > Library, variable groups): GitHub Actions variables and secrets, over REST.
//  - Repository: GET /repos/{repo}/actions/variables?per_page=30&page=N -> { total_count, variables: [{ name, value, created_at, updated_at }] } (30 is the most a page holds);
//    POST /actions/variables { name, value } (201); PATCH /actions/variables/{name} { name?, value? } (204, renames too); DELETE /actions/variables/{name} (204).
//    GET /repos/{repo}/actions/secrets?per_page=100&page=N -> { total_count, secrets: [{ name, created_at, updated_at }] }; DELETE /actions/secrets/{name} (204).
//  - Environment: the same under /repos/{repo}/environments/{env}/variables and /environments/{env}/secrets (the name URL-encoded).
//  - Setting a secret needs the value sealed with the repository's public key (libsodium sealed box). We add no crypto, so secrets are
//    listed and deleted here and set on GitHub's own settings page.
//  - The GitHub App needs the repository permissions "Variables" and "Secrets" (read to list, write to change). Without them GitHub answers
//    403 "Resource not accessible by integration"; a user without admin rights gets 403 or 404.
import type { RestRequest } from "./restRequest";

export type Scope = { kind: "repo" } | { kind: "env"; env: string };

export interface LibVariable {
  name: string;
  value: string;
  updatedAt: Date;
}

export interface LibSecret {
  name: string;
  updatedAt: Date;
}

/** One row of a group's table: a variable, or a secret (whose value GitHub never reveals). */
export type LibRow = ({ secret: false } & LibVariable) | ({ secret: true } & LibSecret);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
const asRaw = (x: unknown): Raw => (x && typeof x === "object" ? (x as Raw) : {});
const str = (x: unknown) => (typeof x === "string" ? x : "");
const when = (r: Raw) => new Date(r.updated_at ?? r.created_at);

export const toVariable = (raw: unknown): LibVariable => {
  const r = asRaw(raw);
  return { name: str(r.name), value: str(r.value), updatedAt: when(r) };
};

export const toSecret = (raw: unknown): LibSecret => {
  const r = asRaw(raw);
  return { name: str(r.name), updatedAt: when(r) };
};

/** A group's rows: variables then secrets, each sorted by name (GitHub stores names upper-case). */
export function groupRows(variables: LibVariable[], secrets: LibSecret[]): LibRow[] {
  const by = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return [...[...variables].sort(by).map((v): LibRow => ({ secret: false, ...v })), ...[...secrets].sort(by).map((s): LibRow => ({ secret: true, ...s }))];
}

// ---------- validation ----------

/** The most bytes GitHub stores in one variable's value (48 KB). */
export const MAX_VALUE_BYTES = 48 * 1024;

/** GitHub's naming rules for variables and secrets: letters, digits and underscores only, not starting with a digit or GITHUB_.
 *  Names are case-insensitive (stored upper-case) and unique within their scope. Returns the problem, or undefined when the name is fine.
 *  `taken` are the scope's existing names; `current` is the variable being edited (keeping its own name is not a clash). */
export function nameError(name: string, taken: string[] = [], current?: string): string | undefined {
  const n = name.trim();
  if (!n) return "Enter a name.";
  if (!/^[A-Za-z0-9_]+$/.test(n)) return "Use only letters, numbers and underscores (no spaces).";
  if (/^[0-9]/.test(n)) return "The name can't start with a number.";
  if (/^GITHUB_/i.test(n)) return "The name can't start with GITHUB_.";
  const up = n.toUpperCase();
  if (up !== current?.toUpperCase() && taken.some((t) => t.toUpperCase() === up)) return `${up} already exists here.`;
  return undefined;
}

export function valueError(value: string): string | undefined {
  if (!value) return "Enter a value.";
  if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES) return "The value is over GitHub's 48 KB limit.";
  return undefined;
}

// ---------- requests ----------

const q = encodeURIComponent;
const base = (repo: string, scope: Scope) => (scope.kind === "repo" ? `/repos/${repo}/actions` : `/repos/${repo}/environments/${q(scope.env)}`);

export const listVariablesRequest = (repo: string, scope: Scope, page = 1): RestRequest => ({ method: "GET", path: `${base(repo, scope)}/variables?per_page=30&page=${page}` });
export const listSecretsRequest = (repo: string, scope: Scope, page = 1): RestRequest => ({ method: "GET", path: `${base(repo, scope)}/secrets?per_page=100&page=${page}` });
export const createVariableRequest = (repo: string, scope: Scope, name: string, value: string): RestRequest => ({ method: "POST", path: `${base(repo, scope)}/variables`, body: { name: name.trim(), value } });

/** PATCH the variable `oldName`; the body carries the name only when it changes (case-insensitively, as GitHub compares them). */
export function updateVariableRequest(repo: string, scope: Scope, oldName: string, name: string, value: string): RestRequest {
  const n = name.trim();
  return { method: "PATCH", path: `${base(repo, scope)}/variables/${q(oldName)}`, body: n.toUpperCase() === oldName.toUpperCase() ? { value } : { name: n, value } };
}

export const deleteVariableRequest = (repo: string, scope: Scope, name: string): RestRequest => ({ method: "DELETE", path: `${base(repo, scope)}/variables/${q(name)}` });
export const deleteSecretRequest = (repo: string, scope: Scope, name: string): RestRequest => ({ method: "DELETE", path: `${base(repo, scope)}/secrets/${q(name)}` });

/** GitHub's page for setting secrets: the repository's Actions secrets, or the environment's settings (where its secrets are). */
export function secretsSettingsUrl(repo: string, scope: Scope, envId?: number): string {
  if (scope.kind === "repo") return `https://github.com/${repo}/settings/secrets/actions`;
  return envId ? `https://github.com/${repo}/settings/environments/${envId}/edit` : `https://github.com/${repo}/settings/environments`;
}

// ---------- errors ----------

export type Section = "variables" | "secrets";

export interface LibraryProblem {
  /** permission: the app or the viewer may not read this section; auth: signed out; rateLimit; other. */
  kind: "permission" | "auth" | "rateLimit" | "other";
  text: string;
}

/** A failed read of one section, as words for its MessageCard. `e` is a GhError-like { kind, status, apiMessage }. */
export function libraryProblem(e: unknown, section: Section): LibraryProblem {
  const err = asRaw(e);
  const what = section === "variables" ? "Variables" : "Secrets";
  if (err.kind === "auth") return { kind: "auth", text: `Sign in with GitHub to see ${section}.` };
  if (err.kind === "rateLimit") return { kind: "rateLimit", text: "GitHub's rate limit has been reached. Try again later." };
  if (err.kind === "access" || err.status === 403 || err.status === 404) {
    const byApp = /not accessible by integration/i.test(str(err.apiMessage));
    return {
      kind: "permission",
      text: byApp
        ? `The GitHub App lacks the "${what}" repository permission, so ${section} can't be shown. An organisation owner can grant it in the app's settings; then sign in again.`
        : `GitHub won't show these ${section}. The GitHub App may lack the "${what}" repository permission, or you may not be an admin of this repository.`,
    };
  }
  return { kind: "other", text: `Could not load ${section} from GitHub.` };
}

/** A failed write, as one sentence for the panel or dialog. */
export function libraryWriteError(e: unknown, what: string, section: Section): string {
  const err = asRaw(e);
  const msg = str(err.apiMessage) || str(err.detail);
  if (err.status === 409 || (err.status === 422 && /exist/i.test(msg))) return `Could not ${what}: a ${section === "variables" ? "variable" : "secret"} with that name already exists.`;
  if (/not accessible by integration/i.test(msg)) return `Could not ${what}: the GitHub App lacks write access to the "${section === "variables" ? "Variables" : "Secrets"}" repository permission.`;
  if (err.kind === "access") return `Could not ${what}: GitHub refused it${msg ? ` (${msg})` : ""}. You need admin rights on the repository.`;
  return `Could not ${what}${msg ? `: ${msg}` : "."}`;
}

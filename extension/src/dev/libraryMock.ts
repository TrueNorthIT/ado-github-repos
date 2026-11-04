// __TN_MOCK__ Actions > Library (batch K): repository and environment variables and secrets, with create, update and delete kept in memory
// for the session ("manyVariables" pages the repository's variables). Environments are actionsMock's staging and production. Scenarios: "noVariablesPermission" and "noSecretsPermission" answer
// 403 "Resource not accessible by integration" for that section, as GitHub does when the app lacks the permission; "readOnly" and
// "notAdmin" (mockFetch's repo permissions) make the viewer a non-admin, so no edit controls show.
import { PR_REPO } from "./fixtures/prs";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const empty = (status: number) => new Response(null, { status });
const MIN = 60e3;
const ago = (m: number) => new Date(Date.now() - m * MIN).toISOString();

interface Item { name: string; value?: string; created_at: string; updated_at: string }
const item = (name: string, value: string | undefined, mins: number): Item => ({ name, value, created_at: ago(mins * 3), updated_at: ago(mins) });

// Scope key ("repo" or "env:<name>") -> its variables and secrets. "manyVariables" adds enough repository variables to need a second page of 30.
const VARS: Record<string, Item[]> = {
  repo: [
    item("AZURE_REGION", "uksouth", 60 * 24 * 12),
    item("DOTNET_VERSION", "8.0.x", 60 * 24 * 40),
    item("NODE_VERSION", "20", 60 * 5),
    item("FEATURE_FLAGS", '{"newHeader":true,"betaSearch":false}', 60 * 24 * 3),
  ],
  "env:staging": [item("APP_URL", "https://staging.example.com", 60 * 24 * 2), item("LOG_LEVEL", "debug", 60 * 24 * 20)],
  "env:production": [item("APP_URL", "https://app.example.com", 60 * 24 * 30), item("LOG_LEVEL", "warning", 60 * 24 * 30), item("REPLICAS", "3", 60 * 24 * 9)],
};
const SECRETS: Record<string, Item[]> = {
  repo: [item("NPM_TOKEN", undefined, 60 * 24 * 90), item("SONAR_TOKEN", undefined, 60 * 24 * 7)],
  "env:staging": [item("AZURE_CREDENTIALS", undefined, 60 * 24 * 60)],
  "env:production": [item("AZURE_CREDENTIALS", undefined, 60 * 24 * 60), item("DB_PASSWORD", undefined, 60 * 24 * 14)],
};
const ENVS = ["staging", "production"];
const MANY = Array.from({ length: 30 }, (_, i) => item(`BUILD_SETTING_${String(i + 1).padStart(2, "0")}`, `value-${i + 1}`, 60 * 24 * (50 + i)));

const denied = () => json({ message: "Resource not accessible by integration", documentation_url: "https://docs.github.com/rest/actions/variables" }, 403);
const notAdmin = (sc: string) => sc === "readOnly" || sc === "notAdmin";

function page(list: Item[], u: URL, key: "variables" | "secrets", max: number, pathname: string) {
  const per = Math.min(Number(u.searchParams.get("per_page") || 30), max), p = Number(u.searchParams.get("page") || 1);
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  const more = p * per < sorted.length;
  const rows = sorted.slice((p - 1) * per, p * per).map((x) => (key === "secrets" ? { name: x.name, created_at: x.created_at, updated_at: x.updated_at } : x));
  return json({ total_count: sorted.length, [key]: rows }, 200, more ? { link: `<https://api.github.com${pathname}?per_page=${per}&page=${p + 1}>; rel="next"` } : {});
}

/** Answers the variables and secrets endpoints of the mock repository; undefined for anything else. `rest` is the path after /repos/{owner}/{name}. */
export function libraryRest(repo: string, rest: string, u: URL, init: RequestInit | undefined, sc: string): Response | undefined {
  if (repo.toLowerCase() !== PR_REPO) return undefined;
  const m = /^\/(?:actions|environments\/([^/]+))\/(variables|secrets)(?:\/([^/]+))?$/.exec(rest);
  if (!m) return undefined;
  const env = m[1] && decodeURIComponent(m[1]);
  if (env && !ENVS.includes(env)) return json({ message: "Not Found" }, 404);
  const key = env ? `env:${env}` : "repo";
  const section = m[2] as "variables" | "secrets";
  const name = m[3] && decodeURIComponent(m[3]);
  const method = init?.method ?? "GET";
  if ((section === "variables" && sc === "noVariablesPermission") || (section === "secrets" && sc === "noSecretsPermission")) return denied();
  const store = section === "variables" ? VARS : SECRETS;
  if (sc === "manyVariables" && key === "repo" && section === "variables" && !VARS.repo.includes(MANY[0])) VARS.repo.push(...MANY);
  const list = (store[key] ??= []);
  if (method === "GET" && !name) return page(list, u, section, section === "variables" ? 30 : 100, u.pathname);
  if (method !== "GET" && notAdmin(sc)) return json({ message: "Must have admin rights to Repository." }, 403);
  const at = name ? list.findIndex((x) => x.name.toUpperCase() === name.toUpperCase()) : -1;
  if (method === "GET") return at < 0 ? json({ message: "Not Found" }, 404) : json(list[at]);
  if (method === "DELETE") {
    if (at < 0) return json({ message: "Not Found" }, 404);
    list.splice(at, 1);
    return empty(204);
  }
  if (section !== "variables") return json({ message: "Not Found" }, 404); // setting a secret needs a sealed value: the app never sends one
  const body = JSON.parse(String(init?.body ?? "{}")) as { name?: string; value?: string };
  const newName = body.name?.toUpperCase();
  if (method === "POST" && !name) {
    if (!newName || typeof body.value !== "string") return json({ message: "Invalid request." }, 422);
    if (list.some((x) => x.name === newName)) return json({ message: "Already exists - Variable already exists" }, 409);
    list.push(item(newName, body.value, 0));
    return json({}, 201);
  }
  if (method === "PATCH" && name) {
    if (at < 0) return json({ message: "Not Found" }, 404);
    if (newName && newName !== list[at].name && list.some((x) => x.name === newName)) return json({ message: "Already exists - Variable already exists" }, 409);
    list[at] = { ...list[at], name: newName ?? list[at].name, value: body.value ?? list[at].value, updated_at: ago(0) };
    return empty(204);
  }
  return undefined;
}

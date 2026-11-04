// Code search (Files hub) is GitHub's own page: REST GET /search/code sends no Access-Control-Allow-Origin on its real responses
// (its preflight does), so the extension can't call it from the browser and links out to github.com/search instead.

export interface SearchInput {
  text: string;
  /** "owner/name" repositories to search. One is scoped with `repo:`; several or none search all of GitHub. */
  repos: string[];
  path?: string;
  ext?: string;
}

const quote = (v: string) => (/[\s"]/.test(v) ? `"${v.replace(/"/g, "")}"` : v);

/** The search terms with any scope qualifier the user typed (repo:, org:, user:) removed: the scope is the caller's to set. */
export function stripScope(text: string): string {
  return text.replace(/(^|\s)-?(?:repo|org|user):(?:"[^"]*"|\S+)/gi, " ").replace(/\s+/g, " ").trim();
}

/** The search on github.com. */
export function githubSearchUrl(input: SearchInput): string {
  const terms = stripScope(input.text);
  const scope = input.repos.length === 1 ? `repo:${input.repos[0]} ` : "";
  const q = `${scope}${terms}${input.path ? ` path:${quote(input.path)}` : ""}${input.ext ? ` path:*.${input.ext}` : ""}`;
  return `https://github.com/search?type=code&q=${encodeURIComponent(q)}`;
}

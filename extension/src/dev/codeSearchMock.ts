// __TN_MOCK__ GET /search/code for the Files hub's Code search: greps the fixture repos' text files and answers with GitHub's text-match shape.
// Scenarios: searchRateLimit (403, no code_search requests left), searchSecondary (403, secondary rate limit), searchInvalid (422, Validation Failed).
import { REPOS, TEXT } from "./fixtures/repos";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const SHA = "5ea7c4e5ea7c4e5ea7c4e5ea7c4e5ea7c4e5ea7c";

/** Splits a q string into words, keeping "quoted phrases" whole (without the quotes). */
const words = (q: string) => [...q.matchAll(/(-?\w+:)?"([^"]*)"|\S+/g)].map((m) => (m[2] !== undefined ? (m[1] ?? "") + m[2] : m[0]));

/** Fragments as GitHub cuts them: a line with a match and its neighbours, each with the indices of every term in it. At most two per file. */
function fragments(text: string, terms: string[]) {
  const lines = text.split("\n");
  const out: { object_url: string; object_type: string; property: string; fragment: string; matches: { text: string; indices: number[] }[] }[] = [];
  let last = -2;
  for (let i = 0; i < lines.length && out.length < 2; i++) {
    if (!terms.some((t) => lines[i].toLowerCase().includes(t)) || i <= last + 1) continue;
    const from = Math.max(0, i - 1), to = Math.min(lines.length, i + 2);
    const fragment = lines.slice(from, to).join("\n");
    const low = fragment.toLowerCase();
    const matches: { text: string; indices: number[] }[] = [];
    for (const t of terms) for (let at = low.indexOf(t); at >= 0; at = low.indexOf(t, at + t.length)) matches.push({ text: fragment.slice(at, at + t.length), indices: [at, at + t.length] });
    out.push({ object_url: "", object_type: "FileContent", property: "content", fragment, matches: matches.sort((a, b) => a.indices[0] - b.indices[0]) });
    last = to - 1;
  }
  return out;
}

export function codeSearchRest(u: URL, sc: string): Response | undefined {
  if (u.pathname !== "/search/code") return undefined;
  const reset = String(Math.floor(Date.now() / 1000) + 45);
  if (sc === "searchRateLimit" || sc === "rateLimit") return json({ message: "API rate limit exceeded for user ID 1." }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset, "x-ratelimit-resource": "code_search" });
  if (sc === "searchSecondary") return json({ message: "You have exceeded a secondary rate limit. Please wait a few minutes before you try again." }, 403, { "retry-after": "60" });
  if (sc === "searchInvalid") return json({ message: "Validation Failed", errors: [{ message: "The search contains only logical operators (AND / OR / NOT) without any search terms.", resource: "Search", field: "q", code: "invalid" }] }, 422);
  const ws = words(u.searchParams.get("q") ?? "");
  const repos = ws.filter((w) => w.startsWith("repo:")).map((w) => w.slice(5).toLowerCase());
  const fixtures = repos.map((r) => REPOS.find((x) => x.fullName.toLowerCase() === r));
  if (!repos.length || fixtures.some((f) => !f || f.missing)) {
    return json({ message: "Validation Failed", errors: [{ message: "The listed users and repositories cannot be searched either because the resources do not exist or you do not have permission to view them.", resource: "Search", field: "q", code: "invalid" }] }, 422);
  }
  const path = ws.find((w) => w.startsWith("path:"))?.slice(5).replace(/^\/+/, "");
  const ext = ws.find((w) => w.startsWith("extension:"))?.slice(10);
  const terms = ws.filter((w) => !/^-?\w+:/.test(w)).map((w) => w.toLowerCase());
  const items = fixtures.flatMap((repo) =>
    Object.keys(repo!.files)
      .filter((p) => TEXT[p] !== undefined && (!path || p.startsWith(path)) && (!ext || p.endsWith(`.${ext}`)))
      .filter((p) => terms.every((t) => TEXT[p].toLowerCase().includes(t)))
      .map((p) => ({
        name: p.slice(p.lastIndexOf("/") + 1),
        path: p,
        sha: SHA,
        url: `https://api.github.com/repositories/1/contents/${p}?ref=main`,
        git_url: "",
        html_url: `https://github.com/${repo!.fullName}/blob/main/${p}`,
        repository: { full_name: repo!.fullName },
        score: 1,
        text_matches: fragments(TEXT[p], terms),
      }))
  );
  const per = Number(u.searchParams.get("per_page") || 30), page = Number(u.searchParams.get("page") || 1);
  return json({ total_count: items.length, incomplete_results: false, items: items.slice((page - 1) * per, page * per) });
}

// Fixture repos, connections and trees for the mock GitHub and Azure DevOps endpoints.
import * as C from "./content";

export interface FixtureRepo {
  fullName: string;
  description: string | null;
  language: string | null;
  private: boolean;
  /** GitHub answers 404 for this repo (REQ-9). */
  missing?: boolean;
  /** The recursive tree comes back truncated, so the app fetches folder by folder. */
  truncated?: boolean;
  branches: string[];
  files: Record<string, { size?: number; type?: "commit" }>;
}

const sz = (text: string) => ({ size: new TextEncoder().encode(text).length });

/** Plain text for a path (binary and unknown paths are absent). Shared by every fixture repo. */
export const TEXT: Record<string, string> = {
  "README.md": C.README_MD,
  LICENSE: C.LICENSE,
  "package.json": C.PACKAGE_JSON,
  ".github/workflows/ci.yml": C.CI_YML,
  "docs/guide.md": C.GUIDE_MD,
  "docs/diagram.svg": C.SVG,
  "src/index.ts": C.INDEX_TS,
  "src/Program.cs": C.PROGRAM_CS,
  "src/config.json": '{ "name": "demo", "retries": 3 }\n',
  "src/util/greet.ts": "export const greet = (n: string) => `Hello, ${n}`;\n",
  "apps/web/src/index.ts": C.INDEX_TS,
  "apps/web/package.json": C.PACKAGE_JSON,
  "packages/core/src/greet.ts": "export const greet = (n: string) => `Hello, ${n}`;\n",
  "tools/build.yml": C.CI_YML,
  "azure-pipelines.yml": C.CI_YML,
  "Demo.sln": "Microsoft Visual Studio Solution File, Format Version 12.00\n",
  "data/sales.csv": C.SALES_CSV,
  "data/scores.tsv": C.BIG_TSV,
};
export const HTML: Record<string, string> = { "README.md": C.README_HTML, "docs/guide.md": C.GUIDE_HTML };

const textFiles = (...paths: string[]) => Object.fromEntries(paths.map((p) => [p, sz(TEXT[p])]));

/** Branches the New pull request fixtures (fixtures/newPr.ts) compare. */
export const NEWPR_BRANCHES = ["feature/add-login", "users/dev/1002-handle-empty-repos", "feature/no-changes", "feature/pr-199"];

const branches = (n: number) => ["main", "develop", "feature/x", "feature/login", "release/1.0", "hotfix/typo", ...Array.from({ length: n }, (_, i) => `feature/ticket-${1000 + i}`)];

export const REPOS: FixtureRepo[] = [
  {
    fullName: "truenorthit/github-repos", description: "Browse GitHub repositories from Azure DevOps.", language: "TypeScript", private: false, branches: [...branches(130), ...NEWPR_BRANCHES],
    files: {
      ...textFiles("README.md", "LICENSE", "package.json", "azure-pipelines.yml", "Demo.sln", ".github/workflows/ci.yml", "docs/guide.md", "docs/diagram.svg", "src/index.ts", "src/Program.cs", "src/util/greet.ts", "src/config.json", "data/sales.csv", "data/scores.tsv"),
      "docs/img/logo.png": { size: 160 },
      "docs/release.zip": { size: 52_431 },
      "data/large-export.json": { size: 2_621_440 },
      vendor: { type: "commit" },
    },
  },
  { fullName: "truenorthit/customer-portal", description: "Customer portal (private).", language: "C#", private: true, branches: ["main", "develop"], files: textFiles("README.md", "src/Program.cs") },
  { fullName: "truenorthit/no-description", description: null, language: null, private: false, branches: ["main"], files: textFiles("README.md") },
  { fullName: "truenorthit/gone", description: "Deleted or no access.", language: null, private: true, missing: true, branches: [], files: {} },
  {
    fullName: "truenorthit/monorepo", description: "Huge repo: its recursive tree is truncated.", language: "TypeScript", private: false, truncated: true, branches: ["main", "develop"],
    files: textFiles("README.md", "apps/web/src/index.ts", "apps/web/package.json", "packages/core/src/greet.ts", "tools/build.yml"),
  },
  { fullName: "truenorthit/a-very-long-repository-name-for-layout-tests", description: "Long name, for header layout checks.", language: "TypeScript", private: false, branches: ["main", "develop"], files: textFiles("README.md") },
  { fullName: "truenorthit/archive-tools", description: "Old scripts.", language: "PowerShell", private: false, branches: ["main"], files: textFiles("README.md") },
];

export const repoOf = (fullName: string) => REPOS.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());

export const CONNECTIONS = [
  { id: "conn-1", isConnectionValid: true, repos: ["truenorthit/github-repos", "truenorthit/customer-portal", "truenorthit/no-description", "truenorthit/gone", "truenorthit/a-very-long-repository-name-for-layout-tests"] },
  { id: "conn-2", isConnectionValid: false, repos: ["truenorthit/monorepo", "truenorthit/archive-tools"] },
];

// Git tree responses. Folder shas are "tree-<path>" so a non-recursive fetch can find its folder again.
const ROOT = "tree-";
type Item = { path: string; type: "blob" | "tree" | "commit"; sha: string; size?: number; mode: string };

function children(repo: FixtureRepo, folder: string): Item[] {
  const prefix = folder ? folder + "/" : "";
  const seen = new Map<string, Item>();
  for (const [p, v] of Object.entries(repo.files)) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    const i = rest.indexOf("/");
    if (i >= 0) seen.set(rest.slice(0, i), { path: rest.slice(0, i), type: "tree", sha: ROOT + prefix + rest.slice(0, i), mode: "040000" });
    else if (v.type === "commit") seen.set(rest, { path: rest, type: "commit", sha: "commit-" + p, mode: "160000" });
    else seen.set(rest, { path: rest, type: "blob", sha: "blob-" + p, size: v.size, mode: "100644" });
  }
  return [...seen.values()];
}

export function treeFor(repo: FixtureRepo, shaOrRef: string, recursive: boolean) {
  const folder = shaOrRef.startsWith(ROOT) ? shaOrRef.slice(ROOT.length) : "";
  const sha = ROOT + folder;
  if (!recursive) return { sha, truncated: false, tree: children(repo, folder) };
  if (repo.truncated && !folder) return { sha, truncated: true, tree: children(repo, "") }; // a folder's own recursive tree is whole
  const all: Item[] = [];
  const walk = (dir: string) =>
    children(repo, dir).forEach((c) => {
      const full = dir ? `${dir}/${c.path}` : c.path;
      all.push({ ...c, path: full });
      if (c.type === "tree") walk(full);
    });
  walk(folder);
  return { sha, truncated: false, tree: folder ? all.map((i) => ({ ...i, path: i.path.slice(folder.length + 1) })) : all };
}

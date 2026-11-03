# GitHub Repos for Azure DevOps

An Azure DevOps extension that recreates ADO's Repos experience (Files, Commits, Pushes, Branches, Tags & Releases, Pull requests,
Actions, Advanced Security) backed by GitHub. The aim is to look and behave like native ADO. Published privately to the Marketplace as
`TrueNorthIT.github-repos`. This repo is public: keep customer names, Azure subscription and resource IDs, and secrets out of commits.

- `extension/`: the extension (React 16, azure-devops-ui 2.281, esbuild, vitest, Monaco 0.57, js-yaml).
- `auth/`: the Azure Function that does the GitHub App OAuth exchange and token refresh (`func-tnit-ghrepoview`).
- `shared/contract.ts`: the contract between the two. Don't change it casually.

## UI rule: azure-devops-ui first

The extension must look native to Azure DevOps, and native ADO is built from the azure-devops-ui (`bolt-*`) components.

- Build every piece of UI from azure-devops-ui components: Header, TabBar/Tab/TabBadge, Card (including `collapsible`), Table with SimpleTableCell/TwoLineTableCell, Tree, MasterPanel, Splitter, Status, Pill, Button/MenuButton/MoreButton, Link, Icon, Dropdown, TextField, Checkbox, FormItem, Panel, Dialog, MessageCard, ZeroData, VssPersona, and so on.
- If nothing matches exactly, use the closest component and adapt it with its props or a `className`. Check the props in `node_modules/azure-devops-ui/**/*.Props.d.ts`; comments in our code claiming a component "can't" do something have been wrong before.
- Hand-roll markup (raw `button`, `table`, `ul`, `details`, `dl`, custom tab-like labels) only when no component can do the job. Each time, say what was hand-rolled and why, in the commit message and in your report.
- Match native spacing by measuring a native page with `getComputedStyle`, not by eye. Public native Pipelines pages to compare against: `https://dev.azure.com/dnceng-public/public/_build`.
- Loading lists show native shimmer rows: render the same Table with `skeletonRows()` (src/RepoHub.tsx), not a page spinner.

Hand-rolled CSS put the 0.3.0 redesign, and later the first Actions run and log pages, in the uncanny valley.

## Build, test, check

From `extension/`:

- `npm test` runs vitest. vitest does not type-check, so also run `npx tsc --noEmit` (`npm run build` does both, then bundles). `Array.prototype.at` is not in the TS lib.
- `npm run dev` serves the mock harness at `http://localhost:3000/hub.html` (`PORT` and `DEV_OUT` let a second server run beside it). The ADO SDK and every fetch are replaced by `src/dev`, so no ADO or GitHub access is needed. `?hub=files|commits|pushes|branches|tags|prs|actions|security`, `?scenario=…` for failure and edge cases (see the mock toolbar), `?theme=light|dark`. Mocks stay behind the esbuild alias and the dev entry point; the publish workflow fails if mock code reaches `dist`.
- `npm run shots [-- page …]` starts the mock and saves headless Chrome screenshots of the main pages in both themes to `extension/shots/`. Use it to check UI where you can't open a browser, and look at the PNGs.
- Tests that need fixtures from real data can read GitHub read-only with `gh api`; never write to GitHub from a test.

## Code rules that have bitten us

- Theme colours: ADO's `--palette-*` variables are RGB triples, so use `rgba(var(--palette-x, r, g, b), 1)`. `tests/paletteVars.test.ts` enforces it. Icons must exist in the font (`tests/iconNames.test.ts`).
- Menus: azure-devops-ui keeps a menu open after a `checked` checkbox item, so don't use checked items for actions.
- A Table or Tree item provider must be memoised on everything its cells read (including busy state), or it re-renders without end or shows stale cells.
- Monaco is global: themes apply to every editor. Zones need `suppressMouseDown: false` and `.monaco-editor .lines-content > .view-zones { z-index: 1 }`; don't stopPropagation on zone wrappers (React 16 delegates to `document`).
- Each hub is its own iframe page. A hub opened from the left nav has no hash; `useDefaultRepo` then uses the repo last open in this project (`src/lib/lastRepo.ts`), else the first connected one.
- On a cold load ADO's `getHash()` can answer "" for several seconds. Never overwrite a real address with a default: `go(…, "ifEmpty")` shows the default in memory and keeps re-reading (`IF_EMPTY_WAITS` in `src/hostNav.ts`).
- Hub-specific hash keys live in their own module beside `browseState.ts` (securityHash, actionsHash, newPrHash…), read with `useHashExtras()`.
- GitHub raw and html representations share an ETag, so those requests use `cache: "no-store"`.
- GitHub limits to remember: uploads.github.com has no CORS (release assets are attached on GitHub's own page). Job logs and artifact zips redirect to Azure blob storage with CORS, so `restText`/`restBlob` work. Job summaries and test results have no public API.

## Releasing

1. Bump `version` in both `extension/vss-extension.json` and `extension/package.json` (every release gets a new version, never reuse one), run `npm install --package-lock-only` and `npm run build`, and commit with the code or as "Release X.Y.Z".
2. Push `main`. `.github/workflows/publish.yml` sees a version with no `vX.Y.Z` tag, publishes to the Marketplace (trusted publishing, no stored PAT), waits for validation, then creates the tag and the GitHub release with notes from `.github/scripts/release-notes.sh` (one section per commit; merges and repeated cherry-picks are left out). Pushing a tag yourself also still works.
3. Watch the run (`gh run list --workflow publish.yml`, then `gh run view`). A `503` from the Marketplace token exchange is on their side: re-run the failed job after a few minutes.
4. After it's installed in ADO, a full reload with `?r=N` before the `#` is needed, or the hub keeps serving the previous version.

Commit messages: a meaningful subject and a body saying why. They become the release notes, and they are how we rewind. UK English throughout.

## Testing live

Real checks in Azure DevOps need a browser signed in to ADO and GitHub. TrueNorth's Conditional Access requires a compliant device, so that can't happen from a cloud machine; it's done on Joe's laptop (Claude in Chrome, or by hand). Elsewhere, check with tests, the mock harness and `npm run shots`, and list what still needs a live check.

Live test data: use the TrueTunes repo's test PR #234, its `test/github-repos-extension-pr` branch and `test/merge-target`; leave real work untouched, and ask before anything that writes to a real repo, board or release.

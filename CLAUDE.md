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
- `npm run dev` serves the mock harness at `http://localhost:3000/hub.html` (`PORT` and `DEV_OUT` let a second server run beside it). The ADO SDK and every fetch are replaced by `src/dev`, so no ADO or GitHub access is needed. `?hub=files|commits|pushes|branches|tags|prs|actions|security`, `?scenario=…` for failure and edge cases (see the mock toolbar), `?theme=light|dark`. The dashboard widgets are at `widget.html?widget=prs|runs&size=2x2&repo=…` (add `&config=1` for the configuration panel with a live preview); `src/dev/widgetMain.tsx` plays the dashboard host. The GitHub tab in ADO's My work flyout (the top bar's checklist icon; `ms.vss-web.tab` on the undocumented `ms.vss-tfs-web.my-work-pivot`) is at `myWorkTab.html` (`?scenario=signedOut|rateLimit|noProjectScope|noConnections`, `?height=`); it lists PRs only in repos some project connects, scanning every project (`vso.project`) and caching the result per organisation for 30 minutes. Its "View more" opens the organisation-level GitHub pull requests page (`MyPrsHub.tsx`, `?hub=myprs`): a hub in ADO's Home hub group `ms.vss-tfs-web.suite-me-page-hub-group`, so it has no project; it loads `hub.html` and `index.tsx` picks it by contribution id. Both share `myPrsShared.tsx`. Mocks stay behind the esbuild alias and the dev entry point; the publish workflow fails if mock code reaches `dist`.
- `npm run shots [-- page …]` starts the mock and saves headless Chrome screenshots of the main pages in both themes to `extension/shots/`. Use it to check UI where you can't open a browser, and look at the PNGs. It exits non-zero if any shot fails. Chrome: `SHOTS_CHROME` if set, else Playwright's `chrome-headless-shell` under `/opt/pw-browsers` (cloud containers, where full Chrome's `--screenshot` hangs), else `CHROME_PATH` and the usual install paths; it adds `--no-sandbox` when running as root.
- **Live data mode** (dev only): `GH_SANDBOX_TOKEN=… LIVE=1 npm run dev` (or `GH_SANDBOX_TOKEN=… npm run shots -- --live [pages]`) runs the harness against the real `TrueNorthIT/gh-repos-sandbox`. In cloud sessions `GH_SANDBOX_TOKEN` is a `ghu_` token from a dev copy of the GitHub App installed only on the sandbox; locally `GH_SANDBOX_TOKEN=$(gh auth token)` works, but that token is broad, so rely on the guard. Real: everything on api.github.com (REST, GraphQL, and the blob-storage redirects for logs and artifacts), with the app signed in as the token's user, so checks, annotations, approvals and the viewer match production. Mocked as ever: the ADO SDK, work items and identities; the project's connections list only the sandbox, so the hubs default to it. **The token never reaches the page.** `src/dev/live.ts` sends api.github.com requests to the dev server's same-origin proxy at `/__gh/…`. `build.mjs --dev` runs a small Node http server in front of esbuild's serve, and `src/dev/ghProxy.ts` (tests: `tests/ghProxy.test.ts`) reads `GH_SANDBOX_TOKEN` in Node, adds it to each request and drops the page's own headers apart from a short allow list. It proxies api.github.com only: a full or protocol-relative URL, a backslash or a control character in the path is refused with a 400. It follows the log and artifact redirects itself, by hand, and never sends the token or the page's headers to the blob host. The bundle gets only `__LIVE__`: `build.mjs` throws if production defines anything live, and `publish.yml` greps `dist` for `ghu_`, `github_pat_` and the live markers. The repo guard (`src/dev/liveGuard.ts`, tested in `tests/liveGuard.test.ts`) runs twice, in the page and again in the dev server on every proxied request (including each api.github.com redirect hop). Each refuses with a 403 and logs `[live guard] refused…`: the page in the browser console, the server on its stderr. It refuses anything addressing another repository (REST paths, `/repositories/{id}`, `repo:` qualifiers, GraphQL `repository()` and unseen node ids) and any write outside the sandbox repo; org reads for `/user` and org teams and members, and public profiles (`/users/{login}`, for hover cards), are allowed. For cloud sessions, see "Cloud sessions" below. Another guard, the PreToolUse hook `.claude/hooks/sandbox-only.mjs` (samples: `bash .claude/hooks/sandbox-only.test.sh`), blocks Bash commands that use the token against another repo. **Writes land in the real sandbox**: re-seed what a test used up (a merged PR, a deleted release). Live shots are saved as `shots/live-*.png`.
- Tests that need fixtures from real data can read GitHub read-only with `gh api`; never write to GitHub from a test.

## Cloud sessions

A fresh Claude Code cloud session works with no manual steps once the environment is set up like this (in the environment's settings: the cloud environment menu in the session's title bar, then Edit):
- **Repositories:** this repo and `TrueNorthIT/gh-repos-sandbox`. The session's egress proxy refuses GitHub API calls for any repository not attached to the session, so live mode needs the sandbox attached.
- **Setup script:** the contents of `.claude/cloud-setup.sh`. A session with two repos is rooted above both (`/home/user`), so this repo's `.claude/settings.json` doesn't load. The setup script adds the same two hooks to the user-level `~/.claude/settings.json`, pointing into this repo: `.claude/hooks/session-start.sh` installs `extension/` and `auth/` dependencies (it takes a lock and skips a lockfile it has already installed, so firing twice is harmless), and `sandbox-only.mjs` guards Bash. Change the hooks in those files, not in the setup script.
- **Variables:** `GH_SANDBOX_TOKEN` (see Live data mode). `CHROME_PATH` isn't needed; `npm run shots` finds the headless shell itself.

How live mode behaves there: when `HTTPS_PROXY` is set, `build.mjs` re-runs itself with `NODE_USE_ENV_PROXY=1`, so the dev server's fetch goes through the egress proxy rather than around it. Don't route around that proxy. It refuses GitHub GraphQL outright (the refusal says GraphQL isn't available from Claude Code sessions; no environment setting changes that, and a relay around it is off the table), so pages built on GraphQL show the "lacks … permission" access error in cloud live mode: the Branches and Tags lists, Releases, the PR list and every PR page. Check those locally. Pages that read GraphQL only for extras degrade instead: Commits lists over REST and leaves the PR, status and signature columns empty. REST pages work: Files (including Clone, line links), Commits, Pushes, Branch policies, Actions (runs, the Tests tab, annotations, job logs, artifacts), Advanced Security and the dashboard widgets. The Actions Environments and Library tabs are the exceptions: the egress proxy refuses `/environments` and `/actions/variables` and `/actions/secrets` (403 "…path is not permitted through this proxy"), so those show the permission MessageCards in cloud live mode. It also refuses `/users/{login}` and `/orgs/…/members/{login}` ("sessions are bound to their configured repositories"), so person hover cards show only the name and avatar with "Profile details could not be loaded." New features should use REST where GitHub offers it, so they can be checked here. When the dev server sees either refusal it says so once on stderr as `[gh proxy] …` (`EGRESS_HINTS` in `ghProxy.ts`).

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
- GitHub's `/search/code` sends no `Access-Control-Allow-Origin` on its real responses (the preflight does), so code search can only link out to github.com/search: the Files hub's search box opens it in a new tab.

## Releasing

1. Bump `version` in both `extension/vss-extension.json` and `extension/package.json` (every release gets a new version, never reuse one), run `npm install --package-lock-only` and `npm run build`, and commit with the code or as "Release X.Y.Z".
2. Push `main`. `.github/workflows/publish.yml` sees a version with no `vX.Y.Z` tag, publishes to the Marketplace (trusted publishing, no stored PAT), waits for validation, then creates the tag and the GitHub release with notes from `.github/scripts/release-notes.sh` (one section per commit; merges and repeated cherry-picks are left out). Pushing a tag yourself also still works.
3. Watch the run (`gh run list --workflow publish.yml`, then `gh run view`). A `503` from the Marketplace token exchange is on their side: re-run the failed job after a few minutes.
4. After it's installed in ADO, a full reload with `?r=N` before the `#` is needed, or the hub keeps serving the previous version.

Commit messages: a meaningful subject and a body saying why. They become the release notes, and they are how we rewind. UK English throughout.

## Testing live

Real checks in Azure DevOps need a browser signed in to ADO and GitHub. TrueNorth's Conditional Access requires a compliant device, so that can't happen from a cloud machine; it's done on Joe's laptop (Claude in Chrome, or by hand). Elsewhere, check with tests, the mock harness and `npm run shots`, and list what still needs a live check.

Test data: **`TrueNorthIT/gh-repos-sandbox`** (private) exists for this, and anything in it is safe to change, re-run, release or delete. It has:
- `main`, `feature/greeting` (PR #3: a code, markdown and image diff, an inline review thread, a label, a milestone and "Closes #1"), `test/failing` (draft PR #4: failing matrix tests, lint error and warning annotations, JUnit artifacts) and `test/merge-target`;
- tags `v0.1.0` (annotated), `v0.2.0-beta.1` and `nightly`; releases v0.1.0 (Latest, two assets, a reaction), v0.2.0 beta 1 (Pre-release) and v0.3.0 (Draft);
- workflows CI (lint, matrix test, build), "Manual run" (every `workflow_dispatch` input type, plus `sleep_seconds` for testing Cancel) and Deploy (waits on the `sandbox-approval` environment, which has a required reviewer);
- Dependabot alerts from an old `lodash`. Code scanning is off (it needs Code Security on a private repo).

Re-seed what a test used up (a deleted release, a merged PR) before finishing. Older live tests used TrueTunes PR #234 and its branches; leave other real work untouched, and ask before anything that writes outside the sandbox.

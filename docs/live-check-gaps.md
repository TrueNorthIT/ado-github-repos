# Live check: gap-analysis features

Everything here is built, unit-tested and checked in the mock harness (`npm run shots`). These checks need a real Azure DevOps
org and real GitHub, so they run on a compliant device (Claude in Chrome or by hand), against `TrueNorthIT/gh-repos-sandbox`.
Tick each, note anything that doesn't look native, and re-seed the sandbox afterwards.

## GitHub App permissions (check first)
- [ ] Production app has: Variables (read/write), Secrets (read/write), Administration (write, for rulesets), Workflows (write), Deployments (read), Dependabot alerts (read).
- [ ] Without each, the page shows its permission MessageCard rather than breaking.

## Files
- [ ] Clone panel: HTTPS/SSH copy, "Clone in VS Code" opens VS Code from inside the iframe.
- [ ] Select lines, "Copy link to lines": the link opens the file with those lines tinted.
- [ ] "Download repository as zip" downloads for the private sandbox.
- [ ] Edit a .md file: Edit / Preview toggle.
- [ ] Delete a folder (on a throwaway branch): commit lands; stale-branch message names the folder.
- [ ] Code search: results, preview with hits, "All connected repositories", rate-limit message after ~10 quick searches.

## Commits / Pushes
- [ ] Author and From/To date filters narrow the list; Load more pages within the filter.
- [ ] PR, status and signature columns fill (GraphQL; local only).
- [ ] `AB#` pills link to real work items; unknown ids say so.
- [ ] Pushes date filter; a force push shows its outlined pill.
- [ ] Cherry-pick a commit from `feature/greeting` onto `test/merge-target`: new branch, "Create pull request" opens New PR. Revert likewise. Then delete `*-cherry-pick-*`, `*-revert-*` and any `tmp/*` branches.

## Branches
- [ ] Branch policies page for `main` reads rulesets and classic protection; non-admin wording on 403.
- [ ] As admin: edit policies, Save creates "Azure DevOps policies: <branch>"; Discard and leave-with-unsaved-edits prompt; turning all off deletes it.
- [ ] Lock / Unlock `test/merge-target`; lock icon in the list; a push is refused while locked. Unlock afterwards.
- [ ] Rename a throwaway branch; favourites follow. Set as default (admin) on a throwaway repo only.
- [ ] Compare a tag and a SHA. Forks page; New PR from a fork.

## Pull requests (GraphQL; local only)
- [ ] Required / Optional reviewer groups with a CODEOWNERS file.
- [ ] Semi-linear merge on a throwaway PR: progress steps, rebased head merged; a push during the rebase stops it.
- [ ] Cherry-pick a completed PR.

## Actions
- [ ] Disable / Enable "Manual run" (re-enable afterwards).
- [ ] Delete a throwaway run and its logs.
- [ ] Scheduled runs panel times match the cron in local time.
- [ ] Environments tab and an environment's deployment history (needs Deployments read).
- [ ] Tests tab on a `test/failing` run: 8 tests, 2 failed, details card.
- [ ] Edit workflow opens the Files editor; committing without Workflows permission shows the message.
- [ ] Status badge dialog.
- [ ] Library tab: add, edit, rename, delete a variable; secret names and delete.

## Advanced Security
- [ ] Ecosystem, package and validity filters change the results.

## Dashboard widgets
- [ ] Both widgets appear in the catalogue with icon and preview.
- [ ] Configuration saves; preview reloads.
- [ ] Clicks open the PR / run in our hubs; title spacing and dark background match native widgets.

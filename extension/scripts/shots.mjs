// Screenshots of the mock harness in headless Chrome, for checking UI without a browser session (cloud sessions, CI, reviews).
// No dependencies: it starts the mock dev server and uses Chrome's own --screenshot.
//
//   npm run shots                         every page in PAGES, light and dark, into shots/
//   npm run shots -- commits run-9001     only those pages
//   SHOTS_CHROME=... npm run shots        a specific Chrome; otherwise Playwright's headless shell if installed (cloud sessions), then CHROME_PATH
//   GH_SANDBOX_TOKEN=... npm run shots -- --live [page …]   live mode: the real TrueNorthIT/gh-repos-sandbox through the repo guard, own page set
//
// Read the PNGs afterwards (an agent can open them with its image-reading tool). Without --live it is mock data only and never touches ADO or GitHub; --live only reads the sandbox repo.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const LIVE = process.argv.includes("--live");
const PORT = Number(process.env.SHOTS_PORT) || (LIVE ? 3098 : 3099);
const BASE = `http://localhost:${PORT}/hub.html`;
const SANDBOX = "TrueNorthIT/gh-repos-sandbox";
const REPO = LIVE ? `#repo=${encodeURIComponent(SANDBOX)}` : "#repo=truenorthit%2Fgithub-repos";
/** Dashboard widgets: a value starting with "/" is a path of its own (widget.html plays the dashboard host; see src/dev/widgetMain.tsx). */
const WIDGET_PAGES = {
  "widget-prs": "/widget.html?widget=prs&size=3x2&repo=truenorthit/github-repos",
  "widget-prs-2x2": "/widget.html?widget=prs&size=2x2&filter=assigned&repo=truenorthit/github-repos",
  "widget-runs": "/widget.html?widget=runs&size=2x2&repo=truenorthit/github-repos",
  "widget-runs-4x2": "/widget.html?widget=runs&size=4x2&workflow=101&repo=truenorthit/github-repos",
  "widget-runs-2x1": "/widget.html?widget=runs&size=2x1&repo=truenorthit/github-repos",
  "widget-config": "/widget.html?widget=runs&config=1&repo=truenorthit/github-repos",
  "widget-signed-out": "/widget.html?widget=prs&size=2x2&scenario=signedOut",
};
/** name -> query and hash after hub.html. */
const MOCK_PAGES = {
  files: `?hub=files${REPO}`,
  // Hover cards (src/HoverCard.tsx): ?click=hover:… (src/dev/main.tsx) rests the pointer on a person, a PR number or an AB# pill.
  "hover-person": `?hub=commits&click=${encodeURIComponent("hover:.gh-hover-anchor > .gh-person")}${REPO}`,
  "hover-pr": `?hub=branches&click=${encodeURIComponent("hover:.gh-hover-anchor > .gh-pr-ref")}${REPO}&branchTab=all`,
  "hover-workitem": `?hub=commits&click=${encodeURIComponent("hover:.gh-wi-pills .gh-hover-anchor")}${REPO}`,
  "hover-pr-author": `?hub=prs&click=${encodeURIComponent("hover:.gh-hover-anchor .vss-Persona")}${REPO}&view=prs`,
  "hover-pr-merged": `?hub=commits&click=${encodeURIComponent("hover:.gh-hover-anchor > .gh-pr-ref")}${REPO}`,
  "hover-reviewer": `?hub=prs&click=${encodeURIComponent("hover:.gh-pr-row .gh-hover-anchor")}${REPO}&view=prs&pr=200`,
  "hover-fails": `?hub=prs&scenario=hoverFails&click=${encodeURIComponent("hover:.gh-hover-anchor .vss-Persona")}${REPO}&view=prs`,
  "files-clone": `?hub=files&click=${encodeURIComponent('button[aria-label="Clone repository"]')}${REPO}`,
  "file-lines": `?hub=files${REPO}&path=src%2Findex.ts&line=3&lineEnd=5`,
  "file-readme": `?hub=files${REPO}&path=README.md`,
  "file-guide-mermaid": `?hub=files${REPO}&path=docs%2Fguide.md`,
  "file-csv": `?hub=files${REPO}&path=data%2Fsales.csv`,
  "file-tsv-big": `?hub=files${REPO}&path=data%2Fscores.tsv`,
  "pr-200-csv": `?hub=prs&click=${encodeURIComponent('button[aria-label="Rendered view of prices.csv"]')}${REPO}&view=prs&pr=200&prPage=files&file=data%2Fprices.csv`,
  "file-edit-workflow": `?hub=files${REPO}&ref=main&path=.github%2Fworkflows%2Fci.yml&edit=true`,
  commits: `?hub=commits${REPO}`,
  pushes: `?hub=pushes${REPO}`,
  "commits-filtered": `?hub=commits${REPO}&cAuthor=ann&cFrom=2026-01-01`,
  "commit-detail": `?hub=commits${REPO}&commit=ed921796ed921796ed921796ed921796ed921796&commitTab=details`,
  // Batch I: the commit ⋯ menu's Cherry-pick and Revert dialogs (form, done, conflict) and a completed PR's Cherry-pick.
  "cherry-pick-dialog": `?hub=commits&click=${encodeURIComponent("[aria-label=\"More actions\"]|text:Cherry-pick|text:Topic branch name")}${REPO}&commit=ed921796ed921796ed921796ed921796ed921796`,
  // The rest open from the list's row ⋯ (the commit page's diff is too slow to load inside the shot's time budget for every step).
  "cherry-pick-done": `?hub=commits&click=${encodeURIComponent("[aria-label^=\"Actions for commit\"]|text:Cherry-pick|text:Cherry-pick|.gh-pick-done")}${REPO}`,
  "cherry-pick-conflict": `?hub=commits&scenario=cherryPickConflict&click=${encodeURIComponent("[aria-label^=\"Actions for commit\"]|text:Cherry-pick|text:Cherry-pick|text:Topic branch name")}${REPO}`,
  "revert-dialog": `?hub=commits&click=${encodeURIComponent("[aria-label^=\"Actions for commit\"]|text:Revert|text:Topic branch name")}${REPO}`,
  "pr-cherry-pick": `?hub=prs&click=${encodeURIComponent("[aria-label=\"More actions\"]|text:Cherry-pick|text:Topic branch name")}${REPO}&view=prs&pr=316`,
  "pushes-filtered": `?hub=pushes${REPO}&pushPeriod=week`,
  branches: `?hub=branches${REPO}&branchTab=all`,
  "branch-policies": `?hub=branches${REPO}&view=policies&polBranch=main`,
  "branch-policies-reader": `?hub=branches&scenario=notAdmin${REPO}&view=policies&polBranch=release%2F1.0`,
  // Batch J: an admin editing (the extension's own ruleset), after a Save, refused for want of admin rights, a locked branch and its menu.
  "branch-policies-edit": `?hub=branches&click=${encodeURIComponent('[aria-label="Require a minimum number of reviewers: off"]')}${REPO}&view=policies&polBranch=develop`,
  "branch-policies-saved": `?hub=branches&click=${encodeURIComponent('[aria-label="Require a minimum number of reviewers: off"]|[aria-label="Check for comment resolution: off"]|text:Save')}${REPO}&view=policies&polBranch=main`,
  "branch-policies-denied": `?hub=branches&scenario=rulesetsDenied&click=${encodeURIComponent('[aria-label="Block force pushes: off"]|text:Save')}${REPO}&view=policies&polBranch=develop`,
  "branch-policies-locked": `?hub=branches${REPO}&view=policies&polBranch=release%2F2.0`,
  "branches-locked": `?hub=branches&click=${encodeURIComponent('[aria-label="Actions for release/2.0"]')}${REPO}&branchTab=all&q=release`,
  "compare-tag": `?hub=branches${REPO}&view=compare&cmpBase=v1.0.0&cmpHead=develop`,
  tags: `?hub=tags${REPO}`,
  releases: `?hub=tags${REPO}&tagTab=releases`,
  prs: `?hub=prs${REPO}&view=prs`,
  "pr-200": `?hub=prs${REPO}&view=prs&pr=200`,
  "pr-200-files": `?hub=prs${REPO}&view=prs&pr=200&prPage=files`,
  // The code above each review thread in the Overview feed: Copilot's findings (title, severity, the "suggested a fix" link) and the ordinary threads (a range, a LEFT-side line, an outdated one).
  "pr-200-copilot": `?hub=prs&click=${encodeURIComponent('scroll:[aria-label="Code at src/retry.ts"]')}${REPO}&view=prs&pr=200`,
  // Copilot as a comment author: "Copilot" with the AI pill, and its card (no /users lookup).
  // A commit author whose email is on no GitHub account: ADO's own identity card when the email is in its directory (Gwen), else name and email (Sam).
  "hover-git-ado": `?hub=commits&click=${encodeURIComponent("hover:.gh-hover-anchor > .gh-person@Gwen Git")}${REPO}`,
  "hover-git": `?hub=commits&click=${encodeURIComponent("hover:.gh-hover-anchor > .gh-person@Sam Unlinked")}${REPO}`,
  "hover-copilot": `?hub=prs&click=${encodeURIComponent("hover:.gh-feed-who .gh-hover-anchor:has(.gh-bot-pill)")}${REPO}&view=prs&pr=200`,
  "pr-200-threads": `?hub=prs&click=${encodeURIComponent('scroll:[aria-label="Code at src/lib/names.ts"]')}${REPO}&view=prs&pr=200`,
  // VW-12: collapsed unchanged lines with their expand rows, inline and side by side, and after "Show 20 more below".
  "pr-diff-expand": `?hub=prs${REPO}&view=prs&pr=200&prPage=files&file=src%2Futil%2Fgreet.ts`,
  "pr-diff-expand-sbs": `?hub=prs${REPO}&view=prs&pr=200&prPage=files&file=src%2Futil%2Fgreet.ts&sbs=1`,
  "pr-diff-expand-more": `?hub=prs&click=${encodeURIComponent("text:Show 20 more below|scroll:text:Show all 29 lines")}${REPO}&view=prs&pr=200&prPage=files&file=src%2Futil%2Fgreet.ts`,
  // CM-6: an existing thread on lines 13-15 (gutter bar, "Lines 13–15"), and lines 16-18 picked in the gutter (press on 16, Shift-press on 18) with the comment box open.
  "pr-range-thread": `?hub=prs${REPO}&view=prs&pr=200&prPage=files&file=src%2Flib%2Fnames.ts`,
  "pr-range-compose": `?hub=prs&click=${encodeURIComponent('pointer:.gh-pr-file:has([aria-label="View src/lib/names.ts"]) .editor.modified .line-numbers@16|shiftpointer:.gh-pr-file:has([aria-label="View src/lib/names.ts"]) .editor.modified .line-numbers@18|scroll:text:src/lib/names.ts, lines 16 to 18')}${REPO}&view=prs&pr=200&prPage=files&file=src%2Flib%2Fnames.ts`,
  // Image diff modes on a modified PNG (size change, transparency) and SVG; ?click= picks a mode, which then applies to every image on the page.
  "pr-image-2up": `?hub=prs${REPO}&view=prs&pr=200&prPage=files&file=docs%2Fimg%2Flogo.png`,
  "pr-image-onion": `?hub=prs&click=${encodeURIComponent('[aria-label="Onion skin comparison of logo.png"]')}${REPO}&view=prs&pr=200&prPage=files&file=docs%2Fimg%2Flogo.png`,
  "pr-image-swipe": `?hub=prs&click=${encodeURIComponent('[aria-label="Swipe comparison of logo.png"]|text:diagram.svg')}${REPO}&view=prs&pr=200&prPage=files&file=docs%2Fimg%2Flogo.png`,
  // ?click= (src/dev/main.tsx) opens the Complete panel and picks Semi-linear merge.
  "pr-317-semilinear": `?hub=prs&click=${encodeURIComponent("text:Complete|.gh-complete input[aria-label=\"Merge type\"]|text:Semi-linear merge")}${REPO}&view=prs&pr=317`,
  "pr-317-semilinear-run": `?hub=prs&scenario=rebaseStuck&click=${encodeURIComponent("text:Complete|.gh-complete input[aria-label=\"Merge type\"]|text:Semi-linear merge|text:Complete merge")}${REPO}&view=prs&pr=317`,
  "pr-317-semilinear-fail": `?hub=prs&scenario=mergeBlocked&click=${encodeURIComponent("text:Complete|.gh-complete input[aria-label=\"Merge type\"]|text:Semi-linear merge|text:Complete merge")}${REPO}&view=prs&pr=317`,
  forks: `?hub=branches${REPO}&view=forks`,
  "newpr-fork": `?hub=prs${REPO}&view=newpr&source=fix%2Ftypo-in-readme&sourceRepo=contributor%2Fgithub-repos`,
  "forks-dialog": `?hub=branches&scenario=forkDenied&click=${encodeURIComponent("text:Fork|[role=dialog] button.primary")}${REPO}&view=forks`,
  "pr-318-protected": `?hub=prs&click=${encodeURIComponent("text:Complete")}${REPO}&view=prs&pr=318`,
  actions: `?hub=actions${REPO}&view=actions`,
  "run-9001": `?hub=actions${REPO}&view=actions&actRun=9001`,
  "run-9001-tests": `?hub=actions${REPO}&view=actions&actRun=9001&actRunTab=tests`,
  "run-9004-tests": `?hub=actions${REPO}&view=actions&actRun=9004&actRunTab=tests`,
  "log-900151": `?hub=actions${REPO}&view=actions&actRun=9001&actJob=900151`,
  "actions-wf-disabled": `?hub=actions${REPO}&view=actions&actWorkflow=103`,
  "actions-envs": `?hub=actions${REPO}&view=actions&actTab=environments`,
  "actions-library": `?hub=actions${REPO}&view=actions&actTab=library`,
  "actions-library-noperm": `?hub=actions&scenario=noSecretsPermission${REPO}&view=actions&actTab=library`,
  "actions-library-readonly": `?hub=actions&scenario=notAdmin${REPO}&view=actions&actTab=library`,
  // ?click= (src/dev/main.tsx): "edit" waits for the admin-only Add button (so rows are editable), closes that panel and opens a variable;
  // "add" submits an empty editor to show the validation.
  "actions-library-edit": `?hub=actions&click=${encodeURIComponent("text:Add variable|text:Cancel|text:NODE_VERSION")}${REPO}&view=actions&actTab=library`,
  "actions-library-add": `?hub=actions&click=${encodeURIComponent("text:Add variable|input[aria-label=Name]|.bolt-panel button.primary")}${REPO}&view=actions&actTab=library`,
  "actions-env-staging": `?hub=actions${REPO}&view=actions&actTab=environments&actEnv=staging`,
  security: `?hub=security${REPO}&view=security&secTab=dependencies`,
  // One alert of each kind: the Details grid, the back button. 136 is a dismissed Dependabot alert with a comment, secret 5 a resolved one.
  "security-alert-dependabot": `?hub=security${REPO}&view=security&secTab=dependencies&alert=136&secState=dismissed`,
  "security-alert-code": `?hub=security${REPO}&view=security&secTab=code&alert=12`,
  "security-alert-secret": `?hub=security${REPO}&view=security&secTab=secrets&alert=5`,
  ...WIDGET_PAGES,
};

/** Live pages: the sandbox's fixed PRs, plus a CI run on test/failing and one failed job, looked up through the dev server's /__gh proxy (which holds the token and guards). */
async function livePages() {
  const gh = async (path) => {
    const r = await fetch(`http://localhost:${PORT}/__gh/repos/${SANDBOX}${path}`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`GitHub ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    return r.json();
  };
  const runs = (await gh("/actions/runs?branch=test%2Ffailing&per_page=20")).workflow_runs.filter((r) => r.name === "CI");
  const run = runs.find((r) => r.conclusion === "failure") ?? runs[0];
  if (!run) throw new Error("No CI run on test/failing; re-run the CI workflow in the sandbox.");
  const jobs = (await gh(`/actions/runs/${run.id}/jobs`)).jobs;
  const job = jobs.find((j) => j.conclusion === "failure") ?? jobs[0];
  const base = `?hub=actions${REPO}&view=actions`;
  return {
    files: `?hub=files${REPO}`, commits: `?hub=commits${REPO}`, pushes: `?hub=pushes${REPO}`,
    branches: `?hub=branches${REPO}&branchTab=all`, tags: `?hub=tags${REPO}`, releases: `?hub=tags${REPO}&tagTab=releases`,
    "branch-policies": `?hub=branches${REPO}&view=policies&polBranch=main`, "compare-tag": `?hub=branches${REPO}&view=compare&cmpBase=v0.1.0&cmpHead=main`,
    prs: `?hub=prs${REPO}&view=prs`, "pr-3": `?hub=prs${REPO}&view=prs&pr=3`, "pr-3-files": `?hub=prs${REPO}&view=prs&pr=3&prPage=files`, "pr-4": `?hub=prs${REPO}&view=prs&pr=4`,
    actions: base, "actions-library": `${base}&actTab=library`, [`run-${run.id}`]: `${base}&actRun=${run.id}`, [`run-${run.id}-tests`]: `${base}&actRun=${run.id}&actRunTab=tests`, [`log-${job.id}`]: `${base}&actRun=${run.id}&actJob=${job.id}`,
    security: `?hub=security${REPO}&view=security&secTab=dependencies`,
    "widget-prs": `/widget.html?widget=prs&size=3x2&repo=${encodeURIComponent(SANDBOX)}`, "widget-runs": `/widget.html?widget=runs&size=4x2&repo=${encodeURIComponent(SANDBOX)}`,
  };
}

/** Playwright's chrome-headless-shell under /opt/pw-browsers (cloud containers). Full Chrome's --screenshot hangs there even on a blank page; the shell doesn't. */
function headlessShell() {
  const root = "/opt/pw-browsers";
  try {
    for (const d of readdirSync(root).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse()) {
      const p = join(root, d, "chrome-headless-shell-linux64", "chrome-headless-shell");
      if (existsSync(p)) return p;
    }
  } catch { /* not there */ }
  return undefined;
}

function chromePath() {
  const candidates = [
    process.env.SHOTS_CHROME,
    headlessShell(),
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error(`Chrome not found; set SHOTS_CHROME or CHROME_PATH (tried ${candidates.join(", ")})`);
  return hit;
}

async function waitForServer(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`Mock server did not start at ${url}`);
}

if (LIVE && !process.env.GH_SANDBOX_TOKEN) { console.error("--live needs GH_SANDBOX_TOKEN (a GitHub App user token for the sandbox); it is not set."); process.exit(2); }
const args = process.argv.slice(2).filter((a) => a !== "--live");
const outDir = resolve("shots");
mkdirSync(outDir, { recursive: true });
const chrome = chromePath();
// stderr is kept so the dev server's [live guard] refusals and proxy errors show up here.
const server = spawn(process.execPath, ["build.mjs", "--dev"], { env: { ...process.env, PORT: String(PORT), DEV_OUT: LIVE ? "dist-dev/shots-live" : "dist-dev/shots", LIVE: LIVE ? "1" : "" }, stdio: ["ignore", "ignore", "inherit"] });
try {
  await waitForServer(`${BASE}?hub=files`);
  const PAGES = LIVE ? await livePages() : MOCK_PAGES;
  const names = args.length ? args : Object.keys(PAGES);
  const unknown = names.filter((n) => !PAGES[n]);
  if (unknown.length) { console.error(`Unknown page(s): ${unknown.join(", ")}. Known: ${Object.keys(PAGES).join(", ")}`); process.exitCode = 2; names.length = 0; }
  for (const name of names) {
    for (const theme of ["light", "dark"]) {
      const q = PAGES[name];
      const url = `${q.startsWith("/") ? `http://localhost:${PORT}` : BASE}${q.replace("?", `?theme=${theme}&`)}`;
      const file = resolve(outDir, `${LIVE ? "live-" : ""}${name}-${theme}.png`);
      rmSync(file, { force: true }); // so a stale PNG from an earlier run can't pass for this one
      const r = spawnSync(chrome, [
        "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
        ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), // Chrome refuses to run as root with its sandbox (cloud containers run as root)
        // A throwaway profile outside the repo: Chrome can install managed extensions into it, whose *.test.js files vitest would pick up.
        `--user-data-dir=${join(tmpdir(), "gh-repos-shots-profile")}`, "--window-size=1440,900", `--virtual-time-budget=${LIVE ? 20000 : q.includes("click=") ? 20000 : 8000}`, // ?click= waits for the page to settle before each step
        `--screenshot=${file}`, url,
      ], { stdio: "ignore", timeout: 60000 });
      const good = r.status === 0 && existsSync(file);
      if (!good) process.exitCode = 1;
      console.log(`${good ? "ok  " : "FAIL"} ${LIVE ? "live-" : ""}${name}-${theme}.png${good ? "" : r.error ? ` (${r.error.code ?? r.error.message})` : ` (exit ${r.status ?? r.signal})`}`);
    }
  }
} finally {
  server.kill();
}

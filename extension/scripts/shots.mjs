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
/** name -> query and hash after hub.html. */
const MOCK_PAGES = {
  files: `?hub=files${REPO}`,
  commits: `?hub=commits${REPO}`,
  pushes: `?hub=pushes${REPO}`,
  branches: `?hub=branches${REPO}&branchTab=all`,
  "branch-policies": `?hub=branches${REPO}&view=policies&polBranch=main`,
  "branch-policies-reader": `?hub=branches&scenario=notAdmin${REPO}&view=policies&polBranch=release%2F1.0`,
  "compare-tag": `?hub=branches${REPO}&view=compare&cmpBase=v1.0.0&cmpHead=develop`,
  tags: `?hub=tags${REPO}`,
  releases: `?hub=tags${REPO}&tagTab=releases`,
  prs: `?hub=prs${REPO}&view=prs`,
  "pr-200": `?hub=prs${REPO}&view=prs&pr=200`,
  "pr-200-files": `?hub=prs${REPO}&view=prs&pr=200&prPage=files`,
  actions: `?hub=actions${REPO}&view=actions`,
  "run-9001": `?hub=actions${REPO}&view=actions&actRun=9001`,
  "log-900151": `?hub=actions${REPO}&view=actions&actRun=9001&actJob=900151`,
  security: `?hub=security${REPO}&view=security&secTab=dependencies`,
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
    prs: `?hub=prs${REPO}&view=prs`, "pr-3": `?hub=prs${REPO}&view=prs&pr=3`, "pr-3-files": `?hub=prs${REPO}&view=prs&pr=3&prPage=files`, "pr-4": `?hub=prs${REPO}&view=prs&pr=4`,
    actions: base, [`run-${run.id}`]: `${base}&actRun=${run.id}`, [`log-${job.id}`]: `${base}&actRun=${run.id}&actJob=${job.id}`,
    security: `?hub=security${REPO}&view=security&secTab=dependencies`,
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
      const url = `${BASE}${q.replace("?", `?theme=${theme}&`)}`;
      const file = resolve(outDir, `${LIVE ? "live-" : ""}${name}-${theme}.png`);
      rmSync(file, { force: true }); // so a stale PNG from an earlier run can't pass for this one
      const r = spawnSync(chrome, [
        "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
        ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), // Chrome refuses to run as root with its sandbox (cloud containers run as root)
        // A throwaway profile outside the repo: Chrome can install managed extensions into it, whose *.test.js files vitest would pick up.
        `--user-data-dir=${join(tmpdir(), "gh-repos-shots-profile")}`, "--window-size=1440,900", `--virtual-time-budget=${LIVE ? 20000 : 8000}`,
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

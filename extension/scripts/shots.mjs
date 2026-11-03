// Screenshots of the mock harness in headless Chrome, for checking UI without a browser session (cloud sessions, CI, reviews).
// No dependencies: it starts the mock dev server and uses Chrome's own --screenshot.
//
//   npm run shots                         every page in PAGES, light and dark, into shots/
//   npm run shots -- commits run-9001     only those pages
//   CHROME_PATH=... npm run shots         a specific Chrome (cloud sessions set CHROME_PATH already)
//   GH_SANDBOX_TOKEN=... npm run shots -- --live [page …]   live mode: the real TrueNorthIT/gh-repos-sandbox through the repo guard, own page set
//
// Read the PNGs afterwards (an agent can open them with its image-reading tool). Without --live it is mock data only and never touches ADO or GitHub; --live only reads the sandbox repo.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
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

/** Live pages: the sandbox's fixed PRs, plus a CI run on test/failing and one failed job, looked up through the API. */
async function livePages() {
  const gh = async (path) => {
    const r = await fetch(`https://api.github.com/repos/${SANDBOX}${path}`, { headers: { Authorization: `Bearer ${process.env.GH_SANDBOX_TOKEN}`, Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`GitHub ${path}: HTTP ${r.status}`);
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

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error(`Chrome not found; set CHROME_PATH (tried ${candidates.join(", ")})`);
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
const PAGES = LIVE ? await livePages() : MOCK_PAGES;
const args = process.argv.slice(2).filter((a) => a !== "--live");
const names = args.length ? args : Object.keys(PAGES);
const unknown = names.filter((n) => !PAGES[n]);
if (unknown.length) { console.error(`Unknown page(s): ${unknown.join(", ")}. Known: ${Object.keys(PAGES).join(", ")}`); process.exit(2); }

const outDir = resolve("shots");
mkdirSync(outDir, { recursive: true });
const chrome = chromePath();
const server = spawn(process.execPath, ["build.mjs", "--dev"], { env: { ...process.env, PORT: String(PORT), DEV_OUT: LIVE ? "dist-dev/shots-live" : "dist-dev/shots", LIVE: LIVE ? "1" : "" }, stdio: "ignore" });
try {
  await waitForServer(`${BASE}?hub=files`);
  for (const name of names) {
    for (const theme of ["light", "dark"]) {
      const q = PAGES[name];
      const url = `${BASE}${q.replace("?", `?theme=${theme}&`)}`;
      const file = resolve(outDir, `${LIVE ? "live-" : ""}${name}-${theme}.png`);
      const r = spawnSync(chrome, [
        "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
        // A throwaway profile outside the repo: Chrome can install managed extensions into it, whose *.test.js files vitest would pick up.
        `--user-data-dir=${join(tmpdir(), "gh-repos-shots-profile")}`, "--window-size=1440,900", `--virtual-time-budget=${LIVE ? 20000 : 8000}`,
        `--screenshot=${file}`, url,
      ], { stdio: "ignore", timeout: 60000 });
      console.log(`${r.status === 0 && existsSync(file) ? "ok  " : "FAIL"} ${LIVE ? "live-" : ""}${name}-${theme}.png`);
    }
  }
} finally {
  server.kill();
}

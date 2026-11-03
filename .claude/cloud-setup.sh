#!/usr/bin/env bash
# Setup script for the Claude Code cloud environment used with TrueNorthIT/ado-github-repos.
# Paste this whole file into the environment's settings (cloud environment menu in the session's title bar, then Edit, Setup script).
# It needs nothing from the repo at setup time, so it doesn't matter whether the repos are cloned before or after it runs.
#
# Why: live mode needs TrueNorthIT/gh-repos-sandbox attached to the session too (the egress proxy refuses API calls for repos that
# aren't), and a session with two repos is rooted above both, so this repo's .claude/settings.json (dependency install, sandbox-token
# guard) doesn't load. User-level settings always load, so this adds the same two hooks there, pointing into the repo. In a session
# with only this repo both copies fire, which is harmless: session-start.sh locks and skips work that is done, and the guard only blocks.
set -euo pipefail
REPO=/home/user/ado-github-repos
mkdir -p "$HOME/.claude"
REPO="$REPO" node <<'NODE'
const fs = require("fs"), path = require("path");
const file = path.join(process.env.HOME, ".claude", "settings.json");
const repo = process.env.REPO;
let s = {};
try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* none yet */ }
s.hooks ??= {};
const add = (event, entry) => {
  const list = (s.hooks[event] ??= []);
  const cmd = entry.hooks[0].command;
  if (!list.some((e) => e.hooks?.some((h) => h.command === cmd))) list.push(entry);
};
// Each hook does nothing if the repo isn't in this session.
add("SessionStart", { hooks: [{ type: "command", command: `f=${repo}/.claude/hooks/session-start.sh; [ -f "$f" ] || exit 0; bash "$f"`, timeout: 600 }] });
add("PreToolUse", { matcher: "Bash", hooks: [{ type: "command", command: `f=${repo}/.claude/hooks/sandbox-only.mjs; [ -f "$f" ] || exit 0; node "$f"` }] });
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
console.log(`cloud-setup: hooks written to ${file}`);
NODE
# If the repo is already cloned, install dependencies now so the first session starts warm. A failure here is not fatal.
if [ -f "$REPO/.claude/hooks/session-start.sh" ]; then CLAUDE_CODE_REMOTE=true bash "$REPO/.claude/hooks/session-start.sh" || true; fi

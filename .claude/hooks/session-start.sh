#!/usr/bin/env bash
# SessionStart (cloud sessions only): installs extension/ and auth/ dependencies when package-lock.json has changed since the last install.
# It runs from .claude/settings.json and also from the user-level settings that .claude/cloud-setup.sh writes (a cloud session with a
# second repo attached is rooted above this repo and doesn't load .claude/settings.json). Both can fire at once, so it takes a lock and
# skips work that is already done.
[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0
root="$(cd "$(dirname "$0")/../.." && pwd)"
exec 9>"${TMPDIR:-/tmp}/ado-github-repos-session-start.lock"
flock 9
for d in extension auth; do
  want=$(sha256sum "$root/$d/package-lock.json" | cut -d' ' -f1)
  stamp="$root/$d/node_modules/.package-lock.sha256"
  [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$want" ] && continue
  (cd "$root/$d" && npm ci --no-audit --no-fund --loglevel=error) || { echo "npm ci failed in $d" >&2; exit 1; }
  echo "$want" > "$stamp"
done

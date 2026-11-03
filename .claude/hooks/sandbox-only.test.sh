#!/usr/bin/env bash
# Sample inputs for sandbox-only.mjs: prints the exit code and expects it. Run: bash .claude/hooks/sandbox-only.test.sh
cd "$(dirname "$0")" || exit 1
fail=0
t() { # expected-exit command
  local out code
  out=$(node -e 'process.stdout.write(JSON.stringify({tool_name:"Bash",tool_input:{command:process.argv[1]}}))' "$2" | node sandbox-only.mjs 2>&1); code=$?
  [ "$code" = "$1" ] && echo "ok   exit $code: $2" || { echo "FAIL exit $code (wanted $1): $2 $out"; fail=1; }
}
t 0 'ls -la'
t 0 'gh api repos/TrueNorthIT/TrueTunes/pulls'
t 0 'curl -H "Authorization: Bearer $GH_SANDBOX_TOKEN" https://api.github.com/repos/TrueNorthIT/gh-repos-sandbox/pulls/3'
t 0 'GH_TOKEN=$GH_SANDBOX_TOKEN gh pr list -R truenorthit/GH-repos-sandbox'
t 0 'curl -H "Authorization: Bearer $GH_SANDBOX_TOKEN" https://api.github.com/user'
t 2 'curl -H "Authorization: Bearer $GH_SANDBOX_TOKEN" https://api.github.com/repos/TrueNorthIT/TrueTunes/pulls/234'
t 2 'GH_TOKEN=$GH_SANDBOX_TOKEN gh pr list --repo TrueNorthIT/TrueTunes'
t 2 'GH_TOKEN=$GH_SANDBOX_TOKEN gh pr list -R TrueNorthIT/TrueTunes'
t 2 'GH_TOKEN=ghu_abc123 gh api /repos/octocat/hello/issues'
t 2 'curl -H "Authorization: Bearer $GH_SANDBOX_TOKEN" https://api.github.com/repos/TrueNorthIT/gh-repos-sandbox/pulls && curl -H "Authorization: Bearer $GH_SANDBOX_TOKEN" https://api.github.com/repos/TrueNorthIT/TrueTunes'
t 2 'GH_TOKEN=$GH_SANDBOX_TOKEN git clone https://github.com/TrueNorthIT/TrueTunes.git'
t 2 'GH_TOKEN=$GH_SANDBOX_TOKEN gh search issues "repo:TrueNorthIT/TrueTunes bug"'
exit $fail

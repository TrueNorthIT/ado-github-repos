#!/usr/bin/env bash
# Release notes for a tag, built from the commit messages since the previous tag.
# Usage: release-notes.sh <tag> [<previous-tag>]   (previous defaults to the tag before <tag>)
# We commit straight to main, so GitHub's generated notes (from merged PRs) would be empty.
set -euo pipefail
tag="$1"
prev="${2:-$(git describe --tags --abbrev=0 "${tag}^" 2>/dev/null || true)}"
range="${prev:+$prev..}$tag"

echo "## What's changed"
echo
# One section per commit: the subject as a heading, the body as-is, attribution trailers dropped.
# Merges are left out (their changes come through their own commits), and so is a repeated subject (a cherry-pick of a commit already listed).
seen=$'
'
git log --reverse --no-merges --format='%H' "$range" | while read -r sha; do
  subject=$(git log -1 --format='%s' "$sha")
  case "$seen" in *$'
'"$subject"$'
'*) continue ;; esac
  seen+="$subject"$'
'
  body=$(git log -1 --format='%b' "$sha" | grep -vE '^(Co-Authored-By|Claude-Session):' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')
  echo "### ${subject}"
  echo
  if [ -n "$body" ]; then
    echo "$body"
    echo
  fi
  echo "<sub>${sha:0:7}</sub>"
  echo
done

if [ -n "$prev" ]; then
  echo "**Full changelog:** https://github.com/${GITHUB_REPOSITORY:-TrueNorthIT/ado-github-repos}/compare/${prev}...${tag}"
fi

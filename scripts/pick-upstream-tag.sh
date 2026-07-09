#!/usr/bin/env bash
# pick-upstream-tag.sh — print the newest upstream release tag.
#
# Selection rules (in order):
#   1. Match strict semver v<MAJOR>.<MINOR>.<PATCH> (excludes pre-releases like -rc.1).
#   2. Sort by version (sort -V).
#   3. Print the last one.
#
# Assumes upstream tags have already been fetched into the local repo
# (`git fetch upstream --tags`). Emits nothing (exit 1) if no candidate.
#
# Usage:
#   scripts/pick-upstream-tag.sh              # newest tag
#   scripts/pick-upstream-tag.sh --exclude v1.17.15  # newest excluding a specific tag
set -euo pipefail

exclude=""
if [ "${1:-}" = "--exclude" ] && [ -n "${2:-}" ]; then
  exclude="$2"
fi

# Strict semver: exclude pre-release, build-metadata, and lightweight-dereferenced ^{} refs.
mapfile -t tags < <(
  git tag -l 'v[0-9]*' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V
)

if [ "${#tags[@]}" -eq 0 ]; then
  echo "pick-upstream-tag: no matching tags found (did you 'git fetch upstream --tags'?)" >&2
  exit 1
fi

if [ -n "$exclude" ]; then
  filtered=()
  for t in "${tags[@]}"; do
    [ "$t" = "$exclude" ] && continue
    filtered+=("$t")
  done
  tags=("${filtered[@]}")
fi

if [ "${#tags[@]}" -eq 0 ]; then
  echo "pick-upstream-tag: only $exclude available; nothing newer to pick" >&2
  exit 1
fi

echo "${tags[-1]}"

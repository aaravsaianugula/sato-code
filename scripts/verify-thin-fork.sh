#!/usr/bin/env bash
# verify-thin-fork.sh — the guardrail that keeps Sato-Code a *thin* fork.
#
# sato-main must differ from the pinned upstream anchor tag ONLY in additive
# Sato paths. Source patches are stored as files under sato-patches/ and applied
# at BUILD time (see build-sato.sh) — they are never committed into the upstream
# tree, so a committed edit to any upstream package source is drift and fails.
#
# Usage: scripts/verify-thin-fork.sh [ANCHOR_REF]
#   ANCHOR_REF defaults to the anchor= line in SATO_UPSTREAM.txt.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

ANCHOR="${1:-}"
if [ -z "$ANCHOR" ]; then
  ANCHOR="$(grep -E '^anchor=' SATO_UPSTREAM.txt | head -1 | cut -d= -f2 | tr -d '[:space:]')"
fi
if [ -z "$ANCHOR" ]; then
  echo "verify-thin-fork: could not determine anchor ref" >&2
  exit 2
fi
if ! git rev-parse --verify --quiet "${ANCHOR}^{commit}" >/dev/null; then
  echo "verify-thin-fork: anchor ref '$ANCHOR' not found (fetch upstream tags?)" >&2
  exit 2
fi

# Allowlist of additive Sato paths. A changed path is OK iff it matches one of
# these prefixes/globs. Everything else is upstream tree and must be untouched.
#
# NOTE: the .github/workflows/ entries are EXPLICIT FILENAMES, not a
# `sato-*.yml` glob. This is the last defense against upstream sneaking a
# workflow file in (a broad glob would happily allow an arbitrary
# `sato-anything.yml` to land through a sync). If you add a new sato-* workflow,
# add its exact filename here — that same edit forces a code review of the
# workflow file itself.
is_allowed() {
  case "$1" in
    packages/sato-*/*|packages/sato-*)  return 0 ;;
    sato-patches/*)                     return 0 ;;
    .github/workflows/sato-ci.yml)      return 0 ;;
    .github/workflows/sato-sync.yml)    return 0 ;;
    .github/workflows/sato-build.yml)   return 0 ;;
    .github/workflows/sato-canary.yml)  return 0 ;;
    scripts/verify-thin-fork.sh)        return 0 ;;
    scripts/apply-patches.sh)           return 0 ;;
    scripts/build-sato.sh)              return 0 ;;
    scripts/pick-upstream-tag.sh)       return 0 ;;
    opencode.json)                      return 0 ;;
    tui.json)                           return 0 ;;
    SATO_UPSTREAM.txt|SATO_README.md)   return 0 ;;
    sato-code.pin.json)                 return 0 ;;
    *) return 1 ;;
  esac
}

drift=0
while IFS= read -r path; do
  [ -z "$path" ] && continue
  if ! is_allowed "$path"; then
    if [ "$drift" -eq 0 ]; then
      echo "verify-thin-fork: FAIL — committed edits to upstream tree (not additive Sato paths):" >&2
    fi
    echo "  drift: $path" >&2
    drift=1
  fi
done < <(git diff --name-only "${ANCHOR}" HEAD)

if [ "$drift" -ne 0 ]; then
  echo >&2
  echo "Fix: move the change into an additive package or a sato-patches/*.patch (applied at build time)." >&2
  exit 1
fi

echo "verify-thin-fork: OK — sato-main is a clean additive layer over ${ANCHOR}."

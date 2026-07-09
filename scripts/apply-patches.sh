#!/usr/bin/env bash
# apply-patches.sh — idempotently apply Sato source patches at BUILD time.
#
# Patches live in sato-patches/*.patch (git format-patch output). They are NOT
# committed into sato-main (that stays a thin additive layer); they are applied
# to the working tree here, just before a branded build, and by CI to verify
# they still apply against the current upstream anchor.
#
# Usage:
#   scripts/apply-patches.sh            # git am --3way each patch (leaves commits)
#   scripts/apply-patches.sh --check    # dry-run: can every patch apply cleanly?
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

MODE="apply"
[ "${1:-}" = "--check" ] && MODE="check"

shopt -s nullglob
patches=(sato-patches/*.patch)
shopt -u nullglob

if [ "${#patches[@]}" -eq 0 ]; then
  echo "apply-patches: no patches in sato-patches/ (nothing to do)."
  exit 0
fi

# Deterministic order (0001-, 0002-, ...).
IFS=$'\n' patches=($(printf '%s\n' "${patches[@]}" | sort)); unset IFS

if [ "$MODE" = "check" ]; then
  fail=0
  for p in "${patches[@]}"; do
    if git apply --check --3way "$p" 2>/dev/null; then
      echo "  ok:   $p"
    else
      echo "  FAIL: $p (does not apply against $(grep -E '^anchor=' SATO_UPSTREAM.txt | cut -d= -f2))" >&2
      fail=1
    fi
  done
  [ "$fail" -eq 0 ] && echo "apply-patches: all ${#patches[@]} patch(es) apply cleanly." || exit 1
  exit 0
fi

# Real apply. Requires a clean tree so a failed am can be aborted safely.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "apply-patches: working tree not clean; refusing to git am. Commit/stash first." >&2
  exit 2
fi

echo "apply-patches: applying ${#patches[@]} patch(es) with git am --3way ..."
if ! git am --3way "${patches[@]}"; then
  echo "apply-patches: a patch failed to apply. Aborting git am." >&2
  git am --abort || true
  exit 1
fi
echo "apply-patches: applied ${#patches[@]} patch(es)."

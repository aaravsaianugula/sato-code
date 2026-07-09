#!/usr/bin/env bash
# build-sato.sh — build a Sato-branded, Sato-skinned Sato-Code binary.
#
# Pipeline:
#   1. Verify the working tree is a thin fork (no drift beyond sato-*).
#   2. Apply the sato-patches (brand + metadata) to the working tree via
#      git am --3way. These edits are NEVER committed to sato-main; they only
#      live during a build.
#   3. Build the Sato-skinned web bundle: `bun --cwd packages/sato-app build`
#      → produces packages/sato-app/dist with Sato title, favicon,
#      data-theme="sato-dark" default, and the Ember CSS skin.
#   4. Stage: copy packages/sato-app/dist over packages/app/dist so upstream's
#      createEmbeddedWebUIBundle() (packages/opencode/script/build.ts) picks
#      up the skinned bundle. This uses the `dist/` gitignored surface —
#      thin-fork-safe, no additional patch needed.
#   5. Build the branded CLI: OPENCODE_VERSION=<upstream>+sato.<n>
#      SATO_BRAND="Sato Code" bun --cwd packages/opencode build --single.
#
# Environment overrides:
#   OPENCODE_VERSION  — CLI version string (default: <anchor>+sato.dev)
#   SATO_BRAND        — display name baked into scriptName + banner guard
#                       (default: "Sato Code")
#   OPENCODE_CHANNEL  — dev|beta|prod (default: dev)
#   BUILD_FLAGS       — extra flags to opencode build (default: --single)
#   SKIP_APPLY        — set to 1 to skip the git am (useful when patches
#                       are already applied to the working tree by CI)
#   SKIP_VERIFY       — set to 1 to skip verify-thin-fork.sh (CI runs it
#                       separately)
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

ANCHOR="$(grep -E '^anchor=' SATO_UPSTREAM.txt | head -1 | cut -d= -f2 | tr -d '[:space:]')"
: "${OPENCODE_VERSION:=${ANCHOR#v}+sato.dev}"
: "${SATO_BRAND:=Sato Code}"
: "${OPENCODE_CHANNEL:=dev}"
: "${BUILD_FLAGS:=--single}"

if [ "${SKIP_VERIFY:-0}" != "1" ]; then
  echo "==> [1/5] verify-thin-fork"
  bash scripts/verify-thin-fork.sh
fi

if [ "${SKIP_APPLY:-0}" != "1" ]; then
  echo "==> [2/5] apply sato-patches"
  bash scripts/apply-patches.sh
fi

echo "==> [3/5] install workspace deps (sato-app is a workspace pkg)"
bun install

echo "==> [4/5] build branded CLI (version=${OPENCODE_VERSION}, brand=${SATO_BRAND})"
# createEmbeddedWebUIBundle() in packages/opencode/script/build.ts, patched by
# sato-patches/0001, redirects `bun run --cwd packages/sato-app build` when
# SATO_BRAND is set — so this single CLI build both compiles the skinned web
# bundle at packages/sato-app/dist AND embeds it in the binary. No dist
# staging into packages/app/dist required.
OPENCODE_VERSION="${OPENCODE_VERSION}" \
  OPENCODE_CHANNEL="${OPENCODE_CHANNEL}" \
  SATO_BRAND="${SATO_BRAND}" \
  bun run --cwd packages/opencode build ${BUILD_FLAGS}

echo "==> [5/5] done"

echo
echo "Built binary:"
find packages/opencode/dist -maxdepth 3 -type f -name opencode -o -name opencode.exe 2>/dev/null | head
echo
echo "Done. Try:"
echo "  ./packages/opencode/dist/<target>/bin/opencode --version"
echo "  ./packages/opencode/dist/<target>/bin/opencode --help"

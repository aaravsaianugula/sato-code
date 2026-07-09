# Sato-Code

A **thin fork** of [OpenCode](https://github.com/anomalyco/opencode) (MIT), customized for
[Sato](https://github.com/aaravsaianugula) — a local multi-model AI orchestrator. Sato-Code is the
coding surface embedded in the Sato Desktop app's **Code** tab, and also ships as a standalone
branded CLI/TUI.

> Upstream's own `README.md` is left untouched. This file documents only the Sato fork layer.

## Design goal: stay current with upstream, keep our changes

OpenCode ships **near-daily**. Manually merging that cadence is untenable, so this fork is
deliberately *thin*:

- **The upstream tree is never edited in place.** Everything Sato adds is either an additive
  package or a small, tracked source patch.
- A scheduled GitHub Action (`.github/workflows/sato-sync.yml`) advances to each new upstream
  **release tag**, re-applies our patches, runs CI smoke tests, and auto-merges only when green.
  Conflicts open a labeled PR for a human.

## Where Sato's changes live

| Path | What | Mechanism |
|---|---|---|
| `packages/sato-theme/` | TUI themes + web-UI CSS skin + Sato logos | additive package |
| `packages/sato-plugin/` | Sato provider config, `x-sato-*` surfacing, `.sato/` policy/permission bridge | additive package (`@opencode-ai/plugin` hooks — no core edits) |
| `packages/sato-app/` | Wrapper Vite app: imports `@opencode-ai/app`, applies the skin, sets Sato title/favicon | additive package (workspace glob `packages/*` picks it up) |
| `sato-patches/` | `git format-patch` source patches for the few things config/plugins can't reach (brand strings, response-header→metadata) | `git am --3way`, applied by the sync workflow |
| `opencode.json` (root) | Default Sato provider config bundled with the CLI | additive |
| `SATO_UPSTREAM.txt` | Current upstream anchor tag + last sync time | tracked state |

**Naming note:** source patches live in `sato-patches/`, **not** `patches/` — upstream already uses
`patches/` for Bun's `patchedDependencies` (node_modules patches). Do not conflate them.

## Branches

| Branch | Role |
|---|---|
| `sato-main` | Default. Always builds. Receives only auto-sync merges + reviewed `sato-dev` PRs. |
| `sato-dev` | Human working branch for Sato-only features. |
| `sync/<tag>-<ts>` | Ephemeral, created per auto-sync attempt. |
| `sync-conflict/<tag>` | Ephemeral, created when a merge or patch re-apply fails; needs a human. |

## Build & versioning

- Toolchain: **bun@1.3.14** (pinned in `package.json`), Turbo, a version `catalog`.
- Sato release version: `OPENCODE_VERSION=<upstream-tag>+sato.<n>` (upstream's build honors the
  `OPENCODE_VERSION` env override). Git tags: `sato-v<upstream>+sato.<n>`.
- The CLI embeds the web UI at build time (`packages/*/script/build.ts` →
  `createEmbeddedWebUIBundle` reads `packages/app/dist`); the Sato skin is injected by pointing that
  step at `packages/sato-app/dist` (see `scripts/build-sato.sh`).

## Scripts

- `scripts/verify-thin-fork.sh` — fails if the working tree edits upstream package sources outside
  the Sato additive paths and `sato-patches/`. The guardrail that keeps the fork thin.
- `scripts/apply-patches.sh` — idempotently `git am --3way` every `sato-patches/*.patch`.
- `scripts/build-sato.sh` — orchestrates skin injection + branded `bun` build.
- `scripts/pick-upstream-tag.sh` — prints the newest upstream **release tag** (strict semver, no
  pre-releases). Used by `.github/workflows/sato-sync.yml` and by hand for a manual sync.

## Workflows

Four GitHub Actions workflows live under `.github/workflows/sato-*.yml` (each one is allow-listed
by **exact filename** in `verify-thin-fork.sh` — deliberately not a glob, so upstream cannot land a
new `.github/workflows/sato-<anything>.yml` through a sync without a matching allowlist change,
which forces a human review of the workflow file):

| Workflow | Trigger | Purpose |
|---|---|---|
| `sato-ci.yml`     | PR to `sato-main`/`sato-dev`; `workflow_call` | Cheap→expensive gates: `verify-thin-fork` → `apply-patches --check` → apply → typecheck → build linux-x64 → boot smoke → brand smoke → route-header smoke. Reusable by `sato-sync`. |
| `sato-sync.yml`   | Daily cron + `workflow_dispatch` | Advance the anchor to the newest upstream tag. Merge, re-verify patches, open a labeled PR. On green CI, `gh pr merge --squash --auto` **only** because `sato-ci` is a `needs:` dependency of the auto-merge job — a broken/malicious upstream release can't auto-land. Conflicts → `sync-conflict` PRs, never auto-merged. Backlog ≥3 opens a `patch-rot-alarm` issue. |
| `sato-build.yml`  | Push of `sato-v*` tag; `workflow_dispatch` | Matrix release build: `linux-x64` **and** `windows-x64`. Uploads archives + `manifest.json` + `sato-code.pin.json` to the GitHub Release. |
| `sato-canary.yml` | Nightly cron | Look-ahead: merges `upstream/dev` into a throwaway branch, applies patches, tries a build. **Never** pushes / merges. Opens a `canary-fail` issue on failure so patches can be pre-fixed before the next tagged release lands. |

### Bot PAT (required user setup)

`sato-sync.yml` (and optionally `sato-build.yml`'s release upload) need a fine-grained token:

- Repository: `aaravsaianugula/sato-code` **only** — least privilege.
- Permissions: **Contents: Read & Write** (branches + tags), **Pull requests: Read & Write**,
  **Issues: Read & Write**, **Metadata: Read**.
- Store as an Actions secret named `SATO_BOT_PAT`.
- Enable *"Allow GitHub Actions to create and approve pull requests"* in repo settings.

### Branch protection on `sato-main` — LOAD-BEARING, not defense-in-depth

Once `sato-sync.yml` enables `gh pr merge --auto`, further pushes to the sync branch are
re-gated **only** by the required-checks list configured on the **base branch** (`sato-main`).
The workflow itself cannot re-run `sato-ci` on a human-pushed commit landing on the sync branch
between "auto-merge enabled" and "merge fires" — the required-checks setting is what protects
that edge case. If the setting is missing, `--auto` can silently land un-CI'd code.

Enforce, on `sato-main`:

1. **Require a pull request before merging.**
2. **Require status checks to pass before merging.** Under *"Status checks that are required"*,
   add **`sato-ci gates (linux-x64)`** — this is the job name from `sato-ci.yml`.
3. **Do not allow the bot to bypass required checks** — the bot must pass CI like everyone else.
4. **Restrict who can push directly** to sato-main to the bot and the release owner.

This is REQUIRED for safety, not merely a nice-to-have. The auto-merge job in `sato-sync.yml`
has an inline comment marking it load-bearing.

## Release pin — `sato-code.pin.json`

Sato Desktop's `build.rs` reads `sato-code.pin.json` (either the committed root file for local
dev, or the copy attached to a `sato-v*` GitHub Release) to know **which** Sato-Code binary to
bundle. The shape:

```json
{
  "tag": "sato-v<upstream>+sato.<n>",
  "sato_version": "<upstream>+sato.<n>",
  "upstream_anchor": "v<upstream>",
  "linux_x64":   { "url": "...", "sha256": "...", "size": 0 },
  "windows_x64": { "url": "...", "sha256": "...", "size": 0 },
  "web_ui":      null
}
```

`build.rs` should:
1. Read the pin.
2. Download `linux_x64.url` (WSL sidecar) and `windows_x64.url` (Windows fallback).
3. Verify each archive's SHA-256 against the pin — **fail the build if a hash mismatches**.
4. Extract into `desktop/resources/sato-code/<platform>/` for `tauri build` to embed.

The authoritative per-release pin is uploaded by `sato-build.yml`; the file committed at repo
root is a placeholder to keep the shape stable in code review.

Upstream anchor: **v1.17.15** (see `SATO_UPSTREAM.txt`).

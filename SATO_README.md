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

Upstream anchor: **v1.17.15** (see `SATO_UPSTREAM.txt`).

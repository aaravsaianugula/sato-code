# sato-patches/

`git format-patch` source patches for the few Sato customizations that config and
plugins **cannot** reach. Applied at build time by `scripts/apply-patches.sh`
(`git am --3way`) — **never committed into `sato-main`**, which stays a thin
additive layer over the pinned upstream tag.

> Not to be confused with the repo-root `patches/` directory, which is Bun's
> `patchedDependencies` system for node_modules — a different mechanism entirely.

## Discipline (binding)

Every patch must:
1. Carry a header comment stating **which upstream files it touches, why, an owner,
   and a kill-criterion** (the condition under which it can be deleted — e.g. "delete
   when upstream PR #NNNN lands").
2. Be **≤25 lines of net additions**. If it grows past that, PR it upstream instead
   of carrying it here — a large patch will rot against the near-daily upstream cadence.
3. Fail loudly in CI (`apply-patches.sh --check`) the moment it stops applying, so
   drift is caught at sync time, not at release time.

## Planned patches

| # | Purpose | Touches | Kill-criterion |
|---|---|---|---|
| 0001 | Brand user-visible strings ("opencode" → "Sato Code") via a build-time define | CLI banner/help + prompt files | upstream adds a brand config knob |
| 0002 | Capture allowlisted `x-sato-*` response headers into message `Part.metadata.sato` | `packages/llm/...`, `packages/opencode/src/session/...` (verify exact paths at authoring time) | upstream accepts a generic response-header-metadata PR |
| 0004 | `SATO_WEB_UI_DIST` env override so the branded web bundle embeds cleanly | the package that runs `createEmbeddedWebUIBundle` | upstream honors an env override for the embed dir |

(Exact upstream file paths must be re-verified against the current anchor when each
patch is authored — upstream moves files.)

// `config` hook — ensure the Sato provider block exists.
//
// The root `opencode.json` already ships a `sato` provider config, so in
// most invocations this is a no-op. It matters when:
//   - A user overrides the top-level config but forgets to include the
//     provider (they still want `sato/*` models to route through the local
//     gateway).
//   - The user drives opencode without our root config (embedded mode).
//
// Rules:
//   - NEVER clobber a user's explicit config. If `cfg.provider.sato`
//     already exists, we leave it alone.
//   - Only default `model` / `small_model` when they're absent.

import type { Config } from "@opencode-ai/plugin"

export const SATO_PROVIDER_DEFAULT = {
  npm: "@ai-sdk/openai-compatible",
  name: "Sato Kashi (local)",
  options: {
    baseURL: "http://localhost:8787/v1",
    apiKey: "sato-local",
    headers: { "x-sato-client": "sato-code" as const },
  },
  models: {
    auto: { name: "Sato Auto (router-picked)", limit: { context: 32768, output: 8192 } },
    "sato-fast": { name: "Sato Fast (single-pass lane)", limit: { context: 32768, output: 8192 } },
    "sato-deep": { name: "Sato Deep (verified lane)", limit: { context: 32768, output: 16384 } },
  },
} as const

export function applyProviderDefaults(cfg: Config): void {
  // Provider block
  const cfgAny = cfg as unknown as { provider?: Record<string, unknown>; model?: string; small_model?: string }
  if (!cfgAny.provider) cfgAny.provider = {}
  if (!cfgAny.provider.sato) {
    cfgAny.provider.sato = SATO_PROVIDER_DEFAULT as unknown
  }
  // Top-level model defaults
  if (!cfgAny.model) cfgAny.model = "sato/auto"
  if (!cfgAny.small_model) cfgAny.small_model = "sato/sato-fast"
}

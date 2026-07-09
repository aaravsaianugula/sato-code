// Toast surfacing for route / overseer / moderation decisions.
//
// The `sato-patches/0002` bridge attaches `x-sato-*` headers to TextPart
// metadata. We watch `message.part.updated` events for text parts whose
// metadata carries `sato.route`, `sato["x-sato-overseer"]`, or
// `sato["x-sato-moderation"]`, and forward a short toast via the TUI API.
//
// The toast is best-effort — if the TUI client isn't available (headless
// build, remote server), we log the same info to stderr instead so no
// signal is lost.

import type { OpencodeClient } from "@opencode-ai/sdk"

type SatoRoute = {
  primary?: string
  mode?: string
  confidence?: number
  degraded_from?: string
}

type SatoMeta = {
  route?: SatoRoute
  "x-sato-overseer"?: string
  "x-sato-moderation"?: string
  [key: string]: unknown
}

/** Track sessions we've already toasted about so we don't spam per-token. */
const seen = new Map<string, string>() // partID → last summary

function summarize(sato: SatoMeta): string | undefined {
  const bits: string[] = []
  if (sato.route?.primary) {
    const conf = typeof sato.route.confidence === "number" ? ` (${sato.route.confidence.toFixed(2)})` : ""
    const mode = sato.route.mode ? ` [${sato.route.mode}]` : ""
    const degraded = sato.route.degraded_from ? ` ← ${sato.route.degraded_from}` : ""
    bits.push(`route: ${sato.route.primary}${mode}${conf}${degraded}`)
  }
  if (sato["x-sato-overseer"]) bits.push(`overseer: ${sato["x-sato-overseer"]}`)
  if (sato["x-sato-moderation"]) bits.push(`moderation: ${sato["x-sato-moderation"]}`)
  return bits.length ? bits.join(" · ") : undefined
}

function variantFor(sato: SatoMeta): "info" | "warning" | "error" {
  const mod = sato["x-sato-moderation"]
  if (mod && /block|deny|flag/i.test(mod)) return "warning"
  const overseer = sato["x-sato-overseer"]
  if (overseer && /warn|degraded/i.test(overseer)) return "warning"
  return "info"
}

export async function surfaceSatoPart(
  client: OpencodeClient,
  directory: string,
  part: { id?: string; type?: string; metadata?: unknown },
): Promise<void> {
  if (part.type !== "text") return
  const meta = part.metadata as { sato?: SatoMeta } | undefined
  const sato = meta?.sato
  if (!sato) return
  const summary = summarize(sato)
  if (!summary) return
  const partID = part.id ?? "?"
  if (seen.get(partID) === summary) return
  seen.set(partID, summary)

  const message = `Sato · ${summary}`
  try {
    await client.tui.showToast({
      query: { directory },
      body: { message, variant: variantFor(sato), title: "Sato" },
    })
  } catch {
    // Headless / no TUI — log so the info is still captured somewhere.
    // eslint-disable-next-line no-console
    console.error(`[sato] ${message}`)
  }

  // Cap the map size so it doesn't leak in long sessions.
  if (seen.size > 512) {
    const first = seen.keys().next().value
    if (first) seen.delete(first)
  }
}

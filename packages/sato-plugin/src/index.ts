// @sato/opencode-plugin — Sato-Code plugin (minimal, Task 15 slice).
//
// Task 15 delivers ONE behavior: prove the sato-patches/0002 channel by logging
// the routing decision the gateway attached as x-sato-route (parsed into
// part.metadata.sato.route on the assistant TextPart). Broader behavior — Sato
// provider config, .sato/ policy/permission bridge, all x-sato-* surfacing —
// lands in later tasks (see SATO_README.md).
import type { Plugin } from "@opencode-ai/plugin"

type SatoRoute = {
  primary?: string
  mode?: string
  confidence?: number
  degraded_from?: string
}

export const SatoPlugin: Plugin = async () => {
  return {
    event: async ({ event }) => {
      if (event.type !== "message.part.updated") return
      const part = event.properties.part
      if (part.type !== "text") return
      const sato = part.metadata?.sato as { route?: SatoRoute } | undefined
      const route = sato?.route
      if (!route) return
      // eslint-disable-next-line no-console
      console.log(
        `[sato] route: ${route.primary ?? "?"} mode=${route.mode ?? "?"} conf=${
          typeof route.confidence === "number" ? route.confidence.toFixed(2) : "?"
        }${route.degraded_from ? ` degraded_from=${route.degraded_from}` : ""}`,
      )
    },
  }
}

export default SatoPlugin

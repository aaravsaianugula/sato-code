// @sato/opencode-plugin — Sato-Code's server plugin.
//
// Uses only documented `@opencode-ai/plugin` hooks (no core patches).
// Modules:
//   - paths.ts   Workspace paths + path-jail resolver.
//   - redact.ts  Secret redaction for audit payloads.
//   - audit.ts   Append-only .sato/state/*.jsonl writer.
//   - policy.ts  .sato/policy.yaml loader + per-tool decision.
//   - headers.ts x-sato-* request headers.
//   - persona.ts System-prompt preamble.
//   - config.ts  Sato provider defaults (idempotent).
//   - tools.ts   sato_state_read (workspace-jailed).
//   - toast.ts   TUI surface for route/overseer/moderation.

import type { Plugin } from "@opencode-ai/plugin"
import { makeSatoPaths } from "./paths.js"
import { makeAudit } from "./audit.js"
import { loadPolicy, decide, type Policy } from "./policy.js"
import { buildSatoHeaders, mergeHeaders } from "./headers.js"
import { applyPersona } from "./persona.js"
import { applyProviderDefaults } from "./config.js"
import { makeSatoStateReadTool } from "./tools.js"
import { surfaceSatoPart } from "./toast.js"

export const SatoPlugin: Plugin = async (input) => {
  const paths = makeSatoPaths(input.directory ?? input.worktree ?? process.cwd())
  const audit = makeAudit(paths.stateDir)

  // Policy is cached in-memory but re-read when the mtime changes so users
  // can edit .sato/policy.yaml without restarting the session.
  let policyCache: { mtime: number; policy: Policy } | undefined
  async function currentPolicy(): Promise<Policy> {
    let mtime = 0
    try {
      const fs = await import("node:fs/promises")
      const st = await fs.stat(paths.policyFile)
      mtime = st.mtimeMs
    } catch {
      // absent → mtime stays 0; loadPolicy returns fallback defaults.
    }
    if (policyCache && policyCache.mtime === mtime) return policyCache.policy
    const policy = await loadPolicy(paths.policyFile)
    if (policy.fallback && policy.parseErrors.length) {
      // eslint-disable-next-line no-console
      console.error(`[sato] policy parse error: ${policy.parseErrors.join("; ")} — falling back to defaults`)
    }
    policyCache = { mtime, policy }
    return policy
  }

  return {
    // -------------------------------------------------------------
    // 1. Provider defaults — ensure `sato` provider block exists.
    // -------------------------------------------------------------
    config: async (cfg) => {
      applyProviderDefaults(cfg)
    },

    // -------------------------------------------------------------
    // 2. Chat headers — inject x-sato-* identity + affinity headers.
    // -------------------------------------------------------------
    "chat.headers": async (i, o) => {
      const add = await buildSatoHeaders({
        sessionID: i.sessionID,
        workspaceRoot: paths.root,
      })
      mergeHeaders(o.headers, add)
    },

    // -------------------------------------------------------------
    // 3. Persona — prepend Sato preamble to the system prompt.
    // -------------------------------------------------------------
    "experimental.chat.system.transform": async (_i, o) => {
      applyPersona(o.system)
    },

    // -------------------------------------------------------------
    // 4. Policy enforcement — pre-tool.
    //    - deny → throw (blocks the tool)
    //    - ask  → let opencode's built-in permission machinery decide
    //             (we DO NOT auto-approve; ask is the safe default).
    //    - allow→ proceed silently
    //    Every attempt is audit-logged.
    // -------------------------------------------------------------
    "tool.execute.before": async (i, o) => {
      const policy = await currentPolicy()
      const { decision, via } = decide(policy, i.tool)
      await audit.permissionLine({
        type: "tool.pre",
        sessionID: i.sessionID,
        tool: i.tool,
        decision,
        data: { via, callID: i.callID, args: o.args, policy_fallback: policy.fallback },
      })
      if (decision === "deny") {
        throw new Error(
          `Sato policy: tool '${i.tool}' is DENIED by .sato/policy.yaml (${via}). ` +
            `To allow, edit .sato/policy.yaml or remove the deny rule.`,
        )
      }
    },

    // -------------------------------------------------------------
    // 5. permission.ask — defense in depth.
    //    If policy says deny, force the outgoing status to deny. We
    //    NEVER silently escalate: if the input status is "ask" and
    //    policy says "allow", we leave the status alone (fail safe).
    //    Note: this hook is defined by @opencode-ai/plugin but is not
    //    currently triggered by opencode core (as of upstream v1.17.15).
    //    We implement it anyway so it works when core wires it in.
    // -------------------------------------------------------------
    "permission.ask": async (i, o) => {
      const tool = typeof (i as any).metadata?.tool === "string" ? (i as any).metadata.tool : i.type
      const policy = await currentPolicy()
      const { decision, via } = decide(policy, tool)
      if (decision === "deny") {
        o.status = "deny"
      }
      // never escalate to "allow" from here; if opencode wants to ask, we
      // let it ask. Only allow-passthrough of an already-allowed request.
      await audit.permissionLine({
        type: "permission.ask",
        sessionID: i.sessionID,
        tool,
        decision: o.status,
        data: { policy_decision: decision, via, requested: i.type, id: i.id },
      })
    },

    // -------------------------------------------------------------
    // 6. Audit + toast surfacing on events.
    // -------------------------------------------------------------
    event: async ({ event }) => {
      switch (event.type) {
        case "session.created":
        case "session.updated":
        case "session.deleted": {
          const info = (event.properties as { info?: { id?: string } }).info
          const id = info?.id
          if (!id) return
          const kind = event.type.split(".")[1] as "created" | "updated" | "deleted"
          await audit.sessionBoundary(id, kind, info)
          return
        }
        case "permission.updated": {
          const perm = event.properties as { id: string; sessionID: string; type: string; metadata?: Record<string, unknown> }
          await audit.permissionLine({
            type: "permission.updated",
            sessionID: perm.sessionID,
            tool: typeof perm.metadata?.tool === "string" ? (perm.metadata.tool as string) : perm.type,
            data: { id: perm.id, requested: perm.type },
          })
          return
        }
        case "permission.replied": {
          const p = event.properties as { sessionID: string; permissionID: string; response: string }
          await audit.permissionLine({
            type: "permission.replied",
            sessionID: p.sessionID,
            data: { id: p.permissionID, response: p.response },
          })
          return
        }
        case "message.part.updated": {
          const part = (event.properties as { part: { id?: string; type?: string; metadata?: unknown } }).part
          await surfaceSatoPart(input.client, input.directory, part)
          return
        }
        default:
          return
      }
    },

    // -------------------------------------------------------------
    // 7. Custom tools registered via the plugin `tool()` helper.
    // -------------------------------------------------------------
    tool: {
      sato_state_read: makeSatoStateReadTool(paths.root),
    },
  }
}

// Named + default export so opencode's loader is happy either way.
// (Do not add non-function exports here — the loader's legacy-plugin path
// iterates every export and expects each to be a Plugin function.)
export default SatoPlugin

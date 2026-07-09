// Append-only audit log for Sato policy/permission events.
//
// Each event → one JSON line under `.sato/state/permissions.jsonl`. Session
// boundaries go to `.sato/state/sessions/<id>.json`. All payloads are
// passed through `redact()` first.
//
// Failures never propagate — audit MUST NOT break the tool call. We log to
// stderr with a `[sato]` prefix and move on.

import * as path from "node:path"
import * as fs from "node:fs/promises"
import { ensureDir, resolveInsideRoot } from "./paths.js"
import { redact } from "./redact.js"

export type AuditEntry = {
  ts: string
  type: string
  sessionID?: string
  tool?: string
  decision?: "allow" | "ask" | "deny"
  data?: unknown
}

function isoNow(): string {
  return new Date().toISOString()
}

function warn(msg: string, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err)
  // eslint-disable-next-line no-console
  console.error(`[sato] audit: ${msg}: ${detail}`)
}

export type Audit = {
  permissionLine(entry: Omit<AuditEntry, "ts">): Promise<void>
  sessionBoundary(sessionID: string, kind: "created" | "updated" | "deleted", info: unknown): Promise<void>
}

export function makeAudit(stateDir: string): Audit {
  const permissionsPath = path.join(stateDir, "permissions.jsonl")
  const sessionsDir = path.join(stateDir, "sessions")

  return {
    async permissionLine(entry) {
      try {
        await ensureDir(stateDir)
        const payload: AuditEntry = { ts: isoNow(), ...entry, data: redact(entry.data) }
        await fs.appendFile(permissionsPath, JSON.stringify(payload) + "\n", "utf8")
      } catch (err) {
        warn("append permissions.jsonl", err)
      }
    },
    async sessionBoundary(sessionID, kind, info) {
      try {
        await ensureDir(sessionsDir)
        // Defense-in-depth: sessionID comes from an untrusted event
        // payload; jail the resulting file under `sessionsDir` so a
        // crafted id like `../foo` or an absolute path cannot escape.
        const p = resolveInsideRoot(sessionsDir, `${sessionID}.json`)
        // Read-modify-write: idempotent. Each write records the most recent
        // known state; created is set once, updated stamps last-seen.
        let prev: Record<string, unknown> = {}
        try {
          const raw = await fs.readFile(p, "utf8")
          prev = JSON.parse(raw) as Record<string, unknown>
        } catch {
          // absent → fresh
        }
        const now = isoNow()
        const next: Record<string, unknown> = {
          ...prev,
          sessionID,
          last_seen: now,
          last_kind: kind,
          info: redact(info),
        }
        if (kind === "created" && !prev.created) next.created = now
        if (kind === "deleted") next.deleted = now
        await fs.writeFile(p, JSON.stringify(next, null, 2), "utf8")
      } catch (err) {
        warn(`session ${sessionID}`, err)
      }
    },
  }
}

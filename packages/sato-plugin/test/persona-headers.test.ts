// Persona + headers pure-logic tests.

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { applyPersona, PERSONA_PREAMBLE } from "../src/persona.ts"
import { mergeHeaders, buildSatoHeaders } from "../src/headers.ts"

describe("applyPersona", () => {
  it("prepends the preamble", () => {
    const system = ["upstream prompt"]
    applyPersona(system)
    assert.equal(system[0], PERSONA_PREAMBLE)
    assert.equal(system[1], "upstream prompt")
  })

  it("is idempotent — repeated calls do not stack preambles", () => {
    const system = ["upstream"]
    applyPersona(system)
    applyPersona(system)
    applyPersona(system)
    assert.equal(system.length, 2)
    assert.equal(system[0], PERSONA_PREAMBLE)
  })

  it("prepends even when system is empty", () => {
    const system: string[] = []
    applyPersona(system)
    assert.equal(system.length, 1)
    assert.equal(system[0], PERSONA_PREAMBLE)
  })
})

describe("mergeHeaders", () => {
  it("adds keys that don't exist", () => {
    const existing = { "content-type": "application/json" }
    mergeHeaders(existing, { "x-sato-client": "sato-code" })
    assert.equal(existing["x-sato-client"], "sato-code")
    assert.equal(existing["content-type"], "application/json")
  })

  it("does NOT overwrite existing keys", () => {
    const existing: Record<string, string> = { "x-sato-client": "custom" }
    mergeHeaders(existing, { "x-sato-client": "sato-code" })
    assert.equal(existing["x-sato-client"], "custom")
  })
})

describe("buildSatoHeaders", () => {
  it("emits the three x-sato-* headers with a stable workspace hash", async () => {
    const h1 = await buildSatoHeaders({ sessionID: "sess-1", workspaceRoot: "/tmp/x" })
    const h2 = await buildSatoHeaders({ sessionID: "sess-1", workspaceRoot: "/tmp/x" })
    assert.equal(h1["x-sato-client"], "sato-code")
    assert.equal(h1["x-sato-session"], "sess-1")
    assert.ok(/^[0-9a-f]{16}$/.test(h1["x-sato-workspace-hash"] ?? ""), "hash should be 16 hex chars")
    assert.equal(h1["x-sato-workspace-hash"], h2["x-sato-workspace-hash"], "hash must be stable per workspace")
  })

  it("different workspaces produce different hashes", async () => {
    const a = await buildSatoHeaders({ sessionID: "s", workspaceRoot: "/tmp/a" })
    const b = await buildSatoHeaders({ sessionID: "s", workspaceRoot: "/tmp/b" })
    assert.notEqual(a["x-sato-workspace-hash"], b["x-sato-workspace-hash"])
  })
})

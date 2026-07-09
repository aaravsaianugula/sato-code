// Adversarial regression: `ask` for a sensitive tool MUST throw from
// `tool.execute.before`.
//
// The prior implementation only threw on `deny` and relied on upstream's
// permission prompt for `ask`. But upstream's `permission.ask` hook is
// not currently wired into core (v1.17.15), and an existing user config
// like `bash: allow` auto-approves — silently dropping the workspace
// policy's friction. This test asserts the fix by exercising the pure
// `enforcementError` helper the plugin hook now delegates to:
//   - sensitive tool at `ask` → throw message names the tool.
//   - sensitive tool at `deny` → throw message says DENIED.
//   - sensitive tool with explicit opt-in `allow` → no throw.
//   - read-only tool at `ask` (user restricting reads) → no throw here
//     (upstream's UX to handle; throwing would be user-hostile).

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { enforcementError, normalizePolicy } from "../src/policy.ts"

describe("enforcementError: ask is an enforceable speed-bump", () => {
  it("throws for a sensitive tool that resolves to ask (default policy)", () => {
    const pol = normalizePolicy({})
    const e = enforcementError(pol, "bash")
    assert.ok(e, "sensitive tool at ask must produce a throw message")
    assert.match(e!.throwMessage, /Sato policy requires confirmation for 'bash'/i)
    assert.match(e!.throwMessage, /defaults\.sensitive: allow/i)
  })

  it("throws for a sensitive tool that policy explicitly downgrades to ask", () => {
    // tools.bash: allow + defaults.sensitive: ask → downgraded to ask
    // (the anti-escalation guard). Must still enforce.
    const pol = normalizePolicy({
      tools: { bash: "allow" },
      defaults: { sensitive: "ask", read_only: "allow" },
    })
    const e = enforcementError(pol, "bash")
    assert.ok(e, "downgraded-to-ask sensitive tool must still enforce")
    assert.match(e!.throwMessage, /confirmation for 'bash'/i)
  })

  it("does NOT throw for a sensitive tool that is explicitly opt-in allowed", () => {
    // Both defaults.sensitive AND the per-tool entry are `allow` — the
    // conscious opt-in the policy layer honors.
    const pol = normalizePolicy({
      tools: { bash: "allow" },
      defaults: { sensitive: "allow", read_only: "allow" },
    })
    const e = enforcementError(pol, "bash")
    assert.equal(e, null)
  })

  it("throws deny for any tool, with a distinct DENIED message", () => {
    const pol = normalizePolicy({ tools: { webfetch: "deny" } })
    const e = enforcementError(pol, "webfetch")
    assert.ok(e)
    assert.match(e!.throwMessage, /DENIED/)
  })

  it("does NOT throw for a read-only tool at ask (upstream's UX to handle)", () => {
    // Explicit ask on a read-only tool (user restricting reads).
    // Throwing here would be UX-hostile, not safety-critical.
    const pol = normalizePolicy({ tools: { read: "ask" } })
    const e = enforcementError(pol, "read")
    assert.equal(e, null)
  })

  it("does NOT throw for a sensitive tool set to allow via defaults only", () => {
    // Sanity: a bare `defaults.sensitive: allow` (no per-tool entry)
    // means user consciously opted in workspace-wide. Don't enforce.
    const pol = normalizePolicy({ defaults: { sensitive: "allow", read_only: "allow" } })
    const e = enforcementError(pol, "bash")
    assert.equal(e, null)
  })
})

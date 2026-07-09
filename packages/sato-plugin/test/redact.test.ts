// Secret-redaction tests. Covers both key-name and value-pattern passes.

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { redact } from "../src/redact.ts"

describe("redact", () => {
  it("masks values when the key looks sensitive", () => {
    const r = redact({ apiKey: "sk-verysecrettoken12345", other: "ok" }) as Record<string, unknown>
    assert.match(String(r.apiKey), /\[redacted:apikey\]/)
    assert.equal(r.other, "ok")
  })

  it("masks nested sensitive keys", () => {
    const r = redact({
      headers: { Authorization: "Bearer abcdef1234567890abcdef" },
      body: { password: "hunter2" },
    }) as Record<string, Record<string, unknown>>
    assert.match(String(r.headers.Authorization), /\[redacted:authorization\]/)
    assert.match(String(r.body.password), /\[redacted:password\]/)
  })

  it("masks known token shapes even when the key is benign", () => {
    const r = redact({
      command: "curl -H 'Authorization: Bearer abcdef1234567890abcdef' https://x",
      note: "sk-1234567890abcdef1234567890abcdef",
    }) as Record<string, string>
    assert.match(r.command, /\[redacted:bearer\]/)
    assert.match(r.note, /\[redacted:openai-sk\]/)
  })

  it("masks a github PAT", () => {
    const r = redact({ token_str: "hello ghp_abcdefghijklmnopqrstuvwxyz1234" }) as Record<string, string>
    // key contains 'token' → entire value masked
    assert.match(r.token_str, /\[redacted:/)
  })

  it("passes booleans, numbers, and short strings through untouched", () => {
    const r = redact({ ok: true, n: 42, s: "hello" }) as Record<string, unknown>
    assert.equal(r.ok, true)
    assert.equal(r.n, 42)
    assert.equal(r.s, "hello")
  })

  it("truncates very long strings so audit lines stay bounded", () => {
    const big = "x".repeat(2000)
    const r = redact({ payload: big }) as Record<string, string>
    assert.ok(r.payload.length < 2000)
    assert.match(r.payload, /truncated/)
  })

  // Adversarial regression: hyphenated header names bypass BOTH passes.
  //
  // Old key-name pass: `SENSITIVE_KEY_SUBSTR.some((needle) =>
  // "x-api-key".toLowerCase().includes(needle))` — none of the substrings
  // (`apikey`, `api_key`, `authorization`, …) is a substring of
  // `x-api-key` (the dashes break `apikey`), so the key looked benign
  // and the raw value was written verbatim into the audit log.
  //
  // Value-pattern pass: an opaque token like `abcd1234efgh5678` matches
  // none of the shape regexes (Bearer, sk-, ghp_, JWT, AKIA), so it
  // slipped through too.
  //
  // Result: the secret landed in `.sato/state/permissions.jsonl`. The
  // new key-name pass normalizes the key (`x-api-key` → `xapikey`)
  // BEFORE substring matching, so the `apikey` needle catches it.
  it("redacts hyphenated header names — x-api-key, api-key, x-openai-key", () => {
    const opaqueValue = "abcd1234efgh5678ijkl9012mnop3456"
    const r = redact({
      headers: {
        "x-api-key": opaqueValue,
        "api-key": opaqueValue,
        "X-Api-Key": opaqueValue,
        "x-openai-key": opaqueValue,
        "api.key": opaqueValue,
      },
    }) as { headers: Record<string, string> }
    assert.match(r.headers["x-api-key"], /\[redacted:/, "x-api-key must be redacted")
    assert.match(r.headers["api-key"], /\[redacted:/, "api-key must be redacted")
    assert.match(r.headers["X-Api-Key"], /\[redacted:/, "X-Api-Key must be redacted")
    assert.match(r.headers["x-openai-key"], /\[redacted:/, "x-openai-key must be redacted")
    assert.match(r.headers["api.key"], /\[redacted:/, "api.key must be redacted")
    // Sanity: the raw opaque value must NOT appear anywhere in the payload.
    const serialized = JSON.stringify(r)
    assert.equal(serialized.includes(opaqueValue), false, "raw secret must not survive redaction")
  })

  it("caps recursion depth", () => {
    const cycleFree: any = {}
    let cur = cycleFree
    for (let i = 0; i < 20; i += 1) {
      cur.next = {}
      cur = cur.next
    }
    // should not throw and should terminate
    const r = redact(cycleFree)
    assert.ok(r)
  })
})

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

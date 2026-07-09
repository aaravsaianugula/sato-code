// Pure-logic tests for policy resolution. Uses node:test — no external deps.
//
// Coverage:
//   1. Malformed YAML → fallback with parseErrors and sensitive → ask.
//   2. Absent file → same fallback, no errors.
//   3. Well-formed policy → explicit tools override defaults.
//   4. Explicit `allow` on a sensitive tool WITHOUT `defaults.sensitive: allow`
//      → DOWNGRADED to `ask` (never silent-approve).
//   5. Read-only tool with `defaults.read_only: allow` → allow.
//   6. Deny always wins.

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { classify, decide, loadPolicy, normalizePolicy, parsePolicyText } from "../src/policy.ts"

describe("classify", () => {
  it("known read-only tools", () => {
    assert.equal(classify("read"), "read_only")
    assert.equal(classify("grep"), "read_only")
    assert.equal(classify("sato_state_read"), "read_only")
  })
  it("known sensitive tools", () => {
    assert.equal(classify("bash"), "sensitive")
    assert.equal(classify("write"), "sensitive")
    assert.equal(classify("edit"), "sensitive")
    assert.equal(classify("webfetch"), "sensitive")
  })
  it("unknown tools default to sensitive (fail-safe)", () => {
    assert.equal(classify("some_random_tool"), "sensitive")
    assert.equal(classify("mcp:foo:bar_write"), "sensitive")
  })
})

describe("parsePolicyText", () => {
  it("accepts simple nested schema", () => {
    const p = parsePolicyText(
      [
        "version: 1",
        "defaults:",
        "  sensitive: ask",
        "  read_only: allow",
        "tools:",
        "  bash: deny",
        "  read: allow",
      ].join("\n"),
    )
    assert.ok(p.ok)
    if (p.ok) {
      assert.equal(p.data.version, 1)
      // Parser builds null-prototype objects for proto-safety, so we
      // compare own-property shape without asserting the prototype.
      const defaults = p.data.defaults as Record<string, unknown>
      assert.equal(defaults.sensitive, "ask")
      assert.equal(defaults.read_only, "allow")
      const tools = p.data.tools as Record<string, unknown>
      assert.equal(tools.bash, "deny")
      assert.equal(tools.read, "allow")
    }
  })

  it("ignores comments and blank lines", () => {
    const p = parsePolicyText("# top\n\nversion: 1\n# inline\ntools:\n  bash: ask # trailing\n")
    assert.ok(p.ok)
  })

  it("rejects malformed lines", () => {
    const p = parsePolicyText("nokeyshere\n")
    assert.equal(p.ok, false)
  })
})

describe("normalizePolicy", () => {
  it("supplies safe defaults on missing keys", () => {
    const p = normalizePolicy({})
    assert.equal(p.defaults.sensitive, "ask")
    assert.equal(p.defaults.read_only, "allow")
    assert.deepEqual(p.tools, {})
    assert.equal(p.fallback, false)
  })

  it("records unknown-decision errors instead of accepting them", () => {
    const p = normalizePolicy({ tools: { bash: "maybe" } })
    assert.equal(p.tools.bash, undefined)
    assert.ok(p.parseErrors.length >= 1)
  })
})

describe("decide", () => {
  it("deny wins on any tool", () => {
    const policy = normalizePolicy({ tools: { grep: "deny" } })
    assert.equal(decide(policy, "grep").decision, "deny")
  })

  it("read-only default applies when tool unmapped", () => {
    const policy = normalizePolicy({ defaults: { read_only: "allow", sensitive: "ask" } })
    assert.equal(decide(policy, "read").decision, "allow")
    assert.equal(decide(policy, "grep").decision, "allow")
  })

  it("sensitive default applies when tool unmapped", () => {
    const policy = normalizePolicy({ defaults: { read_only: "allow", sensitive: "ask" } })
    assert.equal(decide(policy, "bash").decision, "ask")
    assert.equal(decide(policy, "edit").decision, "ask")
  })

  it("explicit allow on a sensitive tool is DOWNGRADED to ask (fail-safe)", () => {
    const policy = normalizePolicy({ tools: { bash: "allow" }, defaults: { sensitive: "ask", read_only: "allow" } })
    const d = decide(policy, "bash")
    assert.equal(d.decision, "ask")
    assert.match(d.via, /downgraded/i)
  })

  it("explicit allow on sensitive is honored ONLY when defaults.sensitive is also allow (opt-in)", () => {
    const policy = normalizePolicy({ tools: { bash: "allow" }, defaults: { sensitive: "allow", read_only: "allow" } })
    assert.equal(decide(policy, "bash").decision, "allow")
  })

  it("explicit ask on a read-only tool is honored (policy can restrict)", () => {
    const policy = normalizePolicy({ tools: { read: "ask" } })
    assert.equal(decide(policy, "read").decision, "ask")
  })
})

// -----------------------------------------------------------------------
// Adversarial: prototype-pollution regression.
//
// Failing this suite means a `.sato/policy.yaml` can silently escalate a
// sensitive tool to `allow` — the exact opposite of the plugin's
// documented anti-escalation guarantee.
//
// Old parser: assigned keys directly onto regular {} objects. A YAML
// payload like `defaults.__proto__.sensitive: allow` set the prototype of
// the `defaults` object, so a later `defaultsRaw.sensitive` walked the
// chain and returned "allow" — flipping `policy.defaults.sensitive` to
// "allow" and letting `tools: { bash: allow }` be honored verbatim.
//
// New parser: builds objects with `Object.create(null)` AND rejects the
// three well-known escalation keys at parse time.
// -----------------------------------------------------------------------
describe("proto-pollution regression", () => {
  const cleanup = () => {
    // Belt-and-suspenders: whatever these tests do, they must not leak
    // pollution into the process's global Object.prototype.
    delete (Object.prototype as unknown as Record<string, unknown>).sensitive
    delete (Object.prototype as unknown as Record<string, unknown>).bash
    delete (Object.prototype as unknown as Record<string, unknown>).polluted
  }

  it("__proto__.sensitive: allow does NOT escalate bash to allow", () => {
    cleanup()
    const yaml = [
      "defaults:",
      "  __proto__:",
      "    sensitive: allow",
      "tools:",
      "  bash: allow",
    ].join("\n")
    const p = parsePolicyText(yaml)
    // Accept either outcome from the parser: (a) reject the forbidden
    // key outright, or (b) accept but treat __proto__ as an inert data
    // property on a null-proto object. Both are safe; only the OLD
    // parser flipped bash to `allow`.
    let bashDecision: string
    if (!p.ok) {
      // Rejection path: fallback policy applies → bash → ask.
      // Simulate the fallback path by normalizing an empty object.
      const pol = normalizePolicy({})
      bashDecision = decide(pol, "bash").decision
    } else {
      const pol = normalizePolicy(p.data)
      bashDecision = decide(pol, "bash").decision
    }
    assert.equal(
      bashDecision,
      "ask",
      "bash must still require ask — a proto-polluted defaults must not escalate it to allow",
    )
    // Object.prototype must NOT be polluted after parsing an untrusted
    // policy file.
    assert.equal((Object.prototype as unknown as Record<string, unknown>).sensitive, undefined)
    cleanup()
  })

  it("top-level __proto__ key does NOT escalate bash to allow", () => {
    cleanup()
    const yaml = [
      "__proto__:",
      "  defaults:",
      "    sensitive: allow",
      "tools:",
      "  bash: allow",
    ].join("\n")
    const p = parsePolicyText(yaml)
    let bashDecision: string
    if (!p.ok) {
      const pol = normalizePolicy({})
      bashDecision = decide(pol, "bash").decision
    } else {
      const pol = normalizePolicy(p.data)
      bashDecision = decide(pol, "bash").decision
    }
    assert.equal(bashDecision, "ask")
    assert.equal((Object.prototype as unknown as Record<string, unknown>).sensitive, undefined)
    cleanup()
  })

  it("constructor / prototype keys are rejected or inert", () => {
    cleanup()
    for (const key of ["constructor", "prototype"]) {
      const yaml = ["defaults:", `  ${key}:`, "    sensitive: allow", "tools:", "  bash: allow"].join("\n")
      const p = parsePolicyText(yaml)
      let bashDecision: string
      if (!p.ok) {
        const pol = normalizePolicy({})
        bashDecision = decide(pol, "bash").decision
      } else {
        const pol = normalizePolicy(p.data)
        bashDecision = decide(pol, "bash").decision
      }
      assert.equal(bashDecision, "ask", `key '${key}' must not escalate bash`)
      assert.equal((Object.prototype as unknown as Record<string, unknown>).sensitive, undefined)
    }
    cleanup()
  })

  it("normalizePolicy ignores a polluted Object.prototype (own-props only)", () => {
    cleanup()
    // Simulate an already-polluted process (e.g. from a third-party
    // dependency). `normalizePolicy({})` MUST still emit `sensitive: ask`
    // because inherited props are not read.
    ;(Object.prototype as unknown as Record<string, unknown>).sensitive = "allow"
    try {
      const pol = normalizePolicy({})
      assert.equal(pol.defaults.sensitive, "ask", "sensitive must not be inherited from Object.prototype")
      const d = decide(pol, "bash")
      assert.equal(d.decision, "ask")
    } finally {
      cleanup()
    }
  })
})

describe("loadPolicy (fail-safe)", () => {
  it("absent file returns fallback with no errors", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sato-policy-"))
    try {
      const p = await loadPolicy(path.join(dir, "policy.yaml"))
      assert.equal(p.fallback, true)
      assert.deepEqual(p.parseErrors, [])
      assert.equal(p.defaults.sensitive, "ask")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("malformed file returns fallback with parseErrors — sensitive still asks", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sato-policy-"))
    const p = path.join(dir, "policy.yaml")
    try {
      await fs.writeFile(p, "this is not yaml at all\n:::::\n")
      const pol = await loadPolicy(p)
      assert.equal(pol.fallback, true)
      assert.ok(pol.parseErrors.length >= 1)
      // fail-safe: sensitive tools still default to ask
      assert.equal(decide(pol, "bash").decision, "ask")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("well-formed file is honored", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sato-policy-"))
    const p = path.join(dir, "policy.yaml")
    try {
      await fs.writeFile(
        p,
        "version: 1\ndefaults:\n  sensitive: ask\n  read_only: allow\ntools:\n  webfetch: deny\n",
      )
      const pol = await loadPolicy(p)
      assert.equal(pol.fallback, false)
      assert.equal(decide(pol, "webfetch").decision, "deny")
      assert.equal(decide(pol, "read").decision, "allow")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

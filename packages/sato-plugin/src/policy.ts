// `.sato/policy.yaml` — per-workspace tool policy for the Sato plugin.
//
// Schema (only these keys are honored; unknown keys ignored):
//
//     version: 1
//     defaults:
//       sensitive: ask       # applied to sensitive tools when unmapped
//       read_only: allow     # applied to read-only tools when unmapped
//     tools:
//       bash: ask            # allow | ask | deny
//       write: ask
//       edit: ask
//       webfetch: ask
//       read: allow
//       glob: allow
//       grep: allow
//       sato_state_read: allow
//
// This deliberately supports only a flat key:value shape so we don't drag
// in a full YAML parser (the plugin ships zero non-workspace deps).
//
// FAIL-SAFE contract:
//   - Policy file absent → fall back to built-in defaults (sensitive → ask).
//   - Policy file malformed → same as absent, plus a warning line.
//   - Unknown tool name → `sensitive` classification for sensitive-shaped
//     tool ids (bash/shell/write/edit/webfetch/*_write/*_edit), else "ask".
//   - `allow` in policy can only DOWNGRADE a tool that is inherently
//     read-only; a policy MUST NOT be able to silently auto-approve a
//     sensitive tool. In practice we honor allow only when the tool is in
//     the read-only classification OR the caller explicitly opted in via
//     `defaults.sensitive: allow` (a load-bearing choice; explicit).

import * as fs from "node:fs/promises"

export type Decision = "allow" | "ask" | "deny"

export type Policy = {
  version: number
  defaults: { sensitive: Decision; read_only: Decision }
  tools: Record<string, Decision>
  /** True when the file was missing or malformed and we fell back. */
  fallback: boolean
  /** Non-empty when we couldn't parse the file. */
  parseErrors: string[]
}

/** Tools classified read-only. Others treated as sensitive by default. */
export const READ_ONLY_TOOLS = new Set<string>([
  "read",
  "glob",
  "grep",
  "list",
  "ls",
  "sato_state_read",
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
])

/** Tools we KNOW are sensitive — enforced even if not listed in policy. */
export const SENSITIVE_TOOLS = new Set<string>([
  "bash",
  "shell",
  "write",
  "edit",
  "apply_patch",
  "webfetch",
  "web_fetch",
  "patch",
])

export function classify(tool: string): "read_only" | "sensitive" {
  if (READ_ONLY_TOOLS.has(tool)) return "read_only"
  if (SENSITIVE_TOOLS.has(tool)) return "sensitive"
  // Heuristic: names containing write/edit/delete/exec are sensitive.
  const t = tool.toLowerCase()
  if (/write|edit|delete|exec|shell|patch/.test(t)) return "sensitive"
  // Default: treat unknown tools as SENSITIVE for fail-safe. Better to
  // over-ask than to silently allow.
  return "sensitive"
}

function DEFAULT_POLICY(fallback: boolean, parseErrors: string[] = []): Policy {
  return {
    version: 1,
    defaults: { sensitive: "ask", read_only: "allow" },
    tools: {},
    fallback,
    parseErrors,
  }
}

function isDecision(x: unknown): x is Decision {
  return x === "allow" || x === "ask" || x === "deny"
}

/**
 * Keys we never accept from a policy file — assigning `__proto__` on a
 * regular object mutates the prototype chain (JS spec behavior), and
 * `constructor`/`prototype` are the standard proto-pollution escalation
 * paths. Rejecting them at parse time gives us a clear, sourced error
 * instead of a silent prototype-poisoned object. This is defense-in-depth
 * on top of the null-prototype objects the parser builds — an
 * `Object.create(null)` object treats `__proto__` as a normal data
 * property, but downstream code that mistakenly reads via a regular
 * object would still be exposed, so we refuse the key outright.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

/**
 * Minimal YAML subset parser for the policy schema.
 *
 * Handles:
 *   - `key: value` at top level
 *   - `key:` then indented `sub: value` pairs (2 or 4 spaces)
 *   - `#` line comments
 *   - unquoted scalar values (booleans, strings, integers)
 *
 * Rejects everything else (lists, block scalars, anchors). This is
 * intentional — a malformed policy is more dangerous than an absent one,
 * and we don't want silent partial parses.
 *
 * Proto-safety: all objects are built with `Object.create(null)` so
 * `__proto__`/`constructor` reads never traverse the prototype chain,
 * and the forbidden-key list above rejects the standard pollution
 * payloads at parse time.
 */
export function parsePolicyText(text: string): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const root: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  const stack: { indent: number; obj: Record<string, unknown> }[] = [{ indent: -1, obj: root }]
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? ""
    // Strip trailing comment (only if not inside a quoted value; we don't
    // support quotes with `#` inside — good enough for our schema).
    const noComment = raw.replace(/\s+#.*$/, "").replace(/^#.*$/, "")
    if (!noComment.trim()) continue
    const indent = noComment.length - noComment.trimStart().length
    const line = noComment.trimStart()
    while (stack.length > 1 && indent <= (stack[stack.length - 1]?.indent ?? -1)) stack.pop()
    const parent = stack[stack.length - 1]!
    const colon = line.indexOf(":")
    if (colon === -1) return { ok: false, error: `line ${i + 1}: expected 'key:' or 'key: value'` }
    const key = line.slice(0, colon).trim()
    const rest = line.slice(colon + 1).trim()
    if (!key) return { ok: false, error: `line ${i + 1}: empty key` }
    if (FORBIDDEN_KEYS.has(key)) {
      return { ok: false, error: `line ${i + 1}: forbidden key '${key}' (prototype-pollution guard)` }
    }
    if (rest.length === 0) {
      const child: Record<string, unknown> = Object.create(null) as Record<string, unknown>
      parent.obj[key] = child
      stack.push({ indent, obj: child })
    } else {
      parent.obj[key] = coerceScalar(rest)
    }
  }
  return { ok: true, data: root }
}

function coerceScalar(v: string): unknown {
  const s = v.replace(/^["']|["']$/g, "")
  if (s === "true") return true
  if (s === "false") return false
  if (s === "null") return null
  if (/^-?\d+$/.test(s)) return Number(s)
  return s
}

/**
 * Load, parse, and normalize the policy at `policyPath`. Never throws on
 * IO/parse errors — returns fallback defaults with `fallback = true` and
 * `parseErrors` populated.
 */
export async function loadPolicy(policyPath: string): Promise<Policy> {
  let text: string
  try {
    text = await fs.readFile(policyPath, "utf8")
  } catch {
    return DEFAULT_POLICY(true)
  }
  const parsed = parsePolicyText(text)
  if (!parsed.ok) {
    return DEFAULT_POLICY(true, [parsed.error])
  }
  return normalizePolicy(parsed.data)
}

/**
 * Read a field ONLY if it is an OWN property. This is the second half of
 * proto-pollution defense: even if a caller hands us a polluted regular
 * object (e.g. through `normalizePolicy` directly), inherited fields are
 * ignored, so a polluted `Object.prototype.sensitive = "allow"` cannot
 * escalate a sensitive tool.
 */
function ownGet(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== "object") return undefined
  return Object.hasOwn(obj as object, key) ? (obj as Record<string, unknown>)[key] : undefined
}

export function normalizePolicy(raw: Record<string, unknown>): Policy {
  const errors: string[] = []
  const rawVersion = ownGet(raw, "version")
  const version = typeof rawVersion === "number" ? rawVersion : 1
  const defaultsRawUnknown = ownGet(raw, "defaults")
  const defaultsRaw =
    defaultsRawUnknown && typeof defaultsRawUnknown === "object"
      ? (defaultsRawUnknown as Record<string, unknown>)
      : undefined
  const rawSensitive = ownGet(defaultsRaw, "sensitive")
  const rawReadOnly = ownGet(defaultsRaw, "read_only")
  const sensitive = isDecision(rawSensitive) ? rawSensitive : "ask"
  const read_only = isDecision(rawReadOnly) ? rawReadOnly : "allow"
  // Regular object is safe here: we filter FORBIDDEN_KEYS below and only
  // write validated `Decision` values, so the prototype chain is never
  // touched. Keeps deepStrictEqual test assertions well-behaved.
  const toolsOut: Record<string, Decision> = {}
  const toolsRawUnknown = ownGet(raw, "tools")
  const toolsRaw =
    toolsRawUnknown && typeof toolsRawUnknown === "object"
      ? (toolsRawUnknown as Record<string, unknown>)
      : undefined
  if (toolsRaw) {
    // Object.keys is own-only; combined with FORBIDDEN_KEYS filtering to
    // stay defense-in-depth even if a caller hand-crafts a raw object.
    for (const k of Object.keys(toolsRaw)) {
      if (FORBIDDEN_KEYS.has(k)) {
        errors.push(`tools.${k}: forbidden key`)
        continue
      }
      const v = (toolsRaw as Record<string, unknown>)[k]
      if (isDecision(v)) toolsOut[k] = v
      else errors.push(`tools.${k}: not a valid decision (${String(v)})`)
    }
  }
  return {
    version,
    defaults: { sensitive, read_only },
    tools: toolsOut,
    fallback: false,
    parseErrors: errors,
  }
}

/**
 * Resolve the decision for a tool against the policy.
 *
 * Enforcement rules:
 *   1. Explicit per-tool entry wins.
 *   2. Otherwise fall back to `defaults.sensitive` / `defaults.read_only`
 *      depending on classification.
 *   3. `allow` is only honored for read-only tools OR when the caller
 *      explicitly set `defaults.sensitive: allow` (audit records this).
 *      For sensitive tools with an unqualified allow, we DOWNGRADE to
 *      `ask` — the plugin never silently auto-approves a sensitive
 *      tool the built-in permission would have prompted for.
 */
/**
 * Enforcement layer: given a policy decision, return the error message
 * the plugin's `tool.execute.before` hook should throw, or `null` when
 * the tool should proceed.
 *
 * Two throw cases:
 *   1. `deny` on ANY tool — hard stop, workspace forbids this.
 *   2. `ask` on a SENSITIVE tool — enforceable speed-bump. Upstream's
 *      `permission.ask` hook is not currently wired into core, so `ask`
 *      would silently fall through to user config (which may auto-allow
 *      via `bash: allow` etc), defeating the workspace's friction. We
 *      throw a user-actionable error instead: the user can raise the
 *      policy to `allow` (or `defaults.sensitive: allow`) to consciously
 *      bypass — never silently.
 *
 * We do NOT throw on `ask` for read-only tools; that path is a user
 * explicitly restricting reads, and enforcement is upstream's UX.
 * Isolated from `decide()` so we can unit-test it directly.
 */
export function enforcementError(
  policy: Policy,
  tool: string,
): { throwMessage: string } | null {
  const { decision, via } = decide(policy, tool)
  if (decision === "deny") {
    return {
      throwMessage:
        `Sato policy: tool '${tool}' is DENIED by .sato/policy.yaml (${via}). ` +
        `To allow, edit .sato/policy.yaml or remove the deny rule.`,
    }
  }
  if (decision === "ask" && classify(tool) === "sensitive") {
    return {
      throwMessage:
        `Sato policy requires confirmation for '${tool}' — ` +
        `set it to allow (or defaults.sensitive: allow) in .sato/policy.yaml to bypass.`,
    }
  }
  return null
}

export function decide(policy: Policy, tool: string): { decision: Decision; via: string } {
  const cls = classify(tool)
  // Own-property-only lookup: even if Object.prototype was polluted
  // upstream, we cannot inherit `policy.tools[tool]` from the chain.
  const explicit = Object.hasOwn(policy.tools, tool) ? policy.tools[tool] : undefined
  if (explicit) {
    // Explicit allow on a sensitive tool: honor only if user explicitly
    // set defaults.sensitive: allow too (i.e. they consciously opted in).
    if (explicit === "allow" && cls === "sensitive" && policy.defaults.sensitive !== "allow") {
      return { decision: "ask", via: `explicit-downgraded (${tool})` }
    }
    return { decision: explicit, via: `explicit (${tool})` }
  }
  if (cls === "read_only") return { decision: policy.defaults.read_only, via: "default (read_only)" }
  return { decision: policy.defaults.sensitive, via: "default (sensitive)" }
}

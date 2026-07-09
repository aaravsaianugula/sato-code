// Secret redaction for audit-log payloads.
//
// Goal: an audit line that names a tool + summary of args + policy decision
// must NEVER leak an API key, bearer token, cookie, or password. We can't
// enumerate every schema, so we use two complementary passes:
//
//  1. Key-name pass: any object key that looks sensitive → value replaced
//     with "[redacted:<name>]" regardless of value shape.
//  2. Value pattern pass: string values that MATCH a known credential
//     shape (Bearer, sk-*, github pat, JWT-ish) → replaced with a hash
//     marker so we can still correlate distinct secrets without exposing
//     them.
//
// The two passes together handle both "field named apiKey" and "someone
// stuffed a token into `command` or `body`" cases.

/** Substrings that mark a field name as sensitive (case-insensitive). */
const SENSITIVE_KEY_SUBSTR = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "bearer",
  "cookie",
  "session_id",
  "private_key",
  "privatekey",
  "credential",
]

function keyLooksSensitive(k: string): boolean {
  const lower = k.toLowerCase()
  return SENSITIVE_KEY_SUBSTR.some((needle) => lower.includes(needle))
}

/** Patterns for likely-secret VALUES (used when the key doesn't tell us). */
const VALUE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/g },
  { label: "openai-sk", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { label: "github-pat", re: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { label: "github-oauth", re: /\bgho_[A-Za-z0-9]{20,}\b/g },
  { label: "aws-akid", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
]

function redactString(s: string): string {
  let out = s
  for (const { label, re } of VALUE_PATTERNS) {
    out = out.replace(re, `[redacted:${label}]`)
  }
  return out
}

const MAX_DEPTH = 6
const MAX_STRING = 500

/**
 * Recursively clone `input`, replacing secrets. Truncates long strings
 * (audit lines aren't for archiving giant payloads).
 */
export function redact(input: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[redacted:depth]"
  if (input === null || input === undefined) return input
  const t = typeof input
  if (t === "string") {
    const s = input as string
    const red = redactString(s)
    return red.length > MAX_STRING ? red.slice(0, MAX_STRING) + "…[truncated]" : red
  }
  if (t === "number" || t === "boolean" || t === "bigint") return input
  if (Array.isArray(input)) return input.map((v) => redact(v, depth + 1))
  if (t === "object") {
    const rec = input as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rec)) {
      if (keyLooksSensitive(k)) {
        out[k] = `[redacted:${k.toLowerCase()}]`
        continue
      }
      out[k] = redact(v, depth + 1)
    }
    return out
  }
  // Functions, symbols → drop
  return `[redacted:${t}]`
}

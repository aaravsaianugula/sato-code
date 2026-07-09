// Request-header injection for the `chat.headers` hook.
//
// We stamp every outgoing request to the model with three headers:
//
//   x-sato-client:          "sato-code" (fork identity — routing hint)
//   x-sato-session:         current OpenCode session id (affinity + patch-0002 capture)
//   x-sato-workspace-hash:  short SHA-256 of the workspace root (privacy-safe id)
//
// The gateway on the other end (Sato-AI) uses these for routing, audit,
// and session capture. Downstream headers already set by opencode (or by
// other plugins earlier in the chain) are preserved verbatim — we only
// ADD, never overwrite.

export type HeaderInputs = {
  sessionID: string
  workspaceRoot: string
}

/** First 16 hex chars of SHA-256(input). Local so headers.ts has no relative imports. */
async function shortSha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest("SHA-256", buf)
  const bytes = new Uint8Array(digest)
  let out = ""
  for (let i = 0; i < 8; i += 1) {
    const b = bytes[i]!
    out += b.toString(16).padStart(2, "0")
  }
  return out
}

/**
 * Build the header map. Cached workspace-hash lookup keyed by root.
 */
export async function buildSatoHeaders(input: HeaderInputs): Promise<Record<string, string>> {
  const wsHash = await workspaceHash(input.workspaceRoot)
  return {
    "x-sato-client": "sato-code",
    "x-sato-session": input.sessionID,
    "x-sato-workspace-hash": wsHash,
  }
}

const cache = new Map<string, string>()
async function workspaceHash(root: string): Promise<string> {
  const cached = cache.get(root)
  if (cached) return cached
  const hash = await shortSha256(root)
  cache.set(root, hash)
  return hash
}

/**
 * Merge without clobbering pre-existing keys. Existing plugins may have
 * set values we should respect (e.g. a custom `x-sato-session` a test
 * harness wants to force).
 */
export function mergeHeaders(existing: Record<string, string>, add: Record<string, string>): void {
  for (const [k, v] of Object.entries(add)) {
    if (existing[k] === undefined) existing[k] = v
  }
}

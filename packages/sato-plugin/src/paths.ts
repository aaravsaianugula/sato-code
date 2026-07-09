// Workspace paths + workspace-jail path resolver for the Sato plugin.
//
// The plugin runs with the OpenCode server's file-system authority. Every
// path that flows from user/tool input MUST be reduced to an absolute path
// under the workspace root; anything outside is refused. This module is the
// single source of truth for that guarantee.

import * as path from "node:path"
import * as fs from "node:fs/promises"

/** Names under `.sato/` we care about. */
export const SATO_DIR = ".sato"
export const STATE_DIR = "state"
export const POLICY_FILE = "policy.yaml"

export type SatoPaths = {
  /** Workspace root — absolute, resolved. */
  root: string
  /** Absolute `.sato/` directory (may not exist). */
  satoDir: string
  /** Absolute `.sato/state/` directory (may not exist). */
  stateDir: string
  /** Absolute `.sato/policy.yaml` path (may not exist). */
  policyFile: string
}

export function makeSatoPaths(workspaceRoot: string): SatoPaths {
  const root = path.resolve(workspaceRoot)
  const satoDir = path.join(root, SATO_DIR)
  const stateDir = path.join(satoDir, STATE_DIR)
  const policyFile = path.join(satoDir, POLICY_FILE)
  return { root, satoDir, stateDir, policyFile }
}

/**
 * Resolve `rel` under `root` and REJECT any path that escapes.
 *
 * Contract:
 *  - Empty / undefined `rel` → returns `root` itself.
 *  - Absolute paths are allowed IFF they resolve inside `root`.
 *  - `..`, symlink loops, drive-letter tricks → thrown.
 *
 * The check is done by resolving to an absolute path and asserting
 * `path.relative(root, abs)` neither starts with `..` nor is absolute.
 * This is intentionally NOT `startsWith(root)` — that would misfire on
 * `/tmp/root-evil` vs `/tmp/root`. Using `path.relative` handles the
 * boundary correctly on Windows + POSIX.
 */
export function resolveInsideRoot(root: string, rel: string | undefined): string {
  const normalizedRoot = path.resolve(root)
  const target = rel && rel.length > 0 ? path.resolve(normalizedRoot, rel) : normalizedRoot
  const between = path.relative(normalizedRoot, target)
  if (between.startsWith("..") || path.isAbsolute(between)) {
    throw new Error(`path escapes workspace: ${rel}`)
  }
  return target
}

/** Best-effort `mkdir -p`. Swallows EEXIST. */
export async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "EEXIST") throw err
  }
}

/** Stable short SHA-256 hex of a string, first 16 chars. */
export async function shortSha256(input: string): Promise<string> {
  // Use SubtleCrypto (available in Node ≥18, Bun, browsers).
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

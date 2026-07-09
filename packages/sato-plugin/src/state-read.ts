// Pure `sato_state_read` logic, separated from `tools.ts` so it can be
// unit-tested without booting the `@opencode-ai/plugin` workspace dep.
// tools.ts wraps this in the plugin's `tool()` helper; the security-
// critical jail lives entirely here.

import * as fs from "node:fs/promises"
import * as path from "node:path"

const MAX_BYTES = 256 * 1024 // 256 KiB — Sato state files are notes, not archives

// Local copy of `paths.ts`'s workspace-jail check. Duplicated (rather
// than imported) so this module can be loaded by `node --test` without
// resolving relative `.js` specifiers against `.ts` sources. Kept in
// perfect sync with `resolveInsideRoot` in `paths.ts`; if that file's
// contract ever changes, update both.
function resolveInsideRootLocal(root: string, rel: string | undefined): string {
  const normalizedRoot = path.resolve(root)
  const target = rel && rel.length > 0 ? path.resolve(normalizedRoot, rel) : normalizedRoot
  const between = path.relative(normalizedRoot, target)
  if (between.startsWith("..") || path.isAbsolute(between)) {
    throw new Error(`path escapes workspace: ${rel}`)
  }
  return target
}

export type StateReadResult = {
  title: string
  output: string
  metadata?: { path: string; bytes: number }
}

/**
 * Read `.sato/state/<relPath>` under `workspaceRoot`.
 *
 * Refuses (never throws) on:
 *   - path escapes via `..` / absolute paths (textual layer)
 *   - path is a leaf symlink (`lstat` layer)
 *   - path physically resolves outside `.sato/state/` after following
 *     intermediate directory symlinks (`realpath` layer — this is what
 *     closes the CVE-shaped hole where a planted directory symlink like
 *     `<workspace>/.sato/state/notes -> /etc` would make
 *     `sato_state_read {path: "notes/passwd"}` textually resolve inside
 *     the jail while physically reading `/etc/passwd`)
 *   - path is empty, oversize, or not a regular file
 */
export async function readSatoStateFile(workspaceRoot: string, relPath: string): Promise<StateReadResult> {
  const stateRoot = path.join(workspaceRoot, ".sato", "state")
  let target: string
  try {
    target = resolveInsideRootLocal(stateRoot, relPath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { title: "sato_state_read: refused", output: `Refused: ${msg}` }
  }
  if (target === stateRoot) {
    return {
      title: "sato_state_read: refused",
      output: "Refused: path is empty; specify a file under .sato/state/.",
    }
  }
  // Layer 1: leaf-symlink and shape check.
  try {
    const st = await fs.lstat(target)
    if (st.isSymbolicLink()) {
      return { title: "sato_state_read: refused", output: "Refused: symlink target." }
    }
    if (!st.isFile()) {
      return { title: "sato_state_read: refused", output: "Refused: not a regular file." }
    }
    if (st.size > MAX_BYTES) {
      return {
        title: "sato_state_read: too large",
        output: `Refused: file is ${st.size} bytes; limit is ${MAX_BYTES}.`,
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { title: "sato_state_read: not found", output: `Not found: ${msg}` }
  }
  // Layer 2: physically resolve BOTH the target and the jail root, then
  // verify the target lives underneath. Both are realpath'd because the
  // jail root itself may be a symlink (WSL /home is commonly one).
  let realTarget: string
  let realRoot: string
  try {
    realTarget = await fs.realpath(target)
    realRoot = await fs.realpath(stateRoot)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { title: "sato_state_read: refused", output: `Refused: realpath failed (${msg}).` }
  }
  const relFromRealRoot = path.relative(realRoot, realTarget)
  if (
    relFromRealRoot === "" ||
    relFromRealRoot.startsWith("..") ||
    path.isAbsolute(relFromRealRoot)
  ) {
    return {
      title: "sato_state_read: refused",
      output: "Refused: path escapes .sato/state/ via symlink.",
    }
  }
  const content = await fs.readFile(realTarget, "utf8")
  const rel = path.relative(stateRoot, target).replace(/\\/g, "/")
  return {
    title: `sato_state_read: ${rel}`,
    output: content,
    metadata: { path: rel, bytes: content.length },
  }
}

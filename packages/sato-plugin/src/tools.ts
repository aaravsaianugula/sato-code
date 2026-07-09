// Custom Sato tools registered via the plugin `tool` helper.
//
// `sato_state_read` — read a file under `.sato/state/`. Workspace-jailed:
// the requested path is resolved under the workspace root's `.sato/state`
// dir, and any attempt to escape (via `..`, absolute paths, or symlink
// tricks) is rejected before touching the filesystem.

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { tool } from "@opencode-ai/plugin"
import { resolveInsideRoot } from "./paths.js"

const MAX_BYTES = 256 * 1024 // 256 KiB — Sato state files are notes, not archives

export function makeSatoStateReadTool(workspaceRoot: string) {
  return tool({
    description:
      "Read a file under the workspace's `.sato/state/` directory (e.g. GOAL.md, PLAN.md, ROADMAP.md). " +
      "The path is jailed to `.sato/state/` — attempts to read outside are refused. " +
      "Use this to inspect the Sato supervisor's state notes.",
    args: {
      path: tool.schema
        .string()
        .describe("Path RELATIVE to `.sato/state/` (e.g. 'GOAL.md' or 'notes/plan.md'). No leading slash, no `..`."),
    },
    async execute(args) {
      // Root for the jail is `.sato/state`, not the whole workspace, so
      // sato_state_read cannot read outside its designated directory even
      // if someone patches over the workspace root check.
      const stateRoot = path.join(workspaceRoot, ".sato", "state")
      let target: string
      try {
        target = resolveInsideRoot(stateRoot, args.path)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          title: "sato_state_read: refused",
          output: `Refused: ${msg}`,
        }
      }
      if (target === stateRoot) {
        return {
          title: "sato_state_read: refused",
          output: "Refused: path is empty; specify a file under .sato/state/.",
        }
      }
      // Reject symlinks (they could point outside the jail even though the
      // path resolved inside).
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
      const content = await fs.readFile(target, "utf8")
      const rel = path.relative(stateRoot, target).replace(/\\/g, "/")
      return {
        title: `sato_state_read: ${rel}`,
        output: content,
        metadata: { path: rel, bytes: content.length },
      }
    },
  })
}

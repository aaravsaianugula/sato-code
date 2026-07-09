// Custom Sato tools registered via the plugin `tool` helper.
//
// `sato_state_read` — read a file under `.sato/state/`. Workspace-jailed:
// the requested path is resolved under the workspace root's `.sato/state`
// dir, and any attempt to escape (via `..`, absolute paths, or symlink
// tricks — including intermediate directory symlinks) is rejected
// before touching the filesystem. All security-critical logic lives in
// `./state-read.ts` (kept plugin-dep-free so it's directly unit-testable).

import { tool } from "@opencode-ai/plugin"
import { readSatoStateFile } from "./state-read.js"

export { readSatoStateFile } from "./state-read.js"

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
      return readSatoStateFile(workspaceRoot, args.path)
    },
  })
}

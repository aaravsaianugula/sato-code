// Adversarial regression: sato_state_read intermediate-symlink jail bypass.
//
// The prior guard was `lstat(target)` (which only checks the LEAF) plus a
// textual `resolveInsideRoot` check. Neither catches an INTERMEDIATE
// directory symlink: a planted `<workspace>/.sato/state/notes -> /etc`
// let `sato_state_read {path: "notes/passwd"}` textually resolve inside
// the jail, but `readFile` physically followed the symlink and read
// `/etc/passwd`. The fix realpath's both the requested target and the
// jail root, and refuses if the physical target is not underneath.
//
// This test is skipped on Windows unless the process has the
// SeCreateSymbolicLinkPrivilege (typically only elevated shells); the
// jail hole was reported on WSL/POSIX and the fix is verified there.

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
// NOTE: import from `state-read.ts` (the pure helper), NOT `tools.ts`.
// tools.ts imports `@opencode-ai/plugin`, a workspace dep that isn't
// necessarily resolvable in a raw `node --test` run. The wrapper is a
// one-line delegate, so testing the helper covers the security-critical
// logic verbatim.
import { readSatoStateFile } from "../src/state-read.ts"

async function tryMakeDirSymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    await fs.symlink(target, linkPath, "dir")
    return true
  } catch {
    // Fall through to junction: on stock Windows without
    // SeCreateSymbolicLinkPrivilege, `fs.symlink(..., "dir")` fails but
    // `fs.symlink(..., "junction")` succeeds (junctions don't require
    // the privilege). Junctions are followed by `realpath`, so they
    // exercise the same intermediate-symlink escape the fix closes.
    if (process.platform === "win32") {
      try {
        await fs.symlink(target, linkPath, "junction")
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

describe("sato_state_read: intermediate-symlink jail", () => {
  it("refuses a read that traverses an intermediate directory symlink pointing outside the jail", async () => {
    // Layout:
    //   <workspace>/.sato/state/    ← jail root
    //   <workspace>/.sato/state/notes → <outside>/   ← planted escape
    //   <outside>/passwd            ← the secret we must NOT read
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sato-jail-ws-"))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "sato-jail-outside-"))
    try {
      const stateRoot = path.join(workspace, ".sato", "state")
      await fs.mkdir(stateRoot, { recursive: true })
      // The escape target must be a real regular file, otherwise the
      // `st.isFile()` guard would reject on shape (not on jail escape),
      // which would be a false pass for this test.
      const escapeFile = path.join(outside, "passwd")
      await fs.writeFile(escapeFile, "SECRET root:x:0:0::/root:/bin/sh\n")

      const linkPath = path.join(stateRoot, "notes")
      const linked = await tryMakeDirSymlink(outside, linkPath)
      if (!linked) {
        // On stock Windows without symlink privilege we cannot make the
        // adversarial layout — skip rather than false-pass.
        // eslint-disable-next-line no-console
        console.warn("[skip] symlink creation not permitted; jail test needs elevated Windows or POSIX")
        return
      }

      // Sanity check the layout is truly adversarial: without the fix,
      // the raw fs.readFile would resolve through the symlink and hand
      // us the secret. If this fails, the OS doesn't honor the symlink
      // and the test is meaningless — bail out.
      const throughSymlink = await fs.readFile(path.join(linkPath, "passwd"), "utf8")
      assert.match(throughSymlink, /SECRET/, "symlink is not being followed — test setup broken")

      const result = await readSatoStateFile(workspace, "notes/passwd")
      assert.match(
        result.title,
        /refused/i,
        `expected refusal, got title=${result.title} output=${result.output}`,
      )
      assert.equal(
        result.output.includes("SECRET"),
        false,
        "secret file contents must NOT appear in the tool output",
      )
    } finally {
      await fs.rm(workspace, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it("still allows a legitimate in-jail read", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sato-jail-ok-"))
    try {
      const stateRoot = path.join(workspace, ".sato", "state")
      await fs.mkdir(stateRoot, { recursive: true })
      await fs.writeFile(path.join(stateRoot, "GOAL.md"), "hello sato")

      const result = await readSatoStateFile(workspace, "GOAL.md")
      assert.equal(result.output, "hello sato")
      assert.match(result.title, /GOAL\.md/)
    } finally {
      await fs.rm(workspace, { recursive: true, force: true })
    }
  })
})

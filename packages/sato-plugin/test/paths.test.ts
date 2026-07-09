// Pure-logic tests for the workspace-jail resolver.
//
// The property under test: `resolveInsideRoot(root, rel)` MUST reject any
// path that escapes `root`, regardless of whether the escape is via
// `..`, an absolute path, a UNC path, or a drive-letter root.

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import { resolveInsideRoot } from "../src/paths.ts"

describe("resolveInsideRoot", () => {
  const root = path.resolve(os.tmpdir(), "sato-jail-test")

  it("accepts a normal relative path", () => {
    const p = resolveInsideRoot(root, "GOAL.md")
    assert.equal(p, path.join(root, "GOAL.md"))
  })

  it("accepts a nested relative path", () => {
    const p = resolveInsideRoot(root, "notes/plan.md")
    assert.equal(p, path.join(root, "notes/plan.md"))
  })

  it("normalizes intra-root traversal (../sibling under root is OK)", () => {
    const p = resolveInsideRoot(root, "a/../b")
    assert.equal(p, path.join(root, "b"))
  })

  it("rejects `..` escape", () => {
    assert.throws(() => resolveInsideRoot(root, "../evil"))
    assert.throws(() => resolveInsideRoot(root, "..//..//etc/passwd"))
  })

  it("rejects an absolute path outside root", () => {
    assert.throws(() => resolveInsideRoot(root, path.resolve(os.tmpdir(), "other-dir/file")))
    if (process.platform === "win32") {
      assert.throws(() => resolveInsideRoot(root, "C:/Windows/System32/cmd.exe"))
    } else {
      assert.throws(() => resolveInsideRoot(root, "/etc/passwd"))
    }
  })

  it("accepts empty / undefined `rel` — returns root itself", () => {
    assert.equal(resolveInsideRoot(root, undefined), path.resolve(root))
    assert.equal(resolveInsideRoot(root, ""), path.resolve(root))
  })

  it("rejects sibling that shares a prefix with root", () => {
    // path.relative correctly handles /tmp/sato-jail-test vs
    // /tmp/sato-jail-test-evil — the latter is outside even though
    // startsWith(root) would say it isn't.
    const evil = root + "-evil/notes.md"
    assert.throws(() => resolveInsideRoot(root, evil))
  })
})

import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression driver for focus cleanup on remove/destroy/focusable changes.
// Runs in a Node child process with FFI enabled because the renderer needs
// native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("removing or destroying a focused renderable clears focus and ancestor flags", () => {
  runDriver(`
import assert from "node:assert/strict"
import { BoxRenderable, RenderableEvents } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, useKittyKeyboard: null })
const { renderer } = setup
try {
  {
    const parent = new BoxRenderable(renderer, { id: "p1", width: 20, height: 6 })
    const child = new BoxRenderable(renderer, { id: "c1", width: 10, height: 2, focusable: true })
    renderer.root.add(parent)
    parent.add(child)
    child.focus()
    assert.equal(renderer.currentFocusedRenderable, child)
    assert.equal(parent.hasFocusedDescendant, true)
    child.destroy()
    assert.equal(child.focused, false)
    assert.equal(renderer.currentFocusedRenderable, null)
    assert.equal(parent.hasFocusedDescendant, false)
  }
  {
    const parent = new BoxRenderable(renderer, { id: "p2", width: 20, height: 6 })
    const child = new BoxRenderable(renderer, { id: "c2", width: 10, height: 2, focusable: true })
    renderer.root.add(parent)
    parent.add(child)
    child.focus()
    parent.remove(child.id)
    assert.equal(child.focused, false)
    assert.equal(renderer.currentFocusedRenderable, null)
    assert.equal(parent.hasFocusedDescendant, false)
  }
  {
    const gp = new BoxRenderable(renderer, { id: "gp", width: 30, height: 10 })
    const parent = new BoxRenderable(renderer, { id: "p3", width: 20, height: 6 })
    const child = new BoxRenderable(renderer, { id: "c3", width: 10, height: 2, focusable: true })
    renderer.root.add(gp)
    gp.add(parent)
    parent.add(child)
    child.focus()
    assert.equal(gp.hasFocusedDescendant, true)
    parent.remove(child.id)
    assert.equal(parent.hasFocusedDescendant, false)
    assert.equal(gp.hasFocusedDescendant, false)
  }
  {
    const parent = new BoxRenderable(renderer, { id: "p4", width: 20, height: 6 })
    const child = new BoxRenderable(renderer, { id: "c4", width: 10, height: 2, focusable: true })
    renderer.root.add(parent)
    parent.add(child)
    let blurred = 0
    child.on(RenderableEvents.BLURRED, () => {
      blurred += 1
    })
    child.focus()
    child.focusable = false
    assert.equal(child.focused, false)
    assert.equal(renderer.currentFocusedRenderable, null)
    assert.equal(parent.hasFocusedDescendant, false)
    assert.equal(blurred, 1)
  }
} finally {
  renderer.destroy()
}
console.log("renderable-focus ok")
`)
})

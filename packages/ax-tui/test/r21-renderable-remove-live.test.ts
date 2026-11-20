import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression drivers for live-count accounting when a removal callback
// reparents live renderables out of the subtree being removed. Runs in a Node
// child process with FFI enabled because the renderer needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("blur-listener reparent of a live descendant keeps ancestor live counts", () => {
  runDriver(`
import assert from "node:assert/strict"
import { BoxRenderable, RenderableEvents } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, useKittyKeyboard: null })
const { renderer } = setup
try {
  const parent = new BoxRenderable(renderer, { id: "p", width: 20, height: 8 })
  const box = new BoxRenderable(renderer, { id: "b", width: 16, height: 6 })
  const live = new BoxRenderable(renderer, { id: "live", width: 12, height: 4, focusable: true, live: true })
  renderer.root.add(parent)
  parent.add(box)
  box.add(live)
  live.focus()
  assert.equal(parent.liveCount, 1)
  assert.equal(renderer.root.liveCount, 1)
  live.on(RenderableEvents.BLURRED, () => {
    parent.add(live)
  })
  parent.remove(box.id)
  assert.equal(live.parent, parent)
  assert.equal(live.focused, false)
  assert.equal(box.parent, null)
  assert.equal(box.liveCount, 0)
  assert.equal(parent.liveCount, 1)
  assert.equal(renderer.root.liveCount, 1)
  parent.remove(live.id)
  assert.equal(parent.liveCount, 0)
  assert.equal(renderer.root.liveCount, 0)
} finally {
  renderer.destroy()
}
console.log("renderable-remove-reparent-descendant ok")
`)
})

test.skipIf(!supportsFfi)("blur-listener reparent of the removed renderable keeps its new parent", () => {
  runDriver(`
import assert from "node:assert/strict"
import { BoxRenderable, RenderableEvents } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, useKittyKeyboard: null })
const { renderer } = setup
try {
  const parent = new BoxRenderable(renderer, { id: "p", width: 20, height: 8 })
  const rescue = new BoxRenderable(renderer, { id: "r", width: 20, height: 8 })
  const box = new BoxRenderable(renderer, { id: "b", width: 16, height: 6, focusable: true, live: true })
  renderer.root.add(parent)
  renderer.root.add(rescue)
  parent.add(box)
  box.focus()
  assert.equal(parent.liveCount, 1)
  assert.equal(rescue.liveCount, 0)
  assert.equal(renderer.root.liveCount, 1)
  box.on(RenderableEvents.BLURRED, () => {
    rescue.add(box)
  })
  parent.remove(box.id)
  assert.equal(box.parent, rescue)
  assert.equal(box.liveCount, 1)
  assert.equal(rescue.liveCount, 1)
  assert.equal(parent.liveCount, 0)
  assert.equal(renderer.root.liveCount, 1)
  rescue.remove(box.id)
  assert.equal(rescue.liveCount, 0)
  assert.equal(renderer.root.liveCount, 0)
} finally {
  renderer.destroy()
}
console.log("renderable-remove-reparent-self ok")
`)
})

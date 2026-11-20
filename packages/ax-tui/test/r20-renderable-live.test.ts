import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression drivers for live-count propagation and focus cleanup when hiding
// ancestors. Runs in a Node child process with FFI enabled because the renderer
// needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("re-entrant remove from a blur listener decrements live counts once", () => {
  runDriver(`
import assert from "node:assert/strict"
import { BoxRenderable, RenderableEvents } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, useKittyKeyboard: null })
const { renderer } = setup
try {
  const parent = new BoxRenderable(renderer, { id: "p", width: 20, height: 8 })
  const live = new BoxRenderable(renderer, { id: "live", width: 16, height: 4, live: true })
  const child = new BoxRenderable(renderer, { id: "c", width: 10, height: 2, focusable: true })
  renderer.root.add(parent)
  parent.add(live)
  live.add(child)
  child.focus()
  assert.equal(parent.liveCount, 1)
  assert.equal(renderer.root.liveCount, 1)
  child.on(RenderableEvents.BLURRED, () => {
    parent.remove(live.id)
  })
  parent.remove(live.id)
  assert.equal(child.focused, false)
  assert.equal(renderer.currentFocusedRenderable, null)
  assert.equal(parent.liveCount, 0)
  assert.equal(renderer.root.liveCount, 0)
  const other = new BoxRenderable(renderer, { id: "other", width: 16, height: 4, live: true })
  parent.add(other)
  assert.equal(renderer.root.liveCount, 1)
} finally {
  renderer.destroy()
}
console.log("renderable-live-reentrant ok")
`)
})

test.skipIf(!supportsFfi)("hiding an ancestor blocks input to the focused descendant without stealing focus", () => {
  runDriver(`
import assert from "node:assert/strict"
import { BoxRenderable, InputRenderable, KeyEvent } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, useKittyKeyboard: null })
const { renderer } = setup
const send = (name) => {
  const event = new KeyEvent({ name, ctrl: false, meta: false, shift: false, option: false,
    sequence: name, raw: name, number: false, eventType: "press", source: "raw" })
  renderer.keyInput.emit("keypress", event)
}
try {
  const panel = new BoxRenderable(renderer, { id: "panel", width: 20, height: 6 })
  const editor = new InputRenderable(renderer, { id: "editor", width: 16, height: 3 })
  const sibling = new BoxRenderable(renderer, { id: "sibling", width: 20, height: 4 })
  renderer.root.add(panel)
  renderer.root.add(sibling)
  panel.add(editor)
  editor.focus()
  send("a")
  assert.equal(editor.value, "a")
  sibling.visible = false
  send("b")
  assert.equal(editor.value, "ab")
  panel.visible = false
  assert.equal(editor.focused, true)
  assert.equal(renderer.currentFocusedRenderable, editor)
  send("c")
  assert.equal(editor.value, "ab")
  renderer.keyInput.processPaste(new TextEncoder().encode("paste"))
  assert.equal(editor.value, "ab")
  panel.visible = true
  send("d")
  assert.equal(editor.value, "abd")
} finally {
  renderer.destroy()
}
console.log("renderable-hidden-input ok")
`)
})

test.skipIf(!supportsFfi)("adding a live renderable while idle never renders it before layout", () => {
  runDriver(`
import assert from "node:assert/strict"
import { BoxRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, useKittyKeyboard: null })
const { renderer } = setup
const bad = []
const origAddToHitGrid = renderer.addToHitGrid.bind(renderer)
renderer.addToHitGrid = (x, y, w, h, id) => {
  if ([x, y, w, h].some((v) => !Number.isInteger(v) || v < 0)) {
    bad.push({ x, y, w, h, id })
    return
  }
  return origAddToHitGrid(x, y, w, h, id)
}
try {
  const parent = new BoxRenderable(renderer, { id: "p", width: 20, height: 8 })
  renderer.root.add(parent)
  const first = new BoxRenderable(renderer, { id: "d", width: 16, height: 4, live: true })
  parent.add(first)
  await setup.renderOnce()
  parent.remove(first.id)
  const second = new BoxRenderable(renderer, { id: "o", width: 16, height: 4, live: true })
  parent.add(second)
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.deepEqual(bad, [])
  assert.equal(renderer.root.liveCount, 1)
} finally {
  renderer.destroy()
}
console.log("renderable-live-attach ok")
`)
})
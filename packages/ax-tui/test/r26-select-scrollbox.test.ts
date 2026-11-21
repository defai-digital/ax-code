import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression drivers for Select fractional-index normalization + no-change
// event suppression, ScrollBox auto-scroll live ownership, and Image onError
// error masking. Runs in a Node child process with FFI enabled because the
// renderer needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("scroll boxes listen for selection changes only during auto-scroll", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { CliRenderEvents, ScrollBoxRenderable, TextRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 30, height: 10 })
const { renderer } = setup
const event = CliRenderEvents.SELECTION
const baseline = renderer.listenerCount(event)
try {
  const boxes = Array.from({ length: 12 }, (_, index) =>
    new ScrollBoxRenderable(renderer, { width: 20, height: 8, visible: index === 0 }))
  for (const box of boxes) renderer.root.add(box)
  assert.equal(renderer.listenerCount(event), baseline)

  const [box] = boxes
  box.add(new TextRenderable(renderer, { content: "line\\n".repeat(20) }))
  await setup.renderOnce()
  assert.ok(box.scrollHeight > box.viewport.height)
  const x = box.x + 8
  const y = box.y + box.height - 1
  box.startAutoScroll(x, y)
  assert.equal(renderer.listenerCount(event), baseline + 1)
  renderer.emit(event)
  assert.equal(box.live, false)
  assert.equal(renderer.listenerCount(event), baseline)

  box.startAutoScroll(x, y)
  box.destroyRecursively()
  assert.equal(renderer.listenerCount(event), baseline)
} finally {
  renderer.destroy()
}
`)
})

test.skipIf(!supportsFfi)("clearing a drag selection stops scroll box auto-scroll", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { CliRenderEvents, ScrollBoxRenderable, TextRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 30, height: 10 })
const { renderer } = setup
try {
  const box = new ScrollBoxRenderable(renderer, { width: 20, height: 8 })
  const text = new TextRenderable(renderer, { content: "line\\n".repeat(20) })
  box.add(text)
  renderer.root.add(box)
  await setup.renderOnce()
  assert.ok(box.scrollHeight > box.viewport.height)
  const baseline = renderer.listenerCount(CliRenderEvents.SELECTION)
  const x = box.x + 8
  const y = box.y + box.height - 1
  renderer.startSelection(text, text.x, text.y)
  assert.equal(renderer.getSelection()?.isDragging, true)
  box.updateAutoScroll(x, y)
  assert.equal(box.live, true)

  renderer.clearSelection()
  await setup.renderOnce()
  assert.equal(box.live, false)
  assert.equal(renderer.listenerCount(CliRenderEvents.SELECTION), baseline)
} finally {
  renderer.destroy()
}
`)
})

test.skipIf(!supportsFfi)("select normalizes fractional indexes and stops emitting on no-change moves", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { ImageRenderable, ScrollBoxRenderable, SelectRenderable, SelectRenderableEvents } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 30, height: 10, useKittyKeyboard: null })
const { renderer } = setup
try {
  const options = [
    { name: "A", description: "first" },
    { name: "B", description: "second" },
    { name: "C", description: "third" },
  ]
  const select = new SelectRenderable(renderer, { width: 10, height: 4, options, selectedIndex: 1.5 })
  renderer.root.add(select)
  assert.equal(select.getSelectedIndex(), 2, "fractional selectedIndex must round to a usable index")
  assert.equal(select.getSelectedOption()?.name, "C")
  let events = 0
  select.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
    events += 1
  })
  select.setSelectedIndex(2)
  assert.equal(events, 0, "re-selecting the current index must not emit")
  select.moveDown()
  assert.equal(events, 0, "a clamped boundary move must not emit")
  select.moveUp(0.5)
  assert.equal(events, 1, "fractional steps round and a real move emits once")
  assert.equal(select.getSelectedIndex(), 1)
  select.selectedIndex = 0.6
  assert.equal(select.getSelectedIndex(), 1, "the silent setter rounds to the current index without moving")

  const box = new ScrollBoxRenderable(renderer, { width: 10, height: 4 })
  renderer.root.add(box)
  box.live = true
  box.startAutoScroll(0, 0)
  box.stopAutoScroll()
  assert.equal(box.live, true, "an app-requested live state must survive auto-scroll")
  const auto = new ScrollBoxRenderable(renderer, { width: 10, height: 4 })
  renderer.root.add(auto)
  auto.startAutoScroll(0, 0)
  auto.stopAutoScroll()
  assert.equal(auto.live, false, "auto-scroll-owned live clears on stop")

  let rejected
  const image = new ImageRenderable(renderer, {
    width: 2,
    height: 2,
    source: Uint8Array.from([1, 2, 3]),
    protocol: "blocks",
    onError: () => {
      throw new Error("handler boom")
    },
  })
  renderer.root.add(image)
  await image.loadPromise.catch((err) => {
    rejected = err
  })
  assert.ok(rejected instanceof Error)
  assert.ok(!/handler boom/.test(String(rejected.message)), "a throwing onError must not mask the load error: " + rejected.message)
  assert.ok(image.loadError, "loadError must hold the decode failure")
} finally {
  renderer.destroy()
}
console.log("r26-select-scrollbox-image ok")
`)
})

test.skipIf(!supportsFfi)("select rejects NaN steps and spacing, and setSelectedIndex clamps like the constructor", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { LineNumberRenderable, SelectRenderable, SelectRenderableEvents } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 30, height: 10, useKittyKeyboard: null })
const { renderer } = setup
try {
  const options = [
    { name: "A", description: "first" },
    { name: "B", description: "second" },
    { name: "C", description: "third" },
  ]
  const select = new SelectRenderable(renderer, { width: 10, height: 4, options, selectedIndex: 2 })
  renderer.root.add(select)
  let events = 0
  select.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
    events += 1
  })
  select.moveUp(NaN)
  assert.equal(select.getSelectedIndex(), 2, "NaN steps must not move the selection")
  assert.equal(events, 0, "NaN steps must not emit")
  select.moveDown(Number.NaN)
  assert.equal(select.getSelectedIndex(), 2)
  assert.equal(events, 0)
  select.fastScrollStep = NaN
  assert.ok(Number.isFinite(select["_fastScrollStep"]), "NaN fastScrollStep falls back to the default")
  select.itemSpacing = NaN
  assert.ok(Number.isFinite(select["_itemSpacing"]), "NaN itemSpacing falls back to the default")
  assert.ok(Number.isFinite(select.maxVisibleItems), "visible-item math stays finite")
  select.setSelectedIndex(0.6)
  assert.equal(select.getSelectedIndex(), 1, "setSelectedIndex rounds like the other entry points")
  select.setSelectedIndex(2.5)
  assert.equal(select.getSelectedIndex(), 2, "setSelectedIndex clamps near-end fractionals like the constructor")
} finally {
  renderer.destroy()
}
console.log("r27-select-linenumber ok")
`)
})

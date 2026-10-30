import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

function scenario(source: string): void {
  const result = spawnSync(process.execPath, ["--experimental-ffi", "--disable-warning=ExperimentalWarning",
    "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { VirtualListRenderable, TextRenderable, InputRenderable, Renderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, useKittyKeyboard: null })
const { renderer } = setup
const settle = async () => {
  for (let pass = 0; pass < 8; pass++) { await setup.renderOnce(); await new Promise(r => setImmediate(r)) }
}
try { ${source} } finally { renderer.destroy() }
assert.equal(Renderable.renderablesByNumber.size, 0)
process.stdout.write("AX_SCENARIO_COMPLETE")
`], { encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expect(result.stdout, result.stderr).toContain("AX_SCENARIO_COMPLETE")
}

test.skipIf(!supportsFfi)("virtual list renders 10000 rows with bounded mounting and no lifecycle leaks", () => {
  scenario(`
let mounts = 0
const list = new VirtualListRenderable(renderer, {
  id: "list", width: 40, height: 10, items: Array.from({ length: 10000 }, (_, i) => i), getKey: x => x,
  renderItem: (x, i, ctx) => { mounts++; return new TextRenderable(ctx, { content: "Row " + x }) },
})
renderer.root.add(list)
await settle()
assert.ok(setup.captureCharFrame().includes("Row 0"))
assert.ok(list.mountedCount <= 16)
assert.ok(mounts <= 20)
for (const index of [5000, 20, 9999, 0, 7000]) {
  list.scrollToIndex(index)
  await settle()
  assert.ok(setup.captureCharFrame().includes("Row " + index))
  assert.ok(list.mountedCount <= 16)
}
assert.ok(Renderable.renderablesByNumber.size < 50)
list.scrollToIndex(300)
list.scrollBy(10)
await settle()
assert.equal(list.scrollTop, 310, "manual scrolling must cancel an unsettled jump")
list.scrollToIndex(100); await settle()
list.focus()
setup.mockInput.pressArrow("down"); await settle()
assert.ok(list.scrollTop > 100)
const beforeWheel = list.scrollTop
await setup.mockMouse.scroll(2, 2, "down"); await settle()
assert.ok(list.scrollTop > beforeWheel)
assert.ok(list.mountedCount <= 16)
list.items = []
await settle()
assert.equal(list.mountedCount, 0)
assert.equal(list.scrollTop, 0)
assert.equal(list.totalHeight, 0)
assert.ok(!setup.captureCharFrame().includes("Row"))
`)
})

test.skipIf(!supportsFfi)("variable-height rows retain the visible anchor across prepend, resize and streaming updates", () => {
  scenario(`
const items = Array.from({ length: 100 }, (_, i) => ({ id: i, text: "Item " + i + " " + "wide-text ".repeat(i % 4) }))
const list = new VirtualListRenderable(renderer, {
  id: "list", width: "100%", height: 10, items, getKey: x => x.id, estimateHeight: 2,
  renderItem: (x, i, ctx) => new TextRenderable(ctx, { content: x.text, width: "100%", wrapMode: "word" }),
})
renderer.root.add(list)
await settle()
list.scrollToIndex(50)
await settle()
assert.ok(setup.captureCharFrame().split("\\n")[0].includes("Item 50"))
list.items = [{ id: -1, text: "prepended" }, ...items]
await settle()
assert.ok(setup.captureCharFrame().split("\\n")[0].includes("Item 50"))
setup.resize(20, 12)
await settle()
assert.ok(setup.captureCharFrame().split("\\n")[0].includes("Item 50"))
const top = list.scrollTop
await settle()
assert.equal(list.scrollTop, top, "measurements must converge without scroll oscillation")
list.items = list.items.map(x => x.id === 99 ? { ...x, text: x.text + " streaming tail" } : x)
await settle()
assert.equal(list.scrollTop, top, "streaming below the viewport must not move its anchor")
list.items = list.items.filter(x => x.id !== 50)
await settle()
assert.ok(setup.captureCharFrame().includes("Item 51"))
`)
})

test.skipIf(!supportsFfi)("focused virtual rows stay alive offscreen and release focus when removed", () => {
  scenario(`
const editors = new Map()
const list = new VirtualListRenderable(renderer, {
  id: "list", width: 30, height: 6, items: Array.from({ length: 100 }, (_, i) => i), getKey: x => x,
  renderItem: (x, i, ctx) => {
    const editor = new InputRenderable(ctx, { value: "Item " + x, width: "100%" })
    editors.set(x, editor); return editor
  },
})
renderer.root.add(list); await settle()
const first = editors.get(0); first.focus()
list.scrollToIndex(80); await settle()
assert.equal(first.isDestroyed, false)
assert.equal(renderer.currentFocusedRenderable, first)
assert.ok(list.mountedCount <= 13)
list.items = list.items.filter(x => x !== 0); await settle()
assert.equal(first.isDestroyed, true)
assert.equal(renderer.currentFocusedRenderable, list)
`)
})

test.skipIf(!supportsFfi)("on-demand rendering paints rows mounted after a frame without manual render passes", () => {
  scenario(`
const idle = async () => {
  for (let pass = 0; pass < 3; pass++) {
    await new Promise(resolve => setImmediate(resolve))
    await renderer.idle()
  }
}
const list = new VirtualListRenderable(renderer, {
  width: 40, height: 10, items: Array.from({ length: 500 }, (_, i) => i), getKey: x => x,
  renderItem: (x, i, ctx) => new TextRenderable(ctx, { content: "Row " + x }),
})
renderer.root.add(list)
await idle()
assert.ok(setup.captureCharFrame().includes("Row 0"), "initial rows must paint without renderOnce")
list.scrollToIndex(200)
await idle()
assert.ok(setup.captureCharFrame().includes("Row 200"))
list.scrollBy(-30)
await idle()
assert.ok(setup.captureCharFrame().includes("Row 170"), "scroll-mounted rows must paint without renderOnce")
const frame = renderer.frameId
await idle()
assert.equal(renderer.frameId, frame, "settled list must stop scheduling frames")
`)
})

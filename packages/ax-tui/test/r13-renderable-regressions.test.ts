import { spawnSync } from "node:child_process"
import { Buffer } from "node:buffer"
import { expect, test } from "vitest"
import { parseKeypress } from "../src/lib/parse.keypress.js"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression drivers for r13 lifecycle/input fixes. Each scenario runs in a
// Node child process with FFI enabled because the renderer needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

const PREAMBLE = `
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { FrameBufferRenderable, Renderable, RGBA, SlotRenderable, TextRenderable, createCoreSlotRegistry, registerCorePlugin } from "@defai-digital/ax-tui"
const NL = String.fromCharCode(10)
`

test("parseKeypress does not mutate the caller's buffer for high-bit single bytes", () => {
  const buf = Buffer.from([0xc1])
  const first = parseKeypress(buf)
  const second = parseKeypress(buf)
  expect(first).not.toBeNull()
  expect(second).toEqual(first)
  expect(buf[0]).toBe(0xc1)
})

test.skipIf(!supportsFfi)("coalesced same-id unregister and re-register swaps the slot content", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const registry = createCoreSlotRegistry(setup.renderer, {})
  const calls = []
  let v1Node
  let v2Node
  const makePlugin = (label) => ({
    id: "p",
    slots: {
      probe: {
        render: () => {
          const node = new TextRenderable(setup.renderer, { content: label })
          if (label === "v1") v1Node = node
          else v2Node = node
          return node
        },
        onActivate: () => calls.push("activate:" + label),
        onDeactivate: () => calls.push("deactivate:" + label),
        onDispose: () => calls.push("dispose:" + label),
      },
    },
  })
  const unregister1 = registerCorePlugin(registry, makePlugin("v1"))
  const slot = new SlotRenderable(setup.renderer, { registry, name: "probe", mode: "append" })
  setup.renderer.root.add(slot)
  assert.deepEqual(calls, ["activate:v1"])

  registry.batch(() => {
    unregister1()
    registerCorePlugin(registry, makePlugin("v2"))
  })
  assert.deepEqual(calls, ["activate:v1", "deactivate:v1", "dispose:v1", "activate:v2"])
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  assert.ok(frame.includes("v2"), frame)
  assert.ok(!frame.includes("v1"), frame)
  assert.equal(v1Node.parent, null)
  assert.equal(v1Node.isDestroyed, false, "plugin-owned node lifecycle belongs to the plugin")
  v1Node.destroy()
  v2Node.destroy()
} finally {
  setup.renderer.destroy()
}
console.log("slot-same-id-swap ok")
`)
})

function scenario(source: string): void {
  const result = spawnSync(process.execPath, ["--experimental-ffi", "--disable-warning=ExperimentalWarning",
    "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { VirtualListRenderable, TextRenderable, Renderable } from "@defai-digital/ax-tui"
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

test.skipIf(!supportsFfi)("seek to the last row survives a setItems before the first layout", () => {
  scenario(`
const items = Array.from({ length: 100 }, (_, i) => i)
const list = new VirtualListRenderable(renderer, {
  id: "list", width: 40, height: 10, items, getKey: x => x,
  estimateHeight: 1,
  renderItem: (x, i, ctx) => new TextRenderable(ctx, { content: "Row " + x + "\\nline2\\nline3" }),
})
renderer.root.add(list)
list.scrollToIndex(99, "end")
list.setItems(items.slice(50))
await settle()
assert.ok(setup.captureCharFrame().includes("Row 99"), setup.captureCharFrame())
`)
})

test.skipIf(!supportsFfi)("invalid constructor dimensions do not leak renderable registrations", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const before = Renderable.renderablesByNumber.size
  assert.throws(() => new FrameBufferRenderable(setup.renderer, { width: 0, height: 10 }), RangeError)
  assert.throws(() => new FrameBufferRenderable(setup.renderer, { width: 10.5, height: 10 }), RangeError)
  assert.throws(() => new TextRenderable(setup.renderer, { content: "x", width: -5 }), /Invalid width/)
  assert.equal(Renderable.renderablesByNumber.size, before)
} finally {
  setup.renderer.destroy()
}
console.log("ctor-dimension-leak ok")
`)
})

test.skipIf(!supportsFfi)("buffered FrameBufferRenderable renders its own buffer without self-blit drift", () => {
  runDriver(`
${PREAMBLE}
const setup = await createTestRenderer({ width: 20, height: 5 })
try {
  const fb = new FrameBufferRenderable(setup.renderer, { width: 6, height: 3, left: 2, top: 1, buffered: true })
  setup.renderer.root.add(fb)
  fb.frameBuffer.drawText("X", 0, 0, RGBA.fromInts(255, 255, 255, 255))
  const countX = (s) => s.split("X").length - 1
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  const lines = frame.split(NL)
  assert.equal(lines[1][2], "X", frame)
  assert.equal(countX(frame), 1, "self-blit must not duplicate the buffer content: " + frame)
  await setup.renderOnce()
  const frame2 = setup.captureCharFrame()
  const lines2 = frame2.split(NL)
  assert.equal(lines2[1][2], "X", frame2)
  assert.equal(countX(frame2), 1, "self-blit drift must not accumulate: " + frame2)
  fb.destroy()
} finally {
  setup.renderer.destroy()
}
console.log("framebuffer-buffered-self-blit ok")
`)
})

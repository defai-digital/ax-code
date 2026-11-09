import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

test("Yoga layout reads reuse output storage and return independent values across nodes and GC", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "--expose-gc",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { resolveRenderLib, TextBuffer, Yoga } from "@defai-digital/ax-tui"
const lib = resolveRenderLib()
const config = Yoga.Config.create()
config.setPointScaleFactor(0)
const first = Yoga.Node.create(config)
const second = Yoga.Node.create(config)
const text = TextBuffer.create("unicode")
const addresses = new Set()
const original = lib.native.symbols.yogaNodeGetComputedLayout
lib.native.symbols.yogaNodeGetComputedLayout = (node, output) => {
  addresses.add(output)
  return original(node, output)
}
try {
  first.setWidth(120.25); first.setHeight(40.5)
  second.setWidth(80.75); second.setHeight(24.25)
  first.calculateLayout(120.25, 40.5, Yoga.Direction.LTR)
  second.calculateLayout(80.75, 24.25, Yoga.Direction.LTR)
  const before = first.getComputedLayout()
  const other = second.getComputedLayout()
  assert.deepEqual(before, { left: 0, top: 0, right: 0, bottom: 0, width: 120.25, height: 40.5 })
  assert.deepEqual(other, { left: 0, top: 0, right: 0, bottom: 0, width: 80.75, height: 24.25 })
  assert.notEqual(before, other)
  first.setWidth(160.5)
  first.calculateLayout(160.5, 40.5, Yoga.Direction.LTR)
  assert.equal(first.getComputedLayout().width, 160.5)
  assert.equal(before.width, 120.25, "A later read changed the retained snapshot")
  before.left = -100
  assert.equal(first.getComputedLayout().left, 0, "A returned snapshot mutated the shared output")
  // Move temporary pointer owners through the FFI pin ring before forcing GC.
  // The cached layout address must remain backed by the library's own array.
  text.setText("GC pressure")
  for (let index = 0; index < 2048; index++) assert.equal(text.getPlainText(), "GC pressure")
  globalThis.gc()
  assert.deepEqual(second.getComputedLayout(), other)
  assert.equal(addresses.size, 1, "Layout reads allocated fresh native output storage")
} finally {
  lib.native.symbols.yogaNodeGetComputedLayout = original
  text.destroy()
  first.free(); second.free(); config.free()
}
process.stdout.write("AX_YOGA_LAYOUT_COMPLETE")
`,
    ],
    {
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" },
    },
  )
  expect(child.error, child.stderr).toBeUndefined()
  expect(child.status, child.stdout + child.stderr).toBe(0)
  expect(child.stdout).toContain("AX_YOGA_LAYOUT_COMPLETE")
})

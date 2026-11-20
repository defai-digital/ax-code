import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression driver for stale drag-release state: an outside release ends the
// drag, and a later unrelated release inside the console must not move the
// selection. Runs in a Node child process with FFI enabled because the renderer
// needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("an unrelated release after an outside release does not move the selection", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { MouseEvent } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({
  width: 30,
  height: 10,
  consoleMode: "console-overlay",
  consoleOptions: { maxDisplayLines: 6, sizePercent: 50 },
})
const cons = setup.renderer.console
const mouse = (type, x, y) =>
  new MouseEvent(null, { type, button: 0, x, y, modifiers: { shift: false, alt: false, ctrl: false } })
try {
  cons.show()
  for (let i = 0; i <= 5; i++) console.log("L" + i)
  await setup.renderOnce()
  cons.handleMouse(mouse("down", 1, 6))
  cons.handleMouse(mouse("drag", 2, 7))
  assert.equal(cons["_isDragging"], true)
  const end = { ...cons["_selectionEnd"] }
  setup.renderer["processSingleMouseEvent"]({
    type: "up",
    button: 0,
    x: 0,
    y: 0,
    modifiers: { shift: false, alt: false, ctrl: false },
  })
  assert.equal(cons["_isDragging"], false)
  setup.renderer["processSingleMouseEvent"]({
    type: "up",
    button: 2,
    x: 20,
    y: 8,
    modifiers: { shift: false, alt: false, ctrl: false },
  })
  assert.deepEqual(cons["_selectionEnd"], end)
} finally {
  cons.deactivate()
  setup.renderer.destroy()
}
console.log("console-mouse-up-stale ok")
`)
})
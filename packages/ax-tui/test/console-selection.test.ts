import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression drivers for console selection fixes. Each scenario runs in a Node
// child process with FFI enabled because the renderer needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("console selection follows trimmed logs instead of drifting onto newer lines", () => {
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
  const copied = []
  cons.onCopySelection = (text) => copied.push(text)
  cons.show()
  for (let i = 0; i <= 5; i++) console.log("L" + i)
  await setup.renderOnce()
  const linesBefore = cons["_displayLines"].map((line) => line.text)
  assert.equal(linesBefore.length, 6)

  cons.handleMouse(mouse("down", 1, 6))
  cons.handleMouse(mouse("drag", 29, 7))
  cons.handleMouse(mouse("up", 29, 7))

  console.log("L6")
  console.log("L7")
  console.log("L8")
  await setup.renderOnce()
  cons["triggerCopy"]()
  assert.equal(copied.length, 1)
  assert.equal(copied[0], linesBefore[3])

  cons.handleMouse(mouse("down", 1, 6))
  cons.handleMouse(mouse("drag", 29, 7))
  cons.handleMouse(mouse("up", 29, 7))
  for (let i = 9; i <= 14; i++) console.log("L" + i)
  await setup.renderOnce()
  cons["triggerCopy"]()
  assert.equal(copied.length, 1)
} finally {
  cons.deactivate()
  setup.renderer.destroy()
}
console.log("console-selection-trim ok")
`)
})

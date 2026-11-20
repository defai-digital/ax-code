import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression driver for selection column mapping around zero-width combining
// marks. Runs in a Node child process with FFI enabled because the renderer
// needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

const setupSource = `
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { MouseEvent } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({
  width: 30,
  height: 10,
  consoleMode: "console-overlay",
  consoleOptions: { maxDisplayLines: 20, sizePercent: 100 },
})
const cons = setup.renderer.console
const mouse = (type, x, y) =>
  new MouseEvent(null, { type, button: 0, x, y, modifiers: { shift: false, alt: false, ctrl: false } })
cons.show()
`

test.skipIf(!supportsFfi)("console selection keeps trailing combining marks with their base glyph", () => {
  runDriver(`${setupSource}
try {
  const copied = []
  cons.onCopySelection = (text) => copied.push(text)
  const err = new Error("boom")
  err.stack = "Error: boom\\ne\\u0301x"
  console.log(err)
  await setup.renderOnce()
  const lines = cons["_displayLines"]
  assert.equal(lines[2].text, "e\\u0301x")
  cons.handleMouse(mouse("down", 3, 3))
  cons.handleMouse(mouse("drag", 4, 3))
  cons.handleMouse(mouse("up", 4, 3))
  cons["triggerCopy"]()
  assert.equal(copied.length, 1)
  assert.equal(copied[0], "e\\u0301")
  cons.handleMouse(mouse("down", 4, 3))
  cons.handleMouse(mouse("drag", 5, 3))
  cons.handleMouse(mouse("up", 5, 3))
  cons["triggerCopy"]()
  assert.equal(copied.length, 2)
  assert.equal(copied[1], "x")
} finally {
  cons.deactivate()
  setup.renderer.destroy()
}
console.log("console-combining-copy ok")
`)
})
import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression drivers for console display-width wrapping and selection. Each
// scenario runs in a Node child process with FFI enabled because the renderer
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

test.skipIf(!supportsFfi)("console wraps wide glyphs by display width and keeps blank continuation lines", () => {
  runDriver(`${setupSource}
try {
  const err = new Error("boom")
  err.stack = "Error: boom\\n" + "あ".repeat(14)
  console.log(err)
  await setup.renderOnce()
  const lines = cons["_displayLines"]
  assert.equal(lines.length, 5)
  assert.ok(lines[0].text.endsWith("Error: boom"))
  assert.equal(lines[2].text, "あ".repeat(13))
  assert.equal(lines[3].text, "あ")
  assert.equal(lines[4].text, "")
} finally {
  cons.deactivate()
  setup.renderer.destroy()
}
console.log("console-width-wrap ok")
`)
})

test.skipIf(!supportsFfi)("console selection copies whole wide glyphs instead of half a column", () => {
  runDriver(`${setupSource}
try {
  const copied = []
  cons.onCopySelection = (text) => copied.push(text)
  const err = new Error("boom")
  err.stack = "Error: boom\\nあいうえお"
  console.log(err)
  await setup.renderOnce()
  const lines = cons["_displayLines"]
  assert.equal(lines[2].text, "あいうえお")
  assert.equal(lines[2].indent, true)
  cons.handleMouse(mouse("down", 3, 3))
  cons.handleMouse(mouse("drag", 5, 3))
  cons.handleMouse(mouse("up", 5, 3))
  cons["triggerCopy"]()
  assert.equal(copied.length, 1)
  assert.equal(copied[0], "あ")
} finally {
  cons.deactivate()
  setup.renderer.destroy()
}
console.log("console-width-copy ok")
`)
})

test.skipIf(!supportsFfi)("console selection highlight is drawn at the display column of the selected glyph", () => {
  runDriver(`${setupSource}
try {
  const err = new Error("boom")
  err.stack = "Error: boom\\nあいうえお"
  console.log(err)
  await setup.renderOnce()
  const fb = cons["frameBuffer"]
  const original = fb.drawText.bind(fb)
  const calls = []
  fb.drawText = (...args) => {
    calls.push(args)
    return original(...args)
  }
  cons.handleMouse(mouse("down", 3, 3))
  cons.handleMouse(mouse("drag", 5, 3))
  cons.handleMouse(mouse("up", 5, 3))
  await setup.renderOnce()
  const sel = cons["_rgbaSelection"]
  const mid = calls.find((args) => typeof args[0] === "string" && args[4] === sel)
  assert.ok(mid, "selection drawText call missing")
  assert.equal(mid[0], "あ")
  assert.equal(mid[1], 3)
  assert.equal(mid[2], 3)
} finally {
  cons.deactivate()
  setup.renderer.destroy()
}
console.log("console-width-highlight ok")
`)
})

test.skipIf(!supportsFfi)("console keeps empty lines inside multiline error entries", () => {
  runDriver(`${setupSource}
try {
  const err = new Error("boom")
  err.stack = "Error: boom\\n\\nb"
  console.log(err)
  await setup.renderOnce()
  const lines = cons["_displayLines"]
  assert.equal(lines.length, 5)
  assert.equal(lines[2].text, "")
  assert.equal(lines[3].text, "b")
  assert.equal(lines[4].text, "")
} finally {
  cons.deactivate()
  setup.renderer.destroy()
}
console.log("console-blank-continuation ok")
`)
})

import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression driver for console selection over grapheme clusters: column
// offsets must map to whole graphemes, so selecting the cell after a ZWJ
// emoji picks the following character and selecting the emoji picks the whole
// cluster. Runs in a Node child process with FFI enabled because the renderer
// needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("console selection maps columns to whole grapheme clusters", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({
  width: 30,
  height: 10,
  consoleMode: "console-overlay",
  consoleOptions: { maxDisplayLines: 6, sizePercent: 50 },
})
const { renderer } = setup
const cons = renderer.console
const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469)
const send = (type, x, y) =>
  renderer["processSingleMouseEvent"]({ type, button: 0, x, y, modifiers: { shift: false, alt: false, ctrl: false } })
try {
  cons.show()
  console.log("aaa")
  console.log(family + "!")
  console.log("bbb")
  await setup.renderOnce()
  const lines = cons["_displayLines"]
  const lineIndex = lines.findIndex((l) => l.text.includes(family + "!"))
  assert.ok(lineIndex >= 0, "family line missing from display")
  // Log lines carry a fixed-width ASCII prefix, so the UTF-16 index of the
  // family cluster inside the display text is also its terminal column.
  const colOffset = lines[lineIndex].text.indexOf(family)
  const y = cons["consoleY"] + 1 + (lineIndex - cons["scrollTopIndex"])
  const x0 = cons["consoleX"] + 1
  send("down", x0 + colOffset + 2, y)
  send("drag", x0 + colOffset + 3, y)
  send("up", x0 + colOffset + 3, y)
  assert.equal(cons["getSelectedText"](), "!")
  cons["clearSelection"]()
  send("down", x0 + colOffset, y)
  send("drag", x0 + colOffset + 2, y)
  send("up", x0 + colOffset + 2, y)
  assert.equal(cons["getSelectedText"](), family)
} finally {
  cons.deactivate()
  renderer.destroy()
}
console.log("console-grapheme-selection ok")
`)
})

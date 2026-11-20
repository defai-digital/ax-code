import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression drivers for scrollback releases in split-footer mode: footer
// subscribers (the console's global release handler, a captured footer
// control) interpret the release coordinates in the footer's local space, so
// the scrollback branch must hand them a translated copy — otherwise a
// scrollback row whose absolute number lands inside the footer-local console
// rectangle never ends a console drag, and a captured slider commits a value
// computed from the absolute row. Runs in Node child processes with FFI
// enabled because the renderer needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("a scrollback release above the console's footer-local row still ends the console drag", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { MouseEvent, TextRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({
  screenMode: "split-footer",
  externalOutputMode: "capture-stdout",
  width: 24,
  height: 24,
  footerHeight: 12,
  consoleMode: "console-overlay",
  consoleOptions: { maxDisplayLines: 6, sizePercent: 30 },
  useThread: false,
  useKittyKeyboard: null,
  memorySnapshotInterval: 0,
})
const { renderer } = setup
const cons = renderer.console
const mouse = (type, x, y) =>
  new MouseEvent(null, { type, button: 0, x, y, modifiers: { shift: false, alt: false, ctrl: false } })
try {
  cons.show()
  // Grow the scrollback until its row range covers the console's footer-local
  // rectangle, so an absolute scrollback row numerically lands inside it.
  let row = 0
  while (renderer["renderOffset"] <= cons["consoleY"] + 1 && row < 30) {
    renderer.writeToScrollback(({ renderContext }) => ({
      root: new TextRenderable(renderContext, { content: "scroll " + row, width: 14, height: 1 }),
    }))
    await setup.renderOnce()
    row++
  }
  assert.ok(
    renderer["renderOffset"] > cons["consoleY"] + 1,
    "scrollback must cover the console's footer-local rows (renderOffset=" + renderer["renderOffset"] + " consoleY=" + cons["consoleY"] + ")",
  )
  console.log("C0")
  console.log("C1")
  await setup.renderOnce()
  cons.handleMouse(mouse("down", cons["consoleX"] + 1, cons["consoleY"] + 1))
  cons.handleMouse(mouse("drag", cons["consoleX"] + 2, cons["consoleY"] + 1))
  assert.equal(cons["_isDragging"], true)
  const releaseRow = cons["consoleY"] + 1
  assert.ok(releaseRow < renderer["renderOffset"], "release row must be in the scrollback")
  renderer["processSingleMouseEvent"]({
    type: "up",
    button: 0,
    x: 1,
    y: releaseRow,
    modifiers: { shift: false, alt: false, ctrl: false },
  })
  assert.equal(cons["_isDragging"], false)
} finally {
  cons.deactivate()
  renderer.destroy()
}
console.log("scrollback-release-over-console-row ok")
`)
})

test.skipIf(!supportsFfi)("a scrollback release does not move a captured footer slider", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { SliderRenderable, TextRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({
  screenMode: "split-footer",
  externalOutputMode: "capture-stdout",
  width: 24,
  height: 13,
  footerHeight: 8,
  consoleMode: "disabled",
  useThread: false,
  useKittyKeyboard: null,
  memorySnapshotInterval: 0,
})
const { renderer } = setup
const send = (type, x, y) =>
  renderer["processSingleMouseEvent"]({ type, button: 0, x, y, modifiers: { shift: false, alt: false, ctrl: false } })
try {
  const slider = new SliderRenderable(renderer, {
    id: "s",
    orientation: "vertical",
    width: 1,
    height: 8,
    min: 0,
    max: 100,
    value: 0,
  })
  renderer.root.add(slider)
  let row = 0
  while (renderer["renderOffset"] < 5 && row < 20) {
    renderer.writeToScrollback(({ renderContext }) => ({
      root: new TextRenderable(renderContext, { content: "scroll " + row, width: 14, height: 1 }),
    }))
    await setup.renderOnce()
    row++
  }
  assert.ok(renderer["renderOffset"] >= 5, "scrollback must be at least 5 rows (renderOffset=" + renderer["renderOffset"] + ")")
  await setup.renderOnce()
  const offset = renderer["renderOffset"]
  send("down", 0, offset)
  send("drag", 0, offset)
  assert.ok(renderer["capturedRenderable"], "slider drag should be captured")
  const releaseRow = offset - 1
  send("up", 0, releaseRow)
  assert.equal(renderer["capturedRenderable"], undefined)
  assert.equal(slider.value, 0, "release in the scrollback must not commit a footer-local track position")
} finally {
  renderer.destroy()
}
console.log("scrollback-release-slider-value ok")
`)
})

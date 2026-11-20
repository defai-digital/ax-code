import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression drivers for releases that must finalize footer state: a release
// in the split-footer scrollback still has to end a console drag, and a
// release over the console overlay must still release a captured renderable.
// Runs in a Node child process with FFI enabled because the renderer needs
// native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("a scrollback release ends a console drag in split-footer mode", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { MouseEvent, TextRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({
  screenMode: "split-footer",
  externalOutputMode: "capture-stdout",
  width: 24,
  height: 10,
  footerHeight: 8,
  consoleMode: "console-overlay",
  consoleOptions: { maxDisplayLines: 6, sizePercent: 50 },
  useThread: false,
  useKittyKeyboard: null,
  memorySnapshotInterval: 0,
})
const { renderer } = setup
const cons = renderer.console
const mouse = (type, x, y) =>
  new MouseEvent(null, { type, button: 0, x, y, modifiers: { shift: false, alt: false, ctrl: false } })
try {
  renderer.writeToScrollback(({ renderContext }) => ({
    root: new TextRenderable(renderContext, { content: "scrollback row", width: 14, height: 1 }),
  }))
  await setup.renderOnce()
  assert.ok(renderer["renderOffset"] > 0, "scrollback write should push the footer down")
  cons.show()
  console.log("C0")
  console.log("C1")
  await setup.renderOnce()
  cons.handleMouse(mouse("down", cons["consoleX"] + 1, cons["consoleY"] + 2))
  cons.handleMouse(mouse("drag", cons["consoleX"] + 2, cons["consoleY"] + 2))
  assert.equal(cons["_isDragging"], true)
  renderer["processSingleMouseEvent"]({
    type: "up",
    button: 0,
    x: 1,
    y: 0,
    modifiers: { shift: false, alt: false, ctrl: false },
  })
  assert.equal(cons["_isDragging"], false)
} finally {
  cons.deactivate()
  renderer.destroy()
}
console.log("split-scrollback-release ok")
`)
})

test.skipIf(!supportsFfi)("a release over the console overlay releases a captured renderable", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { SliderRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({
  width: 30,
  height: 10,
  consoleMode: "console-overlay",
  consoleOptions: { maxDisplayLines: 6, sizePercent: 50 },
})
const { renderer } = setup
const cons = renderer.console
const send = (type, x, y) =>
  renderer["processSingleMouseEvent"]({ type, button: 0, x, y, modifiers: { shift: false, alt: false, ctrl: false } })
try {
  cons.show()
  console.log("L0")
  const slider = new SliderRenderable(renderer, {
    id: "s",
    orientation: "horizontal",
    width: 20,
    height: 1,
    min: 0,
    max: 100,
    value: 10,
  })
  renderer.root.add(slider)
  await setup.renderOnce()
  send("down", 2, 0)
  send("drag", 5, 0)
  assert.ok(renderer["capturedRenderable"], "slider drag should be captured")
  send("up", cons["consoleX"] + 1, cons["consoleY"] + 1)
  assert.equal(renderer["capturedRenderable"], undefined)
} finally {
  cons.deactivate()
  renderer.destroy()
}
console.log("captured-release-over-console ok")
`)
})

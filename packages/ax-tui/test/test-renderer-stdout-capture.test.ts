import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// capture-stdout must decode byte chunks as text (not comma-joined numbers)
// and a CR at a chunk boundary must still pair with a following LF.
test.skipIf(!supportsFfi)("capture-stdout decodes byte chunks and carries CR across writes", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { Writable } from "node:stream"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"

class CaptureStdout extends Writable {
  constructor() {
    super()
    this.isTTY = true
    this.columns = 80
    this.rows = 24
  }
  _write(chunk, encoding, callback) { callback() }
  getColorDepth() { return 24 }
}

const stdout = new CaptureStdout()
const { renderer, externalOutput } = await createTestRenderer({
  stdout,
  screenMode: "split-footer",
  externalOutputMode: "capture-stdout",
  width: 80,
  height: 24,
  footerHeight: 3,
  consoleMode: "disabled",
  useThread: false,
  useKittyKeyboard: null,
  memorySnapshotInterval: 0,
})
try {
  const rows = () => externalOutput.take().flatMap((commit) => commit.rows)

  // A plain Uint8Array (not a Buffer) must decode as text.
  stdout.write(new Uint8Array([104, 101, 108, 108, 111, 10]))
  assert.deepEqual(rows(), ["hello"])

  // Multibyte UTF-8 must decode with the stream encoding, not byte-wise.
  stdout.write(new Uint8Array([231, 149, 140, 10]))
  assert.deepEqual(rows(), ["界"])

  // CR ends one write, LF starts the next: together they close the row.
  stdout.write("a\\r")
  assert.deepEqual(rows(), [])
  stdout.write("\\nX\\n")
  assert.deepEqual(rows(), ["a", "X"])
} finally {
  renderer.destroy()
}
console.log("stdout capture byte/CR checks passed")
`,
    ],
    { encoding: "utf8", timeout: 60_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})
// destroy() must clear the pending debounced resize so no resize event or
// buffer access happens on a destroyed renderer.
test.skipIf(!supportsFfi)("destroy clears the pending debounced resize", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { CliRenderEvents } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"

const { renderer } = await createTestRenderer({ width: 80, height: 24 })
const events = []
renderer.on(CliRenderEvents.RESIZE, () => events.push("resize"))
renderer.on(CliRenderEvents.DESTROY, () => events.push("destroy"))
renderer.handleResize(100, 30)
assert.notEqual(renderer.pendingResize, null, "no pending resize scheduled")
renderer.destroy()
assert.equal(renderer.pendingResize, null, "pending resize survived destroy")
await new Promise((resolve) => setTimeout(resolve, 150))
assert.ok(!events.includes("resize"), "resize fired after destroy: " + events.join(","))
assert.ok(events.includes("destroy"), "destroy event missing: " + events.join(","))
console.log("pending resize cleared on destroy")
`,
    ],
    { encoding: "utf8", timeout: 60_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

// A captured stdout line wider than the terminal must be skipped, not crash
// the write path with a RangeError from the native buffer.
test.skipIf(!supportsFfi)("capture-stdout skips lines wider than the terminal", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { Writable } from "node:stream"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"

class CaptureStdout extends Writable {
  constructor() {
    super()
    this.isTTY = true
    this.columns = 2
    this.rows = 4
  }
  _write(chunk, encoding, callback) { callback() }
  getColorDepth() { return 24 }
}

const stdout = new CaptureStdout()
const { renderer, externalOutput } = await createTestRenderer({
  stdout,
  screenMode: "split-footer",
  externalOutputMode: "capture-stdout",
  width: 2,
  height: 4,
  footerHeight: 1,
  consoleMode: "disabled",
  useThread: false,
  useKittyKeyboard: null,
  memorySnapshotInterval: 0,
})
try {
  stdout.write("😀😀\\n")
  stdout.write("ok\\n")
  const rows = externalOutput.take().flatMap((commit) => commit.rows)
  assert.ok(rows.includes("ok"), "narrow-terminal write path lost the fitting line: " + JSON.stringify(rows))
} finally {
  renderer.destroy()
}
console.log("wide captured line skipped without crashing")
`,
    ],
    { encoding: "utf8", timeout: 60_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

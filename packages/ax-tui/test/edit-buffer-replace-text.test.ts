import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// replaceText pins a new native text-registry slot on every call and the native
// registry never recycles slots. Once it is exhausted the call must recycle an
// already-pinned slot instead of throwing and bricking the buffer.
test.skipIf(!supportsFfi)("replaceText survives native text-registry exhaustion", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { EditBuffer } from "@defai-digital/ax-tui"

const buffer = EditBuffer.create("wcwidth")
try {
  // More replacements than the native registry has slots.
  for (let i = 0; i < 300; i++) {
    buffer.replaceText("line " + i)
  }
  assert.equal(buffer.getText(), "line 299")
  // The fallback must leave a fully working buffer, not just readable text.
  buffer.setCursor(0, 1000)
  buffer.insertText("!")
  assert.equal(buffer.getText(), "line 299!")

  // The registry stays full, so every later replacement takes the fallback
  // again and must keep rotating slots without corrupting the buffer.
  for (let i = 300; i < 600; i++) {
    buffer.replaceText("line " + i)
  }
  assert.equal(buffer.getText(), "line 599")
  // The fallback resets undo history; a fresh edit starts a new history.
  assert.equal(buffer.canUndo(), false)
  buffer.setCursor(0, 1000)
  buffer.insertText("!")
  assert.equal(buffer.getText(), "line 599!")
  assert.equal(buffer.canUndo(), true)
  buffer.undo()
  assert.equal(buffer.getText(), "line 599")
} finally {
  buffer.destroy()
}

// clear() preserves the native registry and undo history, so setText must keep
// reusing its single slot instead of registering a fresh one per cycle.
const cycled = EditBuffer.create("wcwidth")
try {
  for (let i = 0; i < 300; i++) {
    cycled.clear()
    cycled.setText("cycle " + i)
  }
  assert.equal(cycled.getText(), "cycle 299")
} finally {
  cycled.destroy()
}

// Undo still works after clear(): history and pinned bytes survive.
const undoable = EditBuffer.create("wcwidth")
try {
  undoable.setText("hello")
  undoable.setCursor(0, 5)
  undoable.insertText(" world")
  undoable.clear()
  assert.equal(undoable.getText(), "")
  assert.equal(undoable.canUndo(), true)
  undoable.undo()
  assert.equal(undoable.getText(), "hello")
} finally {
  undoable.destroy()
}
console.log("edit-buffer replace-text registry exhaustion ok")
`,
    ],
    { encoding: "utf8", timeout: 60_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})
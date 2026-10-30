import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// EditBuffer/EditorView text getters used to size their native output buffer
// with a hard 1MB cap, silently truncating larger buffers. They must size from
// the buffer's actual byte size instead.
test.skipIf(!supportsFfi)("edit buffer getters return text beyond the old 1MB cap", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { EditBuffer, EditorView } from "@defai-digital/ax-tui"

// 2MB total (twice the old cap) as many lines so no single line approaches
// the native per-line display-width (u16) limit.
const line = "x".repeat(32768)
const big = Array.from({ length: 64 }, () => line).join("\\n")
const totalBytes = 64 * 32768 + 63

const buffer = EditBuffer.create("wcwidth")
try {
  // Display-width offsets must not be reused as a UTF-8 allocation size.
  for (const text of ["中文😀", "e\\u0301", "👩‍💻", "中\\na"]) {
    buffer.setText(text)
    buffer.setCursor(999, 65535)
    const end = buffer.getCursorPosition().offset
    assert.equal(buffer.getTextRange(0, end), text)
  }

  // Undo/redo must emit the same "cursor-changed" event as every other
  // cursor update (the native side briefly emitted "cursorChanged").
  let cursorEvents = 0
  buffer.on("cursor-changed", () => { cursorEvents++ })
  buffer.on("cursorChanged", () => { assert.fail("undo/redo emitted the legacy event name") })

  buffer.setText(big)
  assert.equal(buffer.getText().length, big.length)
  assert.equal(buffer.getTextRange(0, totalBytes).length, big.length)
  assert.equal(buffer.getTextRangeByCoords(0, 0, 63, 32768).length, totalBytes)

  buffer.insertText("y")
  // Native events are delivered asynchronously; give them a tick to land.
  await new Promise((resolve) => setTimeout(resolve, 10))
  buffer.undo()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.ok(cursorEvents > 0, "undo must emit cursor-changed")
  buffer.redo()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.ok(cursorEvents > 1, "redo must emit cursor-changed")

  const view = EditorView.create(buffer, 80, 24)
  try {
    const viewText = view.getText()
    // The view serializes wrapped visual rows (extra newlines, 80-col
    // wrapping); what matters is that nothing was truncated at the old 1MB
    // boundary.
    assert.ok(viewText.length >= totalBytes, \`view text truncated: \${viewText.length}\`)
    assert.ok(viewText.includes("x".repeat(80)))
  } finally {
    view.destroy()
  }
} finally {
  buffer.destroy()
}
console.log("edit-buffer sizing checks passed")
`,
    ],
    { encoding: "utf8", timeout: 60_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

test.skipIf(!supportsFfi)("virtual extmark cursor skips preserve display offsets and buffer boundaries", () => {
  const result = spawnSync(process.execPath, ["--experimental-ffi", "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { EditBuffer, EditorView } from "@defai-digital/ax-tui"
const buffer = EditBuffer.create("unicode")
const view = EditorView.create(buffer, 40, 4)
try {
  buffer.setText("中文中文中文[tag]z")
  view.extmarks.create({ start: 12, end: 17, virtual: true })
  buffer.setCursor(0, 12)
  assert.equal(buffer.getCursorPosition().offset, 12)
  buffer.moveCursorRight()
  assert.equal(buffer.getCursorPosition().offset, 17, "virtual spans must use display offsets")
  buffer.moveCursorRight()
  assert.equal(buffer.getCursorPosition().offset, 18)
  buffer.moveCursorRight()
  assert.equal(buffer.getCursorPosition().offset, 18, "native cursor movement must still clamp at EOL")

  buffer.setText("[tag]z")
  view.extmarks.create({ start: 0, end: 5, virtual: true })
  buffer.setCursor(0, 5)
  buffer.moveCursorLeft()
  assert.equal(buffer.getCursorPosition().offset, 0, "backward skip at buffer start must not pass a negative offset")
  buffer.setCursor(0, 5)
  buffer.setCursorByOffset(1)
  assert.equal(buffer.getCursorPosition().offset, 0, "direct backward positioning must clamp before a leading span")

  buffer.setText("aaaa\\nbbbb\\ncccc\\ndddd\\neeee")
  view.extmarks.create({ start: 5, end: 19, virtual: true })
  buffer.setCursorByOffset(19)
  view.moveUpVisual()
  assert.equal(
    buffer.getCursorPosition().offset,
    4,
    "moving up from below a tall virtual block must land above it, not stick at the block end",
  )
  view.moveDownVisual()
  assert.equal(
    buffer.getCursorPosition().offset,
    19,
    "moving down from above the block lands below it (existing no-progress guard)",
  )
} finally {
  view.destroy()
  buffer.destroy()
}
console.log("AX_EXTMARK_CURSOR_COMPLETE")
`], { encoding: "utf8", timeout: 10_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } })
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_EXTMARK_CURSOR_COMPLETE")
})

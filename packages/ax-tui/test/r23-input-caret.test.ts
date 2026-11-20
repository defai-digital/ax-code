import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression driver for a completion caret past the end of the stored value:
// InputRenderable truncates programmatic replaceText edits to maxLength, and
// the native cursor does not clamp an out-of-range offset (it falls back to
// 0,0), so the offset must be clamped to the stored value's display width.
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

test.skipIf(!supportsFfi)("a truncated programmatic edit parks the caret at the end, not column 0", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { InputRenderable } from "@defai-digital/ax-tui"
const setup = await createTestRenderer({ width: 40, height: 6, useKittyKeyboard: null })
const { renderer } = setup
try {
  const input = new InputRenderable(renderer, { id: "i", width: 20, height: 1, maxLength: 3 })
  renderer.root.add(input)
  input.replaceText("abcdef", 6)
  assert.equal(input.plainText, "abc")
  assert.equal(input.cursorOffset, 3, "caret must clamp to the stored end, not fall back to 0")
  const wide = new InputRenderable(renderer, { id: "w", width: 20, height: 1, maxLength: 2 })
  renderer.root.add(wide)
  wide.replaceText("中文x", 99)
  assert.equal(wide.plainText, "中文")
  assert.equal(wide.cursorOffset, 4, "caret must clamp to the display width of the stored value")
} finally {
  renderer.destroy()
}
console.log("input-truncated-caret ok")
`)
})

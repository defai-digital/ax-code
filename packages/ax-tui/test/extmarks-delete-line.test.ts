import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Extmark adjustments run against native display offsets, so the scenarios run
// in a Node child process with FFI enabled.
test.skipIf(!supportsFfi)("deleteLine adjusts extmarks in display-offset space", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 60_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

const script = `
import assert from "node:assert/strict"
import { EditBuffer, EditorView } from "@defai-digital/ax-tui"

// Wide characters before the cursor line: the deleted range must be derived
// from native display offsets, not UTF-16 string indices. Line 0 ("中文字") is
// six display columns wide, so the mark at [4, 6) sits on line 0 and must
// survive deleting line 1 untouched.
{
  const editBuffer = EditBuffer.create("unicode")
  const editorView = EditorView.create(editBuffer, 40, 10)
  try {
    editBuffer.setText("中文字\\nsecond\\nthird")
    const extmarks = editorView.extmarks
    const id = extmarks.create({ start: 4, end: 6 })
    editBuffer.gotoLine(1)
    editBuffer.deleteLine()
    assert.equal(editBuffer.getText(), "中文字\\nthird")
    const mark = extmarks.get(id)
    assert.ok(mark, "extmark on the previous line was wrongly deleted")
    assert.equal(mark.start, 4)
    assert.equal(mark.end, 6)
  } finally {
    editorView.destroy()
    editBuffer.destroy()
  }
}

// On the last line native deleteLine joins upward: it removes the preceding
// newline plus the line content, so [1, 4) is deleted here, not [2, 4).
{
  const editBuffer = EditBuffer.create("unicode")
  const editorView = EditorView.create(editBuffer, 40, 10)
  try {
    editBuffer.setText("a\\nbb")
    const extmarks = editorView.extmarks
    const id = extmarks.create({ start: 0, end: 3 }) // spans "a\\nb"
    editBuffer.gotoLine(1)
    editBuffer.deleteLine()
    assert.equal(editBuffer.getText(), "a")
    const mark = extmarks.get(id)
    assert.ok(mark, "spanning extmark should be clamped, not removed")
    assert.equal(mark.start, 0)
    assert.equal(mark.end, 1)
  } finally {
    editorView.destroy()
    editBuffer.destroy()
  }
}

console.log("extmarks deleteLine checks passed")
`

import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

test.skipIf(!supportsFfi)("extmark history stays aligned with text undo and restores indexes", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 30_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

const script = `
import assert from "node:assert/strict"
import { EditBuffer, EditorView } from "@defai-digital/ax-tui"

// A no-op backspace must not leave an extmark-only undo entry that consumes a
// later text undo while restoring stale offsets.
{
  const buffer = EditBuffer.create("unicode")
  const view = EditorView.create(buffer, 40, 4)
  try {
    buffer.setText("abcd")
    const id = view.extmarks.create({ start: 3, end: 4, typeId: 5 })
    buffer.setCursorByOffset(2)
    buffer.insertText("X")
    assert.equal(buffer.getText(), "abXcd")
    assert.deepEqual([view.extmarks.get(id).start, view.extmarks.get(id).end], [4, 5])

    buffer.setCursorByOffset(0)
    buffer.deleteCharBackward()
    buffer.undo()
    assert.equal(buffer.getText(), "abcd")
    assert.deepEqual([view.extmarks.get(id).start, view.extmarks.get(id).end], [3, 4])
  } finally {
    view.destroy()
    buffer.destroy()
  }
}

// Undo must rebuild the type index and metadata instead of leaving entries
// from the redo state behind, including when an id is reused.
{
  const buffer = EditBuffer.create("unicode")
  const view = EditorView.create(buffer, 40, 4)
  try {
    buffer.setText("pq")
    const first = view.extmarks.create({ start: 0, end: 1, typeId: 5 })
    buffer.insertText("Z")
    const second = view.extmarks.create({ start: 1, end: 2, typeId: 5, metadata: "two" })
    assert.deepEqual(view.extmarks.getAllForTypeId(5).map(mark => mark.id), [first, second])

    buffer.undo()
    assert.deepEqual(view.extmarks.getAllForTypeId(5).map(mark => mark.id), [first])

    const reused = view.extmarks.create({ start: 1, end: 2, typeId: 7 })
    assert.equal(view.extmarks.getMetadataFor(reused), undefined)
    assert.deepEqual(view.extmarks.getAllForTypeId(5).map(mark => mark.id), [first])
    assert.deepEqual(view.extmarks.getAllForTypeId(7).map(mark => mark.id), [reused])
  } finally {
    view.destroy()
    buffer.destroy()
  }
}

// Native deleteChar edits at the cursor even when a selection exists. Extmarks
// must follow the text that was actually deleted.
{
  const buffer = EditBuffer.create("unicode")
  const view = EditorView.create(buffer, 40, 4)
  try {
    buffer.setText("hello world")
    const id = view.extmarks.create({ start: 6, end: 11, typeId: 5 })
    view.setSelection(6, 11)
    buffer.setCursorByOffset(0)
    buffer.deleteChar()
    assert.equal(buffer.getText(), "ello world")
    assert.deepEqual([view.extmarks.get(id).start, view.extmarks.get(id).end], [5, 10])
  } finally {
    view.destroy()
    buffer.destroy()
  }
}

// The content-change listener belongs to the controller and must be removed
// when the view is destroyed.
{
  const buffer = EditBuffer.create("unicode")
  try {
    const baseline = buffer.listenerCount("content-changed")
    const view = EditorView.create(buffer, 40, 4)
    view.extmarks
    assert.equal(buffer.listenerCount("content-changed"), baseline + 1)
    view.destroy()
    assert.equal(buffer.listenerCount("content-changed"), baseline)
  } finally {
    buffer.destroy()
  }
}

// setText resets the native text history; extmark snapshots for the discarded
// history must not resurface on a later undo().
{
  const buffer = EditBuffer.create("unicode")
  const view = EditorView.create(buffer, 40, 4)
  try {
    buffer.setText("abcd")
    const id = view.extmarks.create({ start: 3, end: 4, typeId: 5 })
    buffer.insertText("X")
    buffer.setText("zz")
    assert.equal(buffer.canUndo(), false)

    buffer.undo()
    assert.equal(buffer.getText(), "zz")
    assert.equal(view.extmarks.get(id), null)
  } finally {
    view.destroy()
    buffer.destroy()
  }
}

// clearHistory must also drop extmark undo snapshots so the next undo cannot
// restore stale offsets while the text stays put.
{
  const buffer = EditBuffer.create("unicode")
  const view = EditorView.create(buffer, 40, 4)
  try {
    buffer.setText("abcd")
    const id = view.extmarks.create({ start: 3, end: 4, typeId: 5 })
    buffer.insertText("X")
    buffer.clearHistory()
    assert.equal(buffer.canUndo(), false)

    buffer.undo()
    assert.equal(buffer.getText(), "Xabcd")
    assert.deepEqual([view.extmarks.get(id).start, view.extmarks.get(id).end], [4, 5])
  } finally {
    view.destroy()
    buffer.destroy()
  }
}

console.log("extmark history checks passed")
`

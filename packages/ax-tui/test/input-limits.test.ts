import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

function scenario(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { InputRenderable, InputRenderableEvents, RenderableEvents } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const { renderer, renderOnce } = await createTestRenderer({ width: 40, height: 4, useKittyKeyboard: null })
try { ${source} } finally { renderer.destroy() }
`],
    { encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, result.stdout + result.stderr).toBe(0)
}

test.skipIf(!supportsFfi)("typing and pasting replace selected text at the input length limit", () => {
  scenario(`
const input = new InputRenderable(renderer, { value: "abcde", maxLength: 5 })
renderer.root.add(input)
input.focus()
input.setSelection(1, 3)
assert.equal(input.getSelectedText(), "bc")
input.insertText("XYZ")
assert.equal(input.value, "aXYde")
await renderOnce()
input.selectAll()
input.handlePaste({ bytes: new TextEncoder().encode("😀abcd") })
assert.equal(input.value, "😀abc")
assert.equal(input.hasSelection(), false)
await renderOnce()
input.selectAll()
input.insertText("123456")
assert.equal(input.value, "12345")
`)
})

test.skipIf(!supportsFfi)("an emoji that cannot fit leaves the selection and input events untouched", () => {
  scenario(`
const input = new InputRenderable(renderer, { value: "abcd", maxLength: 5 })
renderer.root.add(input)
input.focus()
let events = 0
input.on(InputRenderableEvents.INPUT, () => events++)
input.insertText("😀")
assert.equal(input.value, "abcd")
assert.equal(events, 0)
input.value = "abcde"
events = 0
input.setSelection(1, 2)
input.insertText("😀")
assert.equal(input.value, "abcde")
assert.equal(input.getSelectedText(), "b")
assert.equal(events, 0)
`)
})

test.skipIf(!supportsFfi)("repeated focus and edits in focus listeners preserve change notifications", () => {
  scenario(`
const input = new InputRenderable(renderer, { value: "before" })
renderer.root.add(input)
const changes = []
input.on(InputRenderableEvents.CHANGE, value => changes.push(value))
input.focus()
input.value = "after"
input.focus()
input.blur()
assert.deepEqual(changes, ["after"])
input.on(RenderableEvents.FOCUSED, () => { input.value = "focus edit" })
input.focus()
input.blur()
assert.deepEqual(changes, ["after", "focus edit"])
`)
})

test.skipIf(!supportsFfi)("shrinking maxLength validates the limit, truncates, and notifies", () => {
  scenario(`
const input = new InputRenderable(renderer, { value: "abcdef", maxLength: 10, minLength: 2 })
renderer.root.add(input)
input.focus()
const events = []
input.on(InputRenderableEvents.INPUT, value => events.push(value))
assert.throws(() => { input.maxLength = NaN }, /finite/)
assert.throws(() => { input.maxLength = 1 }, /minLength/)
assert.equal(input.value, "abcdef")
assert.deepEqual(events, [])
input.maxLength = 4
assert.equal(input.value, "abcd")
assert.deepEqual(events, ["abcd"])
input.deleteCharBackward()
assert.equal(input.value, "abc")
assert.deepEqual(events, ["abcd", "abc"])
input.insertText("XYZ")
assert.equal(input.value, "abcX")
await renderOnce()
`)
})

test.skipIf(!supportsFfi)("no-op edits leave the input event stream untouched", () => {
  scenario(`
const input = new InputRenderable(renderer, { value: "" })
renderer.root.add(input)
input.focus()
let events = 0
input.on(InputRenderableEvents.INPUT, () => events++)
input.deleteCharBackward()
input.deleteChar()
input.deleteLine()
input.deleteWordBackward()
input.deleteWordForward()
input.deleteToLineStart()
input.deleteToLineEnd()
input.undo()
input.redo()
assert.equal(input.value, "")
assert.equal(events, 0)
input.value = "hello world"
events = 0
input.deleteChar()
input.deleteWordForward()
input.deleteToLineEnd()
assert.equal(events, 0)
input.deleteCharBackward()
assert.equal(input.value, "hello worl")
assert.equal(events, 1)
input.undo()
assert.equal(input.value, "hello world")
assert.equal(events, 2)
input.redo()
assert.equal(input.value, "hello worl")
assert.equal(events, 3)
await renderOnce()
`)
})


test.skipIf(!supportsFfi)("replaceText suppresses INPUT for no-op replacements", () => {
  scenario(`
const input = new InputRenderable(renderer, { value: "abc" })
renderer.root.add(input)
input.focus()
let events = 0
input.on(InputRenderableEvents.INPUT, () => events++)
input.replaceText("abc")
assert.equal(events, 0)
assert.equal(input.value, "abc")
input.replaceText("abcd")
assert.equal(events, 1)
input.replaceText("ab\\ncd")
assert.equal(input.value, "abcd")
assert.equal(events, 1)
input.replaceText("xyz\\r\\n")
assert.equal(input.value, "xyz")
assert.equal(events, 2)
await renderOnce()
`)
})

test.skipIf(!supportsFfi)("constructor and minLength setter reject non-finite limits", () => {
  scenario(`
for (const bad of [NaN, Infinity, -Infinity]) {
  assert.throws(() => new InputRenderable(renderer, { maxLength: bad }), /finite/)
  assert.throws(() => new InputRenderable(renderer, { minLength: bad }), /finite/)
}
const input = new InputRenderable(renderer, {})
renderer.root.add(input)
assert.throws(() => { input.minLength = NaN }, /finite/)
assert.throws(() => { input.minLength = Infinity }, /finite/)
assert.equal(input.minLength, 0)
await renderOnce()
`)
})

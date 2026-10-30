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

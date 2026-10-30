import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

function runScenario(source: string): void {
  const result = spawnSync(process.execPath, [
    "--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source,
  ], { encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("overlays render, resize, restore focus, and clean up native nodes", () => {
  runScenario(`
import assert from "node:assert/strict"
import { BoxRenderable, InputRenderable, TextRenderable, getOverlayManager, Renderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, useKittyKeyboard: null })
const { renderer } = setup
try {
  const base = new InputRenderable(renderer, { id: "base", width: 30 })
  renderer.root.add(base)
  base.focus()
  const manager = getOverlayManager(renderer)
  assert.equal(manager, getOverlayManager(renderer))
  const before = Renderable.renderablesByNumber.size
  const content = new BoxRenderable(renderer, { id: "dialog", width: "100%", height: "100%" })
  const input = new InputRenderable(renderer, { id: "dialog-input", width: "100%", value: "Dialog" })
  content.add(input)
  const handle = manager.show(content, { width: "50%", height: 3, margin: 1, anchor: "bottom-right", focus: input })
  const wrapper = content.parent
  await setup.renderOnce()
  assert.equal(renderer.currentFocusedRenderable?.id, input.id)
  assert.equal(handle.isFocused(), true)
  assert.equal(wrapper.width, 19)
  assert.equal(wrapper.x, 20)
  assert.equal(wrapper.y, 8)
  assert.ok(setup.captureCharFrame().includes("Dialog"))
  const toast = new TextRenderable(renderer, { id: "toast", content: "Notice" })
  const notification = manager.show(toast, { nonCapturing: true, width: 10, height: 1, anchor: "top-right" })
  assert.equal(renderer.currentFocusedRenderable?.id, input.id)
  notification.close()
  assert.equal(renderer.currentFocusedRenderable?.id, input.id)
  handle.setHidden(true)
  assert.equal(renderer.currentFocusedRenderable?.id, base.id)
  assert.equal(input.focused, false)
  assert.equal(content.isDestroyed, false)
  assert.equal(handle.isHidden(), true)
  handle.setHidden(false)
  assert.equal(renderer.currentFocusedRenderable?.id, base.id)
  handle.focus()
  assert.equal(renderer.currentFocusedRenderable?.id, input.id)
  setup.resize(10, 4)
  await setup.renderOnce()
  assert.ok(wrapper.x >= 1 && wrapper.x + wrapper.width <= 9)
  assert.ok(wrapper.y >= 1 && wrapper.y + wrapper.height <= 3)
  handle.close()
  handle.close()
  assert.equal(renderer.currentFocusedRenderable?.id, base.id)
  assert.equal(content.isDestroyed, true)
  assert.equal(input.isDestroyed, true)
  assert.equal(Renderable.renderablesByNumber.size, before)
  manager.dispose()
} finally { renderer.destroy() }
`)
})

test.skipIf(!supportsFfi)("overlay stack handles background closure, responsive hiding and external focus", () => {
  runScenario(`
import assert from "node:assert/strict"
import { InputRenderable, getOverlayManager } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, useKittyKeyboard: null })
const { renderer } = setup
try {
  const base = new InputRenderable(renderer, { id: "base" })
  renderer.root.add(base)
  base.focus()
  const manager = getOverlayManager(renderer)
  const first = new InputRenderable(renderer, { id: "first" })
  const a = manager.show(first)
  const second = new InputRenderable(renderer, { id: "second" })
  const b = manager.show(second)
  a.close()
  assert.equal(renderer.currentFocusedRenderable?.id, second.id)
  b.close()
  assert.equal(renderer.currentFocusedRenderable?.id, base.id)
  const lower = new InputRenderable(renderer, { id: "lower" })
  const lowerHandle = manager.show(lower)
  const upper = new InputRenderable(renderer, { id: "upper" })
  const upperHandle = manager.show(upper)
  lowerHandle.focus()
  lowerHandle.close()
  assert.equal(renderer.currentFocusedRenderable?.id, upper.id)
  upperHandle.close()
  assert.equal(renderer.currentFocusedRenderable?.id, base.id)
  const third = new InputRenderable(renderer, { id: "third" })
  const c = manager.show(third, { visible: width => width >= 20 })
  const fourth = new InputRenderable(renderer, { id: "fourth" })
  const d = manager.show(fourth)
  setup.resize(10, 4)
  await setup.renderOnce()
  assert.equal(c.isHidden(), true)
  d.close()
  assert.equal(renderer.currentFocusedRenderable?.id, base.id)
  setup.resize(40, 12)
  await setup.renderOnce()
  assert.equal(c.isHidden(), false)
  assert.equal(renderer.currentFocusedRenderable?.id, base.id)
  c.focus()
  base.focus()
  c.close()
  assert.equal(renderer.currentFocusedRenderable?.id, base.id)
  const last = new InputRenderable(renderer, { id: "last" })
  const e = manager.show(last)
  base.destroy()
  e.close()
  assert.equal(renderer.currentFocusedRenderable, null)
} finally { renderer.destroy() }
`)
})

test.skipIf(!supportsFfi)("overlay destruction and reentrant focus changes leave no stale input handlers", () => {
  runScenario(`
import assert from "node:assert/strict"
import { BoxRenderable, InputRenderable, getOverlayManager } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 30, height: 8, useKittyKeyboard: null })
const { renderer } = setup
try {
  const base = new InputRenderable(renderer, { id: "base" })
  renderer.root.add(base)
  base.focus()
  const manager = getOverlayManager(renderer)
  const panel = new BoxRenderable(renderer, { id: "panel" })
  const child = new InputRenderable(renderer, { id: "child" })
  panel.add(child)
  const handle = manager.show(panel, { focus: child })
  child.destroy()
  assert.equal(handle.isHidden(), true)
  assert.equal(renderer.currentFocusedRenderable?.id, base.id)
  assert.equal(panel.isDestroyed, true)
  const redirected = new InputRenderable(renderer, { id: "redirected" })
  const redirect = current => { if (current === redirected) base.focus() }
  renderer.on("focused_renderable", redirect)
  const other = manager.show(redirected)
  renderer.off("focused_renderable", redirect)
  await setup.mockInput.typeText("x")
  assert.equal(base.value, "x")
  assert.equal(redirected.value, "")
  other.close()
  const closing = new InputRenderable(renderer, { id: "closing" })
  const close = current => { if (current === closing) closing.destroy() }
  renderer.on("focused_renderable", close)
  const closed = manager.show(closing)
  renderer.off("focused_renderable", close)
  assert.equal(closed.isHidden(), true)
  assert.equal(renderer.currentFocusedRenderable?.id, base.id)
  const final = manager.show(new InputRenderable(renderer, { id: "final" }))
  renderer.destroy()
  final.close()
  manager.dispose()
  assert.throws(() => getOverlayManager(renderer), /destroyed/)
} finally { renderer.destroy() }
`)
})

test.skipIf(!supportsFfi)("autocomplete uses native display-width offsets, preserves undo and rejects stale editor snapshots", () => {
  runScenario(`
import assert from "node:assert/strict"
import { TextareaRenderable, InputRenderable, getEditorAutocompleteRequest, applyEditorAutocomplete } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const { renderer } = await createTestRenderer({ width: 40, height: 8, useKittyKeyboard: null })
try {
  const editor = new TextareaRenderable(renderer, { id: "editor", initialValue: "中文😀 ./fi tail" })
  renderer.root.add(editor)
  editor.cursorOffset = 11
  const request = getEditorAutocompleteRequest(editor)
  assert.equal(request.cursor, "中文😀 ./fi".length)
  const item = { label: "file.ts", insertText: "./file.ts" }
  const result = { request, start: "中文😀 ".length, end: request.cursor, items: [item] }
  assert.equal(applyEditorAutocomplete(editor, result, item), true)
  assert.equal(editor.plainText, "中文😀 ./file.ts tail")
  assert.equal(editor.cursorOffset, 16)
  assert.equal(editor.undo(), true)
  assert.equal(editor.plainText, "中文😀 ./fi tail")
  editor.cursorOffset = 0
  assert.equal(applyEditorAutocomplete(editor, result, item), false)
  editor.destroy()
  assert.equal(applyEditorAutocomplete(editor, result, item), false)
  const input = new InputRenderable(renderer, { id: "input", value: "中文😀", maxLength: 12 })
  renderer.root.add(input)
  assert.equal(input.cursorOffset, 6)
  input.value = "😀中文"
  assert.equal(input.cursorOffset, 6)
  let changed = ""
  input.on("input", value => { changed = value })
  const suggestion = { label: "long", insertText: "abcd\\nefghijklmnop" }
  const inputRequest = getEditorAutocompleteRequest(input)
  assert.equal(applyEditorAutocomplete(input, { request: inputRequest, start: 0, end: inputRequest.cursor, items: [suggestion] }, suggestion), true)
  assert.equal(input.value, "abcdefghijkl")
  assert.equal(changed, input.value)
  assert.equal(input.undo(), true)
  assert.equal(input.value, "😀中文")
  input.value = "X tail"
  input.cursorOffset = 1
  const middleRequest = getEditorAutocompleteRequest(input)
  const middle = { label: "middle", insertText: "ab\\ncd" }
  applyEditorAutocomplete(input, { request: middleRequest, start: 0, end: 1, items: [middle] }, middle)
  assert.equal(input.value, "abcd tail")
  assert.equal(input.cursorOffset, 4)
  input.maxLength = 3
  input.replaceText("😀😀")
  assert.equal(input.value, "😀")
  input.value = "😀😀"
  assert.equal(input.value, "😀")
} finally { renderer.destroy() }
`)
})

test.skipIf(!supportsFfi)("overlay disposal cleans all entries and listeners even when focus callbacks throw", () => {
  runScenario(`
import assert from "node:assert/strict"
import { InputRenderable, getOverlayManager } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const { renderer } = await createTestRenderer({ width: 40, height: 8, useKittyKeyboard: null })
try {
  const base = new InputRenderable(renderer, { id: "base" })
  renderer.root.add(base)
  base.focus()
  const before = ["resize", "focused_renderable", "destroy"].map(name => renderer.listenerCount(name))
  const manager = getOverlayManager(renderer)
  const first = new InputRenderable(renderer, { id: "first" })
  const a = manager.show(first)
  const second = new InputRenderable(renderer, { id: "second" })
  const b = manager.show(second)
  const fail = () => { throw new Error("application focus callback") }
  first.on("focused", fail)
  assert.throws(() => manager.dispose(), /Overlay disposal failed/)
  assert.equal(first.isDestroyed, true)
  assert.equal(second.isDestroyed, true)
  assert.equal(a.isHidden(), true)
  assert.equal(b.isHidden(), true)
  assert.equal(renderer.currentFocusedRenderable?.id, base.id)
  assert.deepEqual(["resize", "focused_renderable", "destroy"].map(name => renderer.listenerCount(name)), before)
  assert.notEqual(getOverlayManager(renderer), manager)
  getOverlayManager(renderer).dispose()
} finally { renderer.destroy() }
`)
})

test.skipIf(!supportsFfi)("public completion and overlay APIs compose into an editor suggestion list", () => {
  runScenario(`
import assert from "node:assert/strict"
import {
  InputRenderable, TextRenderable, getOverlayManager, AutocompleteController,
  createSlashCommandProvider, getEditorAutocompleteRequest, applyEditorAutocomplete,
} from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 8, useKittyKeyboard: null })
const { renderer } = setup
const controller = new AutocompleteController(createSlashCommandProvider([{ name: "help" }]))
try {
  const editor = new InputRenderable(renderer, { id: "prompt", value: "/he", width: 40 })
  renderer.root.add(editor)
  editor.focus()
  const result = await controller.request(getEditorAutocompleteRequest(editor))
  const suggestions = new TextRenderable(renderer, { id: "suggestions", content: result.items.map(item => item.label).join("\\n") })
  const popup = getOverlayManager(renderer).show(suggestions, {
    nonCapturing: true, anchor: "top-left", offsetY: 1, width: 20, height: 3,
  })
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("/help"))
  assert.equal(renderer.currentFocusedRenderable?.id, editor.id)
  assert.equal(applyEditorAutocomplete(editor, result, result.items[0]), true)
  popup.close()
  assert.equal(editor.value, "/help")
  assert.equal(editor.cursorOffset, 5)
  assert.equal(renderer.currentFocusedRenderable?.id, editor.id)
  assert.equal(editor.undo(), true)
  assert.equal(editor.value, "/he")
} finally {
  controller.dispose()
  renderer.destroy()
}
`)
})


test.skipIf(!supportsFfi)("hiding an overlay tolerates closure from the restored focus callback", () => {
  runScenario(`
import assert from "node:assert/strict"
import { InputRenderable, getOverlayManager, Renderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const { renderer } = await createTestRenderer({ width: 40, height: 8, useKittyKeyboard: null })
try {
  const base = new InputRenderable(renderer, {})
  renderer.root.add(base)
  base.focus()
  const before = Renderable.renderablesByNumber.size
  const content = new InputRenderable(renderer, {})
  const overlay = getOverlayManager(renderer).show(content)
  base.once("focused", () => overlay.close())
  assert.doesNotThrow(() => overlay.setHidden(true))
  assert.equal(content.isDestroyed, true)
  assert.equal(overlay.isHidden(), true)
  assert.equal(renderer.currentFocusedRenderable, base)
  assert.equal(Renderable.renderablesByNumber.size, before)
} finally { renderer.destroy() }
`)
})

test.skipIf(!supportsFfi)("failed overlay focus releases adopted content and restores application focus", () => {
  runScenario(`
import assert from "node:assert/strict"
import { InputRenderable, getOverlayManager, Renderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const { renderer } = await createTestRenderer({ width: 40, height: 8, useKittyKeyboard: null })
try {
  const base = new InputRenderable(renderer, {})
  renderer.root.add(base)
  base.focus()
  const before = Renderable.renderablesByNumber.size
  const content = new InputRenderable(renderer, {})
  const expected = new Error("application focus failure")
  content.once("focused", () => { throw expected })
  assert.throws(() => getOverlayManager(renderer).show(content), error => error === expected)
  assert.equal(content.isDestroyed, true)
  assert.equal(renderer.currentFocusedRenderable, base)
  assert.equal(Renderable.renderablesByNumber.size, before)
} finally { renderer.destroy() }
`)
})

test.skipIf(!supportsFfi)("overlay closure respects application focus chosen by a blur callback", () => {
  runScenario(`
import assert from "node:assert/strict"
import { InputRenderable, getOverlayManager } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const { renderer } = await createTestRenderer({ width: 40, height: 8, useKittyKeyboard: null })
try {
  const base = new InputRenderable(renderer, {})
  const next = new InputRenderable(renderer, {})
  renderer.root.add(base)
  renderer.root.add(next)
  base.focus()
  const content = new InputRenderable(renderer, {})
  const overlay = getOverlayManager(renderer).show(content)
  content.once("blurred", () => next.focus())
  overlay.close()
  assert.equal(renderer.currentFocusedRenderable?.id, next.id)
  assert.equal(content.isDestroyed, true)
} finally { renderer.destroy() }
`)
})


test.skipIf(!supportsFfi)("overlay hiding completes even when focus restoration throws", () => {
  runScenario(`
import assert from "node:assert/strict"
import { InputRenderable, getOverlayManager } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const { renderer } = await createTestRenderer({ width: 40, height: 8, useKittyKeyboard: null })
try {
  const base = new InputRenderable(renderer, {})
  renderer.root.add(base)
  base.focus()
  const content = new InputRenderable(renderer, {})
  const overlay = getOverlayManager(renderer).show(content)
  const expected = new Error("restoration failed")
  base.once("focused", () => { throw expected })
  assert.throws(() => overlay.setHidden(true), error => error === expected)
  assert.equal(overlay.isHidden(), true)
  assert.equal(content.isDestroyed, false)
  overlay.setHidden(true)
  overlay.setHidden(false)
  overlay.focus()
  assert.equal(renderer.currentFocusedRenderable?.id, content.id)
  overlay.close()
  assert.equal(renderer.currentFocusedRenderable?.id, base.id)
} finally { renderer.destroy() }
`)
})

test.skipIf(!supportsFfi)("overlay resize updates every entry before reporting focus callback failures", () => {
  runScenario(`
import assert from "node:assert/strict"
import { InputRenderable, TextRenderable, getOverlayManager } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 8, useKittyKeyboard: null })
const { renderer } = setup
try {
  const base = new InputRenderable(renderer, {})
  renderer.root.add(base)
  base.focus()
  const manager = getOverlayManager(renderer)
  const active = manager.show(new InputRenderable(renderer, {}), { visible: width => width >= 20 })
  const toast = manager.show(new TextRenderable(renderer, { content: "Notice" }), {
    nonCapturing: true, visible: width => width >= 20,
  })
  const expected = new Error("resize restoration failed")
  base.once("focused", () => { throw expected })
  assert.throws(() => setup.resize(10, 4), error =>
    error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === expected)
  assert.equal(active.isHidden(), true)
  assert.equal(toast.isHidden(), true)
  setup.resize(40, 8)
  assert.equal(active.isHidden(), false)
  assert.equal(toast.isHidden(), false)
  active.close()
  toast.close()
} finally { renderer.destroy() }
`)
})


test.skipIf(!supportsFfi)("autocomplete preserves edits and caret movement performed by input callbacks", () => {
  runScenario(`
import assert from "node:assert/strict"
import { InputRenderable, getEditorAutocompleteRequest, applyEditorAutocomplete } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const { renderer } = await createTestRenderer({ width: 40, height: 8, useKittyKeyboard: null })
try {
  const input = new InputRenderable(renderer, { value: "/h" })
  renderer.root.add(input)
  const request = getEditorAutocompleteRequest(input)
  const item = { label: "/help", insertText: "/help" }
  input.once("input", () => {
    input.value = "😀 revised"
    input.cursorOffset = 2
  })
  assert.equal(applyEditorAutocomplete(input, { request, start: 0, end: 2, items: [item] }, item), true)
  assert.equal(input.value, "😀 revised")
  assert.equal(input.cursorOffset, 2)
} finally { renderer.destroy() }
`)
})

test.skipIf(!supportsFfi)("autocomplete positions the caret before notifying input observers", () => {
  runScenario(`
import assert from "node:assert/strict"
import { InputRenderable, getEditorAutocompleteRequest, applyEditorAutocomplete } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const { renderer } = await createTestRenderer({ width: 40, height: 8, useKittyKeyboard: null })
try {
  const input = new InputRenderable(renderer, { value: "/h", maxLength: 4 })
  renderer.root.add(input)
  const request = getEditorAutocompleteRequest(input)
  const item = { label: "Unicode", insertText: "中文😀Z", cursorOffset: 4 }
  let observed
  input.once("input", () => { observed = { text: input.value, cursor: input.cursorOffset } })
  assert.equal(applyEditorAutocomplete(input, { request, start: 0, end: 2, items: [item] }, item), true)
  assert.deepEqual(observed, { text: "中文😀", cursor: 6 })
  assert.equal(input.cursorOffset, 6)
} finally { renderer.destroy() }
`)
})

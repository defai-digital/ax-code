import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

function scenario(source: string): void {
  const result = spawnSync(process.execPath, ["--experimental-ffi", "--disable-warning=ExperimentalWarning",
    "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { BoxRenderable, InputRenderable, KeyEvent, getKeymap } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 10, useKittyKeyboard: null })
const { renderer } = setup
const send = (name, extra = {}) => {
  const event = new KeyEvent({ name, ctrl: false, meta: false, shift: false, option: false,
    sequence: name, raw: name, number: false, eventType: "press", source: "raw", ...extra })
  renderer.keyInput.emit("keypress", event)
  return event
}
try { ${source} } finally { renderer.destroy() }
process.stdout.write("AX_SCENARIO_COMPLETE")
`], { encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expect(result.stdout, result.stderr).toContain("AX_SCENARIO_COMPLETE")
}

test.skipIf(!supportsFfi)("keymap routes scoped priority layers before the focused editor", () => {
  scenario(`
const panel = new BoxRenderable(renderer, { id: "panel" })
const editor = new InputRenderable(renderer, { id: "editor" })
panel.add(editor)
renderer.root.add(panel)
editor.focus()
const originalListeners = renderer.keyInput.listenerCount("keypress")
const keymap = getKeymap(renderer)
assert.equal(keymap, getKeymap(renderer))
const calls = []
const bind = id => ({ id, keys: "x", handler: () => calls.push(id) })
keymap.register({ bindings: [bind("global")] })
const removePanel = keymap.register({ target: panel, bindings: [bind("panel")] })
const removeEditor = keymap.register({ target: editor, scope: "focus", bindings: [bind("editor")] })
send("x")
assert.deepEqual(calls, ["editor"])
assert.equal(editor.value, "")
removeEditor()
send("x")
assert.equal(calls.at(-1), "panel")
const removePriority = keymap.register({ priority: 10, bindings: [bind("priority")] })
send("x")
assert.equal(calls.at(-1), "priority")
removePriority()
panel.visible = false
send("x")
assert.equal(calls.at(-1), "global")
panel.visible = true
removePanel()
send("z")
assert.equal(editor.value, "z")
assert.deepEqual(keymap.getActiveBindings().map(x => x.id), ["global"])
keymap.dispose()
assert.equal(renderer.keyInput.listenerCount("keypress"), originalListeners)
send("x")
assert.equal(editor.value, "zx")
`)
})

test.skipIf(!supportsFfi)("keymap sequences cancel on focus, paste, disposal, mismatch and Escape", () => {
  scenario(`
const editor = new InputRenderable(renderer, { id: "editor" })
renderer.root.add(editor)
editor.focus()
const keymap = getKeymap(renderer, { sequenceTimeoutMs: 20 })
let single = 0, double = 0, enabled = true
const remove = keymap.register({ target: editor, enabled: () => enabled, bindings: [
  { id: "single", keys: "g", handler: () => single++ },
  { id: "double", keys: ["g", "g"], handler: () => double++ },
] })
send("g"); assert.deepEqual(keymap.pendingKeys, ["g"])
send("g"); assert.equal(double, 1); assert.equal(single, 0)
send("g"); send("g", { repeated: true }); assert.equal(double, 1)
await new Promise(r => setTimeout(r, 50)); assert.equal(single, 1)
send("g"); enabled = false
await new Promise(r => setTimeout(r, 50)); assert.equal(single, 1)
enabled = true
send("g"); send("escape"); assert.deepEqual(keymap.pendingKeys, [])
send("g"); send("z"); assert.equal(editor.value, "z")
send("g"); renderer.keyInput.processPaste(new TextEncoder().encode("paste"))
assert.deepEqual(keymap.pendingKeys, [])
send("g"); editor.blur(); assert.deepEqual(keymap.pendingKeys, [])
editor.focus(); send("g"); renderer.emit("blur"); assert.deepEqual(keymap.pendingKeys, [])
editor.focus(); send("g"); remove(); assert.deepEqual(keymap.pendingKeys, [])
await new Promise(r => setTimeout(r, 50)); assert.equal(single, 1)
`)
})

test.skipIf(!supportsFfi)("keymap validates registration atomically and tolerates handler lifecycle changes", () => {
  scenario(`
const editor = new InputRenderable(renderer, { id: "editor" })
renderer.root.add(editor); editor.focus()
const keymap = getKeymap(renderer)
assert.throws(() => keymap.register({ bindings: [{ id: "bad", keys: "ctrl+", handler() {} }] }))
assert.throws(() => keymap.register({ bindings: [
  { id: "a", keys: "enter", handler() {} }, { id: "b", keys: "return", handler() {} }
] }))
assert.equal(keymap.getActiveBindings().length, 0)
let calls = 0
keymap.register({ target: editor, bindings: [{ id: "close", keys: "ctrl+k", handler() {
  calls++; editor.destroy(); keymap.register({ bindings: [{ id: "later", keys: "ctrl+k", handler: () => calls++ }] })
} }] })
send("k", { ctrl: true }); assert.equal(calls, 1)
assert.deepEqual(keymap.getActiveBindings().map(x => x.id), ["later"])
send("k", { ctrl: true }); assert.equal(calls, 2)
const consumed = new KeyEvent({ name: "k", ctrl: true, shift: false, meta: false, sequence: "k", raw: "k" })
consumed.preventDefault(); renderer.keyInput.emit("keypress", consumed)
assert.equal(calls, 2)
keymap.register({ bindings: [{ id: "unicode", keys: "界", handler: () => calls++ }] })
send("界"); assert.equal(calls, 3)
let remove
remove = keymap.register({ enabled: () => { remove(); return true },
  bindings: [{ id: "removed", keys: "r", handler: () => calls++ }] })
assert.equal(send("r").defaultPrevented, false)
assert.equal(calls, 3)
let broken = 0, afterBroken = 0
keymap.register({ enabled: () => { throw new Error("expected") },
  bindings: [{ id: "broken", keys: "b", handler: () => broken++ }] })
keymap.register({ priority: -1, bindings: [{ id: "after-broken", keys: "b", handler: () => afterBroken++ }] })
assert.equal(send("b").defaultPrevented, true)
assert.equal(broken, 0)
assert.equal(afterBroken, 1)
let releases = 0
keymap.register({ bindings: [{ id: "release", keys: "v", handler: () => releases++ }] })
assert.equal(send("v", { eventType: "release" }).defaultPrevented, false)
assert.equal(releases, 0)
`)
})

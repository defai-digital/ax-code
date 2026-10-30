import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

test.skipIf(!supportsFfi)("shortcut help renders snapshots and filters without taking focus or consuming input", () => {
  const result = spawnSync(process.execPath, ["--experimental-ffi", "--disable-warning=ExperimentalWarning",
    "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { KeymapHelpRenderable, InputRenderable, Renderable, getKeymap } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 12, useKittyKeyboard: null })
const { renderer } = setup
try {
  const editor = new InputRenderable(renderer, { id: "editor", width: "100%", height: 1 })
  renderer.root.add(editor)
  editor.focus()
  const keymap = getKeymap(renderer)
  let saves = 0
  const remove = keymap.register({ target: editor, bindings: [
    { id: "save", keys: "ctrl+s", description: "Save document", handler: () => saves++ },
    { id: "top", keys: ["ctrl+k", "ctrl+t"], description: "First record", handler() {} },
    { id: "find", keys: "ctrl+f", description: "搜尋文件", handler() {} },
  ] })
  const baseline = renderer.keyInput.listenerCount("keypress")
  const bindings = keymap.getActiveBindings()
  const help = new KeymapHelpRenderable(renderer, { id: "help", width: "100%", bindings })
  renderer.root.add(help)
  bindings[0].description = "mutated caller"
  bindings[0].keys[0] = "x"
  const copied = help.bindings
  copied[0].keys[0] = "z"
  assert.equal("target" in copied[0], false)
  await setup.renderOnce()
  let frame = setup.captureCharFrame()
  assert.ok(frame.includes("Ctrl+s  Save document"), frame)
  assert.ok(frame.includes("Ctrl+k Ctrl+t  First record"), frame)
  assert.ok(frame.includes("搜尋文件"), frame)
  assert.equal(help.matchCount, 3)
  assert.equal(renderer.currentFocusedRenderable, editor)
  assert.equal(renderer.keyInput.listenerCount("keypress"), baseline)
  setup.mockInput.pressKey("s", { ctrl: true })
  setup.mockInput.pressKey("a")
  assert.equal(saves, 1)
  assert.equal(editor.value, "a")
  help.query = "SEARCH DOES NOT MATCH"
  await setup.renderOnce()
  assert.equal(help.matchCount, 0)
  assert.ok(setup.captureCharFrame().includes("No matching shortcuts."))
  help.emptyText = "Nothing here"
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().includes("Nothing here"))
  help.query = "FIRST"
  setup.resize(18, 12)
  await setup.renderOnce()
  frame = setup.captureCharFrame()
  assert.equal(help.matchCount, 1)
  assert.ok(frame.includes("Ctrl+k Ctrl+t"), frame)
  assert.ok(frame.includes("First record"), frame)
  assert.ok(!frame.includes("Save"), frame)
  remove()
  assert.equal(help.matchCount, 1, "metadata stays a snapshot until explicitly refreshed")
  help.bindings = keymap.getActiveBindings()
  await setup.renderOnce()
  assert.equal(help.matchCount, 0)
  help.destroy()
  let writes = 0
  Object.defineProperty(help, "content", { set() { writes++ } })
  help.query = "next"
  help.bindings = []
  help.emptyText = "gone"
  assert.equal(writes, 0)
  assert.equal(renderer.keyInput.listenerCount("keypress"), baseline)
} finally { renderer.destroy() }
assert.equal(Renderable.renderablesByNumber.size, 0)
process.stdout.write("AX_SCENARIO_COMPLETE")
`], { encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expect(result.stdout, result.stderr).toContain("AX_SCENARIO_COMPLETE")
})

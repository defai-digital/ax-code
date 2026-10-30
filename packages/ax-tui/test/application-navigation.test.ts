import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

function scenario(source: string): void {
  const result = spawnSync(process.execPath, ["--experimental-ffi", "--disable-warning=ExperimentalWarning",
    "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { BoxRenderable, InputRenderable, Renderable, RenderableEvents, getFocusManager, getKeymap,
  getCommandRegistry, captureCommandContext, showCommandPalette, getOverlayManager } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 60, height: 16, useKittyKeyboard: null })
const { renderer, mockInput } = setup
try { ${source} } finally { renderer.destroy() }
assert.equal(Renderable.renderablesByNumber.size, 0)
process.stdout.write("AX_APPLICATION_SCENARIO_COMPLETE")
`], { encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } })
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout, result.stderr).toContain("AX_APPLICATION_SCENARIO_COMPLETE")
}

test.skipIf(!supportsFfi)("focus follows current tree order, skips unavailable nodes, and respects keymaps", () => {
  scenario(`
const group = new BoxRenderable(renderer, {})
const a = new InputRenderable(renderer, { id: "a" })
const b = new InputRenderable(renderer, { id: "b" })
const c = new InputRenderable(renderer, { id: "c" })
group.add(a); group.add(b); group.add(c); renderer.root.add(group)
const focus = getFocusManager(renderer)
assert.equal(focus, getFocusManager(renderer))
const removeRoot = focus.registerScope(renderer.root)
a.focus(); mockInput.pressTab(); assert.equal(renderer.currentFocusedRenderable, b)
mockInput.pressTab({ shift: true }); assert.equal(renderer.currentFocusedRenderable, a)
group.remove(c.id); group.add(c, 0)
a.focus(); assert.equal(focus.focusPrevious(), true); assert.equal(renderer.currentFocusedRenderable, c)
b.visible = false; c.focusable = false
assert.equal(focus.focusNext(), true); assert.equal(renderer.currentFocusedRenderable, a)
assert.equal(focus.focusNext(), false)
b.visible = true; c.focusable = true
const removeOrdered = focus.registerScope(group, { order: [b, a] })
b.focus(); assert.equal(focus.focusNext(), true); assert.equal(renderer.currentFocusedRenderable, a)
removeOrdered()
let shortcuts = 0
const removeKey = getKeymap(renderer).register({ bindings: [{ id: "custom.tab", keys: "tab", handler() { shortcuts++ } }] })
a.focus(); mockInput.pressTab(); assert.equal(shortcuts, 1); assert.equal(renderer.currentFocusedRenderable, a)
removeKey()
b.destroy(); group.remove(c.id)
assert.equal(focus.focusNext(), false)
c.destroy()
removeRoot(); removeRoot()
assert.equal(focus.focusNext(), false)
focus.dispose()
`)
})

test.skipIf(!supportsFfi)("modal Tab navigation preserves overlay restoration and reentrant focus decisions", () => {
  scenario(`
const base = new InputRenderable(renderer, {})
renderer.root.add(base); base.focus()
const focus = getFocusManager(renderer)
focus.registerScope(renderer.root)
const dialog = new BoxRenderable(renderer, {})
const first = new InputRenderable(renderer, {})
const second = new InputRenderable(renderer, {})
dialog.add(first); dialog.add(second)
const overlay = getOverlayManager(renderer).show(dialog, { focus: first })
focus.registerScope(dialog, { modal: true })
mockInput.pressTab({ shift: true }); assert.equal(renderer.currentFocusedRenderable, second)
mockInput.pressTab(); assert.equal(renderer.currentFocusedRenderable, first)
let nested
second.once(RenderableEvents.FOCUSED, () => { nested = focus.focusNext(); base.focus() })
focus.focusNext(); assert.equal(nested, false); assert.equal(renderer.currentFocusedRenderable, base)
overlay.close(); assert.equal(renderer.currentFocusedRenderable, base)
const doomed = new InputRenderable(renderer, {})
renderer.root.add(doomed)
doomed.once(RenderableEvents.FOCUSED, () => doomed.destroy())
focus.focusNext(); assert.equal(doomed.isDestroyed, true)
assert.notEqual(renderer.currentFocusedRenderable, doomed)
assert.equal(focus.focusNext(), true)
assert.equal(renderer.currentFocusedRenderable, base)
`)
})

test.skipIf(!supportsFfi)("modal Tab containment handles empty scopes, throwing predicates and nesting", () => {
  scenario(`
const base = new InputRenderable(renderer, { id: "base" })
renderer.root.add(base); base.focus()
const focus = getFocusManager(renderer)
const removeRoot = focus.registerScope(renderer.root)
let leaked = 0
renderer.keyInput.on("keypress", event => { if (!event.defaultPrevented) leaked++ })
const empty = new BoxRenderable(renderer, {})
renderer.root.add(empty)
const removeEmpty = focus.registerScope(empty, { modal: true })
mockInput.pressTab()
assert.equal(leaked, 0, "Tab escaped an empty modal scope")
assert.equal(renderer.currentFocusedRenderable, base)
removeEmpty()

const broken = new BoxRenderable(renderer, {})
const inside = new InputRenderable(renderer, { id: "inside" })
broken.add(inside); renderer.root.add(broken)
const removeBroken = focus.registerScope(broken, { enabled: () => { throw new Error("expected") } })
mockInput.pressTab()
assert.equal(renderer.currentFocusedRenderable, inside)
removeBroken()

const outer = new BoxRenderable(renderer, {})
const inner = new BoxRenderable(renderer, {})
const outerFirst = new InputRenderable(renderer, { id: "outer-first" })
const innerFirst = new InputRenderable(renderer, { id: "inner-first" })
const innerSecond = new InputRenderable(renderer, { id: "inner-second" })
outer.add(outerFirst); outer.add(inner); inner.add(innerFirst); inner.add(innerSecond)
renderer.root.add(outer)
const removeInner = focus.registerScope(inner, { modal: true })
const removeOuter = focus.registerScope(outer, { modal: true })
innerSecond.focus()
mockInput.pressTab()
assert.equal(renderer.currentFocusedRenderable, innerFirst, "Outer modal stole Tab from the inner modal")
removeInner(); removeOuter(); removeRoot()
`)
})

test.skipIf(!supportsFfi)("commands use live registrations, immutable Unicode metadata and explicit async results", () => {
  scenario(`
const input = new InputRenderable(renderer, {})
renderer.root.add(input); input.focus()
const registry = getCommandRegistry(renderer)
const context = captureCommandContext(renderer)
let runs = 0, enabled = true
const definition = { id: "save", title: "Café 😀", keywords: ["document"], enabled: () => enabled,
  run(ctx) { assert.equal(ctx.focused, input); runs++ } }
const remove = registry.register(definition, input)
definition.id = "mutated"; definition.title = "mutated"; definition.keywords[0] = "mutated"
assert.equal(registry.search("cafe\\u0301 😀", context)[0].id, "save")
const metadata = registry.search("document", context)
assert.equal(Object.isFrozen(metadata), true); assert.equal(Object.isFrozen(metadata[0]), true)
assert.equal("run" in metadata[0], false)
assert.throws(() => registry.register({ id: "save", title: "duplicate", run() {} }))
assert.equal((await registry.execute("save", context)).status, "executed"); assert.equal(runs, 1)
enabled = false
assert.equal((await registry.execute("save", context)).status, "disabled"); assert.equal(runs, 1)
remove(); remove()
assert.equal((await registry.execute("save", context)).status, "not-found")
let selfRemove
selfRemove = registry.register({ id: "self", title: "Self", enabled() { selfRemove(); return true }, run() { runs++ } })
assert.equal((await registry.execute("self", context)).status, "disabled"); assert.equal(runs, 1)
registry.register({ id: "bad", title: "Bad", async run() { throw new Error("expected rejection") } })
assert.equal((await registry.execute("bad", context)).status, "error")
registry.register({ id: "predicate", title: "Predicate", enabled() { throw new Error("bad predicate") }, run() {} })
assert.equal(registry.search("Predicate", context)[0].enabled, false)
assert.equal((await registry.execute("predicate", context)).status, "error")
input.destroy()
assert.equal((await registry.execute("bad", context)).status, "stale-context")
registry.dispose()
assert.equal((await registry.execute("bad")).status, "disposed")
`)
})

test.skipIf(!supportsFfi)("palette filters and navigates, restores focus once, and survives async failures", () => {
  scenario(`
const base = new InputRenderable(renderer, { id: "base" })
renderer.root.add(base); base.focus()
const registry = getCommandRegistry(renderer)
let runs = 0, restores = 0
base.on(RenderableEvents.FOCUSED, () => restores++)
registry.register({ id: "alpha", title: "Alpha", run() { runs++ } })
registry.register({ id: "beta", title: "Beta", run(ctx) {
  assert.equal(ctx.focused, base); assert.equal(renderer.currentFocusedRenderable, base); runs++
} })
let palette = showCommandPalette(renderer)
await setup.flush()
assert.ok(setup.captureCharFrame().includes("Alpha"))
mockInput.pressArrow("down"); assert.equal(palette.selectedId, "beta")
await setup.flush()
mockInput.pressEnter()
assert.equal((await palette.result).status, "executed")
assert.equal(runs, 1); assert.equal(restores, 1)
assert.equal(renderer.currentFocusedRenderable, base)
palette = showCommandPalette(renderer)
palette.setQuery("does not exist"); await setup.flush()
assert.ok(setup.captureCharFrame().includes("No matching commands."))
setup.resize(20, 10); await setup.flush()
mockInput.pressEscape(); assert.equal(await palette.result, null)
registry.register({ id: "failure", title: "Failure", async run() { throw new Error("expected") } })
palette = showCommandPalette(renderer, { query: "failure" })
assert.equal((await palette.executeSelected()).status, "error")
assert.equal((await palette.result).status, "error")
palette = showCommandPalette(renderer)
palette.input.destroy()
assert.equal(await palette.result, null)
assert.equal(renderer.currentFocusedRenderable, base)
mockInput.typeText("still editable"); assert.equal(base.value, "still editable")
`)
})

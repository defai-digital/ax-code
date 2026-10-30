import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Renderable constructors allocate yoga nodes, so the scenarios run with FFI.
test.skipIf(!supportsFfi)("constructor options honor focusable:false and text children detach cleanly", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { BoxRenderable, SelectRenderable, TextNodeRenderable, TextRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"

const setup = await createTestRenderer({ width: 20, height: 10, useKittyKeyboard: null })
const { renderer } = setup
try {
  // A subclass that defaults focusability to true must still honor an explicit false.
  const select = new SelectRenderable(renderer, {
    width: 10,
    height: 4,
    focusable: false,
    options: [{ name: "a", description: "" }],
  })
  assert.equal(select.focusable, false)
  select.destroy()

  const defaultSelect = new SelectRenderable(renderer, {
    width: 10,
    height: 4,
    options: [{ name: "a", description: "" }],
  })
  assert.equal(defaultSelect.focusable, true)
  defaultSelect.destroy()

  const box = new BoxRenderable(renderer, { focusable: true })
  assert.equal(box.focusable, true)
  box.destroy()

  // Replaced and cleared text nodes must not keep pointing at their old parent.
  const text = new TextRenderable(renderer, { content: "hi" })
  try {
    const first = new TextNodeRenderable({})
    const second = new TextNodeRenderable({})
    const third = new TextNodeRenderable({})
    text.add(first)
    assert.equal(first.parent, text.textNode)

    text.textNode.replace(second, 0)
    assert.equal(first.parent, null, "replaced node kept a stale parent")
    assert.equal(second.parent, text.textNode)

    text.textNode.add(third)
    text.textNode.clear()
    assert.equal(second.parent, null, "cleared node kept a stale parent")
    assert.equal(third.parent, null, "cleared node kept a stale parent")
  } finally {
    text.destroy()
  }
} finally {
  renderer.destroy()
}
`,
    ],
    { encoding: "utf8", timeout: 20_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

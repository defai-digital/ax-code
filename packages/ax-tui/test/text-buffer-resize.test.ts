import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

test.skipIf(!supportsFfi)("text buffer resize refreshes wrapping and clamps scroll offsets", () => {
  const result = spawnSync(process.execPath, [
    "--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { TextRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 20, useKittyKeyboard: null })
const { renderer } = setup
const settle = async () => {
  for (let pass = 0; pass < 4; pass++) {
    await setup.renderOnce()
    await new Promise(resolve => setImmediate(resolve))
  }
}
try {
  const wrapped = new TextRenderable(renderer, {
    width: "100%", height: 10, wrapMode: "char", content: "abcdefghij".repeat(40),
  })
  renderer.root.add(wrapped)
  await settle()
  const before = wrapped.virtualLineCount
  setup.resize(80, 20)
  await settle()
  assert.ok(wrapped.virtualLineCount < before,
    "resize did not refresh the wrap width: " + before + " -> " + wrapped.virtualLineCount)

  const scrolled = new TextRenderable(renderer, {
    width: 20, height: 5, wrapMode: "none",
    content: Array.from({ length: 20 }, (_, index) => "line " + index).join("\\n"),
  })
  renderer.root.add(scrolled)
  await settle()
  scrolled.scrollY = scrolled.maxScrollY
  assert.ok(scrolled.scrollY > 0)
  scrolled.height = 20
  await settle()
  assert.equal(scrolled.scrollY, 0, "resize kept a stale vertical scroll offset")

  const reflowed = new TextRenderable(renderer, {
    width: 20, height: 5, wrapMode: "char",
    content: Array.from({ length: 10 }, (_, index) => String(index).repeat(100)).join("\\n"),
  })
  renderer.root.add(reflowed)
  await settle()
  reflowed.scrollY = reflowed.maxScrollY
  assert.ok(reflowed.scrollY > 5)
  reflowed.wrapMode = "none"
  await settle()
  assert.equal(reflowed.scrollY, reflowed.maxScrollY,
    "wrap mode change kept a stale vertical scroll offset")
} finally {
  renderer.destroy()
}
process.stdout.write("AX_TEXT_BUFFER_RESIZE_COMPLETE")
`], { encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } })
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_TEXT_BUFFER_RESIZE_COMPLETE")
})

import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

test.skipIf(!supportsFfi)("stickyScroll without an explicit start keeps the current edge", () => {
  const result = spawnSync(process.execPath, [
    "--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { BoxRenderable, ScrollBoxRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 30, height: 12, useKittyKeyboard: null })
const { renderer } = setup
const settle = async () => {
  for (let pass = 0; pass < 6; pass++) {
    await setup.renderOnce()
    await new Promise(resolve => setImmediate(resolve))
  }
}
try {
  const list = new ScrollBoxRenderable(renderer, { width: 20, height: 10, stickyScroll: true })
  const content = new BoxRenderable(renderer, { height: 300, width: 5, flexShrink: 0 })
  list.add(content)
  renderer.root.add(list)
  await settle()
  assert.equal(list.scrollTop, 0, "sticky scroll must start at the origin")

  list.scrollTo(290)
  await settle()
  assert.equal(list.scrollTop, 290)

  content.height = 400
  await settle()
  assert.equal(list.scrollTop, 390, "content growth must keep the bottom edge sticky")
} finally {
  renderer.destroy()
}
process.stdout.write("AX_STICKY_SCROLL_COMPLETE")
`], { encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } })
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_STICKY_SCROLL_COMPLETE")
})

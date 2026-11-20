import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression driver for clearing an absolute position edge with undefined.
// Runs in a Node child process with FFI enabled because the renderer needs
// native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("setting an absolute edge to undefined clears it so the opposite edge applies", () => {
  runDriver(`
import assert from "node:assert/strict"
import { BoxRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 20, height: 20, useKittyKeyboard: null })
const { renderer } = setup
try {
  const box = new BoxRenderable(renderer, { id: "b", position: "absolute", top: 5, width: 4, height: 2 })
  renderer.root.add(box)
  await setup.renderOnce()
  assert.equal(box.y, 5)
  box.top = undefined
  box.bottom = 0
  await setup.renderOnce()
  assert.equal(box.y, 18)
} finally {
  renderer.destroy()
}
console.log("renderable-position-undefined ok")
`)
})

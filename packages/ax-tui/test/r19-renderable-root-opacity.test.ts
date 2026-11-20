import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression driver for root opacity rendering. Runs in a Node child process
// with FFI enabled because the renderer needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("a translucent root renders without re-entering its own render command", () => {
  runDriver(`
import assert from "node:assert/strict"
import { BoxRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 20, height: 8, useKittyKeyboard: null })
const { renderer } = setup
try {
  renderer.root.opacity = 0.5
  const box = new BoxRenderable(renderer, { id: "b", width: 5, height: 2, backgroundColor: "#ff0000" })
  renderer.root.add(box)
  await setup.renderOnce()
  assert.ok(setup.captureCharFrame().length > 0)
} finally {
  renderer.destroy()
}
console.log("renderable-root-opacity ok")
`)
})

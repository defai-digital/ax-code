import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression driver for primary-axis child sorting after flexDirection
// changes. Runs in a Node child process with FFI enabled because the renderer
// needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("changing flexDirection re-sorts children along the new primary axis", () => {
  runDriver(`
import assert from "node:assert/strict"
import { BoxRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 40, height: 20, useKittyKeyboard: null })
const { renderer } = setup
try {
  const container = new BoxRenderable(renderer, { id: "c", width: 40, height: 20 })
  renderer.root.add(container)
  const a = new BoxRenderable(renderer, { id: "a", position: "absolute", left: 20, top: 0, width: 2, height: 2 })
  const b = new BoxRenderable(renderer, { id: "b", position: "absolute", left: 0, top: 10, width: 2, height: 2 })
  container.add(a)
  container.add(b)
  await setup.renderOnce()
  assert.deepEqual(container.getChildrenSortedByPrimaryAxis().map((r) => r.id), ["a", "b"])
  container.flexDirection = "row"
  await setup.renderOnce()
  assert.deepEqual(container.getChildrenSortedByPrimaryAxis().map((r) => r.id), ["b", "a"])
} finally {
  renderer.destroy()
}
console.log("renderable-flex-direction-sort ok")
`)
})

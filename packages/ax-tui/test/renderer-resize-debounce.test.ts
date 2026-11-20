import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// A same-size resize() asserts the current geometry; it must not cancel a
// debounced SIGWINCH resize that is still waiting to apply.
test.skipIf(!supportsFfi)("same-size resize keeps a pending debounced resize", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"

const { renderer } = await createTestRenderer({
  width: 80,
  height: 24,
  consoleMode: "disabled",
  useThread: false,
  useKittyKeyboard: null,
  memorySnapshotInterval: 0,
})
try {
  // Simulates the SIGWINCH path, which debounces before applying.
  renderer.handleResize(100, 30)
  assert.equal(renderer.width, 80)
  assert.equal(renderer.height, 24)

  renderer.resize(80, 24)
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal(renderer.width, 100)
  assert.equal(renderer.height, 30)
} finally {
  renderer.destroy()
}
console.log("resize debounce checks passed")
`,
    ],
    { encoding: "utf8", timeout: 60_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})
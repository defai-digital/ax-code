import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Regression driver for console clear() scroll reset. Runs in a Node child
// process with FFI enabled because the renderer needs native buffers.
function runDriver(source: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 30_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

test.skipIf(!supportsFfi)("console clear resets the scroll position so new logs are visible", () => {
  runDriver(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({
  width: 30,
  height: 10,
  consoleMode: "console-overlay",
  consoleOptions: { maxDisplayLines: 30, sizePercent: 50 },
})
const cons = setup.renderer.console
try {
  cons.show()
  for (let i = 0; i < 20; i++) console.log("L" + i)
  await setup.renderOnce()
  assert.equal(cons["scrollTopIndex"], 16)
  for (let i = 0; i < 5; i++) cons["scrollUp"]()
  assert.equal(cons["scrollTopIndex"], 11)
  assert.equal(cons["isScrolledToBottom"], false)
  cons.clear()
  console.log("fresh")
  await setup.renderOnce()
  assert.equal(cons["_displayLines"].length, 1)
  assert.equal(cons["scrollTopIndex"], 0)
  assert.equal(cons["isScrolledToBottom"], true)
  assert.ok(setup.captureCharFrame().includes("fresh"))
} finally {
  cons.deactivate()
  setup.renderer.destroy()
}
console.log("console-clear-scroll ok")
`)
})

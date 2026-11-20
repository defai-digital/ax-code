import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

function runFfiScript(script: string) {
  return spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
}

test.skipIf(!supportsFfi)("destroy detaches every child instead of skipping alternate entries", () => {
  const result = runFfiScript(`
import assert from "node:assert/strict"
import { BoxRenderable, TextRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 30, height: 8 })
const { renderer } = setup
try {
  const parent = new BoxRenderable(renderer, {})
  renderer.root.add(parent)
  const children = []
  for (let i = 0; i < 4; i++) {
    const child = new TextRenderable(renderer, { content: "c" + i, height: 1 })
    parent.add(child)
    children.push(child)
  }
  parent.destroy()
  for (const child of children) {
    assert.equal(child.parent, null, "every child must be detached when the parent is destroyed")
  }
  assert.equal(parent.getChildrenCount(), 0)
} finally { renderer.destroy() }
console.log("AX_DESTROY_CHILDREN_COMPLETE")
`)
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_DESTROY_CHILDREN_COMPLETE")
})

test.skipIf(!supportsFfi)("cancelAnimationFrame releases the live request so idle resolves", () => {
  // While paused, requestLive() must not auto-start the loop, so the frame
  // request stays pending and the live-counter bookkeeping is observable.
  const result = runFfiScript(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 20, height: 4 })
const { renderer, renderOnce } = setup
try {
  renderer.pause()
  let fired = 0
  const handle = requestAnimationFrame(() => { fired++ })
  assert.equal(renderer["liveRequestCounter"], 1, "a pending frame request must hold one live request")
  assert.equal(renderer["animationRequest"].size, 1)
  assert.equal(fired, 0)
  cancelAnimationFrame(handle)
  assert.equal(renderer["liveRequestCounter"], 0, "cancelAnimationFrame must release the live request")
  assert.equal(renderer["animationRequest"].size, 0)
  cancelAnimationFrame(999999)
  cancelAnimationFrame(handle)
  assert.equal(renderer["liveRequestCounter"], 0, "stale cancels must not underflow the live counter")
  const handle2 = requestAnimationFrame(() => { fired++ })
  renderer.start()
  await renderOnce()
  assert.equal(fired, 1, "a cancelled callback must never fire; a live one fires exactly once")
  assert.equal(renderer["liveRequestCounter"], 0, "firing a frame request must release its live request")
  renderer.pause()
  await renderer.idle()
} finally { renderer.destroy() }
console.log("AX_CANCEL_RAF_COMPLETE")
`)
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_CANCEL_RAF_COMPLETE")
})

test.skipIf(!supportsFfi)("a throwing frame callback still releases its live request", () => {
  const result = runFfiScript(`
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 20, height: 4 })
const { renderer } = setup
process.on("unhandledRejection", () => {})
try {
  renderer.pause()
  requestAnimationFrame(() => { throw new Error("boom") })
  assert.equal(renderer["liveRequestCounter"], 1)
  renderer.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(renderer["liveRequestCounter"], 0, "a throwing callback must not leak its live request")
  renderer.pause()
  await renderer.idle()
} finally { renderer.destroy() }
console.log("AX_THROWING_RAF_COMPLETE")
`)
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_THROWING_RAF_COMPLETE")
})

test.skipIf(!supportsFfi)("double suspend keeps the pre-suspend state and resume restores rendering", () => {
  const result = runFfiScript(`
import assert from "node:assert/strict"
import { RendererControlState, TextRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 30, height: 5 })
const { renderer, renderOnce, captureCharFrame } = setup
try {
  renderer.start()
  renderer.suspend()
  renderer.suspend()
  renderer.resume()
  assert.equal(renderer["_controlState"], RendererControlState.EXPLICIT_STARTED,
    "double suspend must not clobber the pre-suspend control state")
  const label = new TextRenderable(renderer, { content: "back", height: 1 })
  renderer.root.add(label)
  await renderOnce()
  assert.ok(captureCharFrame().includes("back"), "rendering must work after resume")
  const epoch = renderer["terminalControlEpoch"]
  renderer.resume()
  assert.equal(renderer["terminalControlEpoch"], epoch, "resume without suspend must be a no-op")
  assert.equal(renderer["_controlState"], RendererControlState.EXPLICIT_STARTED)
} finally { renderer.destroy() }
console.log("AX_SUSPEND_RESUME_COMPLETE")
`)
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_SUSPEND_RESUME_COMPLETE")
})

test.skipIf(!supportsFfi)("resume and suspend after destroy are no-ops instead of touching freed native state", () => {
  const result = runFfiScript(`
import assert from "node:assert/strict"
import { RendererControlState } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
const setup = await createTestRenderer({ width: 20, height: 4 })
const { renderer } = setup
renderer.start()
renderer.suspend()
renderer.destroy()
// destroy() finalizes native teardown while the control state can stay
// EXPLICIT_SUSPENDED; resume()/suspend() must not call into the freed renderer.
renderer.resume()
renderer.suspend()
assert.equal(renderer["_controlState"], RendererControlState.EXPLICIT_SUSPENDED)
assert.equal(renderer["_isDestroyed"], true)
console.log("AX_DESTROY_SUSPENDED_COMPLETE")
`)
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_DESTROY_SUSPENDED_COMPLETE")
})

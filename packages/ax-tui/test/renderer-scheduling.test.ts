import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

test.skipIf(!supportsFfi)("idle includes coalesced post-frame microtask updates without overlapping frames", () => {
  const result = spawnSync(process.execPath, ["--experimental-ffi", "--input-type=module", "-e", `
import assert from "node:assert/strict"
import { CliRenderEvents, TextRenderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
for (const maxFps of [30, 1000000]) {
  const setup = await createTestRenderer({ width: 30, height: 4, maxFps, useKittyKeyboard: null })
  const { renderer } = setup
  let active = 0
  let peak = 0
  renderer.setFrameCallback(async () => {
    peak = Math.max(peak, ++active)
    await new Promise(resolve => setImmediate(resolve))
    active--
  })
  try {
    const label = new TextRenderable(renderer, { content: "before", height: 1 })
    renderer.root.add(label)
    await renderer.idle()
    const baseline = renderer.frameId
    renderer.once(CliRenderEvents.FRAME, () => {
      queueMicrotask(() => {
        label.content = "after"
        for (let request = 0; request < 20; request++) renderer.requestRender()
      })
    })
    label.content = "during"
    await renderer.idle()
    const snapshot = { maxFps, frame: renderer.frameId,
      state: renderer.getSchedulerState(), text: setup.captureCharFrame() }
    assert.ok(snapshot.text.includes("after"), "idle must await the microtask repaint: " + JSON.stringify(snapshot))
    assert.equal(peak, 1, "async frame callbacks must never overlap")
    assert.equal(renderer.frameId - baseline, 2, "duplicate requests must coalesce into one follow-up frame")
    const before = renderer.frameId
    await renderer.idle()
    assert.equal(renderer.frameId, before)
  } finally { renderer.destroy() }
}
console.log("AX_SCHEDULER_COMPLETE")
`], { encoding: "utf8", timeout: 10_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } })
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_SCHEDULER_COMPLETE")
})

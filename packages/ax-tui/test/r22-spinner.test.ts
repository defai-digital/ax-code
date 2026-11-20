import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// SpinnerRenderable constructor validation must run before super() so a
// rejected constructor leaks no renderable registration or native yoga node,
// and start() after destroy() must not pin the event loop with an interval
// destroy() can no longer clear. Uses the real Renderable via the package
// self-import — the mocked harness in spinner-renderable.test.ts cannot
// observe either behavior.
test.skipIf(!supportsFfi)("rejected spinner constructors leak nothing and start-after-destroy is a no-op", () => {
  const spinnerUrl = "file://" + path.join(pkgRoot, "spinner", "src", "index.ts")
  const source = `
import assert from "node:assert/strict"
import { Renderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { SpinnerRenderable } from ${JSON.stringify(spinnerUrl)}
const setup = await createTestRenderer({ width: 20, height: 8, useKittyKeyboard: null })
const { renderer } = setup
try {
  const before = Renderable.renderablesByNumber.size
  assert.throws(() => new SpinnerRenderable(renderer, { name: "nonexistent" }), /Unknown spinner preset/)
  assert.throws(() => new SpinnerRenderable(renderer, { interval: -1 }), /Spinner interval/)
  assert.throws(() => new SpinnerRenderable(renderer, { interval: NaN }), /Spinner interval/)
  assert.equal(Renderable.renderablesByNumber.size, before, "rejected constructors must not register renderables")
  const spinner = new SpinnerRenderable(renderer, { autoplay: false })
  assert.equal(Renderable.renderablesByNumber.size, before + 1)
  assert.equal(spinner.running, false)
  spinner.destroy()
  assert.equal(Renderable.renderablesByNumber.size, before)
  spinner.start()
  assert.equal(spinner.running, false, "start() after destroy() must not start the interval")
  const framesBefore = spinner.frames
  spinner.frames = ["x", "y"]
  assert.deepEqual(spinner.frames, framesBefore, "frames setter after destroy() must be a no-op")
  spinner.name = "line"
  assert.deepEqual(spinner.frames, framesBefore, "name setter after destroy() must be a no-op")
  spinner.destroy()
} finally {
  renderer.destroy()
}
assert.equal(Renderable.renderablesByNumber.size, 0)
process.stdout.write("AX_SPINNER_SCENARIO_COMPLETE")
`
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--import", "tsx/esm", "--input-type=module", "-e", source],
    { cwd: pkgRoot, encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expect(result.stdout, result.stderr).toContain("AX_SPINNER_SCENARIO_COMPLETE")
}, 30_000)

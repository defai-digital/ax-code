import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// A ChartRenderable whose options fail validation must not leave a registered
// renderable behind: the base constructor allocates a num and inserts it into
// Renderable.renderablesByNumber, so validation has to run before super().
// Uses the real Renderable (package self-import) — the mocked harness in
// chart-renderable.test.ts cannot observe the registry.
test.skipIf(!supportsFfi)(
  "a rejected ChartRenderable constructor leaks no renderable registration",
  () => {
    const chartUrl = "file://" + path.join(pkgRoot, "chart", "src", "renderables.ts")
    const source = `
import assert from "node:assert/strict"
import { Renderable } from "@defai-digital/ax-tui"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { ChartRenderable } from ${JSON.stringify(chartUrl)}
const setup = await createTestRenderer({ width: 20, height: 8, useKittyKeyboard: null })
const { renderer } = setup
try {
  const before = Renderable.renderablesByNumber.size
  assert.throws(() => new ChartRenderable(renderer, { xAxis: {} }), TypeError)
  assert.throws(() => new ChartRenderable(renderer, { yAxis: { bounds: [0, NaN] } }), TypeError)
  assert.equal(Renderable.renderablesByNumber.size, before, "rejected constructors must not register renderables")
  const chart = new ChartRenderable(renderer, { xAxis: { bounds: [0, 1] }, yAxis: { bounds: [0, 1] } })
  assert.equal(Renderable.renderablesByNumber.size, before + 1)
  chart.destroy()
  assert.equal(Renderable.renderablesByNumber.size, before)
} finally {
  renderer.destroy()
}
assert.equal(Renderable.renderablesByNumber.size, 0)
process.stdout.write("AX_SCENARIO_COMPLETE")
`
    const result = spawnSync(
      process.execPath,
      ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--import", "tsx/esm", "--input-type=module", "-e", source],
      { cwd: pkgRoot, encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
    )
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout, result.stderr).toContain("AX_SCENARIO_COMPLETE")
  },
  30_000,
)

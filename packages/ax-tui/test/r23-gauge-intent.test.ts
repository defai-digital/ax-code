import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// A gauge label drawn over the fill must carry default-color intent: an
// RGBA(0,0,0,0) "transparent" foreground blends to the fill color on
// translucent fills (invisible) and emits literal RGB black on opaque fills
// (black-on-black). Uses the real renderable via the source import.
test.skipIf(!supportsFfi)("gauge label foreground over the fill uses default color intent", () => {
  const renderablesUrl = "file://" + path.join(pkgRoot, "chart", "src", "renderables.ts")
  const source = `
import assert from "node:assert/strict"
import { createTestRenderer } from "@defai-digital/ax-tui/testing"
import { GaugeRenderable } from ${JSON.stringify(renderablesUrl)}
const setup = await createTestRenderer({ width: 20, height: 4, useKittyKeyboard: null })
const { renderer } = setup
try {
  for (const color of ["black", "#ffffff80"]) {
    const gauge = new GaugeRenderable(renderer, { ratio: 1, color, width: 10, height: 1, label: "100%" })
    renderer.root.add(gauge)
    await setup.renderOnce()
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans).filter((s) => s.text.trim().length > 0)
    const labelSpan = spans.find((s) => s.text.includes("%"))
    assert.ok(labelSpan, "label span missing for " + color)
    assert.equal(labelSpan.fg.intent, "default", "label fg intent over " + color + " (text " + JSON.stringify(labelSpan.text) + ")")
    renderer.root.remove(gauge.id)
    gauge.destroy()
  }
} finally {
  renderer.destroy()
}
process.stdout.write("AX_GAUGE_INTENT_COMPLETE")
`
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--import", "tsx/esm", "--input-type=module", "-e", source],
    { cwd: pkgRoot, encoding: "utf8", timeout: 20_000, env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" } },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expect(result.stdout, result.stderr).toContain("AX_GAUGE_INTENT_COMPLETE")
}, 30_000)

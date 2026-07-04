// ADR-046 Slice C3a — vitest harness for the Rust TextBuffer FFI surface.
// Spawns a child node process with --experimental-ffi to exercise the
// TextBuffer, SyntaxStyle, highlight, and mem-registry APIs through the
// @ax-code/render napi addon.
//
// When the Rust addon has not been built locally the suite skips (exit 2).

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const addonBuilt = existsSync(
  path.resolve(pkgDir, "..", "ax-code-render-native", "ax-code-render.node"),
)

const runNode = (args: string[]) =>
  spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", ...args],
    { cwd: pkgDir, encoding: "utf8", env: { ...process.env }, timeout: 30_000 },
  )

describe.skipIf(!addonBuilt)("native render text-buffer (Rust FFI)", () => {
  it("TextBuffer lifecycle, styled text, append, metrics, reset/clear, mem registry, ranges, highlights, and syntax styles", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-text-buffer-probe.mjs")])
    expect(result.stderr).not.toContain("check(s) failed")
    expect(result.stdout).toContain("text-buffer probe: PASS")
    expect(result.status).toBe(0)
  })
})

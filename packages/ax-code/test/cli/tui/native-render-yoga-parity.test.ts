// ADR-046 Phase 1 regression: the @ax-code/render Rust yoga backend must stay
// byte-equivalent to the bundled Zig backend, and the AX_CODE_NATIVE_RENDER
// overlay must actually engage (not silently fall back).
//
// Vitest workers do not run with --experimental-ffi, so both checks spawn a
// child node process the same way the shipped launcher does. When the Rust
// addon has not been built locally (probe exits 2), the suite skips instead
// of failing — CI lanes without a cargo toolchain stay green.

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const addonBuilt = existsSync(
  path.resolve(pkgDir, "..", "ax-code-render-native", `ax-code-render.node`),
)

const runNode = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", ...args],
    { cwd: pkgDir, encoding: "utf8", env: { ...process.env, ...env }, timeout: 120_000 },
  )

describe.skipIf(!addonBuilt)("native render yoga parity (ADR-046 Phase 1)", () => {
  it("matches the Zig backend op-for-op", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-parity-probe.mjs")])
    // The addon .node exists (describe-level gate), so a "not built" exit here
    // means broken resolution, not a missing build — fail loudly.
    expect(result.stderr).not.toContain("PARITY MISMATCH")
    expect(result.stdout).toContain("yoga parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("unicode width/grapheme core matches the Zig encodeUnicode oracle", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-unicode-parity.mjs"), "--fuzz=500"])
    expect(result.stderr).not.toContain("mismatching")
    expect(result.stdout).toContain("unicode parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("cell-buffer core matches the Zig backend plane-for-plane", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-buffer-parity.mjs"), "--seqs=100"])
    expect(result.stderr).not.toContain("failing sequence")
    expect(result.stdout).toContain("buffer parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("text-buffer core matches the Zig backend", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-text-parity.mjs"), "--seqs=100"])
    expect(result.stderr).not.toContain("failing sequence")
    expect(result.stdout).toContain("text parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("overlay engages under AX_CODE_NATIVE_RENDER=1 (audio-stub fingerprint)", () => {
    const fingerprint = `
      import { Yoga } from "@ax-code/opentui-core"
      const { resolveRenderLib } = await import("@ax-code/opentui-core")
      Yoga.Node.createForOpenTUI()
      const engine = resolveRenderLib().opentui.symbols.createAudioEngine(0)
      console.log("engine:" + engine)
    `
    const on = runNode(["--input-type=module", "-e", fingerprint], { AX_CODE_NATIVE_RENDER: "1" })
    expect(on.stdout).toContain("engine:0")
    expect(on.stderr).not.toContain("failed to load")

    const off = runNode(["--input-type=module", "-e", fingerprint])
    expect(off.stdout).toMatch(/engine:[1-9]/)
  })
})

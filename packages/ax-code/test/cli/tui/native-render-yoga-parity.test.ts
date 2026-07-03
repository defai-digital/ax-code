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

  it("bufferDrawTextBufferView matches the Zig backend plane-for-plane", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-textview-draw-parity.mjs"), "--seqs=100"])
    expect(result.stderr).not.toContain("failing sequence")
    expect(result.stdout).toContain("textview draw parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("CliRenderer escape output matches the Zig backend byte-for-byte", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-renderer-parity.mjs"), "--seqs=100"])
    expect(result.stderr).not.toContain("escape output differs")
    expect(result.stdout).toContain("renderer parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("editorView (cursor/viewport/visual moves/selection) matches the Zig backend", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-editorview-parity.mjs"), "--seqs=150"])
    expect(result.stderr).not.toContain("state differs")
    expect(result.stdout).toContain("editorview parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("native-span-feed (write/commit/drain + render routing) matches the Zig backend", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-feed-parity.mjs"), "--seqs=150"])
    expect(result.stderr).not.toContain("failing check")
    expect(result.stdout).toContain("feed parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("split-footer scrollback (offsets + repaint) matches the Zig backend", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-split-parity.mjs"), "--seqs=200"])
    expect(result.stderr).not.toContain("failing check")
    expect(result.stdout).toContain("split parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("getRenderStats deterministic fields match the Zig backend", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-stats-parity.mjs"), "--seqs=100"])
    expect(result.stderr).not.toContain("failing sequence")
    expect(result.stdout).toContain("stats parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("hit grid (addToHitGrid/checkHit/scissor) matches the Zig backend", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-hitgrid-parity.mjs"), "--seqs=200"])
    expect(result.stderr).not.toContain("failing sequence")
    expect(result.stdout).toContain("hitgrid parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("rendererSetPaletteState nearest-palette output matches the Zig backend", () => {
    // Self-spawns under an ansi256-only profile so the custom palette is
    // actually consulted (emitColor's nearest-palette fallback).
    const result = runNode([path.join(pkgDir, "script/native-render-palette-parity.mjs"), "--seqs=60"])
    expect(result.stderr).not.toContain("palette output differs")
    expect(result.stdout).toContain("palette parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("setupTerminal/restoreTerminalModes/clearTerminal escape output matches the Zig backend", () => {
    // Drives the stdout backend in child processes and diffs the emitted
    // control sequences (dumpOutputBuffer can't see writeOut output).
    const result = runNode([path.join(pkgDir, "script/native-render-tty-parity.mjs")])
    expect(result.stderr).not.toContain("escape output differs")
    expect(result.stdout).toContain("tty parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("processCapabilityResponse DECRPM/sixel/osc52 capability updates match the Zig backend", () => {
    const result = runNode([path.join(pkgDir, "script/native-render-pcr-parity.mjs")])
    expect(result.stderr).not.toContain("pcr caps differ")
    expect(result.stdout).toContain("pcr parity: MATCH")
    expect(result.status).toBe(0)
  })

  it("render pipeline byte-matches the goldens by DEFAULT (Rust) and under the =0 off-switch (Zig)", () => {
    // ADR-046: the render pipeline now routes to the Rust addon BY DEFAULT (no
    // env) — the path real users get. AX_CODE_NATIVE_RENDER=0 forces the bundled
    // Zig library. Both must byte-match the committed goldens, proving the Rust
    // render core is frame-parity across yoga layout, styled attributes, CJK/
    // emoji wrapping, alpha blending, scroll offset, selection, and the command-
    // palette popup — through the real OpenTUI renderable layer.
    const goldens = (env: Record<string, string>) =>
      runNode(["--import", "tsx", "--conditions=node", path.join(pkgDir, "script/check-golden-frames.ts")], env)

    const rustDefault = goldens({})
    expect(rustDefault.stderr).not.toContain("frame drift")
    expect(rustDefault.stdout).toContain("all golden frames match")
    expect(rustDefault.status).toBe(0)

    const zigOff = goldens({ AX_CODE_NATIVE_RENDER: "0" })
    expect(zigOff.stderr).not.toContain("frame drift")
    expect(zigOff.stdout).toContain("all golden frames match")
    expect(zigOff.status).toBe(0)
  })

  it("render routes to Rust by default, and to Zig under =0 / SCOPE=yoga", () => {
    // getBuildOptions is a documented no-op in the Rust addon but populated by
    // the Zig dylib, so it distinguishes which backend the render family uses.
    const probe = `
      import { createRequire } from "node:module"
      const require = createRequire(import.meta.url)
      const ffi = require("node:ffi")
      const { resolveRenderLib } = await import("@ax-code/opentui-core")
      const sym = resolveRenderLib().opentui.symbols
      const buf = new Uint8Array(64).fill(0xAB)
      const p = ffi.getRawPointer(buf)
      sym.getBuildOptions(typeof p === "bigint" ? Number(p) : p)
      console.log(buf.every((b) => b === 0xAB) ? "render:RUST" : "render:ZIG")
    `
    const render = (env: Record<string, string>) => runNode(["--input-type=module", "-e", probe], env).stdout
    expect(render({})).toContain("render:RUST") // default
    expect(render({ AX_CODE_NATIVE_RENDER: "0" })).toContain("render:ZIG") // off-switch
    expect(render({ AX_CODE_NATIVE_RENDER_SCOPE: "yoga" })).toContain("render:ZIG") // escape hatch
  })

  it("overlay engages by default and disengages under =0 (audio-stub fingerprint)", () => {
    const fingerprint = `
      import { Yoga } from "@ax-code/opentui-core"
      const { resolveRenderLib } = await import("@ax-code/opentui-core")
      Yoga.Node.createForOpenTUI()
      const engine = resolveRenderLib().opentui.symbols.createAudioEngine(0)
      console.log("engine:" + engine)
    `
    // Default (no env): the Rust addon's audio stub returns handle 0.
    const on = runNode(["--input-type=module", "-e", fingerprint])
    expect(on.stdout).toContain("engine:0")
    expect(on.stderr).not.toContain("failed to load")

    // Off-switch: the bundled Zig backend returns a non-zero engine handle.
    const off = runNode(["--input-type=module", "-e", fingerprint], { AX_CODE_NATIVE_RENDER: "0" })
    expect(off.stdout).toMatch(/engine:[1-9]/)
  })
})

// ADR-046 Slice E follow-up: TTY control-sequence parity for the Rust
// CliRenderer vs the Zig backend (setupTerminal / restoreTerminalModes /
// clearTerminal / setCursorPosition).
//
// These symbols emit through the backend's writeOut channel — NOT the A/B
// frame diff — so dumpOutputBuffer can't observe them. Instead we drive the
// STDOUT backend (bufferedDestinationKind=0): each side runs in its own child
// process, calls the setup/teardown symbols, and the escape bytes land on the
// child's stdout, which the parent captures and diffs byte-for-byte.
//
// The escape output branches on terminal capabilities (rgb/ansi256/tmux/foot/
// unicode), and both children inherit the same spawn env, so mirroring
// checkEnvironmentOverrides makes the two sides agree. The parent runs several
// forced capability profiles to exercise the branchy paths.
//
// Run:  node --experimental-ffi script/native-render-tty-parity.mjs
// Child (internal): --emit=<zig|rust>  (writes raw escape bytes to stdout)
// Exit: 0 = parity, 1 = mismatch, 2 = rust renderer symbols not built.

import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const SELF = fileURLToPath(import.meta.url)
const W = 12
const H = 5

// --- child: emit escape bytes for one backend to stdout ----------------------

async function runChild(which) {
  const require = createRequire(import.meta.url)
  const ffi = require("node:ffi")
  let sym
  if (which === "zig") {
    const { resolveRenderLib } = await import("@ax-code/opentui-core")
    sym = resolveRenderLib().opentui.symbols
  } else {
    let rust
    try {
      rust = require("@ax-code/render")
    } catch {
      rust = null
    }
    if (!rust || typeof rust.setupTerminal !== "function") {
      process.exit(2) // symbols not built
    }
    sym = rust
  }

  const rh = sym.createRenderer(W, H, 0, 1, 0) // stdout backend, remote_mode=local
  if (!rh) {
    process.stderr.write(`child ${which}: createRenderer failed\n`)
    process.exit(3)
  }

  // Full setup/teardown surface: setup handshake, a focus-in restore re-emit,
  // a clear, then suspend (performShutdownSequence) / resume
  // (setupTerminalWithoutDetection) / destroy (performShutdownSequence again).
  // setCursorPosition mutates state only (verified via the memory render
  // harness), so it is not exercised here.
  sym.setupTerminal(rh, 0) // useAlternateScreen = false
  sym.restoreTerminalModes(rh)

  // Input-mode + query emitters (all writeOut escape sequences).
  const isZig = which === "zig"
  const p = (v) => (isZig ? ffi.getRawPointer(v) : Number(ffi.getRawPointer(v)))
  sym.enableKittyKeyboard(rh, 7)
  sym.enableMouse(rh, 1)
  sym.enableMouse(rh, 0) // toggle movement off (exercises the disableAnyEventTracking branch)
  const title = new TextEncoder().encode("ax-code")
  sym.setTerminalTitle(rh, p(title), title.length)
  sym.queryThemeColors(rh)
  sym.queryPixelResolution(rh)
  const clip = new TextEncoder().encode("SGVsbG8=")
  sym.copyToClipboardOSC52(rh, 0, p(clip), clip.length)
  sym.clearClipboardOSC52(rh, 0)
  sym.disableMouse(rh)
  sym.disableKittyKeyboard(rh)

  sym.clearTerminal(rh)
  sym.suspendRenderer(rh)
  sym.resumeRenderer(rh)
  sym.destroyRenderer(rh) // emits performShutdownSequence, then frees
  process.exit(0)
}

// --- parent: spawn both children per profile and diff ------------------------

function capture(which, env) {
  return spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", SELF, `--emit=${which}`],
    { env, timeout: 60_000 },
  )
}

function baseEnv(overrides) {
  const env = { ...process.env }
  // Clear anything that would perturb capability detection so each profile is
  // deterministic regardless of the ambient terminal.
  for (const k of ["COLORTERM", "WT_SESSION", "TMUX", "STY", "TERM_PROGRAM", "ALACRITTY_SOCKET", "ALACRITTY_LOG", "ZELLIJ", "ZELLIJ_SESSION_NAME", "ZELLIJ_PANE_ID"]) {
    delete env[k]
  }
  return { ...env, ...overrides }
}

const PROFILES = [
  { name: "truecolor xterm", env: { TERM: "xterm-256color", COLORTERM: "truecolor" } },
  { name: "ansi256 only", env: { TERM: "xterm-256color" } },
  { name: "tmux", env: { TERM: "tmux-256color", TMUX: "/tmp/tmux-1/default,1,0", COLORTERM: "truecolor" } },
  { name: "foot", env: { TERM: "foot", COLORTERM: "truecolor" } },
  { name: "no color", env: { TERM: "dumb" } },
]

const emitArg = process.argv.find((a) => a.startsWith("--emit="))
if (emitArg) {
  await runChild(emitArg.slice(7))
} else {
  let failures = 0
  for (const profile of PROFILES) {
    const env = baseEnv(profile.env)
    const zig = capture("zig", env)
    const rust = capture("rust", env)

    if (rust.status === 2) {
      console.log("tty parity: RUST RENDERER SYMBOLS NOT BUILT — skipping")
      process.exit(2)
    }
    if (zig.status !== 0 || rust.status !== 0) {
      console.error(`✗ ${profile.name}: child exit z=${zig.status} r=${rust.status}`)
      if (zig.stderr?.length) console.error(`  zig stderr: ${zig.stderr}`)
      if (rust.stderr?.length) console.error(`  rust stderr: ${rust.stderr}`)
      failures++
      continue
    }

    const zHex = zig.stdout.toString("hex")
    const rHex = rust.stdout.toString("hex")
    if (zHex !== rHex) {
      console.error(`✗ ${profile.name}: escape output differs`)
      console.error(`  zig  (${zig.stdout.length}B): ${zHex.slice(0, 300)}`)
      console.error(`  rust (${rust.stdout.length}B): ${rHex.slice(0, 300)}`)
      failures++
    } else {
      console.log(`  ✓ ${profile.name} (${zig.stdout.length}B)`)
    }
  }

  if (failures > 0) {
    console.error(`\ntty parity: ${failures} failing profile(s) of ${PROFILES.length}`)
    process.exit(1)
  }
  console.log(`tty parity: MATCH (${PROFILES.length} profiles)`)
  process.exit(0)
}

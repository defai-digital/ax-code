// ADR-046 Slice E: rendererSetPaletteState parity (Rust vs Zig).
//
// setPaletteState's only emit-path effect is palette_rgba, consulted by the
// nearest-palette fallback in emitColor when the terminal is ansi256 WITHOUT
// truecolor (rgb=false). So this harness pins that profile — it re-spawns
// itself with COLORTERM/WT_SESSION cleared and TERM=xterm-256color — then, in
// the child, installs a random 256-entry palette on both backends, draws an
// identical frame of rgb-intent colors (every cell's fg resolves through the
// custom palette), renders into memory, and diffs the dumped ANSI byte-for-byte.
//
// Run:  node --experimental-ffi script/native-render-palette-parity.mjs [--seqs=N]
// Exit: 0 = parity, 1 = mismatch, 2 = rust symbols not built.

import { createRequire } from "node:module"
import { readFileSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const SELF = fileURLToPath(import.meta.url)
const seqArg = process.argv.find((a) => a.startsWith("--seqs="))
const SEQUENCES = seqArg ? Number(seqArg.slice(7)) : 200

// --- parent: re-spawn with an ansi256-only env so rgb=false ------------------
if (!process.argv.includes("--child")) {
  const env = { ...process.env }
  for (const k of ["COLORTERM", "WT_SESSION", "TMUX", "STY", "TERM_PROGRAM", "ALACRITTY_SOCKET", "ALACRITTY_LOG", "ZELLIJ", "ZELLIJ_SESSION_NAME", "ZELLIJ_PANE_ID"]) {
    delete env[k]
  }
  env.TERM = "xterm-256color"
  const r = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", SELF, "--child", `--seqs=${SEQUENCES}`],
    { stdio: "inherit", env },
  )
  process.exit(r.status ?? 1)
}

// --- child: differential comparison under the pinned profile -----------------
const require = createRequire(import.meta.url)
const ffi = require("node:ffi")
// ADR-046: the native-render overlay is ON BY DEFAULT; force the bundled Zig
// library for this differential harness's reference side. require("@ax-code/render")
// below still returns the raw Rust addon to compare against.
process.env.AX_CODE_NATIVE_RENDER = "0"
const { resolveRenderLib } = await import("@ax-code/opentui-core")
const zig = resolveRenderLib().opentui.symbols

let rust = null
try {
  rust = require("@ax-code/render")
} catch {
  rust = null
}
if (!rust || typeof rust.rendererSetPaletteState !== "function") {
  console.log("palette parity: RUST rendererSetPaletteState NOT BUILT — skipping")
  process.exit(2)
}

const ptr = (v) => ffi.getRawPointer(v)
const enc = new TextEncoder()
const keep = []
let seed = 0x51ed77
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000)
const randInt = (n) => Math.floor(rand() * n)

function packColor(r, g, b, a) {
  const arr = new Uint16Array([r & 0xff, g & 0xff, b & 0xff, a & 0xff])
  keep.push(arr)
  return arr
}

const HEADER_MARKER = "================\n"
function captureDump(sym, rh, isZig, ts) {
  try {
    rmSync("buffer_dump", { recursive: true, force: true })
  } catch {}
  sym.dumpOutputBuffer(rh, isZig ? BigInt(ts) : ts)
  const raw = readFileSync(`buffer_dump/output_buffer_${ts}.txt`).toString("latin1")
  const idx = raw.indexOf(HEADER_MARKER)
  const body = idx >= 0 ? raw.slice(idx + HEADER_MARKER.length) : raw
  const f = body.indexOf("\nBuffer size:")
  const ansi = f >= 0 ? body.slice(0, f) : body
  return Buffer.from(ansi, "latin1").toString("hex")
}

function setPalette(sym, rh, isZig, palette, fg, bg, epoch) {
  sym.rendererSetPaletteState(
    rh,
    isZig ? ptr(palette) : Number(ptr(palette)),
    256,
    isZig ? ptr(fg) : Number(ptr(fg)),
    isZig ? ptr(bg) : Number(ptr(bg)),
    epoch,
  )
}

function drawFrame(sym, rh, isZig, w, h) {
  const buf = sym.getNextBuffer(rh)
  const n = 1 + randInt(3)
  for (let i = 0; i < n; i++) {
    const s = ["Hi", "world", "café", "混合", "ab", "x"][randInt(6)]
    const t = enc.encode(s)
    keep.push(t)
    const x = randInt(w)
    const y = randInt(h)
    const fg = packColor(randInt(256), randInt(256), randInt(256), 255)
    const bg = rand() < 0.4 ? packColor(randInt(256), randInt(256), randInt(256), 255) : null
    sym.bufferDrawText(
      buf,
      isZig ? ptr(t) : Number(ptr(t)),
      t.length,
      x,
      y,
      isZig ? ptr(fg) : Number(ptr(fg)),
      bg ? (isZig ? ptr(bg) : Number(ptr(bg))) : 0,
      0,
    )
  }
}

let failures = 0
for (let s = 0; s < SEQUENCES; s++) {
  const w = 4 + randInt(16)
  const h = 2 + randInt(6)
  const zh = zig.createRenderer(w, h, 1, 1, 0)
  const rh = rust.createRenderer(w, h, 1, 1, 0)

  // Random 256-entry palette + defaults, shared by both backends.
  const palette = new Uint16Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    palette[i * 4] = randInt(256)
    palette[i * 4 + 1] = randInt(256)
    palette[i * 4 + 2] = randInt(256)
    palette[i * 4 + 3] = 255
  }
  keep.push(palette)
  const defFg = packColor(randInt(256), randInt(256), randInt(256), 255)
  const defBg = packColor(randInt(256), randInt(256), randInt(256), 255)
  const epoch = s + 1

  setPalette(zig, zh, true, palette, defFg, defBg, epoch)
  setPalette(rust, rh, false, palette, defFg, defBg, epoch)

  const saved = seed
  drawFrame(zig, zh, true, w, h)
  seed = saved
  drawFrame(rust, rh, false, w, h)

  zig.render(zh, 1)
  rust.render(rh, 1)

  const z = captureDump(zig, zh, true, 2000 + s * 2)
  const r = captureDump(rust, rh, false, 2000 + s * 2 + 1)
  if (z !== r) {
    console.error(`✗ seq ${s} (${w}x${h}): palette output differs`)
    console.error(`  zig : ${z.slice(0, 240)}`)
    console.error(`  rust: ${r.slice(0, 240)}`)
    failures++
    if (failures >= 5) break
  }
  zig.destroyRenderer(zh)
  rust.destroyRenderer(rh)
}

if (failures > 0) {
  console.error(`\npalette parity: ${failures} failing frame(s) of ${SEQUENCES}`)
  process.exit(1)
}
console.log(`palette parity: MATCH (${SEQUENCES} frames, ansi256 nearest-palette)`)
process.exit(0)

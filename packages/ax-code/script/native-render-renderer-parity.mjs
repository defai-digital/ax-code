// ADR-046 Slice E parity harness: CliRenderer escape-sequence output vs the
// Zig backend. Both backends render identical frames into a MEMORY-backed
// renderer (bufferedDestinationKind=1, no TTY needed), dump the committed
// ANSI stream via dumpOutputBuffer, and the streams are compared byte-for-byte.
//
// This is the verification gate for the Slice E renderer port. Until the Rust
// @ax-code/render addon exports createRenderer/getNextBuffer/render/
// dumpOutputBuffer, the harness runs the Zig side only and reports the
// captured reference so the port has a concrete target (exit 2 = Rust
// renderer symbols not yet present).
//
// Run: node --experimental-ffi script/native-render-renderer-parity.mjs [--seqs=N]
// Exit: 0 = parity (or reference-capture mode), 1 = mismatch, 2 = addon/symbols
//       not built.
//
// Capability note: the escape output branches on terminal capabilities
// (truecolor rgb, ansi256, hyperlinks, explicit_width,
// explicit_cursor_positioning, cursor color/style). The memory-backed renderer
// reports a fixed default profile; the Rust port MUST report the identical
// profile for byte parity. The reference profile observed for v0.4.1 memory
// mode: rgb=true (fg/bg emitted as `38;2;R;G;B` / `48;2;R;G;B`), synchronized
// update (BSU `\x1b[?2026h` / ESU `\x1b[?2026l`), cursor hide/show around the
// frame, default fg = white (255,255,255), default bg = `\x1b[49m`, empty
// cells painted with default fg + spaces, trailing cursor color
// (`\x1b]12;#RRGGBB\x07`) + cursor style (`\x1b[0 q`) + home + show.

import { createRequire } from "node:module"
import { readFileSync, rmSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

const ptr = (v) => ffi.getRawPointer(v)
const enc = new TextEncoder()
const keep = []

let seed = 0x9e3d71
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000)
const randInt = (n) => Math.floor(rand() * n)

function packColor(r, g, b, a) {
  const arr = new Uint16Array([r & 0xff, g & 0xff, b & 0xff, a & 0xff])
  keep.push(arr)
  return arr
}

// Header written by dumpOutputBuffer before the ANSI body.
const HEADER_MARKER = "================\n"

function captureDump(sym, rendererHandle, isZig, tsBase) {
  // Each capture writes buffer_dump/output_buffer_<ts>.txt in cwd.
  const ts = tsBase
  try {
    rmSync("buffer_dump", { recursive: true, force: true })
  } catch {}
  sym.dumpOutputBuffer(rendererHandle, isZig ? BigInt(ts) : ts)
  const raw = readFileSync(`buffer_dump/output_buffer_${ts}.txt`).toString("latin1")
  const idx = raw.indexOf(HEADER_MARKER)
  const body = idx >= 0 ? raw.slice(idx + HEADER_MARKER.length) : raw
  // Drop the trailing "Buffer size: N bytes\nActive buffer: ...\n..." footer:
  // the ANSI body ends at the first line that starts with "Buffer size:".
  const footerIdx = body.indexOf("\nBuffer size:")
  const ansi = footerIdx >= 0 ? body.slice(0, footerIdx) : body
  return Buffer.from(ansi, "latin1").toString("hex")
}

// One randomized frame drawn identically into a renderer's next buffer.
function drawFrame(sym, rendererHandle, isZig, w, h) {
  const buf = sym.getNextBuffer(rendererHandle)
  const nStrings = 1 + randInt(3)
  for (let i = 0; i < nStrings; i++) {
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

const seqArg = process.argv.find((a) => a.startsWith("--seqs="))
const SEQUENCES = seqArg ? Number(seqArg.slice(7)) : 200

if (!rust || typeof rust.createRenderer !== "function") {
  // Reference-capture mode: no Rust renderer yet. Prove the harness works
  // against Zig and print one captured frame so the port has a target.
  const rh = zig.createRenderer(6, 2, 1, 1, 0)
  if (!rh) {
    console.error("failed to create Zig memory renderer")
    process.exit(2)
  }
  drawFrame(zig, rh, true, 6, 2)
  zig.render(rh, 1)
  const hex = captureDump(zig, rh, true, 111)
  console.log("renderer parity: RUST RENDERER SYMBOLS NOT BUILT — reference-capture mode")
  console.log(`  captured Zig frame (${hex.length / 2} bytes): ${hex.slice(0, 200)}${hex.length > 200 ? "…" : ""}`)
  process.exit(2)
}

let failures = 0
for (let s = 0; s < SEQUENCES; s++) {
  const w = 4 + randInt(20)
  const h = 2 + randInt(8)
  const zh = zig.createRenderer(w, h, 1, 1, 0)
  const rh = rust.createRenderer(w, h, 1, 1, 0)
  if (!zh || !rh) {
    console.error(`seq ${s}: renderer creation failed z=${zh} r=${rh}`)
    failures++
    continue
  }
  // Draw the SAME frame into both (re-seed so the RNG stream matches).
  const savedSeed = seed
  drawFrame(zig, zh, true, w, h)
  seed = savedSeed
  drawFrame(rust, rh, false, w, h)

  zig.render(zh, 1)
  rust.render(rh, 1)

  const zHex = captureDump(zig, zh, true, 1000 + s * 2)
  const rHex = captureDump(rust, rh, false, 1000 + s * 2 + 1)
  if (zHex !== rHex) {
    console.error(`✗ seq ${s} (${w}x${h}): escape output differs`)
    console.error(`  zig : ${zHex.slice(0, 240)}`)
    console.error(`  rust: ${rHex.slice(0, 240)}`)
    failures++
    if (failures >= 5) break
  }
  zig.destroyRenderer(zh)
  rust.destroyRenderer(rh)
}

if (failures > 0) {
  console.error(`\nrenderer parity: ${failures} failing frame(s) of ${SEQUENCES}`)
  process.exit(1)
}
console.log(`renderer parity: MATCH (${SEQUENCES} frames)`)
process.exit(0)

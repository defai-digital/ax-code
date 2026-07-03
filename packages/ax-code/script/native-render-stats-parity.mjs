// ADR-046 Slice E: getRenderStats parity (Rust vs Zig), deterministic subset.
// The stats out-struct's timing fields (last/average frame time, render time,
// write time) are wall-clock and NOT comparable; the deterministic surface is
// frame_count, cells_updated, average_cells_updated, and the two *_valid flags.
// Both backends run identical render cycles; this harness reads those fields
// from the ExternalRenderStats out-struct and diffs them.
//
// Run:  node --experimental-ffi script/native-render-stats-parity.mjs [--seqs=N]
// Exit: 0 = parity, 1 = mismatch, 2 = rust symbols not built.

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const ffi = require("node:ffi")
const { resolveRenderLib } = await import("@ax-code/opentui-core")
const zig = resolveRenderLib().opentui.symbols

let rust = null
try {
  rust = require("@ax-code/render")
} catch {
  rust = null
}
if (!rust || typeof rust.getRenderStats !== "function") {
  console.log("stats parity: RUST getRenderStats NOT BUILT — skipping")
  process.exit(2)
}

const ptr = (v) => ffi.getRawPointer(v)
const enc = new TextEncoder()
const keep = []
let seed = 0x5a7c1
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000)
const randInt = (n) => Math.floor(rand() * n)

function packColor(r, g, b, a) {
  const arr = new Uint16Array([r & 0xff, g & 0xff, b & 0xff, a & 0xff])
  keep.push(arr)
  return arr
}

function drawFrame(sym, rh, isZig, w, h) {
  const buf = sym.getNextBuffer(rh)
  const n = 1 + randInt(3)
  for (let i = 0; i < n; i++) {
    const s = ["Hi", "world", "ab", "x"][randInt(4)]
    const t = enc.encode(s)
    keep.push(t)
    const fg = packColor(randInt(256), randInt(256), randInt(256), 255)
    sym.bufferDrawText(buf, isZig ? ptr(t) : Number(ptr(t)), t.length, randInt(w), randInt(h), isZig ? ptr(fg) : Number(ptr(fg)), 0, 0)
  }
}

// Read the deterministic ExternalRenderStats fields into a comparable tuple.
function readStats(sym, rh, isZig) {
  const buf = new Uint8Array(56)
  keep.push(buf)
  sym.getRenderStats(rh, isZig ? ptr(buf) : Number(ptr(buf)))
  const dv = new DataView(buf.buffer)
  return {
    frameCount: dv.getBigUint64(32, true).toString(),
    cellsUpdated: dv.getUint32(40, true),
    avgCells: dv.getUint32(44, true),
    renderValid: buf[48],
    writeValid: buf[49],
  }
}

const seqArg = process.argv.find((a) => a.startsWith("--seqs="))
const SEQUENCES = seqArg ? Number(seqArg.slice(7)) : 200

let failures = 0
for (let s = 0; s < SEQUENCES; s++) {
  const w = 4 + randInt(14)
  const h = 2 + randInt(6)
  const zh = zig.createRenderer(w, h, 1, 1, 0)
  const rh = rust.createRenderer(w, h, 1, 1, 0)

  // Stats before any render should match (both zeroed / invalid).
  const z0 = readStats(zig, zh, true)
  const r0 = readStats(rust, rh, false)
  if (JSON.stringify(z0) !== JSON.stringify(r0)) {
    console.error(`✗ seq ${s} pre-render: ${JSON.stringify(z0)} vs ${JSON.stringify(r0)}`)
    failures++
    if (failures >= 5) break
    continue
  }

  const cycles = 1 + randInt(5)
  for (let k = 0; k < cycles; k++) {
    const saved = seed
    drawFrame(zig, zh, true, w, h)
    seed = saved
    drawFrame(rust, rh, false, w, h)
    const force = k === 0 ? 1 : randInt(2)
    zig.render(zh, force)
    rust.render(rh, force)
  }

  const z = readStats(zig, zh, true)
  const r = readStats(rust, rh, false)
  if (JSON.stringify(z) !== JSON.stringify(r)) {
    console.error(`✗ seq ${s} (${w}x${h}, ${cycles} cycles): ${JSON.stringify(z)} vs ${JSON.stringify(r)}`)
    failures++
    if (failures >= 5) break
  }
  zig.destroyRenderer(zh)
  rust.destroyRenderer(rh)
}

if (failures > 0) {
  console.error(`\nstats parity: ${failures} failing sequence(s) of ${SEQUENCES}`)
  process.exit(1)
}
console.log(`stats parity: MATCH (${SEQUENCES} sequences, deterministic fields)`)
process.exit(0)

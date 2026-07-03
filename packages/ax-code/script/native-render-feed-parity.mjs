// ADR-046 Slice E: native-span-feed parity (Rust vs Zig).
// Part A drives the feed API directly (createNativeSpanFeed / streamWrite /
// streamCommit / streamDrainSpans / streamGetStats) with random data and
// options, reading the drained span bytes out of the chunk pointers and diffing
// them plus the stats. Part B routes a rendered frame through createRenderer's
// FeedBackend (feedPtr) on both backends and diffs the drained frame bytes.
//
// Run:  node --experimental-ffi script/native-render-feed-parity.mjs [--seqs=N]
// Exit: 0 = parity, 1 = mismatch, 2 = rust symbols not built.

import { createRequire } from "node:module"

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
if (!rust || typeof rust.createNativeSpanFeed !== "function") {
  console.log("feed parity: RUST createNativeSpanFeed NOT BUILT — skipping")
  process.exit(2)
}

const rawPtr = (v) => ffi.getRawPointer(v)
const enc = new TextEncoder()
const keep = []
let seed = 0xfeed42
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000)
const randInt = (n) => Math.floor(rand() * n)

// Per-side pointer arg for a typed array.
const sp = (isZig, v) => (isZig ? rawPtr(v) : Number(rawPtr(v)))

function optionsBuf(chunkSize, initialChunks, maxBytes, growth, autoCommit, queueCap) {
  const b = new Uint8Array(24)
  keep.push(b)
  const dv = new DataView(b.buffer)
  dv.setUint32(0, chunkSize, true)
  dv.setUint32(4, initialChunks, true)
  dv.setBigUint64(8, BigInt(maxBytes), true)
  dv.setUint8(16, growth)
  dv.setUint8(17, autoCommit)
  dv.setUint32(20, queueCap, true)
  return b
}

// Drain all committed spans and return the concatenated bytes as hex.
function drainAllHex(sym, stream, isZig) {
  const MAX = 128
  const out = new Uint8Array(MAX * 24)
  keep.push(out)
  const bytes = []
  for (;;) {
    const n = Number(sym.streamDrainSpans(stream, sp(isZig, out), MAX))
    if (n === 0) break
    const dv = new DataView(out.buffer)
    for (let i = 0; i < n; i++) {
      const base = i * 24
      const chunkPtr = dv.getBigUint64(base, true)
      const off = dv.getUint32(base + 8, true)
      const len = dv.getUint32(base + 12, true)
      if (len > 0) {
        const ab = ffi.toArrayBuffer(chunkPtr, off + len)
        const u8 = new Uint8Array(ab)
        for (let k = off; k < off + len; k++) bytes.push(u8[k])
      }
    }
    if (n < MAX) break
  }
  return Buffer.from(bytes).toString("hex")
}

function statsTuple(sym, stream, isZig) {
  const b = new Uint8Array(24)
  keep.push(b)
  sym.streamGetStats(stream, sp(isZig, b))
  const dv = new DataView(b.buffer)
  return {
    bytesWritten: dv.getBigUint64(0, true).toString(),
    spansCommitted: dv.getBigUint64(8, true).toString(),
  }
}

const seqArg = process.argv.find((a) => a.startsWith("--seqs="))
const SEQUENCES = seqArg ? Number(seqArg.slice(7)) : 300
let failures = 0

// --- Part A: direct feed write/commit/drain ---------------------------------
for (let s = 0; s < SEQUENCES && failures < 5; s++) {
  const chunkSize = 4 + randInt(60)
  const initialChunks = 1 + randInt(3)
  const autoCommit = randInt(2)
  const opts = optionsBuf(chunkSize, initialChunks, 0, 0, autoCommit, 0)
  const zf = zig.createNativeSpanFeed(rawPtr(opts))
  const rf = rust.createNativeSpanFeed(Number(rawPtr(opts)))
  if (!zf || !rf) {
    console.error(`✗ seq ${s}: feed creation failed`)
    failures++
    break
  }

  const nWrites = 1 + randInt(4)
  for (let wi = 0; wi < nWrites; wi++) {
    // With auto_commit off, keep each write within one chunk (all-or-nothing).
    const maxLen = autoCommit ? chunkSize * 3 : chunkSize
    const len = 1 + randInt(Math.max(1, maxLen))
    const data = new Uint8Array(len)
    keep.push(data)
    for (let k = 0; k < len; k++) data[k] = randInt(256)
    zig.streamWrite(zf, rawPtr(data), len)
    rust.streamWrite(rf, Number(rawPtr(data)), len)
    if (rand() < 0.5) {
      zig.streamCommit(zf)
      rust.streamCommit(rf)
    }
  }
  zig.streamCommit(zf)
  rust.streamCommit(rf)

  const zHex = drainAllHex(zig, zf, true)
  const rHex = drainAllHex(rust, rf, false)
  if (zHex !== rHex) {
    console.error(`✗ seq ${s} (chunk=${chunkSize}, auto=${autoCommit}): drained bytes differ`)
    console.error(`  zig : ${zHex.slice(0, 200)}`)
    console.error(`  rust: ${rHex.slice(0, 200)}`)
    failures++
  }
  const zs = statsTuple(zig, zf, true)
  const rs = statsTuple(rust, rf, false)
  if (JSON.stringify(zs) !== JSON.stringify(rs)) {
    console.error(`✗ seq ${s}: stats differ ${JSON.stringify(zs)} vs ${JSON.stringify(rs)}`)
    failures++
  }
  zig.destroyNativeSpanFeed(zf)
  rust.destroyNativeSpanFeed(rf)
}

// --- Part B: renderer FeedBackend routing -----------------------------------
for (let s = 0; s < Math.min(SEQUENCES, 100) && failures < 5; s++) {
  const w = 4 + randInt(12)
  const h = 2 + randInt(5)
  const opts = optionsBuf(64 * 1024, 2, 0, 0, 1, 0)
  const zf = zig.createNativeSpanFeed(rawPtr(opts))
  const rf = rust.createNativeSpanFeed(Number(rawPtr(opts)))
  // createRenderer(width, height, kind, remoteMode, feedPtr)
  const zr = zig.createRenderer(w, h, 1, 1, zf)
  const rr = rust.createRenderer(w, h, 1, 1, Number(rf))

  const savedSeed = seed
  for (const [sym, rh, isZig] of [
    [zig, zr, true],
    [rust, rr, false],
  ]) {
    seed = savedSeed
    const buf = sym.getNextBuffer(rh)
    const str = ["Hi", "world", "café", "ab"][randInt(4)]
    const t = enc.encode(str)
    keep.push(t)
    const fg = new Uint16Array([randInt(256), randInt(256), randInt(256), 255])
    keep.push(fg)
    sym.bufferDrawText(buf, sp(isZig, t), t.length, randInt(w), randInt(h), sp(isZig, fg), 0, 0)
    sym.render(rh, 1)
  }

  const zHex = drainAllHex(zig, zf, true)
  const rHex = drainAllHex(rust, rf, false)
  if (zHex !== rHex) {
    console.error(`✗ render-feed seq ${s} (${w}x${h}): drained frame differs`)
    console.error(`  zig : ${zHex.slice(0, 200)}`)
    console.error(`  rust: ${rHex.slice(0, 200)}`)
    failures++
  }
  zig.destroyRenderer(zr)
  rust.destroyRenderer(rr)
  zig.destroyNativeSpanFeed(zf)
  rust.destroyNativeSpanFeed(rf)
}

if (failures > 0) {
  console.error(`\nfeed parity: ${failures} failing check(s)`)
  process.exit(1)
}
console.log(`feed parity: MATCH (${SEQUENCES} direct + render-routing sequences)`)
process.exit(0)

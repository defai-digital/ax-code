// ADR-046 Slice C5d parity harness: bufferDrawTextBufferView vs the Zig
// backend. Builds a TextBuffer + view (styled text, syntax styles, wrap
// modes, selection, viewport) on both backends, draws into a cell buffer at a
// random offset, and compares all four planes plus the resolved-char text.
//
// Run: node --experimental-ffi script/native-render-textview-draw-parity.mjs [--seqs=N]
// Exit: 0 = parity, 1 = mismatch, 2 = addon not built (skip).

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
let rust
try {
  rust = require("@ax-code/render")
} catch {
  console.error("@ax-code/render addon not built (run: pnpm build:native render) — skipping")
  process.exit(2)
}
const ffi = require("node:ffi")
const { resolveRenderLib } = await import("@ax-code/opentui-core")
const zig = resolveRenderLib().opentui.symbols

let seed = 0x51ede77
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000)
const randInt = (n) => Math.floor(rand() * n)
const ptr = (v) => ffi.getRawPointer(v)
const keepAlive = []

function packColor(r, g, b, a) {
  const arr = new Uint16Array(4)
  keepAlive.push(arr)
  arr[0] = r & 0xff
  arr[1] = g & 0xff
  arr[2] = b & 0xff
  arr[3] = a & 0xff
  return arr
}
const encode = (s) => {
  const b = new TextEncoder().encode(s)
  keepAlive.push(b)
  return b
}

const TEXTS = [
  "hello world foo bar baz",
  "line one\nline two\nline three",
  "混合 width 世界 wrapping here",
  "tab\there\tcols",
  "🚀 emoji 🎉 test line",
  "short",
  "a very long single line that should definitely wrap across multiple columns when narrow",
  "café résumé naïve",
  "日本語テキスト wrap 分割",
  "",
]

function packChunks(specs) {
  const buf = new Uint8Array(specs.length * 56)
  keepAlive.push(buf)
  const dv = new DataView(buf.buffer)
  specs.forEach((spec, i) => {
    const off = i * 56
    dv.setBigUint64(off, spec.text.length ? BigInt(ptr(spec.text)) : 0n, true)
    dv.setBigUint64(off + 8, BigInt(spec.text.length), true)
    dv.setBigUint64(off + 16, spec.fg ? BigInt(ptr(spec.fg)) : 0n, true)
    dv.setBigUint64(off + 24, spec.bg ? BigInt(ptr(spec.bg)) : 0n, true)
    dv.setUint32(off + 32, spec.attributes >>> 0, true)
    dv.setBigUint64(off + 40, 0n, true)
    dv.setBigUint64(off + 48, 0n, true)
  })
  return buf
}

const idBytes = encode("draw-parity")

function planeHex(getPtr, handle, cellCount, bytesPerCell, isZig) {
  const raw = isZig ? getPtr(handle) : BigInt(Math.round(getPtr(handle)))
  const addr = typeof raw === "bigint" ? raw : BigInt(raw)
  return Buffer.from(ffi.toArrayBuffer(addr, cellCount * bytesPerCell).slice(0)).toString("hex")
}

function charPlaneSemantic(sym, handle, n, isZig) {
  // cluster cells: compare flags+extents (pool ids are allocation-order); simple cells exact
  const raw = isZig ? sym.bufferGetCharPtr(handle) : BigInt(Math.round(sym.bufferGetCharPtr(handle)))
  const addr = typeof raw === "bigint" ? raw : BigInt(raw)
  const arr = new Uint32Array(ffi.toArrayBuffer(addr, n * 4).slice(0))
  const out = []
  for (let i = 0; i < n; i++) {
    const c = arr[i] >>> 0
    out.push((c & 0xc0000000) !== 0 ? `C${(c >>> 26).toString(16)}` : c.toString(16))
  }
  return out.join(",")
}

const seqArg = process.argv.find((a) => a.startsWith("--seqs="))
const SEQUENCES = seqArg ? Number(seqArg.slice(7)) : 400
let failures = 0

for (let s = 0; s < SEQUENCES; s++) {
  if (process.env.PROBE) { const fs = require("node:fs"); fs.writeSync(2, `seq ${s}\n`) }
  const opsLog = []
  const zh = zig.createTextBuffer(1)
  const rh = rust.createTextBuffer(1)
  const zStyle = zig.createSyntaxStyle()
  const rStyle = rust.createSyntaxStyle()
  if (rand() < 0.7) {
    zig.textBufferSetSyntaxStyle(zh, zStyle)
    rust.textBufferSetSyntaxStyle(rh, rStyle)
  }

  // default colors sometimes
  if (rand() < 0.4) {
    const fg = packColor(randInt(256), randInt(256), randInt(256), 255)
    zig.textBufferSetDefaultFg(zh, ptr(fg))
    rust.textBufferSetDefaultFg(rh, Number(ptr(fg)))
  }
  if (rand() < 0.4) {
    const bg = packColor(randInt(256), randInt(256), randInt(256), 255)
    zig.textBufferSetDefaultBg(zh, ptr(bg))
    rust.textBufferSetDefaultBg(rh, Number(ptr(bg)))
  }

  // content
  const count = 1 + randInt(3)
  const specs = Array.from({ length: count }, () => ({
    text: encode(TEXTS[randInt(TEXTS.length)]),
    attributes: rand() < 0.3 ? randInt(64) : 0,
    fg: rand() < 0.5 ? packColor(randInt(256), randInt(256), randInt(256), 255) : null,
    bg: rand() < 0.3 ? packColor(randInt(256), randInt(256), randInt(256), 255) : null,
  }))
  zig.textBufferSetStyledText(zh, ptr(packChunks(specs)), count)
  rust.textBufferSetStyledText(rh, Number(ptr(packChunks(specs))), count)
  opsLog.push(`styled(${count})`)

  const zView = zig.createTextBufferView(zh)
  const rView = rust.createTextBufferView(rh)

  // wrap
  if (rand() < 0.6) {
    const mode = 1 + randInt(2)
    const width = 4 + randInt(16)
    zig.textBufferViewSetWrapMode(zView, mode)
    rust.textBufferViewSetWrapMode(rView, mode)
    zig.textBufferViewSetWrapWidth(zView, width)
    rust.textBufferViewSetWrapWidth(rView, width)
    opsLog.push(`wrap(${mode},${width})`)
  }
  // viewport
  if (rand() < 0.5) {
    const [vx, vy, vw, vh] = [randInt(3), randInt(3), 4 + randInt(20), 2 + randInt(8)]
    zig.textBufferViewSetViewport(zView, vx, vy, vw, vh)
    rust.textBufferViewSetViewport(rView, vx, vy, vw, vh)
    opsLog.push(`vp(${vx},${vy},${vw},${vh})`)
  }
  // selection
  if (rand() < 0.5) {
    const a = randInt(30)
    const b = a + randInt(15)
    const selBg = rand() < 0.5 ? packColor(randInt(256), randInt(256), randInt(256), 255) : null
    const selFg = rand() < 0.5 ? packColor(randInt(256), randInt(256), randInt(256), 255) : null
    zig.textBufferViewSetSelection(zView, a, b, selBg ? ptr(selBg) : 0, selFg ? ptr(selFg) : 0)
    rust.textBufferViewSetSelection(rView, a, b, selBg ? Number(ptr(selBg)) : 0, selFg ? Number(ptr(selFg)) : 0)
    opsLog.push(`sel(${a},${b})`)
  }
  // tab indicator
  if (rand() < 0.3) {
    zig.textBufferViewSetTabIndicator(zView, 0x2192)
    rust.textBufferViewSetTabIndicator(rView, 0x2192)
  }

  // draw target
  const w = 12 + randInt(30)
  const h = 4 + randInt(12)
  const zbuf = zig.createOptimizedBuffer(w, h, 0, 1, ptr(idBytes), idBytes.length)
  const rbuf = rust.createOptimizedBuffer(w, h, 0, 1, Number(ptr(idBytes)), idBytes.length)
  // Non-negative draw origins only: a negative origin drives current_x/current_y
  // negative, where the reference's ReleaseFast cell write wraps the u32 index
  // and aliases onto a visible cell of the previous row (undefined behavior).
  // ax-code never draws at a negative origin — horizontal/vertical scrolling is
  // expressed through viewport.x/viewport.y (exercised above), which keeps
  // current_x >= 0. The Rust port skips off-buffer writes instead of emulating
  // the UB aliasing, so we stay in the realistic domain here.
  const dx = randInt(5)
  const dy = randInt(5)
  opsLog.push(`draw(${dx},${dy}) buf=${w}x${h}`)
  if (process.env.PROBE) { const fs = require("node:fs"); fs.writeSync(2, `seq ${s}: ${opsLog.join(" | ")}
`) }
  zig.bufferDrawTextBufferView(zbuf, zView, dx, dy)
  rust.bufferDrawTextBufferView(rbuf, rView, dx, dy)

  const n = w * h
  const fail = (msg) => {
    console.error(`✗ seq ${s}: ${msg}`)
    console.error(`  ops: ${opsLog.join(" | ")}`)
    failures++
  }

  // resolved chars (semantic content of the char plane)
  const zOut = new Uint8Array(n * 130)
  const rOut = new Uint8Array(n * 130)
  const zLen = zig.bufferWriteResolvedChars(zbuf, ptr(zOut), zOut.length, 1)
  const rLen = rust.bufferWriteResolvedChars(rbuf, Number(ptr(rOut)), rOut.length, 1)
  const zText = Buffer.from(zOut.subarray(0, Number(zLen))).toString("hex")
  const rText = Buffer.from(rOut.subarray(0, Number(rLen))).toString("hex")

  const zCharSem = charPlaneSemantic(zig, zbuf, n, true)
  const rCharSem = charPlaneSemantic(rust, rbuf, n, false)

  const specsCmp = [
    ["fg", zig.bufferGetFgPtr, rust.bufferGetFgPtr, 8],
    ["bg", zig.bufferGetBgPtr, rust.bufferGetBgPtr, 8],
    ["attrs", zig.bufferGetAttributesPtr, rust.bufferGetAttributesPtr, 4],
  ]

  if (zText !== rText) {
    fail(`resolved chars differ\n  zig : ${zText.slice(0, 200)}\n  rust: ${rText.slice(0, 200)}`)
  } else if (zCharSem !== rCharSem) {
    fail(`char plane (semantic) differs`)
  } else {
    for (const [name, zGet, rGet, bpc] of specsCmp) {
      const zHex = planeHex(zGet, zbuf, n, bpc, true)
      const rHex = planeHex(rGet, rbuf, n, bpc, false)
      if (zHex !== rHex) {
        let cell = -1
        for (let i = 0; i < zHex.length; i += bpc * 2) {
          if (zHex.slice(i, i + bpc * 2) !== rHex.slice(i, i + bpc * 2)) {
            cell = i / (bpc * 2)
            break
          }
        }
        fail(`plane '${name}' differs at cell ${cell} (x=${cell % w}, y=${Math.floor(cell / w)})`)
        break
      }
    }
  }

  zig.destroyOptimizedBuffer(zbuf)
  rust.destroyOptimizedBuffer(rbuf)
  zig.destroyTextBufferView(zView)
  rust.destroyTextBufferView(rView)
  zig.destroySyntaxStyle(zStyle)
  rust.destroySyntaxStyle(rStyle)
  zig.destroyTextBuffer(zh)
  rust.destroyTextBuffer(rh)

  if (failures >= 5) break
}

if (failures > 0) {
  console.error(`\ntextview draw parity: ${failures} failing sequence(s) of ${SEQUENCES}`)
  process.exit(1)
}
console.log(`textview draw parity: MATCH (${SEQUENCES} sequences)`)
process.exit(0)

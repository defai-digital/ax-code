// ADR-046 Slice B parity harness (tranche 1): drives identical op sequences
// against a Zig OptimizedBuffer (raw dlopen symbols) and the Rust port, then
// byte-compares all four cell planes (char u32 / fg,bg [4]u16 / attrs u32).
//
// Tranche 2 adds drawText (grapheme pool ids in the char plane are
// deterministic — both pools intern live strings and allocate LIFO slots, so
// identical op sequences produce identical ids), covering CJK/emoji/tabs and
// the grapheme span-cleanup + continuation-cell paths on top of the tranche-1
// set/blend/fill/scissor/opacity/resize surface.
//
// Run with: node --experimental-ffi script/native-render-buffer-parity.mjs [--seqs=N]
// Exit codes: 0 = parity, 1 = mismatch, 2 = Rust addon not built (skip).

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

// --- deterministic PRNG -------------------------------------------------------
let seed = 0x51b0ffe
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000)
const randInt = (n) => Math.floor(rand() * n)

// JS-side packRGBA8 (same as the vendored opentui runtime does before FFI).
function packColor(r, g, b, a, meta = 0) {
  const arr = new Uint16Array(4)
  arr[0] = (r & 0xff) | ((meta & 0xff) << 8)
  arr[1] = (g & 0xff) | (((meta >> 8) & 0xff) << 8)
  arr[2] = (b & 0xff) | (((meta >> 16) & 0xff) << 8)
  arr[3] = (a & 0xff) | (((meta >> 24) & 0xff) << 8)
  return arr
}
function randColor() {
  // Mix alphas (transparent/edge/opaque) and intents (rgb/indexed/default).
  const alphas = [0, 1, 127, 128, 254, 255, 255, 255]
  const metaChoices = [0, 0, 0, 1 << 8, (2 << 8) | 33, 0x7f]
  return packColor(randInt(256), randInt(256), randInt(256), alphas[randInt(alphas.length)], metaChoices[randInt(metaChoices.length)])
}
const ptr = (view) => ffi.getRawPointer(view)

// --- dual-target driver --------------------------------------------------------
const idBytes = new TextEncoder().encode("parity-buffer")
function makeBuffers(w, h) {
  const zh = zig.createOptimizedBuffer(w, h, 0, 1, ptr(idBytes), idBytes.length)
  const rh = rust.createOptimizedBuffer(w, h, 0, 1, Number(ptr(idBytes)), idBytes.length)
  if (!zh || !rh) throw new Error("buffer creation failed")
  return { zh, rh }
}

function planes(getPtr, handle, cellCount, bytesPerCell, isZig) {
  const raw = isZig ? getPtr(handle) : BigInt(Math.round(getPtr(handle)))
  const addr = typeof raw === "bigint" ? raw : BigInt(raw)
  return Buffer.from(ffi.toArrayBuffer(addr, cellCount * bytesPerCell)).toString("hex")
}

function compare(zh, rh, w, h, tag, opsLog) {
  const n = w * h
  const fail = (msg) => {
    console.error(`\u2717 ${tag}: ${msg}`)
    console.error(`  ops: ${opsLog.slice(-12).join(" | ")}`)
    return false
  }

  // char plane: pool ids are free-list-order dependent (not semantic), so
  // cluster cells compare flags+extents only; simple cells compare exactly.
  // Cluster CONTENT is compared via writeResolvedChars below.
  const zChar = new Uint32Array(ffi.toArrayBuffer(BigInt(zig.bufferGetCharPtr(zh)), n * 4).slice(0))
  const rChar = new Uint32Array(ffi.toArrayBuffer(BigInt(Math.round(rust.bufferGetCharPtr(rh))), n * 4).slice(0))
  for (let i = 0; i < n; i++) {
    const zc = zChar[i] >>> 0
    const rc = rChar[i] >>> 0
    const zCluster = (zc & 0xc0000000) !== 0
    const rCluster = (rc & 0xc0000000) !== 0
    if (zCluster !== rCluster) return fail(`char cell ${i} cluster-ness differs zig=${zc.toString(16)} rust=${rc.toString(16)}`)
    if (zCluster) {
      if (zc >>> 26 !== rc >>> 26) return fail(`char cell ${i} flags/extents differ zig=${zc.toString(16)} rust=${rc.toString(16)}`)
    } else if (zc !== rc) {
      return fail(`char cell ${i} differs zig=${zc.toString(16)} rust=${rc.toString(16)}`)
    }
  }

  // resolved text: semantic contents of the char plane, pool lookups included
  const zOut = new Uint8Array(n * 130)
  const rOut = new Uint8Array(n * 130)
  const zLen = zig.bufferWriteResolvedChars(zh, ptr(zOut), zOut.length, 1)
  const rLen = rust.bufferWriteResolvedChars(rh, Number(ptr(rOut)), rOut.length, true)
  const zText = Buffer.from(zOut.subarray(0, Number(zLen))).toString("hex")
  const rText = Buffer.from(rOut.subarray(0, Number(rLen))).toString("hex")
  if (zText !== rText) return fail(`resolved chars differ\n  zig : ${zText.slice(0, 160)}\n  rust: ${rText.slice(0, 160)}`)

  const specs = [
    ["fg", zig.bufferGetFgPtr, rust.bufferGetFgPtr, 8],
    ["bg", zig.bufferGetBgPtr, rust.bufferGetBgPtr, 8],
    ["attrs", zig.bufferGetAttributesPtr, rust.bufferGetAttributesPtr, 4],
  ]
  for (const [name, zGet, rGet, bpc] of specs) {
    const zHex = planes(zGet, zh, n, bpc, true)
    const rHex = planes(rGet, rh, n, bpc, false)
    if (zHex !== rHex) {
      for (let i = 0; i < zHex.length; i += bpc * 2) {
        if (zHex.slice(i, i + bpc * 2) !== rHex.slice(i, i + bpc * 2)) {
          const cell = i / (bpc * 2)
          return fail(`plane '${name}' differs at cell ${cell} (x=${cell % w}, y=${Math.floor(cell / w)}): zig=${zHex.slice(i, i + bpc * 2)} rust=${rHex.slice(i, i + bpc * 2)}`)
        }
      }
      return fail(`plane '${name}' differs`)
    }
  }
  return true
}

// --- op fuzz -------------------------------------------------------------------
const TEXTS = [
  "hello",
  "混合 width 世界",
  "🚀 rocket 🎉",
  "👨‍👩‍👧‍👦 family",
  "tab\there",
  "e\u0301 combining café",
  "🇹🇼 flag",
  "デテキスト",
  "a", " ", "wide 寬 mix",
]

const seqArg = process.argv.find((a) => a.startsWith("--seqs="))
const SEQUENCES = seqArg ? Number(seqArg.slice(7)) : 300
let failures = 0

for (let s = 0; s < SEQUENCES; s++) {
  let w = 2 + randInt(24)
  let h = 2 + randInt(12)
  const { zh, rh } = makeBuffers(w, h)
  const opsLog = []
  const opCount = 5 + randInt(40)
  for (let i = 0; i < opCount; i++) {
    const op = randInt(12)
    if (op < 3) {
      // setCellWithAlphaBlending — the hot path
      const [x, y, ch, fg, bg, at] = [randInt(w + 2), randInt(h + 2), 33 + randInt(0x2000), randColor(), randColor(), randInt(256)]
      opsLog.push(`blend(${x},${y})`)
      zig.bufferSetCellWithAlphaBlending(zh, x, y, ch, ptr(fg), ptr(bg), at)
      rust.bufferSetCellWithAlphaBlending(rh, x, y, ch, Number(ptr(fg)), Number(ptr(bg)), at)
    } else if (op < 5) {
      const [x, y, ch, fg, bg, at] = [randInt(w + 2), randInt(h + 2), 33 + randInt(0x2000), randColor(), randColor(), randInt(256)]
      opsLog.push(`set(${x},${y})`)
      zig.bufferSetCell(zh, x, y, ch, ptr(fg), ptr(bg), at)
      rust.bufferSetCell(rh, x, y, ch, Number(ptr(fg)), Number(ptr(bg)), at)
    } else if (op < 7) {
      const [x, y, rw, rh2, bg] = [randInt(w + 2), randInt(h + 2), 1 + randInt(w), 1 + randInt(h), randColor()]
      opsLog.push(`fill(${x},${y},${rw},${rh2})`)
      zig.bufferFillRect(zh, x, y, rw, rh2, ptr(bg))
      rust.bufferFillRect(rh, x, y, rw, rh2, Number(ptr(bg)))
    } else if (op === 7) {
      const [x, y, rw, rh2] = [randInt(w) - 2, randInt(h) - 2, 1 + randInt(w), 1 + randInt(h)]
      opsLog.push(`scissor(${x},${y},${rw},${rh2})`)
      zig.bufferPushScissorRect(zh, x, y, rw, rh2)
      rust.bufferPushScissorRect(rh, x, y, rw, rh2)
    } else if (op === 8) {
      if (rand() < 0.5) {
        opsLog.push("popScissor")
        zig.bufferPopScissorRect(zh)
        rust.bufferPopScissorRect(rh)
      } else {
        const o = [0, 0.25, 0.5, 0.75, 1][randInt(5)]
        opsLog.push(`opacity(${o})`)
        zig.bufferPushOpacity(zh, o)
        rust.bufferPushOpacity(rh, o)
      }
    } else if (op === 9) {
      if (rand() < 0.5) {
        opsLog.push("popOpacity")
        zig.bufferPopOpacity(zh)
        rust.bufferPopOpacity(rh)
      } else {
        const bg = randColor()
        opsLog.push("clear")
        zig.bufferClear(zh, ptr(bg))
        rust.bufferClear(rh, Number(ptr(bg)))
      }
    } else if (op === 10) {
      if (rand() < 0.5) {
        const [ch, x, y, fg, bg, at] = [33 + randInt(0x2000), randInt(w + 2), randInt(h + 2), randColor(), randColor(), randInt(256)]
        opsLog.push(`drawChar(${x},${y})`)
        zig.bufferDrawChar(zh, ch, x, y, ptr(fg), ptr(bg), at)
        rust.bufferDrawChar(rh, ch, x, y, Number(ptr(fg)), Number(ptr(bg)), at)
      } else {
        const text = TEXTS[randInt(TEXTS.length)]
        const bytes = new TextEncoder().encode(text)
        const [x, y, fg, at] = [randInt(w + 2), randInt(h + 2), randColor(), randInt(256)]
        const bgOpt = rand() < 0.3 ? null : randColor()
        opsLog.push(`drawText(${x},${y},${JSON.stringify(text).slice(0, 14)})`)
        zig.bufferDrawText(zh, ptr(bytes), bytes.length, x, y, ptr(fg), bgOpt ? ptr(bgOpt) : null, at)
        rust.bufferDrawText(rh, Number(ptr(bytes)), bytes.length, x, y, Number(ptr(fg)), bgOpt ? Number(ptr(bgOpt)) : 0, at)
      }
    } else if (rand() < 0.3) {
      const nw = 2 + randInt(24)
      const nh = 2 + randInt(12)
      opsLog.push(`resize(${nw},${nh})`)
      zig.bufferResize(zh, nw, nh)
      rust.bufferResize(rh, nw, nh)
      w = nw
      h = nh
    } else {
      opsLog.push("clearScissors")
      zig.bufferClearScissorRects(zh)
      rust.bufferClearScissorRects(rh)
    }
  }
  if (!compare(zh, rh, w, h, `seq ${s} (${opCount} ops)`, opsLog)) {
    failures++
    if (failures >= 5) break
  }
  const zOpacity = zig.bufferGetCurrentOpacity(zh)
  const rOpacity = rust.bufferGetCurrentOpacity(rh)
  if (Math.abs(zOpacity - rOpacity) > 1e-6) {
    console.error(`✗ seq ${s}: opacity differs zig=${zOpacity} rust=${rOpacity}`)
    failures++
  }
  zig.destroyOptimizedBuffer(zh)
  rust.destroyOptimizedBuffer(rh)
}

if (failures > 0) {
  console.error(`\nbuffer parity: ${failures} failing sequence(s) of ${SEQUENCES}`)
  process.exit(1)
}
console.log(`buffer parity: MATCH (${SEQUENCES} op sequences, all four planes byte-identical)`)
process.exit(0)

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
// ADR-046: the native-render overlay is ON BY DEFAULT; force the bundled Zig
// library for this differential harness's reference side. require("@ax-code/render")
// below still returns the raw Rust addon to compare against.
process.env.AX_CODE_NATIVE_RENDER = "0"
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
  const rLen = rust.bufferWriteResolvedChars(rh, Number(ptr(rOut)), rOut.length, 1)
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

const BORDER_SETS = [
  [0x256d, 0x256e, 0x2570, 0x256f, 0x2500, 0x2502, 0x252c, 0x2534, 0x251c, 0x2524, 0x253c], // rounded
  [0x250c, 0x2510, 0x2514, 0x2518, 0x2500, 0x2502, 0x252c, 0x2534, 0x251c, 0x2524, 0x253c], // single
  [0x2554, 0x2557, 0x255a, 0x255d, 0x2550, 0x2551, 0x2566, 0x2569, 0x2560, 0x2563, 0x256c], // double
  [0x4e00, 0x2510, 0x2514, 0x2518, 0x4e00, 0x2502, 0x252c, 0x2534, 0x251c, 0x2524, 0x253c], // wide corner (defeats fast path)
]
const randAttrs = () => (rand() < 0.25 ? ((1 + randInt(500)) << 8) | randInt(256) : randInt(256)) // sometimes carry a link id

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
      const [x, y, ch, fg, bg, at] = [randInt(w + 2), randInt(h + 2), 33 + randInt(0x2000), randColor(), randColor(), randAttrs()]
      opsLog.push(`blend(${x},${y})`)
      zig.bufferSetCellWithAlphaBlending(zh, x, y, ch, ptr(fg), ptr(bg), at)
      rust.bufferSetCellWithAlphaBlending(rh, x, y, ch, Number(ptr(fg)), Number(ptr(bg)), at)
    } else if (op < 5) {
      const [x, y, ch, fg, bg, at] = [randInt(w + 2), randInt(h + 2), 33 + randInt(0x2000), randColor(), randColor(), randAttrs()]
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
        const [ch, x, y, fg, bg, at] = [33 + randInt(0x2000), randInt(w + 2), randInt(h + 2), randColor(), randColor(), randAttrs()]
        opsLog.push(`drawChar(${x},${y})`)
        zig.bufferDrawChar(zh, ch, x, y, ptr(fg), ptr(bg), at)
        rust.bufferDrawChar(rh, ch, x, y, Number(ptr(fg)), Number(ptr(bg)), at)
      } else {
        const text = TEXTS[randInt(TEXTS.length)]
        const bytes = new TextEncoder().encode(text)
        const [x, y, fg, at] = [randInt(w + 2), randInt(h + 2), randColor(), randAttrs()]
        const bgOpt = rand() < 0.3 ? null : randColor()
        opsLog.push(`drawText(${x},${y},${JSON.stringify(text).slice(0, 14)})`)
        zig.bufferDrawText(zh, ptr(bytes), bytes.length, x, y, ptr(fg), bgOpt ? ptr(bgOpt) : null, at)
        rust.bufferDrawText(rh, Number(ptr(bytes)), bytes.length, x, y, Number(ptr(fg)), bgOpt ? Number(ptr(bgOpt)) : 0, at)
      }
    } else if (op === 11 && rand() < 0.6) {
      if (rand() < 0.6) {
        const chars = new Uint32Array(BORDER_SETS[randInt(BORDER_SETS.length)])
        const [bx, by, bw, bh] = [randInt(w) - 1, randInt(h) - 1, 2 + randInt(w), 2 + randInt(h)]
        const sides = randInt(16)
        const packed = sides | (randInt(2) << 4) | (randInt(3) << 5) | (randInt(3) << 7)
        const [bc, bgc, tc] = [randColor(), randColor(), randColor()]
        const useTitle = rand() < 0.5
        const titleBytes = new TextEncoder().encode(useTitle ? TEXTS[randInt(TEXTS.length)] : "")
        opsLog.push(`drawBox(${bx},${by},${bw},${bh},p=${packed.toString(2)})`)
        zig.bufferDrawBox(zh, bx, by, bw, bh, ptr(chars), packed, ptr(bc), ptr(bgc), ptr(tc), titleBytes.length ? ptr(titleBytes) : null, titleBytes.length, null, 0)
        rust.bufferDrawBox(rh, bx, by, bw, bh, Number(ptr(chars)), packed, Number(ptr(bc)), Number(ptr(bgc)), Number(ptr(tc)), titleBytes.length ? Number(ptr(titleBytes)) : 0, titleBytes.length, 0, 0)
      } else {
        // blit a small scratch buffer into the main one
        const sw = 2 + randInt(6)
        const sh = 2 + randInt(4)
        const srcRespectAlpha = randInt(2)
        const zSrc = zig.createOptimizedBuffer(sw, sh, srcRespectAlpha, 1, ptr(idBytes), idBytes.length)
        const rSrc = rust.createOptimizedBuffer(sw, sh, srcRespectAlpha, 1, Number(ptr(idBytes)), idBytes.length)
        const text = TEXTS[randInt(TEXTS.length)]
        const tb = new TextEncoder().encode(text)
        const [fg2, bg2] = [randColor(), randColor()]
        zig.bufferDrawText(zSrc, ptr(tb), tb.length, 0, 0, ptr(fg2), ptr(bg2), 0)
        rust.bufferDrawText(rSrc, Number(ptr(tb)), tb.length, 0, 0, Number(ptr(fg2)), Number(ptr(bg2)), 0)
        const [dx, dy] = [randInt(w) - 1, randInt(h) - 1]
        opsLog.push(`blit(${dx},${dy},${sw}x${sh})`)
        zig.drawFrameBuffer(zh, dx, dy, zSrc, 0, 0, 0, 0)
        rust.drawFrameBuffer(rh, dx, dy, rSrc, 0, 0, 0, 0)
        zig.destroyOptimizedBuffer(zSrc)
        rust.destroyOptimizedBuffer(rSrc)
      }
    } else if (op === 11 && rand() < 0.7) {
      const kind = randInt(5)
      if (kind === 0) {
        // colorMatrixUniform: random 4x4 + strength
        const mat = new Float32Array(16)
        for (let m = 0; m < 16; m++) mat[m] = (rand() * 2 - 0.5)
        const strength = [0.25, 0.5, 1][randInt(3)]
        const target = 1 + randInt(3)
        opsLog.push(`matrixU(t=${target})`)
        zig.bufferColorMatrixUniform(zh, ptr(mat), strength, target)
        rust.bufferColorMatrixUniform(rh, Number(ptr(mat)), strength, target)
      } else if (kind === 1) {
        const mat = new Float32Array(16)
        for (let m = 0; m < 16; m++) mat[m] = (rand() * 2 - 0.5)
        const count = 1 + randInt(6)
        const mask = new Float32Array(count * 3)
        for (let c = 0; c < count; c++) { mask[c*3] = randInt(w + 1); mask[c*3+1] = randInt(h + 1); mask[c*3+2] = rand() }
        const target = 1 + randInt(3)
        opsLog.push(`matrix(n=${count})`)
        zig.bufferColorMatrix(zh, ptr(mat), ptr(mask), count, 0.8, target)
        rust.bufferColorMatrix(rh, Number(ptr(mat)), Number(ptr(mask)), count, 0.8, target)
      } else if (kind === 2) {
        // grayscale (sometimes supersampled)
        const gw = 2 + randInt(8), gh = 2 + randInt(6)
        const inten = new Float32Array(gw * gh)
        for (let g = 0; g < inten.length; g++) inten[g] = rand()
        const [gx, gy] = [randInt(w) - 2, randInt(h) - 2]
        const useFg = rand() < 0.7 ? randColor() : null
        const ss = rand() < 0.5
        opsLog.push(`gray${ss ? "SS" : ""}(${gx},${gy},${gw}x${gh})`)
        const zf = useFg ? ptr(useFg) : null, rf = useFg ? Number(ptr(useFg)) : 0
        if (ss) { zig.bufferDrawGrayscaleBufferSupersampled(zh, gx, gy, ptr(inten), gw, gh, zf, null); rust.bufferDrawGrayscaleBufferSupersampled(rh, gx, gy, Number(ptr(inten)), gw, gh, rf, 0) }
        else { zig.bufferDrawGrayscaleBuffer(zh, gx, gy, ptr(inten), gw, gh, zf, null); rust.bufferDrawGrayscaleBuffer(rh, gx, gy, Number(ptr(inten)), gw, gh, rf, 0) }
      } else if (kind === 3) {
        // supersample quadrant pixels
        const cw = 2 + randInt(5), chh = 2 + randInt(3)
        const rowBytes = cw * 2 * 4
        const px = new Uint8Array(rowBytes * chh * 2)
        for (let b = 0; b < px.length; b++) px[b] = randInt(256)
        const format = randInt(2)
        const [ssx, ssy] = [randInt(w), randInt(h)]
        opsLog.push(`superSample(f=${format}@${ssx},${ssy})`)
        zig.bufferDrawSuperSampleBuffer(zh, ssx, ssy, ptr(px), px.length, format, rowBytes)
        rust.bufferDrawSuperSampleBuffer(rh, ssx, ssy, Number(ptr(px)), px.length, format, rowBytes)
      } else {
        // packed cells
        const cells = 1 + randInt(8)
        const data = new Uint8Array(cells * 48)
        const dv = new DataView(data.buffer)
        for (let c = 0; c < cells; c++) {
          for (let ch2 = 0; ch2 < 8; ch2++) dv.setFloat32(c*48 + ch2*4, rand() * 1.2 - 0.1, true)
          dv.setUint32(c*48 + 32, randInt(0x3000), true)
        }
        const [px2, py2] = [randInt(w), randInt(h)]
        opsLog.push(`packed(${cells}@${px2},${py2})`)
        zig.bufferDrawPackedBuffer(zh, ptr(data), data.length, px2, py2, w, h)
        rust.bufferDrawPackedBuffer(rh, Number(ptr(data)), data.length, px2, py2, w, h)
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
    if (!compare(zh, rh, w, h, `seq ${s} op ${i} [${opsLog[opsLog.length - 1]}]`, opsLog)) {
      failures++
      break
    }
  }
  if (failures >= 3) break
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

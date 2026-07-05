// ADR-046 Slice C3a parity harness: TextBuffer core ops vs the Zig library.
// Drives identical op sequences (setStyledText with mixed chunks, append,
// reset, clear, tab width, mem-buffer registration) and compares plain text,
// length, byte size, line count, and tab width after every op.
//
// Run with: node --experimental-ffi script/native-render-text-parity.mjs [--seqs=N]
// Exit codes: 0 = parity, 1 = mismatch, 2 = Rust addon not built (skip).

import { createRequire } from "node:module"
import { jsonEqual } from "./native-render-json-equal.mjs"

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

let seed = 0x7e57b0f
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000
const randInt = (n) => Math.floor(rand() * n)
const ptr = (v) => ffi.getRawPointer(v)

const TEXTS = [
  "hello world",
  "line1\nline2\nline3",
  "crlf\r\nline",
  "lone\rcr",
  "混合 width 世界",
  "🚀 emoji 🎉 line\nwith 👨‍👩‍👧‍👦 family",
  "tab\there\tand",
  "",
  "\n",
  "\n\n",
  "trailing\n",
  "é combining café",
  "デテキスト\r\n日本語",
  "a",
]

// Keep every buffer we hand to the natives alive for the whole run — both
// sides borrow external memory for registered/appended text.
const keepAlive = []

function packColor(r, g, b, a, meta = 0) {
  const arr = new Uint16Array(4)
  keepAlive.push(arr)
  arr[0] = (r & 0xff) | ((meta & 0xff) << 8)
  arr[1] = (g & 0xff) | (((meta >> 8) & 0xff) << 8)
  arr[2] = (b & 0xff) | (((meta >> 16) & 0xff) << 8)
  arr[3] = (a & 0xff) | (((meta >> 24) & 0xff) << 8)
  return arr
}
const encode = (s) => {
  const b = new TextEncoder().encode(s)
  keepAlive.push(b)
  return b
}

// Pack StyledChunk extern structs (56 bytes each; see text_buffer_ffi.rs).
function packChunks(specs) {
  const buf = new ArrayBuffer(specs.length * 56)
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  keepAlive.push(u8)
  specs.forEach((spec, i) => {
    const off = i * 56
    dv.setBigUint64(off, BigInt(spec.text.length ? ffi.getRawPointer(spec.text) : 0n), true)
    dv.setBigUint64(off + 8, BigInt(spec.text.length), true)
    dv.setBigUint64(off + 16, spec.fg ? BigInt(ffi.getRawPointer(spec.fg)) : 0n, true)
    dv.setBigUint64(off + 24, spec.bg ? BigInt(ffi.getRawPointer(spec.bg)) : 0n, true)
    dv.setUint32(off + 32, spec.attributes >>> 0, true)
    dv.setBigUint64(off + 40, 0n, true) // link
    dv.setBigUint64(off + 48, 0n, true)
  })
  return u8
}

function state(sym, handle, isZig) {
  const out = new Uint8Array(65536)
  const len = sym.textBufferGetPlainText(handle, isZig ? ptr(out) : Number(ptr(out)), out.length)
  return {
    text: Buffer.from(out.subarray(0, Number(len))).toString("hex"),
    length: Number(sym.textBufferGetLength(handle)),
    bytes: Number(sym.textBufferGetByteSize(handle)),
    lines: Number(sym.textBufferGetLineCount(handle)),
    tab: Number(sym.textBufferGetTabWidth(handle)),
    hlCount: Number(sym.textBufferGetHighlightCount(handle)),
    hls: (() => {
      const lines = Number(sym.textBufferGetLineCount(handle))
      const dump = []
      for (let l = 0; l < Math.min(lines, 8); l++) {
        const countBuf = new Uint32Array(1)
        const p = sym.textBufferGetLineHighlightsPtr(handle, l, isZig ? ptr(countBuf) : Number(ptr(countBuf)))
        const n = countBuf[0]
        if (!n || !p) {
          dump.push("")
          continue
        }
        const addr = typeof p === "bigint" ? p : BigInt(Math.round(Number(p)))
        dump.push(Buffer.from(ffi.toArrayBuffer(addr, n * 16).slice(0)).toString("hex"))
        sym.textBufferFreeLineHighlights(isZig ? p : Number(p), n)
      }
      return dump
    })(),
  }
}

function lineInfo(sym, view, isZig) {
  const out = new Uint8Array(72)
  keepAlive.push(out)
  sym.textBufferViewGetLineInfoDirect(view, isZig ? ptr(out) : Number(ptr(out)))
  const dv = new DataView(out.buffer, out.byteOffset)
  const dump = []
  for (let f = 0; f < 4; f++) {
    const p = dv.getBigUint64(f * 16, true)
    const n = dv.getUint32(f * 16 + 8, true)
    if (!p || !n) {
      dump.push("")
      continue
    }
    dump.push(Buffer.from(ffi.toArrayBuffer(p, n * 4).slice(0)).toString("hex"))
  }
  dump.push(dv.getUint32(64, true))
  return dump
}

const seqArg = process.argv.find((a) => a.startsWith("--seqs="))
const SEQUENCES = seqArg ? Number(seqArg.slice(7)) : 400
let failures = 0

outer: for (let s = 0; s < SEQUENCES; s++) {
  const zh = zig.createTextBuffer(1)
  const rh = rust.createTextBuffer(1)
  const zStyle = zig.createSyntaxStyle()
  const rStyle = rust.createSyntaxStyle()
  const zView = zig.createTextBufferView(zh)
  const rView = rust.createTextBufferView(rh)
  if (rand() < 0.5) {
    const [vx, vy, vw, vh] = [randInt(4), randInt(4), 1 + randInt(40), 1 + randInt(10)]
    zig.textBufferViewSetViewport(zView, vx, vy, vw, vh)
    rust.textBufferViewSetViewport(rView, vx, vy, vw, vh)
  }
  if (rand() < 0.6) {
    const mode = 1 + randInt(2) // char | word
    const width = 2 + randInt(20)
    zig.textBufferViewSetWrapMode(zView, mode)
    rust.textBufferViewSetWrapMode(rView, mode)
    zig.textBufferViewSetWrapWidth(zView, width)
    rust.textBufferViewSetWrapWidth(rView, width)
    if (rand() < 0.3) {
      const flo = randInt(10)
      zig.textBufferViewSetFirstLineOffset(zView, flo)
      rust.textBufferViewSetFirstLineOffset(rView, flo)
    }
  }
  if (rand() < 0.6) {
    zig.textBufferSetSyntaxStyle(zh, zStyle)
    rust.textBufferSetSyntaxStyle(rh, rStyle)
  }
  const opsLog = []
  const memIds = []
  const opCount = 3 + randInt(12)
  for (let i = 0; i < opCount; i++) {
    const op = randInt(10)
    if (op < 3) {
      const count = 1 + randInt(4)
      const specs = Array.from({ length: count }, () => ({
        text: encode(TEXTS[randInt(TEXTS.length)]),
        attributes: randInt(256),
        fg: rand() < 0.5 ? packColor(randInt(256), randInt(256), randInt(256), 255) : null,
        bg: rand() < 0.3 ? packColor(randInt(256), randInt(256), randInt(256), 255) : null,
      }))
      opsLog.push(`styled(${count})`)
      zig.textBufferSetStyledText(zh, ptr(packChunks(specs)), count)
      rust.textBufferSetStyledText(rh, Number(ptr(packChunks(specs))), count)
    } else if (op < 5) {
      const text = encode(TEXTS[randInt(TEXTS.length)])
      if (text.length === 0) continue
      opsLog.push(`append(${text.length}b)`)
      zig.textBufferAppend(zh, ptr(text), text.length)
      rust.textBufferAppend(rh, Number(ptr(text)), text.length)
    } else if (op === 5) {
      opsLog.push("reset")
      zig.textBufferReset(zh)
      rust.textBufferReset(rh)
      memIds.length = 0
    } else if (op === 6) {
      opsLog.push("clear")
      zig.textBufferClear(zh)
      rust.textBufferClear(rh)
    } else if (op === 7) {
      const w = 1 + randInt(8)
      opsLog.push(`tab(${w})`)
      zig.textBufferSetTabWidth(zh, w)
      rust.textBufferSetTabWidth(rh, w)
    } else if (op === 8) {
      const text = encode(TEXTS[randInt(TEXTS.length)])
      const zid = Number(zig.textBufferRegisterMemBuffer(zh, ptr(text), text.length, 0))
      const rid = Number(rust.textBufferRegisterMemBuffer(rh, Number(ptr(text)), text.length, 0))
      opsLog.push(`regMem(z=${zid},r=${rid})`)
      if (zid !== rid) {
        console.error(`✗ seq ${s}: mem id divergence z=${zid} r=${rid}\n  ops: ${opsLog.join(" | ")}`)
        failures++
        continue outer
      }
      if (zid !== 0xffff) memIds.push(zid)
    } else if (op === 9 && rand() < 0.6) {
      const kind = randInt(4)
      const hl = new ArrayBuffer(16)
      const dv = new DataView(hl)
      const u8hl = new Uint8Array(hl)
      keepAlive.push(u8hl)
      const a = randInt(30),
        b = a + randInt(12)
      dv.setUint32(0, a, true)
      dv.setUint32(4, b, true)
      dv.setUint32(8, 1 + randInt(20), true)
      dv.setUint8(12, randInt(4))
      dv.setUint16(14, randInt(5), true)
      if (kind === 0) {
        const line = randInt(6)
        opsLog.push(`hl(line=${line},${a}..${b})`)
        zig.textBufferAddHighlight(zh, line, ptr(u8hl))
        rust.textBufferAddHighlight(rh, line, Number(ptr(u8hl)))
      } else if (kind === 1) {
        opsLog.push(`hlRange(${a}..${b})`)
        zig.textBufferAddHighlightByCharRange(zh, ptr(u8hl))
        rust.textBufferAddHighlightByCharRange(rh, Number(ptr(u8hl)))
      } else if (kind === 2) {
        const ref = randInt(5)
        opsLog.push(`hlRemoveRef(${ref})`)
        zig.textBufferRemoveHighlightsByRef(zh, ref)
        rust.textBufferRemoveHighlightsByRef(rh, ref)
      } else {
        if (rand() < 0.5) {
          const line = randInt(6)
          opsLog.push(`hlClearLine(${line})`)
          zig.textBufferClearLineHighlights(zh, line)
          rust.textBufferClearLineHighlights(rh, line)
        } else {
          opsLog.push("hlClearAll")
          zig.textBufferClearAllHighlights(zh)
          rust.textBufferClearAllHighlights(rh)
        }
      }
    } else if (op === 9 && rand() < 0.5) {
      const kind = randInt(4)
      if (kind === 0) {
        const a = randInt(40),
          b = randInt(40)
        opsLog.push(`sel(${a},${b})`)
        zig.textBufferViewSetSelection(zView, a, b, 0, 0)
        rust.textBufferViewSetSelection(rView, a, b, 0, 0)
      } else if (kind === 1) {
        const [ax, ay, fx, fy] = [randInt(30) - 5, randInt(8) - 2, randInt(30) - 5, randInt(8) - 2]
        opsLog.push(`localSel(${ax},${ay},${fx},${fy})`)
        const zr = zig.textBufferViewSetLocalSelection(zView, ax, ay, fx, fy, 0, 0)
        const rr = rust.textBufferViewSetLocalSelection(rView, ax, ay, fx, fy, 0, 0)
        if (Boolean(zr) !== Boolean(rr)) {
          opsLog.push(`RETDIFF z=${zr} r=${rr}`)
        }
      } else if (kind === 2) {
        const [fx, fy] = [randInt(30) - 5, randInt(8) - 2]
        opsLog.push(`updLocalSel(${fx},${fy})`)
        zig.textBufferViewUpdateLocalSelection(zView, 0, 0, fx, fy, 0, 0)
        rust.textBufferViewUpdateLocalSelection(rView, 0, 0, fx, fy, 0, 0)
      } else {
        opsLog.push(rand() < 0.5 ? "resetSel" : "resetLocalSel")
        if (opsLog[opsLog.length - 1] === "resetSel") {
          zig.textBufferViewResetSelection(zView)
          rust.textBufferViewResetSelection(rView)
        } else {
          zig.textBufferViewResetLocalSelection(zView)
          rust.textBufferViewResetLocalSelection(rView)
        }
      }
    } else if (memIds.length > 0) {
      const id = memIds[randInt(memIds.length)]
      if (rand() < 0.5) {
        opsLog.push(`setFromMem(${id})`)
        zig.textBufferSetTextFromMem(zh, id)
        rust.textBufferSetTextFromMem(rh, id)
      } else {
        opsLog.push(`appendFromMem(${id})`)
        zig.textBufferAppendFromMemId(zh, id)
        rust.textBufferAppendFromMemId(rh, id)
      }
    } else {
      continue
    }

    const zs = state(zig, zh, true)
    const rs = state(rust, rh, false)
    // text-range extraction across random weight windows and coords
    for (let r = 0; r < 3; r++) {
      const a = randInt(zs.length + 3)
      const b = a + randInt(8)
      const zOut = new Uint8Array(4096)
      const rOut = new Uint8Array(4096)
      const zl = Number(zig.textBufferGetTextRange(zh, a, b, ptr(zOut), zOut.length))
      const rl = Number(rust.textBufferGetTextRange(rh, a, b, Number(ptr(rOut)), rOut.length))
      zs[`range${r}`] = Buffer.from(zOut.subarray(0, zl)).toString("hex")
      rs[`range${r}`] = Buffer.from(rOut.subarray(0, rl)).toString("hex")
      const [sr, sc, er, ec] = [randInt(zs.lines + 1), randInt(6), randInt(zs.lines + 1), randInt(6)]
      const zc = Number(zig.textBufferGetTextRangeByCoords(zh, sr, sc, er, ec, ptr(zOut), zOut.length))
      const rc = Number(rust.textBufferGetTextRangeByCoords(rh, sr, sc, er, ec, Number(ptr(rOut)), rOut.length))
      zs[`coords${r}`] = Buffer.from(zOut.subarray(0, zc)).toString("hex")
      rs[`coords${r}`] = Buffer.from(rOut.subarray(0, rc)).toString("hex")
    }
    zs.vlines = Number(zig.textBufferViewGetVirtualLineCount(zView))
    rs.vlines = Number(rust.textBufferViewGetVirtualLineCount(rView))
    zs.lineInfo = lineInfo(zig, zView, true)
    rs.lineInfo = lineInfo(rust, rView, false)
    zs.selInfo = String(zig.textBufferViewGetSelectionInfo(zView))
    rs.selInfo = String(BigInt.asUintN(64, BigInt(rust.textBufferViewGetSelectionInfo(rView))))
    {
      const zOut = new Uint8Array(2048),
        rOut = new Uint8Array(2048)
      const zl = Number(zig.textBufferViewGetSelectedText(zView, ptr(zOut), zOut.length))
      const rl = Number(rust.textBufferViewGetSelectedText(rView, Number(ptr(rOut)), rOut.length))
      zs.selText = Buffer.from(zOut.subarray(0, zl)).toString("hex")
      rs.selText = Buffer.from(rOut.subarray(0, rl)).toString("hex")
    }
    if (!jsonEqual(zs, rs)) {
      console.error(`✗ seq ${s} op ${i} [${opsLog[opsLog.length - 1]}]`)
      console.error(`  zig : ${JSON.stringify(zs)}`)
      console.error(`  rust: ${JSON.stringify(rs)}`)
      console.error(`  ops: ${opsLog.join(" | ")}`)
      failures++
      if (failures >= 5) break outer
      continue outer
    }
  }
  // style registry state must agree too
  const zc = Number(zig.syntaxStyleGetStyleCount(zStyle))
  const rc = Number(rust.syntaxStyleGetStyleCount(rStyle))
  if (zc !== rc) {
    console.error(`✗ seq ${s}: style count divergence z=${zc} r=${rc}`)
    failures++
  }
  const probeName = encode("chunk0")
  const zid = Number(zig.syntaxStyleResolveByName(zStyle, ptr(probeName), probeName.length))
  const rid = Number(rust.syntaxStyleResolveByName(rStyle, Number(ptr(probeName)), probeName.length))
  if (zid !== rid) {
    console.error(`✗ seq ${s}: resolveByName divergence z=${zid} r=${rid}`)
    failures++
  }
  zig.destroyTextBufferView(zView)
  rust.destroyTextBufferView(rView)
  zig.destroySyntaxStyle(zStyle)
  rust.destroySyntaxStyle(rStyle)
  zig.destroyTextBuffer(zh)
  rust.destroyTextBuffer(rh)
}

if (failures > 0) {
  console.error(`\ntext parity: ${failures} failing sequence(s) of ${SEQUENCES}`)
  process.exit(1)
}
console.log(`text parity: MATCH (${SEQUENCES} op sequences)`)
process.exit(0)

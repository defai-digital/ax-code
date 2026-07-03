// ADR-046 Slice C3a parity harness: TextBuffer core ops vs the Zig library.
// Drives identical op sequences (setStyledText with mixed chunks, append,
// reset, clear, tab width, mem-buffer registration) and compares plain text,
// length, byte size, line count, and tab width after every op.
//
// Run with: node --experimental-ffi script/native-render-text-parity.mjs [--seqs=N]
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

let seed = 0x7e57b0f
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000)
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
    dv.setBigUint64(off + 16, 0n, true) // fg (styling lands in C4)
    dv.setBigUint64(off + 24, 0n, true) // bg
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
  }
}

const seqArg = process.argv.find((a) => a.startsWith("--seqs="))
const SEQUENCES = seqArg ? Number(seqArg.slice(7)) : 400
let failures = 0

outer: for (let s = 0; s < SEQUENCES; s++) {
  const zh = zig.createTextBuffer(1)
  const rh = rust.createTextBuffer(1)
  const opsLog = []
  const memIds = []
  const opCount = 3 + randInt(12)
  for (let i = 0; i < opCount; i++) {
    const op = randInt(10)
    if (op < 3) {
      const count = 1 + randInt(4)
      const specs = Array.from({ length: count }, () => ({ text: encode(TEXTS[randInt(TEXTS.length)]), attributes: randInt(256) }))
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
      const rid = Number(rust.textBufferRegisterMemBuffer(rh, Number(ptr(text)), text.length, false))
      opsLog.push(`regMem(z=${zid},r=${rid})`)
      if (zid !== rid) {
        console.error(`✗ seq ${s}: mem id divergence z=${zid} r=${rid}\n  ops: ${opsLog.join(" | ")}`)
        failures++
        continue outer
      }
      if (zid !== 0xffff) memIds.push(zid)
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
    if (JSON.stringify(zs) !== JSON.stringify(rs)) {
      console.error(`✗ seq ${s} op ${i} [${opsLog[opsLog.length - 1]}]`)
      console.error(`  zig : ${JSON.stringify(zs)}`)
      console.error(`  rust: ${JSON.stringify(rs)}`)
      console.error(`  ops: ${opsLog.join(" | ")}`)
      failures++
      if (failures >= 5) break outer
      continue outer
    }
  }
  zig.destroyTextBuffer(zh)
  rust.destroyTextBuffer(rh)
}

if (failures > 0) {
  console.error(`\ntext parity: ${failures} failing sequence(s) of ${SEQUENCES}`)
  process.exit(1)
}
console.log(`text parity: MATCH (${SEQUENCES} op sequences)`)
process.exit(0)

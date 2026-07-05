// ADR-046 Slice D parity harness: EditBuffer ops vs the Zig backend.
// Drives identical editing sequences (setText, insert, backspace, delete,
// cursor movement, word boundaries, undo/redo) on both backends and compares
// the plain text, cursor position, EOL, word boundaries, and undo/redo state
// after every op.
//
// Run: node --experimental-ffi script/native-render-editbuffer-parity.mjs [--seqs=N]
// Exit: 0 = parity, 1 = mismatch, 2 = addon not built (skip).

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

let seed = 0x3d17b9
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000
const randInt = (n) => Math.floor(rand() * n)
const ptr = (v) => ffi.getRawPointer(v)
const keepAlive = []
const encode = (s) => {
  const b = new TextEncoder().encode(s)
  keepAlive.push(b)
  return b
}

const INSERTS = ["a", "x", " ", "hello", "世界", "café", "\n", "  ", "foo bar", "🎉", "\ttab"]
const SETTEXTS = [
  "hello world",
  "line one\nline two\nline three",
  "混合 width 世界",
  "word boundary test here",
  "",
  "single",
  "a\nb\nc\nd",
  "trailing space \nnext",
]

const NO_SINK = 0xffff // INVALID_HANDLE for the event sink

function cursorStruct(sym, fn, handle, isZig) {
  const out = new Uint8Array(12)
  keepAlive.push(out)
  fn(handle, isZig ? ptr(out) : Number(ptr(out)))
  const dv = new DataView(out.buffer)
  return [dv.getUint32(0, true), dv.getUint32(4, true), dv.getUint32(8, true)]
}

function state(sym, handle, isZig) {
  const out = new Uint8Array(65536)
  keepAlive.push(out)
  const len = sym.editBufferGetText(handle, isZig ? ptr(out) : Number(ptr(out)), out.length)
  return {
    text: Buffer.from(out.subarray(0, Number(len))).toString("hex"),
    cursor: cursorStruct(sym, sym.editBufferGetCursorPosition, handle, isZig),
    eol: cursorStruct(sym, sym.editBufferGetEOL, handle, isZig),
    nextWord: cursorStruct(sym, sym.editBufferGetNextWordBoundary, handle, isZig),
    prevWord: cursorStruct(sym, sym.editBufferGetPrevWordBoundary, handle, isZig),
    canUndo: Boolean(sym.editBufferCanUndo(handle)),
    canRedo: Boolean(sym.editBufferCanRedo(handle)),
  }
}

const seqArg = process.argv.find((a) => a.startsWith("--seqs="))
const SEQUENCES = seqArg ? Number(seqArg.slice(7)) : 400
let failures = 0

outer: for (let s = 0; s < SEQUENCES; s++) {
  const zh = zig.createEditBuffer(1, NO_SINK)
  const rh = rust.createEditBuffer(1, NO_SINK)
  const opsLog = []
  const initial = encode(SETTEXTS[randInt(SETTEXTS.length)])
  zig.editBufferSetText(zh, ptr(initial), initial.length)
  rust.editBufferSetText(rh, Number(ptr(initial)), initial.length)
  opsLog.push(`setText(${initial.length}b)`)

  const opCount = 4 + randInt(20)
  for (let i = 0; i < opCount; i++) {
    const op = randInt(16)
    if (op < 4) {
      const t = encode(INSERTS[randInt(INSERTS.length)])
      opsLog.push(`insert`)
      zig.editBufferInsertText(zh, ptr(t), t.length)
      rust.editBufferInsertText(rh, Number(ptr(t)), t.length)
    } else if (op === 4) {
      opsLog.push("backspace")
      zig.editBufferDeleteCharBackward(zh)
      rust.editBufferDeleteCharBackward(rh)
    } else if (op === 5) {
      opsLog.push("delete")
      zig.editBufferDeleteChar(zh)
      rust.editBufferDeleteChar(rh)
    } else if (op === 6) {
      opsLog.push("left")
      zig.editBufferMoveCursorLeft(zh)
      rust.editBufferMoveCursorLeft(rh)
    } else if (op === 7) {
      opsLog.push("right")
      zig.editBufferMoveCursorRight(zh)
      rust.editBufferMoveCursorRight(rh)
    } else if (op === 8) {
      opsLog.push("up")
      zig.editBufferMoveCursorUp(zh)
      rust.editBufferMoveCursorUp(rh)
    } else if (op === 9) {
      opsLog.push("down")
      zig.editBufferMoveCursorDown(zh)
      rust.editBufferMoveCursorDown(rh)
    } else if (op === 10) {
      const [r, c] = [randInt(5), randInt(20)]
      opsLog.push(`setCursor(${r},${c})`)
      zig.editBufferSetCursor(zh, r, c)
      rust.editBufferSetCursor(rh, r, c)
    } else if (op === 11) {
      const o = randInt(40)
      opsLog.push(`setCursorByOffset(${o})`)
      zig.editBufferSetCursorByOffset(zh, o)
      rust.editBufferSetCursorByOffset(rh, o)
    } else if (op === 12) {
      opsLog.push("deleteLine")
      zig.editBufferDeleteLine(zh)
      rust.editBufferDeleteLine(rh)
    } else if (op === 13) {
      opsLog.push("undo")
      {
        const ub = new Uint8Array(64)
        keepAlive.push(ub)
        zig.editBufferUndo(zh, ptr(ub), ub.length)
        rust.editBufferUndo(rh, Number(ptr(ub)), ub.length)
      }
    } else if (op === 14) {
      opsLog.push("redo")
      {
        const ub = new Uint8Array(64)
        keepAlive.push(ub)
        zig.editBufferRedo(zh, ptr(ub), ub.length)
        rust.editBufferRedo(rh, Number(ptr(ub)), ub.length)
      }
    } else {
      const line = randInt(5)
      opsLog.push(`gotoLine(${line})`)
      zig.editBufferGotoLine(zh, line)
      rust.editBufferGotoLine(rh, line)
    }

    const zs = state(zig, zh, true)
    const rs = state(rust, rh, false)
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
  zig.destroyEditBuffer(zh)
  rust.destroyEditBuffer(rh)
}

if (failures > 0) {
  console.error(`\neditbuffer parity: ${failures} failing sequence(s) of ${SEQUENCES}`)
  process.exit(1)
}
console.log(`editbuffer parity: MATCH (${SEQUENCES} op sequences)`)
process.exit(0)

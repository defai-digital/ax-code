// ADR-046 Slice E: editorView parity (Rust vs Zig). Creates an EditBuffer with
// identical text on both backends, wraps it in an EditorView, then drives a
// randomized sequence of viewport / cursor / visual-move / selection ops and
// diffs every observable getter (cursor, viewport, visual cursor, EOL/SOL, word
// boundaries, virtual line count, selection, text).
//
// Run:  node --experimental-ffi script/native-render-editorview-parity.mjs [--seqs=N]
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
if (!rust || typeof rust.createEditorView !== "function") {
  console.log("editorview parity: RUST createEditorView NOT BUILT — skipping")
  process.exit(2)
}

const enc = new TextEncoder()
const keep = []
const rp = (v) => ffi.getRawPointer(v)
const sp = (isZig, v) => (isZig ? rp(v) : Number(rp(v)))
let seed = 0xed17e
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000)
const randInt = (n) => Math.floor(rand() * n)

const CORPUS = [
  "hello world",
  "line one\nline two\nthird line here",
  "a\nbb\nccc\ndddd\n\neeeee",
  "the quick brown fox\njumps over\nthe lazy dog",
  "café 混合 text\nsecond 混合 line",
]

// Read a 20-byte ExternalVisualCursor into a comparable tuple.
function visualCursor(sym, fn, handle, isZig) {
  const b = new Uint8Array(20)
  keep.push(b)
  sym[fn](handle, sp(isZig, b))
  const dv = new DataView(b.buffer)
  return [dv.getUint32(0, true), dv.getUint32(4, true), dv.getUint32(8, true), dv.getUint32(12, true), dv.getUint32(16, true)]
}

function cursor(sym, handle, isZig) {
  const b = new Uint32Array(2)
  keep.push(b)
  sym.editorViewGetCursor(handle, sp(isZig, b), isZig ? rp(b) + 4n : Number(rp(b)) + 4)
  return [b[0], b[1]]
}

function viewport(sym, handle, isZig) {
  const b = new Uint32Array(4)
  keep.push(b)
  const base = rp(b)
  const off = (n) => (isZig ? base + BigInt(n) : Number(base) + n)
  // The Zig symbol's bool return is not captured by the vendored FFI signature
  // (reads back undefined), so compare the written x/y/w/h only.
  sym.editorViewGetViewport(handle, off(0), off(4), off(8), off(12))
  return [b[0], b[1], b[2], b[3]]
}

function textOf(sym, handle, isZig) {
  const b = new Uint8Array(256)
  keep.push(b)
  const n = Number(sym.editorViewGetText(handle, sp(isZig, b), 256))
  return Buffer.from(b.subarray(0, n)).toString("hex")
}

function snapshot(sym, handle, isZig) {
  return JSON.stringify({
    cursor: cursor(sym, handle, isZig),
    viewport: viewport(sym, handle, isZig),
    visual: visualCursor(sym, "editorViewGetVisualCursor", handle, isZig),
    eol: visualCursor(sym, "editorViewGetEOL", handle, isZig),
    sol: visualCursor(sym, "editorViewGetVisualSOL", handle, isZig),
    veol: visualCursor(sym, "editorViewGetVisualEOL", handle, isZig),
    nextWord: visualCursor(sym, "editorViewGetNextWordBoundary", handle, isZig),
    prevWord: visualCursor(sym, "editorViewGetPrevWordBoundary", handle, isZig),
    vlc: Number(sym.editorViewGetVirtualLineCount(handle)),
    tvlc: Number(sym.editorViewGetTotalVirtualLineCount(handle)),
    selection: sym.editorViewGetSelection(handle).toString(),
    text: textOf(sym, handle, isZig),
  })
}

const seqArg = process.argv.find((a) => a.startsWith("--seqs="))
const SEQUENCES = seqArg ? Number(seqArg.slice(7)) : 200
let failures = 0

for (let s = 0; s < SEQUENCES && failures < 5; s++) {
  const text = enc.encode(CORPUS[randInt(CORPUS.length)])
  keep.push(text)
  const zeb = zig.createEditBuffer(1, 0)
  const reb = rust.createEditBuffer(1, 0)
  zig.editBufferSetText(zeb, rp(text), text.length)
  rust.editBufferSetText(reb, Number(rp(text)), text.length)

  const w = 4 + randInt(12)
  const h = 2 + randInt(5)
  const zv = zig.createEditorView(zeb, w, h)
  const rv = rust.createEditorView(reb, w, h)

  const nOps = 3 + randInt(10)
  for (let i = 0; i < nOps; i++) {
    const op = randInt(7)
    const apply = (fn) => {
      fn(zig, zeb, zv, true)
      fn(rust, reb, rv, false)
    }
    switch (op) {
      case 0: {
        const off = randInt(text.length + 1)
        apply((sym, eb, v) => sym.editorViewSetCursorByOffset(v, off))
        break
      }
      case 1:
        apply((sym, eb, v) => sym.editorViewMoveUpVisual(v))
        break
      case 2:
        apply((sym, eb, v) => sym.editorViewMoveDownVisual(v))
        break
      case 3: {
        const x = randInt(w),
          y = randInt(h),
          mc = randInt(2)
        apply((sym, eb, v) => sym.editorViewSetViewport(v, x, y, w, h, mc))
        break
      }
      case 4: {
        const a = randInt(text.length + 1),
          b = randInt(text.length + 1)
        apply((sym, eb, v) => sym.editorViewSetSelection(v, Math.min(a, b), Math.max(a, b), 0, 0))
        break
      }
      case 5:
        apply((sym, eb, v) => sym.editorViewResetSelection(v))
        break
      case 6: {
        const mode = randInt(2) // none / char
        apply((sym, eb, v) => sym.editorViewSetWrapMode(v, mode))
        break
      }
    }

    const zs = snapshot(zig, zv, true)
    const rs = snapshot(rust, rv, false)
    if (zs !== rs) {
      console.error(`✗ seq ${s} op ${i} (kind ${op}, ${w}x${h}): editorView state differs`)
      console.error(`  zig : ${zs}`)
      console.error(`  rust: ${rs}`)
      failures++
      break
    }
  }
  zig.destroyEditorView(zv)
  rust.destroyEditorView(rv)
  zig.destroyEditBuffer(zeb)
  rust.destroyEditBuffer(reb)
}

if (failures > 0) {
  console.error(`\neditorview parity: ${failures} failing check(s) of ${SEQUENCES}`)
  process.exit(1)
}
console.log(`editorview parity: MATCH (${SEQUENCES} sequences)`)
process.exit(0)

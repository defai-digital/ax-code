// ADR-046 Slice C3a — standalone probe for the Rust TextBuffer FFI surface.
// Exercises createTextBuffer, setStyledText, append, getPlainText, getLength,
// getByteSize, getLineCount, tab width, reset/clear, mem-buffer registration,
// text-range extraction, highlights, and syntax-style registration.
//
// Run with: node --experimental-ffi script/native-render-text-buffer-probe.mjs
// Exit codes: 0 = all checks passed, 1 = failure, 2 = addon not built (skip).

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
let R
try {
  R = require("@ax-code/render")
} catch {
  console.error("@ax-code/render addon not built (run: pnpm build:native render) — skipping")
  process.exit(2)
}
const ffi = require("node:ffi")
const ptr = (v) => ffi.getRawPointer(v)
const keepAlive = []
const encode = (s) => { const b = new TextEncoder().encode(s); keepAlive.push(b); return b }

function packColor(r, g, b, a, meta = 0) {
  const arr = new Uint16Array(4); keepAlive.push(arr)
  arr[0] = (r & 0xff) | ((meta & 0xff) << 8)
  arr[1] = (g & 0xff) | (((meta >> 8) & 0xff) << 8)
  arr[2] = (b & 0xff) | (((meta >> 16) & 0xff) << 8)
  arr[3] = (a & 0xff) | (((meta >> 24) & 0xff) << 8)
  return arr
}

function packChunks(specs) {
  const buf = new ArrayBuffer(specs.length * 56)
  const dv = new DataView(buf); const u8 = new Uint8Array(buf); keepAlive.push(u8)
  specs.forEach((spec, i) => {
    const off = i * 56
    dv.setBigUint64(off, BigInt(spec.text.length ? ffi.getRawPointer(spec.text) : 0n), true)
    dv.setBigUint64(off + 8, BigInt(spec.text.length), true)
    dv.setBigUint64(off + 16, spec.fg ? BigInt(ffi.getRawPointer(spec.fg)) : 0n, true)
    dv.setBigUint64(off + 24, spec.bg ? BigInt(ffi.getRawPointer(spec.bg)) : 0n, true)
    dv.setUint32(off + 32, spec.attributes >>> 0, true)
    dv.setBigUint64(off + 40, 0n, true)
    dv.setBigUint64(off + 48, 0n, true)
  })
  return u8
}

function getPlainText(handle) {
  const out = new Uint8Array(65536)
  keepAlive.push(out)
  const len = R.textBufferGetPlainText(handle, Number(ptr(out)), out.length)
  return new TextDecoder().decode(out.subarray(0, len))
}

let failures = 0
const check = (name, cond, detail = "") => {
  if (!cond) {
    console.error(`✗ ${name}${detail ? ": " + detail : ""}`)
    failures++
  }
}

// --- 1. create/destroy lifecycle and empty state ---
{
  const h = R.createTextBuffer(1)
  check("create returns positive handle", h > 0, `got ${h}`)
  check("empty length is 0", R.textBufferGetLength(h) === 0, `got ${R.textBufferGetLength(h)}`)
  check("empty byteSize is 0", R.textBufferGetByteSize(h) === 0, `got ${R.textBufferGetByteSize(h)}`)
  // Empty buffer has 1 line (the initial empty line).
  check("empty lineCount is 1", R.textBufferGetLineCount(h) === 1, `got ${R.textBufferGetLineCount(h)}`)
  check("default tabWidth is 2", R.textBufferGetTabWidth(h) === 2, `got ${R.textBufferGetTabWidth(h)}`)
  R.destroyTextBuffer(h)
}

// --- 2. setStyledText stores styled chunks and reports correct metrics ---
{
  const h = R.createTextBuffer(1)
  const chunks = packChunks([
    { text: encode("hello "), attributes: 0, fg: packColor(255, 0, 0, 255), bg: null },
    { text: encode("world"),  attributes: 1, fg: null, bg: packColor(0, 0, 255, 255) },
  ])
  R.textBufferSetStyledText(h, Number(ptr(chunks)), 2)
  const text = getPlainText(h)
  check("styled text content", text === "hello world", `got ${JSON.stringify(text)}`)
  check("styled length", R.textBufferGetLength(h) === 11, `got ${R.textBufferGetLength(h)}`)
  check("styled byteSize", R.textBufferGetByteSize(h) === 11, `got ${R.textBufferGetByteSize(h)}`)
  check("styled lineCount", R.textBufferGetLineCount(h) === 1, `got ${R.textBufferGetLineCount(h)}`)
  R.destroyTextBuffer(h)
}

// --- 3. append adds text and updates line count ---
{
  const h = R.createTextBuffer(1)
  const t1 = encode("line1\n")
  R.textBufferAppend(h, Number(ptr(t1)), t1.length)
  check("append text", getPlainText(h) === "line1\n", `got ${JSON.stringify(getPlainText(h))}`)
  check("append lineCount", R.textBufferGetLineCount(h) === 2, `got ${R.textBufferGetLineCount(h)}`)
  const t2 = encode("line2")
  R.textBufferAppend(h, Number(ptr(t2)), t2.length)
  check("append2 text", getPlainText(h) === "line1\nline2", `got ${JSON.stringify(getPlainText(h))}`)
  // getLength returns total display width (excludes newline markers).
  check("append2 length (display width)", R.textBufferGetLength(h) === 10, `got ${R.textBufferGetLength(h)}`)
  R.destroyTextBuffer(h)
}

// --- 4. reset clears content but preserves tab width; clear resets tab width ---
{
  const h = R.createTextBuffer(1)
  R.textBufferSetTabWidth(h, 8)
  const t = encode("some text")
  R.textBufferAppend(h, Number(ptr(t)), t.length)
  check("pre-reset length", R.textBufferGetLength(h) === 9, `got ${R.textBufferGetLength(h)}`)
  R.textBufferReset(h)
  check("post-reset length", R.textBufferGetLength(h) === 0, `got ${R.textBufferGetLength(h)}`)
  check("reset preserves tabWidth", R.textBufferGetTabWidth(h) === 8, `got ${R.textBufferGetTabWidth(h)}`)
  // setTabWidth clamps to min 2 and rounds up to even; clear() does NOT reset tab_width.
  R.textBufferSetTabWidth(h, 3) // clamped to 3, rounded up to 4
  check("setTabWidth(3) rounds to 4", R.textBufferGetTabWidth(h) === 4, `got ${R.textBufferGetTabWidth(h)}`)
  R.textBufferClear(h)
  check("clear preserves tabWidth", R.textBufferGetTabWidth(h) === 4, `got ${R.textBufferGetTabWidth(h)}`)
  R.destroyTextBuffer(h)
}

// --- 5. registerMemBuffer and setTextFromMem load external text ---
{
  const h = R.createTextBuffer(1)
  const data = encode("registered content")
  const id = R.textBufferRegisterMemBuffer(h, Number(ptr(data)), data.length, 0)
  check("registerMemBuffer returns valid id", id !== 0xffff, `got ${id}`)
  R.textBufferSetTextFromMem(h, id)
  check("setTextFromMem content", getPlainText(h) === "registered content", `got ${JSON.stringify(getPlainText(h))}`)
  check("setTextFromMem length", R.textBufferGetLength(h) === 18, `got ${R.textBufferGetLength(h)}`)
  R.destroyTextBuffer(h)
}

// --- 6. getTextRange extracts a substring by weight offset ---
{
  const h = R.createTextBuffer(1)
  const chunks = packChunks([{ text: encode("abcdefghij"), attributes: 0, fg: null, bg: null }])
  R.textBufferSetStyledText(h, Number(ptr(chunks)), 1)
  const out = new Uint8Array(64); keepAlive.push(out)
  const len = R.textBufferGetTextRange(h, 2, 7, Number(ptr(out)), out.length)
  const sub = new TextDecoder().decode(out.subarray(0, len))
  check("getTextRange result", sub === "cdefg", `got ${JSON.stringify(sub)}`)
  R.destroyTextBuffer(h)
}

// --- 7. getTextRangeByCoords extracts by row/col coordinates ---
{
  const h = R.createTextBuffer(1)
  const chunks = packChunks([{ text: encode("line1\nline2\nline3"), attributes: 0, fg: null, bg: null }])
  R.textBufferSetStyledText(h, Number(ptr(chunks)), 1)
  const out = new Uint8Array(64); keepAlive.push(out)
  const len = R.textBufferGetTextRangeByCoords(h, 0, 2, 1, 3, Number(ptr(out)), out.length)
  const sub = new TextDecoder().decode(out.subarray(0, len))
  check("getTextRangeByCoords non-empty", sub.length > 0, `got ${JSON.stringify(sub)}`)
  R.destroyTextBuffer(h)
}

// --- 8. highlights: add, count, retrieve, remove, and clear ---
{
  const h = R.createTextBuffer(1)
  const chunks = packChunks([{ text: encode("hello world\nsecond line"), attributes: 0, fg: null, bg: null }])
  R.textBufferSetStyledText(h, Number(ptr(chunks)), 1)

  const hl = new ArrayBuffer(16); const hlv = new DataView(hl); const hlu8 = new Uint8Array(hl); keepAlive.push(hlu8)
  hlv.setUint32(0, 0, true); hlv.setUint32(4, 5, true); hlv.setUint32(8, 1, true)
  hlu8[12] = 2; hlv.setUint16(14, 100, true)
  R.textBufferAddHighlight(h, 0, Number(ptr(hlu8)))
  check("highlight count after add", R.textBufferGetHighlightCount(h) === 1, `got ${R.textBufferGetHighlightCount(h)}`)

  const countBuf = new Uint32Array(1); keepAlive.push(new Uint8Array(countBuf.buffer))
  const hlPtr = R.textBufferGetLineHighlightsPtr(h, 0, Number(ptr(countBuf)))
  check("line highlight count", countBuf[0] === 1, `got ${countBuf[0]}`)
  check("line highlight ptr nonzero", hlPtr !== 0, `got ${hlPtr}`)
  R.textBufferFreeLineHighlights(hlPtr, countBuf[0])

  R.textBufferRemoveHighlightsByRef(h, 100)
  check("highlight count after removeRef", R.textBufferGetHighlightCount(h) === 0, `got ${R.textBufferGetHighlightCount(h)}`)

  R.textBufferAddHighlight(h, 0, Number(ptr(hlu8)))
  check("highlight count re-add", R.textBufferGetHighlightCount(h) === 1, `got ${R.textBufferGetHighlightCount(h)}`)
  R.textBufferClearLineHighlights(h, 0)
  check("highlight count after clearLine", R.textBufferGetHighlightCount(h) === 0, `got ${R.textBufferGetHighlightCount(h)}`)

  hlv.setUint16(14, 200, true)
  R.textBufferAddHighlightByCharRange(h, Number(ptr(hlu8)))
  check("highlight count after charRange", R.textBufferGetHighlightCount(h) >= 1, `got ${R.textBufferGetHighlightCount(h)}`)
  R.textBufferClearAllHighlights(h)
  check("highlight count after clearAll", R.textBufferGetHighlightCount(h) === 0, `got ${R.textBufferGetHighlightCount(h)}`)

  R.destroyTextBuffer(h)
}

// --- 9. syntax style: register, resolve by name, count ---
{
  const s = R.createSyntaxStyle()
  check("createSyntaxStyle positive handle", s > 0, `got ${s}`)
  check("initial style count is 0", R.syntaxStyleGetStyleCount(s) === 0, `got ${R.syntaxStyleGetStyleCount(s)}`)

  const name = encode("keyword")
  const fg = packColor(255, 200, 0, 255)
  const id = R.syntaxStyleRegister(s, Number(ptr(name)), name.length, Number(ptr(fg)), 0, 0)
  check("register returns positive id", id > 0, `got ${id}`)
  check("style count after register", R.syntaxStyleGetStyleCount(s) === 1, `got ${R.syntaxStyleGetStyleCount(s)}`)

  const resolved = R.syntaxStyleResolveByName(s, Number(ptr(name)), name.length)
  check("resolveByName matches", resolved === id, `got ${resolved}, expected ${id}`)

  const unknown = encode("nonexistent")
  const zero = R.syntaxStyleResolveByName(s, Number(ptr(unknown)), unknown.length)
  check("resolveByName unknown returns 0", zero === 0, `got ${zero}`)

  R.destroySyntaxStyle(s)
}

// --- 10. textBufferSetSyntaxStyle attaches a style registry ---
{
  const h = R.createTextBuffer(1)
  const s = R.createSyntaxStyle()
  const ok = R.textBufferSetSyntaxStyle(h, s)
  check("setSyntaxStyle returns true", ok === true, `got ${ok}`)
  const ok2 = R.textBufferSetSyntaxStyle(h, 0)
  check("setSyntaxStyle(0) detaches", ok2 === true, `got ${ok2}`)
  R.destroySyntaxStyle(s)
  R.destroyTextBuffer(h)
}

// --- 11. replaceMemBuffer swaps content ---
{
  const h = R.createTextBuffer(1)
  const d1 = encode("original")
  const id = R.textBufferRegisterMemBuffer(h, Number(ptr(d1)), d1.length, 0)
  check("registerMemBuffer valid id", id !== 0xffff, `got ${id}`)
  const d2 = encode("replaced")
  const ok = R.textBufferReplaceMemBuffer(h, id, Number(ptr(d2)), d2.length, 0)
  check("replaceMemBuffer returns true", ok === true, `got ${ok}`)
  R.textBufferSetTextFromMem(h, id)
  check("replaced content", getPlainText(h) === "replaced", `got ${JSON.stringify(getPlainText(h))}`)
  R.destroyTextBuffer(h)
}

// --- 12. clearMemRegistry empties registry ---
{
  const h = R.createTextBuffer(1)
  const d = encode("data")
  const id = R.textBufferRegisterMemBuffer(h, Number(ptr(d)), d.length, 0)
  check("register valid", id !== 0xffff, `got ${id}`)
  R.textBufferClearMemRegistry(h)
  R.textBufferAppendFromMemId(h, id)
  check("append after clear is no-op", R.textBufferGetLength(h) === 0, `got ${R.textBufferGetLength(h)}`)
  R.destroyTextBuffer(h)
}

// --- 13. invalid handle is safely rejected ---
{
  check("getLength(0) returns 0", R.textBufferGetLength(0) === 0, `got ${R.textBufferGetLength(0)}`)
  check("getLength(max) returns 0", R.textBufferGetLength(0xffffffff) === 0, `got ${R.textBufferGetLength(0xffffffff)}`)
  check("getPlainText(0) returns 0", R.textBufferGetPlainText(0, 0, 0) === 0)
  R.textBufferReset(0)
  R.textBufferClear(0)
  R.destroyTextBuffer(0)
}

// --- summary ---
if (failures > 0) {
  console.error(`\ntext-buffer probe: ${failures} check(s) failed`)
  process.exit(1)
}
console.log(`text-buffer probe: PASS (13 sections, all checks passed)`)
process.exit(0)

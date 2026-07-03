// ADR-046 Slice A parity harness: Rust unicode core vs the Zig encodeUnicode
// oracle, across a curated corpus plus deterministic pseudo-random fuzz.
//
// Run with: node --experimental-ffi script/native-render-unicode-parity.mjs [--fuzz=N]
// Exit codes: 0 = parity, 1 = mismatch, 2 = Rust addon not built (skip).
//
// Known excluded input class: strings whose first codepoint is a combining
// mark (degenerate mid-cluster starts). The Zig encoder's per-byte fallback
// emits junk continuation-byte cells for those; real rendering never produces
// them (wrapping is cluster-aligned). Tracked as an open question for Slice C.

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
let rust
try {
  rust = require("@ax-code/render")
} catch {
  console.error("@ax-code/render addon not built (run: pnpm build:native render) — skipping")
  process.exit(2)
}
// ADR-046: the native-render overlay is ON BY DEFAULT; force the bundled Zig
// library for this differential harness's reference side. require("@ax-code/render")
// below still returns the raw Rust addon to compare against.
process.env.AX_CODE_NATIVE_RENDER = "0"
const { resolveRenderLib } = await import("@ax-code/opentui-core")
const lib = resolveRenderLib()

const SPECIAL = 0xffffffff

function oracle(text, method) {
  const encoded = lib.encodeUnicode(text, method)
  if (!encoded) return null
  const cells = encoded.data.map((c) => [c.width, c.char < 128 ? c.char : SPECIAL])
  if (encoded.data.length > 0) lib.freeUnicode(encoded)
  return cells
}

function rustCells(text, method) {
  const flat = rust.__axEncodeWidths(text, method === "wcwidth" ? 0 : 1)
  const cells = []
  for (let i = 0; i < flat.length; i += 2) cells.push([flat[i], flat[i + 1] < 128 ? flat[i + 1] : SPECIAL])
  return cells
}

const corpus = [
  "hello world",
  "The quick brown fox jumps over the lazy dog 0123456789",
  "混合寬度測試 mixed width 世界",
  "日本語テキストと한국어 텍스트",
  "🚀 rocket and 🎉 party",
  "👍🏽 skin tone, 👨‍👩‍👧‍👦 family, 🏳️‍🌈 flag sequence",
  "🇹🇼🇯🇵🇺🇸 regional indicator pairs",
  "café résumé naïve (precomposed) vs café résumé (combining)",
  "☀️ VS16 upgrade ☀️ vs bare ☀",
  "क्या हाल है (Devanagari conjuncts) क्‍या",
  "สวัสดีครับ ภาษาไทย",
  "한글 자모: 각 vs 각",
  "tab\there\tand\tthere",
  "zero width: a​b‌c‍d⁠e",
  "replacement � char �� run",
  "…—–‘’“”†‡•‰′″‹›※",
  "⌚⌛⏰⏳ ⬛⬜ ⭐⭕",
  "𝕞𝕒𝕥𝕙 𝒮𝒸𝓇𝒾𝓅𝓉 𝔉𝔯𝔞𝔨𝔱𝔲𝔯",
  "🀄🀅 mahjong 🂡 cards",
  "á̂̃ stacked marks",
  "mixed\ttab 中文\t🚀\tend",
]

// Deterministic LCG fuzz — reproducible corpus extension.
let seed = 0x2f6e2b1
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000)
const POOLS = [
  [0x20, 0x7e],
  [0xa0, 0x2ff],
  [0x300, 0x36f],
  [0x4e00, 0x9fff],
  [0xac00, 0xd7a3],
  [0x1f300, 0x1f6ff],
  [0x1f900, 0x1faff],
  [0x2600, 0x27bf],
  [0xfe00, 0xfe0f],
  [0x200b, 0x200d],
  [0x1f1e6, 0x1f1ff],
  [0x900, 0x97f],
]
function randomString() {
  let s = "x" // anchor: never start with a combining mark (see header note)
  const len = 2 + Math.floor(rand() * 24)
  for (let i = 0; i < len; i++) {
    const [lo, hi] = POOLS[Math.floor(rand() * POOLS.length)]
    const cp = lo + Math.floor(rand() * (hi - lo + 1))
    if (cp >= 0xd800 && cp <= 0xdfff) continue
    s += String.fromCodePoint(cp)
  }
  return s
}

const fuzzArg = process.argv.find((a) => a.startsWith("--fuzz="))
const fuzzCount = fuzzArg ? Number(fuzzArg.slice(7)) : 2000
const inputs = [...corpus]
for (let i = 0; i < fuzzCount; i++) inputs.push(randomString())

let failures = 0
for (const text of inputs) {
  for (const method of ["unicode", "wcwidth"]) {
    const expected = oracle(text, method)
    const actual = rustCells(text, method)
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      failures++
      if (failures <= 8) {
        console.error(`✗ [${method}] ${JSON.stringify(text)}`)
        console.error(`  zig : ${JSON.stringify(expected)}`)
        console.error(`  rust: ${JSON.stringify(actual)}`)
      }
    }
  }
}

if (failures > 0) {
  console.error(`\nunicode parity: ${failures} mismatching input(s) of ${inputs.length * 2} runs`)
  process.exit(1)
}
console.log(`unicode parity: MATCH (${inputs.length} inputs x 2 width methods)`)
process.exit(0)

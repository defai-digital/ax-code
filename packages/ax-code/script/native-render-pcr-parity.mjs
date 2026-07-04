// ADR-046 Slice E — processCapabilityResponse differential parity.
//
// Feeds terminal query-response strings (DECRPM capability reports, DA1 sixel,
// osc52-/hyperlink-term names, the rgb->hyperlinks coupling) through both the
// Zig backend and the Rust addon in-process and diffs the resulting
// ExternalCapabilities struct for the ported capability fields.
//
// Scope: the xtversion path (\x1bP>|name...) is intentionally excluded — it
// needs parseXtversion (terminal name/version + notification-from-name +
// multiplexer) plus the renderer's enableDetectedFeatures/sendPendingQueries
// emit, which are not ported. Kitty keyboard/graphics mode flags are also
// excluded because Zig toggles those in the unported enableDetectedFeatures
// path on some platforms. Those response types/flags are not covered here.

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const ffi = require("node:ffi")
// ADR-046: the native-render overlay is ON BY DEFAULT; force the bundled Zig
// library for this differential harness's reference side. require("@ax-code/render")
// below still returns the raw Rust addon to compare against.
process.env.AX_CODE_NATIVE_RENDER = "0"
const { resolveRenderLib } = await import("@ax-code/opentui-core")
const zig = resolveRenderLib().opentui.symbols
const rust = require("@ax-code/render")

const enc = new TextEncoder()
const rp = (v) => ffi.getRawPointer(v)

// ExternalCapabilities boolean/u8 field offsets (0..18).
const NAMES = {
  2: "rgb",
  3: "ansi256",
  4: "unicode",
  5: "sgr_pixels",
  6: "color_scheme",
  7: "expl_width",
  9: "sixel",
  10: "focus",
  11: "sync",
  12: "bracketed",
  13: "hyperlinks",
  14: "osc52",
  15: "notif",
  16: "ecp",
  17: "remote",
  18: "mux",
}

function caps(sym, rh, isZig) {
  const b = new Uint8Array(64)
  sym.getTerminalCapabilities(rh, isZig ? rp(b) : Number(rp(b)))
  return b
}

function pcr(sym, rh, isZig, s) {
  const r = enc.encode(s)
  sym.processCapabilityResponse(rh, isZig ? rp(r) : Number(rp(r)), r.length)
}

const RESPONSES = [
  // DECRPM capability reports (the common query-response path).
  "\x1b[?1016;2$y\x1b[?2027;2$y\x1b[?2031;2$y\x1b[?1004;1$y\x1b[?2026;2$y\x1b[?2004;2$y",
  "\x1b[?1016;0$y\x1b[?2027;0$y\x1b[?2031;0$y",
  "\x1b[?2026;1$y\x1b[?1004;2$y",
  "\x1b[?2027;2$y",
  // DA1 sixel (capability 4).
  "\x1b[?62;4;9c",
  "\x1b[?63;1;2;4c",
  // osc52-/hyperlink-term names in the response.
  "response from kitty terminal",
  "\x1b[?2004;2$y and wezterm",
  "iterm2 response",
  "ghostty term",
  "contour",
  "alacritty here",
  // No recognized content (exercises the rgb->hyperlinks coupling only).
  "garbage no decrpm here",
]

let fail = 0
for (const s of RESPONSES) {
  const zh = zig.createRenderer(6, 3, 1, 1, 0)
  const rh = rust.createRenderer(6, 3, 1, 1, 0)
  pcr(zig, zh, true, s)
  pcr(rust, rh, false, s)
  const za = caps(zig, zh, true)
  const ra = caps(rust, rh, false)
  const diffs = []
  for (const i of Object.keys(NAMES)) {
    if (za[i] !== ra[i]) diffs.push(`${NAMES[i]}(z=${za[i]},r=${ra[i]})`)
  }
  if (diffs.length) {
    fail++
    console.error(`pcr caps differ for ${JSON.stringify(s)}: ${diffs.join(" ")}`)
  }
  zig.destroyRenderer(zh)
  rust.destroyRenderer(rh)
}

if (fail) {
  console.log(`pcr parity: ${fail} failing response(s) of ${RESPONSES.length}`)
  process.exit(1)
}
console.log(`pcr parity: MATCH (${RESPONSES.length} query responses)`)

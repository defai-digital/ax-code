// ADR-046 Slice E: hit-grid parity (Rust vs Zig). The hit grid is mouse
// dispatch state — addToHitGrid/addToCurrentHitGridClipped fill a screen-sized
// id grid under a scissor stack; render() swaps next→current; checkHit(x,y)
// reads it. This harness runs identical randomized op sequences on both
// backends and compares the full grid via a checkHit sweep plus getHitGridDirty.
//
// Run:  node --experimental-ffi script/native-render-hitgrid-parity.mjs [--seqs=N]
// Exit: 0 = parity, 1 = mismatch, 2 = rust symbols not built.

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
// ADR-046: the native-render overlay is ON BY DEFAULT; force the bundled Zig
// library for this differential harness's reference side. require("@ax-code/render")
// below still returns the raw Rust addon to compare against.
process.env.AX_CODE_NATIVE_RENDER = "0"
const { resolveRenderLib } = await import("@ax-code/opentui-core")
const zig = resolveRenderLib().opentui.symbols

let rust = null
try {
  rust = require("@ax-code/render")
} catch {
  rust = null
}
if (!rust || typeof rust.checkHit !== "function") {
  console.log("hitgrid parity: RUST checkHit NOT BUILT — skipping")
  process.exit(2)
}

let seed = 0x1b7a3d
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000)
const randInt = (n) => Math.floor(rand() * n)

const seqArg = process.argv.find((a) => a.startsWith("--seqs="))
const SEQUENCES = seqArg ? Number(seqArg.slice(7)) : 300

// Apply one identical random op to both backends.
function op(w, h, apply) {
  const kind = randInt(6)
  const x = randInt(w + 4) - 2 // allow slightly out-of-bounds / negative
  const y = randInt(h + 4) - 2
  const rw = 1 + randInt(w)
  const rh = 1 + randInt(h)
  const id = 1 + randInt(9)
  switch (kind) {
    case 0:
    case 1:
      apply((s, rhandle) => s.addToHitGrid(rhandle, x, y, rw, rh, id))
      break
    case 2:
      apply((s, rhandle) => s.addToCurrentHitGridClipped(rhandle, x, y, rw, rh, id))
      break
    case 3:
      apply((s, rhandle) => s.hitGridPushScissorRect(rhandle, x, y, rw, rh))
      break
    case 4:
      apply((s, rhandle) => s.hitGridPopScissorRect(rhandle))
      break
    case 5:
      apply((s, rhandle) => s.clearCurrentHitGrid(rhandle))
      break
  }
}

let failures = 0
for (let s = 0; s < SEQUENCES; s++) {
  const w = 4 + randInt(16)
  const h = 2 + randInt(8)
  const zh = zig.createRenderer(w, h, 1, 1, 0)
  const rh = rust.createRenderer(w, h, 1, 1, 0)

  zig.hitGridClearScissorRects(zh)
  rust.hitGridClearScissorRects(rh)

  const nOps = 3 + randInt(12)
  for (let i = 0; i < nOps; i++) {
    op(w, h, (fn) => {
      fn(zig, zh)
      fn(rust, rh)
    })
  }

  // render() swaps nextHitGrid -> currentHitGrid (and draws an empty frame).
  zig.render(zh, 1)
  rust.render(rh, 1)

  let mismatch = false
  for (let y = 0; y < h && !mismatch; y++) {
    for (let x = 0; x < w; x++) {
      if (zig.checkHit(zh, x, y) !== rust.checkHit(rh, x, y)) {
        console.error(`✗ seq ${s} (${w}x${h}): checkHit differs at (${x},${y}) z=${zig.checkHit(zh, x, y)} r=${rust.checkHit(rh, x, y)}`)
        mismatch = true
        break
      }
    }
  }
  // node:ffi returns bool as 1/0; napi returns a JS boolean — normalize.
  if (!mismatch && Boolean(zig.getHitGridDirty(zh)) !== Boolean(rust.getHitGridDirty(rh))) {
    console.error(`✗ seq ${s}: getHitGridDirty differs`)
    mismatch = true
  }
  if (mismatch) {
    failures++
    if (failures >= 5) break
  }
  zig.destroyRenderer(zh)
  rust.destroyRenderer(rh)
}

if (failures > 0) {
  console.error(`\nhitgrid parity: ${failures} failing sequence(s) of ${SEQUENCES}`)
  process.exit(1)
}
console.log(`hitgrid parity: MATCH (${SEQUENCES} sequences)`)
process.exit(0)

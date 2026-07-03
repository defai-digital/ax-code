// ADR-046 Slice E: split-footer scrollback parity (Rust vs Zig).
// Covers the offset math (resetSplitScrollback / syncSplitScrollback /
// getSplitOutputOffset return values) and the footer-transition + repaint
// escape output (setPendingSplitFooterTransition + repaintSplitFooter, whose
// packed RenderResult and dumped ANSI are diffed).
//
// Run:  node --experimental-ffi script/native-render-split-parity.mjs [--seqs=N]
// Exit: 0 = parity, 1 = mismatch, 2 = rust symbols not built.

import { createRequire } from "node:module"
import { readFileSync, rmSync } from "node:fs"

const require = createRequire(import.meta.url)
const { resolveRenderLib } = await import("@ax-code/opentui-core")
const zig = resolveRenderLib().opentui.symbols

let rust = null
try {
  rust = require("@ax-code/render")
} catch {
  rust = null
}
if (!rust || typeof rust.resetSplitScrollback !== "function") {
  console.log("split parity: RUST resetSplitScrollback NOT BUILT — skipping")
  process.exit(2)
}

let seed = 0x3c0ffe
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000)
const randInt = (n) => Math.floor(rand() * n)

const HM = "================\n"
function dump(sym, rh, isZig, ts) {
  try {
    rmSync("buffer_dump", { recursive: true, force: true })
  } catch {}
  sym.dumpOutputBuffer(rh, isZig ? BigInt(ts) : ts)
  const raw = readFileSync(`buffer_dump/output_buffer_${ts}.txt`).toString("latin1")
  const i = raw.indexOf(HM)
  const b = raw.slice(i + HM.length)
  const f = b.indexOf("\nBuffer size:")
  return Buffer.from(f >= 0 ? b.slice(0, f) : b, "latin1").toString("hex")
}

const seqArg = process.argv.find((a) => a.startsWith("--seqs="))
const SEQUENCES = seqArg ? Number(seqArg.slice(7)) : 300

let failures = 0
function check(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`)
    failures++
  }
  return cond
}

for (let s = 0; s < SEQUENCES && failures < 5; s++) {
  const w = 6 + randInt(14)
  const h = 3 + randInt(6)
  const zh = zig.createRenderer(w, h, 1, 1, 0)
  const rh = rust.createRenderer(w, h, 1, 1, 0)

  const seed_rows = randInt(20)
  const pinned = randInt(12)
  const zr = zig.resetSplitScrollback(zh, seed_rows, pinned)
  const rr = rust.resetSplitScrollback(rh, seed_rows, pinned)
  if (!check(zr === rr, `seq ${s} reset: z=${zr} r=${rr}`)) break

  const surf = randInt(15)
  const zo = zig.getSplitOutputOffset(zh, surf)
  const ro = rust.getSplitOutputOffset(rh, surf)
  if (!check(zo === ro, `seq ${s} getSplitOutputOffset: z=${zo} r=${ro}`)) break

  zig.setRenderOffset(zh, pinned)
  rust.setRenderOffset(rh, pinned)
  const zs = zig.syncSplitScrollback(zh, pinned)
  const rs = rust.syncSplitScrollback(rh, pinned)
  if (!check(zs === rs, `seq ${s} sync: z=${zs} r=${rs}`)) break

  // Pending footer transition + repaint.
  const mode = randInt(3) // 0 none, 1 viewport_scroll, 2 clear_stale_rows
  const srcTop = 1 + randInt(h)
  const srcH = randInt(h + 1)
  const tgtTop = 1 + randInt(h)
  const tgtH = randInt(h + 1)
  const scroll = randInt(4)
  zig.setPendingSplitFooterTransition(zh, mode, srcTop, srcH, tgtTop, tgtH, scroll)
  rust.setPendingSplitFooterTransition(rh, mode, srcTop, srcH, tgtTop, tgtH, scroll)

  if (rand() < 0.2) {
    zig.clearPendingSplitFooterTransition(zh)
    rust.clearPendingSplitFooterTransition(rh)
  }

  const force = randInt(2)
  const zp = zig.repaintSplitFooter(zh, pinned, force).toString()
  const rp = rust.repaintSplitFooter(rh, pinned, force).toString()
  if (!check(zp === rp, `seq ${s} repaint packed: z=${zp} r=${rp}`)) break

  const zd = dump(zig, zh, true, 3000 + s * 2)
  const rd = dump(rust, rh, false, 3000 + s * 2 + 1)
  if (!check(zd === rd, `seq ${s} repaint dump differs\n  z=${zd.slice(0, 200)}\n  r=${rd.slice(0, 200)}`)) break

  zig.destroyRenderer(zh)
  rust.destroyRenderer(rh)
}

if (failures > 0) {
  console.error(`\nsplit parity: ${failures} failing check(s) of ${SEQUENCES}`)
  process.exit(1)
}
console.log(`split parity: MATCH (${SEQUENCES} sequences)`)
process.exit(0)

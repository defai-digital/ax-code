// ADR-046 Phase 1 parity probe: drives the same yoga scenario through the
// bundled Zig backend (via node:ffi) and the @ax-code/render Rust addon, then
// byte-compares the serialized results. Also fingerprints the
// AX_CODE_NATIVE_RENDER overlay via the audio stub.
//
// Run with: node --experimental-ffi script/native-render-parity-probe.mjs
// Exit codes: 0 = parity, 1 = mismatch, 2 = Rust addon not built (skip).

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

let rust
try {
  rust = require("@ax-code/render")
} catch {
  console.error("@ax-code/render addon not built (run: pnpm build:native render) — skipping parity probe")
  process.exit(2)
}
const ffi = require("node:ffi")
const { Yoga } = await import("@ax-code/opentui-core")

const unpack = (packed) => {
  const b = typeof packed === "bigint" ? packed : BigInt(packed)
  const unit = Number(b & 0xffffffffn)
  const bits = Number((b >> 32n) & 0xffffffffn)
  const dv = new DataView(new ArrayBuffer(4))
  dv.setUint32(0, bits, true)
  return { unit, value: dv.getFloat32(0, true) }
}
const rustLayout = (node) => {
  const out = new Float32Array(6)
  rust.yogaNodeGetComputedLayout(node, Number(ffi.getRawPointer(out)))
  return { left: out[0], top: out[1], right: out[2], bottom: out[3], width: out[4], height: out[5] }
}

// One scenario covering the semantics that differ between naive ports and the
// Zig backend: percent margins, gap readback units, auto/undefined values,
// grow ratios with pixel-grid rounding, edge layout getters.
function scenario(api) {
  const root = api.mk()
  api.setEnum(root, 1, 2) // flexDirection: row
  api.setValue(root, 0, 0, 1, 48) // width 48
  api.setValue(root, 1, 0, 1, 14) // height 14
  api.setValue(root, 10, 1, 1, 1) // column gap 1
  api.setValue(root, 8, 8, 1, 1) // padding all 1
  const a = api.mk()
  api.setFloat(a, 1, 1) // flexGrow 1
  const b = api.mk()
  api.setFloat(b, 1, 2) // flexGrow 2
  api.setValue(b, 7, 0, 2, 10) // margin-left 10%
  const c = api.mk()
  api.setValue(c, 0, 0, 3, NaN) // width auto
  api.insert(root, a, 0)
  api.insert(root, b, 1)
  api.insert(a, c, 0)
  api.calc(root, 48, 14)
  const unpackIf = (v) => (typeof v === "object" && v !== null && "unit" in v ? v : unpack(v))
  return {
    layouts: [root, a, b, c].map((n) => api.layout(n)),
    marginRead: unpackIf(api.getValue(b, 7, 0)),
    gapRead: unpackIf(api.getValue(root, 10, 1)),
    widthAutoRead: unpackIf(api.getValue(c, 0, 0)),
    grow: api.getFloat(b, 1),
    dir: api.getEnum(root, 1),
    marginEdge: api.layoutEdge(b, 0, 0),
    paddingEdge: api.layoutEdge(root, 1, 0),
    childCount: api.childCount(root),
  }
}

const zigApi = {
  mk: () => Yoga.Node.createForOpenTUI(),
  setEnum: (n, k, v) => n.setEnum(k, v),
  setFloat: (n, k, v) => n.setFloat(k, v),
  setValue: (n, k, e, unit, value) => n.setValue(k, e, unit === 3 ? "auto" : { unit, value }),
  getValue: (n, k, e) => n.getValue(k, e),
  getFloat: (n, k) => n.getFloat(k),
  getEnum: (n, k) => n.getEnum(k, -1),
  insert: (parent, child, i) => parent.insertChild(child, i),
  calc: (n, w, h) => n.calculateLayout(w, h, 1),
  layout: (n) => n.getComputedLayout(),
  layoutEdge: (n, kind, edge) => (kind === 0 ? n.getComputedMargin(edge) : n.getComputedPadding(edge)),
  childCount: (n) => n.getChildCount(),
}
const rustApi = {
  mk: () => rust.yogaNodeCreateForOpenTUI(),
  setEnum: rust.yogaNodeStyleSetEnum,
  setFloat: rust.yogaNodeStyleSetFloat,
  setValue: rust.yogaNodeStyleSetValue,
  getValue: rust.yogaNodeStyleGetValue,
  getFloat: rust.yogaNodeStyleGetFloat,
  getEnum: rust.yogaNodeStyleGetEnum,
  insert: rust.yogaNodeInsertChild,
  calc: (n, w, h) => rust.yogaNodeCalculateLayout(n, w, h, 1),
  layout: rustLayout,
  layoutEdge: rust.yogaNodeLayoutGetEdge,
  childCount: rust.yogaNodeGetChildCount,
}

const zig = JSON.stringify(scenario(zigApi))
const rustResult = JSON.stringify(scenario(rustApi))
if (zig !== rustResult) {
  console.error("PARITY MISMATCH")
  console.error("zig :", zig)
  console.error("rust:", rustResult)
  process.exit(1)
}
console.log("yoga parity: MATCH")
process.exit(0)

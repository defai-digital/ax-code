import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  GREATWALL_BRAZIERS,
  GREATWALL_COLORS,
  GREATWALL_COLUMNS,
  GREATWALL_FAR_TOWER,
  GREATWALL_FLAG_X,
  GREATWALL_GROUND_TOP,
  GREATWALL_PINES,
  GREATWALL_ROWS,
  GREATWALL_SUN,
  GREATWALL_TOWER,
  greatwallBirds,
  greatwallClouds,
  greatwallRidgeF,
  greatwallSkyRgb,
  greatwallTorch,
  type GreatwallStyle,
} from "./greatwall-view-model"

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * Freeform HD wall. Mountain ranges recede in atmospheric haze behind a
 * coursed-brick rampart that climbs the ridge, its merlons stepping with the
 * slope, and a watchtower with a tiled pagoda roof and beacon straddles the
 * dip. The dawn sun warms the right-facing brick; at dusk the braziers and
 * tower windows glow against a crimson sky. Pure and deterministic from
 * `elapsedMs`.
 */
export function renderGreatwallPixels(width: number, height: number, style: GreatwallStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, GREATWALL_COLUMNS, GREATWALL_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const dusk = style === "greatwall-dusk"
  const c = GREATWALL_COLORS[style]
  const w = hd.w
  const h = hd.h
  const px = hd.pixels
  const s = Math.max(1, Math.min(hd.cw, hd.ch / 2))
  const t = Math.max(0, elapsedMs)
  const brick = hdHex(c.brick)
  const brickDark = hdHex(c.brickDark)
  const brickLit = hdHex(c.brickLight)
  const roof = hdHex(c.roof)
  const ridge = hdHex(c.ridge)
  const far = hdHex(c.ridgeFar)
  const pine = hdHex(c.pine)
  const flag = hdHex(c.flag)
  const cloud = hdHex(c.cloud)
  const smoke = hdHex(c.smoke)
  const torch = hdHex(c.torch)
  const ground = hdHex(c.ground)
  const bird = hdHex(c.bird)
  const sun = hdHex(c.sun)
  const sunGlow = hdHex(c.sunGlow)
  const groundY = hd.Y(GREATWALL_GROUND_TOP)
  const sunX = hd.X(GREATWALL_SUN.x)
  const sunY = hd.Y(GREATWALL_SUN.y)
  const skyAt = (y: number): RGB => greatwallSkyRgb(style, clamp01(y / (h - 1 || 1)))
  const horizon = skyAt(hd.Y(10))
  const warm: RGB = dusk ? [255, 140, 80] : [255, 220, 160]

  const blend = (x: number, y: number, color: RGB, a: number) => {
    if (a <= 0 || x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 3
    px[i] = Math.round(px[i]! + (color[0] - px[i]!) * a)
    px[i + 1] = Math.round(px[i + 1]! + (color[1] - px[i + 1]!) * a)
    px[i + 2] = Math.round(px[i + 2]! + (color[2] - px[i + 2]!) * a)
  }
  const fill = (x0: number, y0: number, x1: number, y1: number, color: RGB, a = 1) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) blend(x, y, color, a)
  }
  const glow = (gx: number, gy: number, r: number, color: RGB, peak: number) => {
    const xa = Math.max(0, Math.floor(gx - r))
    const xb = Math.min(w - 1, Math.ceil(gx + r))
    const ya = Math.max(0, Math.floor(gy - r))
    const yb = Math.min(h - 1, Math.ceil(gy + r))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot(x + 0.5 - gx, y + 0.5 - gy) / r
        if (d < 1) blend(x, y, color, peak * (1 - d) * (1 - d))
      }
    }
  }
  /** Light from the sun side: 1 facing the sun, 0 facing away. */
  const sunward = (x: number) => clamp01(0.5 + ((x - w * 0.45) / w) * 1.2)

  hd.sky((v) => greatwallSkyRgb(style, v))
  // Sun with soft bloom and a low horizon band of light.
  glow(sunX, sunY, s * 18, sunGlow, dusk ? 0.85 : 0.6)
  glow(sunX, sunY, s * 8, hdMix(sun, [255, 255, 255], 0.3), 0.7)
  hd.disk(sunX, sunY, s * 1.9, hdMix(sun, [255, 255, 240], 0.35))
  for (let y = Math.floor(hd.Y(6)); y < Math.ceil(hd.Y(11)); y++) {
    const f = 1 - Math.abs(y - hd.Y(9)) / hd.Y(3)
    for (let x = 0; x < w; x++) blend(x, y, warm, clamp01(f) * (0.18 + 0.2 * sunward(x)))
  }
  // Clouds with a lit underside facing the sun.
  for (const puff of greatwallClouds(elapsedMs)) {
    const cx0 = hd.X(puff.x)
    const cy = hd.Y(puff.y)
    for (let k = 0; k < 8; k++) {
      const kk = k - 3.5
      const r = s * (1.7 + 0.9 * Math.cos(kk * 0.5)) * 1.3
      glow(cx0 + kk * s * 1.15, cy + Math.sin(k * 2.2) * s * 0.3, r, hdDarken(cloud, 0.88), 0.7)
      glow(cx0 + kk * s * 1.15, cy - s * 0.3, r * 0.7, hdMix(cloud, [255, 255, 255], 0.35), 0.55)
    }
  }
  for (const flyer of greatwallBirds(elapsedMs)) {
    const bx = hd.X(flyer.x + 0.5)
    const by = hd.Y(flyer.y + 0.5)
    const flap = Math.sin((t / 300) * Math.PI) * s * 0.35
    for (let k = 0; k <= 8; k++) {
      const f = k / 8
      hd.disk(bx - f * s * 0.9, by - Math.sin(f * 2) * s * 0.2 - flap * f, Math.max(0.9, s * 0.11), bird)
      hd.disk(bx + f * s * 0.9, by - Math.sin(f * 2) * s * 0.2 - flap * f, Math.max(0.9, s * 0.11), bird)
    }
  }

  // Mountain ranges in atmospheric perspective.
  const ranges = [
    { base: 8.2, amp: 3.6, freq: 0.045, color: far, haze: 0.45, seed: 3 },
    { base: 10.3, amp: 3, freq: 0.07, color: hdMix(far, ridge, 0.35), haze: 0.3, seed: 11 },
  ]
  for (const layer of ranges) {
    for (let x = 0; x < w; x++) {
      const u = x / s
      const peak = vnoise(u * layer.freq * 7, layer.seed) * 0.7 + vnoise(u * layer.freq * 19, layer.seed + 5) * 0.3
      const top = hd.Y(layer.base) - peak * layer.amp * hd.ch * 0.9 + (sunward(x) - 0.5) * s * 0
      for (let y = Math.max(0, Math.floor(top)); y < Math.min(h, Math.ceil(groundY)); y++) {
        const depth = (y - top) / (groundY - top || 1)
        // Ridge-light on the sunward slope, then haze.
        const edge = vnoise(x / (s * 3), y / (s * 3) + layer.seed)
        let col = hdMix(layer.color, horizon, layer.haze * (1 - depth * 0.4))
        col = hdMix(col, warm, 0.18 * sunward(x) * (1 - depth) * (dusk ? 1.3 : 0.8))
        col = hdDarken(col, 0.9 + 0.15 * edge)
        blend(x, y, col, 1)
      }
    }
    // Valley mist.
    for (let y = Math.floor(hd.Y(layer.base + 2)); y < Math.ceil(hd.Y(layer.base + 3.5)); y++)
      for (let x = 0; x < w; x++) blend(x, y, horizon, 0.22 * vnoise(x / (s * 8) + t / 40000, y / (s * 2)))
  }
  // Distant beacon tower and a thin far section of wall on the far range.
  const farT = GREATWALL_FAR_TOWER
  const fx0 = hd.X(farT.x0)
  const fx1 = hd.X(farT.x1 + 1)
  const farCol = hdMix(far, horizon, 0.2)
  fill(fx0 + s * 0.2, hd.Y(farT.top + 0.3), fx1 - s * 0.2, hd.Y(farT.base + 0.2), farCol)
  fill(fx0 - s * 0.3, hd.Y(farT.top), fx1 + s * 0.3, hd.Y(farT.top + 0.3), hdMix(roof, horizon, 0.4))
  fill(
    (fx0 + fx1) / 2 + s * 0.1,
    hd.Y(farT.top + 0.3),
    fx1 - s * 0.2,
    hd.Y(farT.base + 0.2),
    hdDarken(farCol, 0.85),
    0.8,
  )
  if (dusk) glow((fx0 + fx1) / 2, hd.Y(farT.top + 1.2), s * 3, torch, 0.35)
  for (const k of [-1, 1])
    fill(
      (fx0 + fx1) / 2 + k * s * 0.7 - 1,
      hd.Y(farT.top + 1.2),
      (fx0 + fx1) / 2 + k * s * 0.7 + 1,
      hd.Y(farT.top + 1.9),
      hdDarken(farCol, 0.6),
    )
  // Near wooded slope beneath the wall.
  for (let x = 0; x < w; x++) {
    const sceneX = (x + 0.5) / hd.cw
    const top = hd.Y(greatwallRidgeF(sceneX)) + hd.ch * 1.2
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(h, Math.ceil(groundY + hd.ch * 0.5)); y++) {
      const depth = (y - top) / (groundY - top || 1)
      const n = vnoise(x / (s * 1.6), y / (s * 1.2))
      let col = hdMix(hdDarken(ridge, 0.7 + 0.5 * n), hdDarken(ground, 0.8), clamp01(depth * 0.9))
      col = hdMix(col, warm, 0.16 * sunward(x) * (dusk ? 1.2 : 0.7))
      blend(x, y, col, 1)
    }
  }
  // Pine silhouettes along the ridge behind the wall.
  const drawPine = (cx0: number, base: number, hgt: number, color: RGB) => {
    for (let tier = 0; tier < 4; tier++) {
      const ty = base - hgt * (tier * 0.22)
      const tierH = hgt * 0.42
      for (let y = Math.floor(ty - tierH); y < Math.ceil(ty); y++) {
        const f = (y - (ty - tierH)) / tierH
        const half = hgt * 0.2 * (0.15 + f * 0.85) * (1 - tier * 0.15)
        for (let x = Math.floor(cx0 - half); x <= Math.ceil(cx0 + half); x++) {
          const u = (x - cx0) / (half || 1)
          blend(
            x,
            y,
            hdMix(
              hdDarken(color, 0.8),
              hdDarken(color, 1.35),
              clamp01(0.5 + u * 0.4 * sunward(x) + (hash(x, y) - 0.5) * 0.3),
            ),
            1,
          )
        }
      }
    }
    fill(cx0 - 1, base, cx0 + 1, base + hgt * 0.08, hdDarken(color, 0.5))
  }
  for (const [i, pineX] of GREATWALL_PINES.entries()) {
    drawPine(hd.X(pineX + 0.8), hd.Y(greatwallRidgeF(pineX)) - s * 0.2, s * (5 + hash(i, 1) * 2), pine)
  }
  for (let i = 0; i < 40; i++) {
    const tx = hash(i, 5) * w
    const sceneX = tx / hd.cw
    if (sceneX > GREATWALL_TOWER.x0 - 1 && sceneX < GREATWALL_TOWER.x1 + 1) continue
    drawPine(
      tx,
      hd.Y(greatwallRidgeF(sceneX)) + hd.ch * (1.5 + hash(i, 6) * 2.5),
      s * (2.4 + hash(i, 7) * 2),
      hdDarken(pine, 0.9),
    )
  }

  // The rampart: coursed brick body stepping along the ridge, parapet with merlons.
  const tower = GREATWALL_TOWER
  const bodyH = hd.ch * 3.1
  const merlonW = s * 1.5
  const pitch = s * 2.4
  const merlonH = s * 1.35
  const lit = (x: number, y: number, depthShade: number): RGB => {
    const course = s * 0.85
    const row = Math.floor(y / course)
    const ly = y - row * course
    const bwid = s * 2.0
    const off = (row % 2) * bwid * 0.5
    const col = Math.floor((x + off) / bwid)
    const lx = x + off - col * bwid
    let a = hdMix(brickDark, brick, 0.35 + 0.65 * hash(col, row))
    a = hdMix(a, brickLit, sunward(x) * 0.7)
    if (lx < 1.1 || ly < 1.1) a = hdDarken(a, 0.55)
    else if (ly > course - 1.4) a = hdDarken(a, 0.88)
    else if (ly < 2.3) a = hdDarken(a, 1.1)
    a = hdDarken(a, depthShade * (0.9 + 0.2 * vnoise((x / s) * 0.4, (y / s) * 0.4)))
    return a
  }
  for (let x = 0; x < w; x++) {
    const sceneX = (x + 0.5) / hd.cw
    if (sceneX >= tower.x0 - 0.3 && sceneX <= tower.x1 + 0.3) continue
    const walk = hd.Y(greatwallRidgeF(sceneX)) + merlonH
    // Walkway stripe, then body and a foundation that fades into the hill.
    for (let y = Math.floor(walk); y < Math.ceil(walk + bodyH); y++) {
      const f = (y - walk) / bodyH
      let a = lit(x, y, 0.85 - 0.25 * f)
      if (y - walk < s * 0.28) a = hdDarken(brickLit, 1.12)
      if (f > 0.9) a = hdDarken(a, 0.7)
      blend(x, y, a, 1)
    }
    // Parapet merlons: flat tops that follow the slope in steps.
    const phaseX = ((x % pitch) + pitch) % pitch
    const mStart = x - phaseX
    const midSceneX = (mStart + pitch / 2) / hd.cw
    if (phaseX < merlonW) {
      const top = hd.Y(greatwallRidgeF(midSceneX)) - 0.0
      const offs = walk - hd.Y(greatwallRidgeF(sceneX))
      const wallTopAtX = hd.Y(greatwallRidgeF(sceneX)) + offs
      const mTop = top
      for (let y = Math.floor(mTop); y < Math.ceil(wallTopAtX); y++) {
        let a = lit(x, y + 3, 0.95)
        if (y - mTop < 2) a = hdDarken(brickLit, 1.2)
        if (phaseX < 1.2 || phaseX > merlonW - 1.4) a = hdDarken(a, 0.7)
        blend(x, y, a, 1)
      }
    }
    // Soft shadow under the parapet.
    for (let k = 0; k < s * 0.9; k++) blend(x, Math.floor(walk + s * 0.28 + k), [0, 0, 0], 0.22 * (1 - k / (s * 0.9)))
  }
  // Wall seen rising on either side of the tower: stone footing cast shadow on the hillside.
  for (let x = 0; x < w; x++) {
    const sceneX = (x + 0.5) / hd.cw
    const base = hd.Y(greatwallRidgeF(sceneX)) + merlonH + bodyH
    for (let k = 0; k < s * 1.6; k++) blend(x, Math.floor(base + k), [10, 20, 10], 0.3 * (1 - k / (s * 1.6)))
  }

  // Watchtower straddling the dip, with a gate, windows, and a tiled pagoda roof.
  const tx0 = hd.X(tower.x0)
  const tx1 = hd.X(tower.x1 + 1)
  const tcx = (tx0 + tx1) / 2
  const tTop = hd.Y(tower.top + 0.9)
  const tBot = hd.Y(greatwallRidgeF((tower.x0 + tower.x1) / 2)) + merlonH + bodyH
  const topHalf = (tx1 - tx0) * 0.5 - s * 0.6
  const botHalf = (tx1 - tx0) * 0.5 + s * 0.2
  for (let y = Math.floor(tTop); y < Math.ceil(tBot); y++) {
    const f = (y - tTop) / (tBot - tTop || 1)
    const half = topHalf + (botHalf - topHalf) * f
    for (let x = Math.floor(tcx - half); x < Math.ceil(tcx + half); x++) {
      const u = (x - tcx) / half
      let a = lit(x, y, 0.85 - 0.18 * f)
      // Right face catches the sun; left face is in shade.
      a = u > 0.15 ? hdMix(a, brickLit, 0.3 * (u - 0.1)) : hdDarken(a, 0.82 - 0.1 * Math.abs(u))
      if (Math.abs(u) > 0.94) a = hdDarken(a, 0.65)
      blend(x, y, a, 1)
    }
  }
  // Gate arch at the base.
  const gateHalf = s * 1.7
  const gateTop = tBot - s * 6
  for (let y = Math.floor(gateTop); y < Math.ceil(tBot); y++) {
    for (let x = Math.floor(tcx - gateHalf); x < Math.ceil(tcx + gateHalf); x++) {
      const dy = y - (gateTop + gateHalf)
      const inside = dy > 0 || Math.hypot(x + 0.5 - tcx, dy) <= gateHalf
      if (inside) blend(x, y, hdDarken(brickDark, 0.35), 1)
    }
  }
  if (dusk) glow(tcx, gateTop + s * 1.5, s * 3, torch, 0.35)
  // Windows (arched), glowing at dusk.
  for (const k of [-1, 0, 1]) {
    const wx = tcx + k * s * 2.6
    const wy = hd.Y(tower.top + 3.0)
    const ww = s * 0.65
    fill(wx - ww, wy + ww, wx + ww, wy + s * 2.1, hdDarken(brickDark, 0.3))
    hd.disk(wx, wy + ww, ww, hdDarken(brickDark, 0.3))
    if (dusk) {
      fill(wx - ww * 0.7, wy + ww, wx + ww * 0.7, wy + s * 2.0, torch, 0.85)
      glow(wx, wy + s * 1.2, s * 3, torch, 0.3)
    }
  }
  // Balcony band under the roof.
  fill(tcx - topHalf - s * 0.5, tTop - s * 0.1, tcx + topHalf + s * 0.5, tTop + s * 0.5, hdDarken(roof, 0.8))
  for (let x = Math.floor(tcx - topHalf - s * 0.4); x < tcx + topHalf + s * 0.4; x += Math.max(3, Math.round(s * 0.5)))
    fill(x, tTop + s * 0.5, x + 1, tTop + s * 1.0, hdDarken(brick, 0.5), 0.9)
  // Tiled eave roof with upturned corners.
  const eaveY = hd.Y(tower.top)
  const eaveL = hd.X(tower.x0 - 1.0)
  const eaveR = hd.X(tower.x1 + 1.9)
  const roofTop = hd.Y(tower.top - 0.9)
  for (let y = Math.floor(roofTop); y < Math.ceil(eaveY + s * 0.7); y++) {
    const f = (y - roofTop) / (eaveY + s * 0.7 - roofTop || 1)
    const half = (eaveR - eaveL) / 2
    const cxr = (eaveL + eaveR) / 2
    const reach = half * (0.42 + 0.58 * Math.pow(f, 0.8))
    for (let x = Math.floor(cxr - reach); x < Math.ceil(cxr + reach); x++) {
      const u = (x - cxr) / half
      const tileRow = Math.floor(y / (s * 0.5))
      const tile = (x + (tileRow % 2) * s * 0.4) % (s * 0.8)
      let a = hdMix(
        hdDarken(roof, 0.75),
        hdDarken(roof, 1.25),
        clamp01(0.4 + u * 0.5 * (sunward(x) * 2 - 1) + (hash(tileRow, Math.floor(x / s)) - 0.5) * 0.3),
      )
      if (tile < 1) a = hdDarken(a, 0.7)
      if (y - roofTop < 2) a = hdDarken(a, 1.3)
      blend(x, y, a, 1)
    }
  }
  // Upturned eave tips and ridge cap.
  for (const side of [-1, 1]) {
    const ex = side < 0 ? eaveL : eaveR
    for (let k = 0; k < s * 1.4; k++) {
      const f = k / (s * 1.4)
      blend(
        Math.round(ex - side * f * s * 0.2),
        Math.round(eaveY + s * 0.7 - f * f * s * 1.4 - 0),
        hdDarken(roof, 1.2),
        1,
      )
      hd.disk(ex + side * f * s * 0.5, eaveY + s * 0.6 - f * f * s * 1.0, Math.max(1, s * 0.15), hdDarken(roof, 1.1))
    }
  }
  fill(tcx - s * 2.2, roofTop - s * 0.3, tcx + s * 2.2, roofTop + s * 0.1, hdDarken(roof, 1.3))
  // Beacon on the roof with fire and rising smoke.
  const bx = hd.X(37.5)
  const by = roofTop - s * 0.3
  fill(bx - s * 0.6, by - s * 0.6, bx + s * 0.6, by, hdDarken(brickDark, 0.8))
  const fireLift = 1 + 0.2 * Math.sin((t / 1400) * Math.PI * 2 * 3)
  for (const [col, r, hh] of [
    [[255, 120, 40], 0.5, 1.6],
    [torch, 0.35, 1.3],
    [[255, 240, 190], 0.2, 0.8],
  ] as const) {
    for (let y = 0; y < s * hh * fireLift; y++) {
      const f = y / (s * hh * fireLift)
      const half = s * r * Math.sin(Math.PI * Math.pow(1 - f, 0.7))
      for (let x = Math.floor(bx - half); x <= Math.ceil(bx + half); x++)
        blend(x, Math.round(by - s * 0.5 - y), col as RGB, 0.75)
    }
  }
  glow(bx, by - s * 0.8, s * (dusk ? 7 : 4), torch, dusk ? 0.5 : 0.25)
  for (let i = 0; i < 7; i++) {
    const f = (t / 4200 + i / 7) % 1
    const sx = bx + Math.sin(f * 7 + i) * s * 0.7 + f * s * 3
    const sy = by - s * 1.2 - f * s * 9
    glow(sx, sy, s * (0.9 + f * 2.4), smoke, 0.4 * (1 - f))
  }
  // Flag on a pole with a waving cloth.
  const poleX = hd.X(GREATWALL_FLAG_X)
  fill(poleX - 1, hd.Y(1), poleX + 1, hd.Y(3.4), hdDarken(brickDark, 0.9))
  hd.disk(poleX, hd.Y(1) - 1, s * 0.2, hdDarken(torch, 1))
  const clothW = s * 3.4
  const clothH = s * 1.9
  for (let i = 0; i < clothW; i++) {
    const u = i / clothW
    const wave = Math.sin(u * 5.5 - (t / 600) * Math.PI * 2) * s * 0.35 * u
    for (let j = 0; j < clothH; j++) {
      const v = j / clothH
      const shadeAmt = 0.82 + 0.3 * Math.cos(u * 5.5 - (t / 600) * Math.PI * 2 + 0.6)
      let col = hdDarken(flag, shadeAmt)
      if (v < 0.1 || v > 0.9) col = hdMix(col, torch, 0.45)
      blend(Math.round(poleX + 2 + i), Math.round(hd.Y(1.1) + j + wave), col, 1)
    }
  }
  // Braziers on the wall top.
  const brazierOn = greatwallTorch(elapsedMs)
  for (const [i, brazier] of GREATWALL_BRAZIERS.entries()) {
    const bxx = hd.X(brazier + 0.5)
    const byy = hd.Y(greatwallRidgeF(brazier)) - merlonH * 0.1
    fill(bxx - s * 0.5, byy - s * 0.5, bxx + s * 0.5, byy, hdDarken(brickDark, 0.5))
    fill(bxx - s * 0.65, byy - s * 0.7, bxx + s * 0.65, byy - s * 0.45, hdDarken(brickDark, 0.8))
    const lift = 1 + 0.25 * Math.sin((t / 1200) * Math.PI * 2 * 4 + i * 2) + (brazierOn ? 0.1 : -0.1)
    for (const [col, r, hh] of [
      [[255, 110, 30], 0.55, 1.9],
      [torch, 0.38, 1.5],
      [[255, 240, 190], 0.2, 0.9],
    ] as const) {
      for (let y = 0; y < s * hh * lift; y++) {
        const f = y / (s * hh * lift)
        const half = s * r * Math.sin(Math.PI * Math.pow(1 - f, 0.7))
        for (let x = Math.floor(bxx - half); x <= Math.ceil(bxx + half); x++)
          blend(x, Math.round(byy - s * 0.7 - y), col as RGB, 0.8)
      }
    }
    glow(bxx, byy - s * 1.4, s * (dusk ? 8 : 4), torch, dusk ? 0.5 : 0.22)
  }
  // Eagle gliding on a wide circle in front of the tower.
  const ea = t / 900
  const ex = hd.X(20 + Math.cos(ea) * 16 + 0.5)
  const ey = hd.Y(5 + Math.sin(ea) * 2)
  const dir = -Math.sin(ea) > 0 ? 1 : -1
  const flap = Math.sin(ea * 5) * s * 0.25
  for (let k = 0; k <= 12; k++) {
    const f = k / 12
    const wy = -Math.sin(f * 1.6) * s * 0.5 + flap * f
    hd.disk(ex - f * s * 1.7, ey + wy, Math.max(1, s * (0.17 - f * 0.08)), bird)
    hd.disk(ex + f * s * 1.7, ey + wy, Math.max(1, s * (0.17 - f * 0.08)), bird)
  }
  hd.disk(ex, ey, s * 0.28, bird)
  hd.disk(ex + dir * s * 0.3, ey - s * 0.05, s * 0.13, bird)

  // Foreground meadow with grass, rocks, and a worn path.
  for (let y = Math.floor(groundY); y < h; y++) {
    const f = (y - groundY) / (h - groundY || 1)
    for (let x = 0; x < w; x++) {
      const n = vnoise(x / (s * 3), y / (s * 0.9))
      let col = hdMix(hdMix(ground, ridge, 0.35), hdDarken(ground, 0.65), clamp01(f * 0.8 + n * 0.3 - 0.1))
      col = hdMix(col, warm, 0.12 * sunward(x) * (1 - f) * (dusk ? 1.3 : 0.8))
      blend(x, y, col, 1)
    }
  }
  for (let y = Math.floor(groundY); y < h; y++) {
    const f = (y - groundY) / (h - groundY || 1)
    const half = s * (1.4 + f * 3.4)
    const pathX = hd.X(37.5) + Math.sin(f * 2.2) * s * 3 * (1 - f * 0.4)
    for (let x = Math.floor(pathX - half); x < Math.ceil(pathX + half); x++)
      blend(x, y, hdMix([186, 160, 120], horizon, 0.15), 0.5 * clamp01((half - Math.abs(x - pathX)) / (s * 0.8)))
  }
  for (let i = 0; i < Math.floor(w / (s * 1.4)); i++) {
    const gx = hash(i, 71) * w
    const gy = groundY + hash(i, 72) * (h - groundY)
    const hgt = s * (0.9 + hash(i, 73) * 1.6) * (0.6 + (gy - groundY) / (h - groundY || 1))
    const sway = Math.sin((t / 2400) * Math.PI * 2 + i) * s * 0.18
    for (let k = 0; k < hgt; k++) {
      const f = k / hgt
      blend(
        Math.round(gx + sway * f * f),
        Math.floor(gy - k),
        hdMix(hdDarken(ridge, 1.25), warm, 0.2 * sunward(gx)),
        1 - f * 0.4,
      )
    }
  }
  for (let i = 0; i < 6; i++) {
    const rx = hash(i, 81) * w
    const ry = groundY + s * 2 + hash(i, 82) * (h - groundY - s * 3)
    const rr = s * (0.7 + hash(i, 83) * 0.9)
    hd.blob(rx, ry, rr * 1.4, rr * 0.7, hdDarken(brickDark, 0.9))
    hd.blob(rx + rr * 0.2, ry - rr * 0.2, rr * 0.9, rr * 0.4, hdMix(brickDark, warm, 0.35))
  }
  // Foreground pine silhouettes at the corners for depth.
  const fgPine = hdDarken(pine, dusk ? 0.55 : 0.65)
  drawPine(hd.X(1.5), h * 1.02, s * 12, fgPine)
  drawPine(hd.X(GREATWALL_COLUMNS - 1.8), h * 1.02, s * 10, fgPine)
  return px
}

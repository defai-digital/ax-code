import { blendPx, clamp01, fillPoly, glow, hash2, vrect } from "./atmos-paint"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  TAIPEI101_CAR_ROW,
  TAIPEI101_COLORS,
  TAIPEI101_COLUMNS,
  TAIPEI101_GROUND_TOP,
  TAIPEI101_MOON,
  TAIPEI101_PARK_LAMPS,
  TAIPEI101_PARK_TOP,
  TAIPEI101_PILLARS,
  TAIPEI101_PODIUM,
  TAIPEI101_ROWS,
  TAIPEI101_SPIRE,
  TAIPEI101_STARS,
  TAIPEI101_TRACK_ROW,
  TAIPEI101_TREES,
  taipei101Beacon,
  taipei101Cars,
  taipei101Clouds,
  taipei101Lanterns,
  taipei101Lit,
  taipei101SkyRgb,
  taipei101Train,
  type Taipei101Style,
} from "./taipei101-view-model"

/**
 * Freeform HD renderer. Taipei 101 is drawn with its real silhouette: a tapered
 * base, eight flared pagoda segments with dark joints, a crown, and a needle
 * spire. Glass is shaded across the volume and the window chase runs on the
 * view-model clock. Layered ridges and a city skyline sit behind the elevated
 * MRT line; the forecourt carries cars with light trails, trees, and lamps.
 */
export function renderTaipei101Pixels(width: number, height: number, style: Taipei101Style, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, TAIPEI101_COLUMNS, TAIPEI101_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const neon = style === "taipei101-neon"
  const c = TAIPEI101_COLORS[style]
  const t = Math.max(0, elapsedMs)
  const S = Math.min(hd.ch, hd.cw * 2)
  const dot = Math.max(1.7, Math.min(hd.cw, hd.ch) * 0.4)
  const skyAt = (sceneY: number): RGB => {
    if (hd.h <= 1) return taipei101SkyRgb(style, 0)
    const py = Math.max(0, Math.min(hd.h - 1, Math.floor(hd.Y(sceneY))))
    return taipei101SkyRgb(style, py / (hd.h - 1))
  }
  const glass = hdHex(c.glass)
  const frame = hdHex(c.frame)
  const lit = hdHex(c.lit)
  const unlit = hdHex(c.unlit)
  const podium = hdHex(c.podium)
  const mountain = hdHex(c.mountain)
  const tree = hdHex(c.tree)
  const beacon = hdHex(c.beacon)
  const cloud = hdHex(c.cloud)
  const street = hdHex(c.street)
  const ground = hdHex(c.ground)
  const headlight = hdHex(c.headlight)
  const node = hdHex(c.node)
  const orb = neon ? TAIPEI101_MOON : { x: 12, y: 1.6 }
  const horizon = skyAt(TAIPEI101_GROUND_TOP)

  // Sky, stars, sun or moon with bloom.
  hd.sky((v) => taipei101SkyRgb(style, v))
  if (neon) {
    hd.stars(TAIPEI101_STARS, hdHex(c.sky), (i) => taipei101Lit(t, i))
    for (let i = 0; i < 46; i++) {
      const x = Math.floor(hash2(i, 3) * hd.w)
      const y = Math.floor(hash2(i, 9) * hd.Y(12))
      blendPx(hd, x, y, hdHex("#cfd8ff"), 0.25 + 0.5 * hash2(i + Math.floor(t / 700), 5))
    }
  }
  const ox = hd.X(orb.x)
  const oy = hd.Y(orb.y)
  const coreR = Math.max(3, S * 0.5)
  glow(hd, ox, oy, coreR * (neon ? 9 : 12), neon ? hdHex("#7f8fe0") : hdHex("#fff2c0"), neon ? 0.35 : 0.55)
  hd.disk(ox, oy, coreR, neon ? hdHex("#f4f1d8") : hdHex("#fffbe8"))
  if (neon) hd.disk(ox + coreR * 0.35, oy - coreR * 0.15, coreR * 0.82, hdMix(hdHex("#0c1233"), hdHex("#1a2450"), 0.4))
  if (neon) hd.disk(ox, oy, coreR, hdHex("#f4f1d8"))
  for (const puff of taipei101Clouds(t)) {
    const px = hd.X(puff.x + 2)
    const py = hd.Y(puff.y)
    glow(hd, px, py, S * 3.2, cloud, neon ? 0.4 : 0.7, 0.42)
    glow(hd, px + S * 1.2, py - S * 0.2, S * 2.2, cloud, neon ? 0.35 : 0.65, 0.5)
    glow(hd, px - S * 1.3, py + S * 0.1, S * 2, hdMix(cloud, horizon, 0.3), neon ? 0.3 : 0.5, 0.45)
  }

  // Layered ridges: far haze, then near slopes, flanking the tower.
  const baseLine = hd.Y(TAIPEI101_GROUND_TOP)
  const ridge = (seed: number, amp: number, top: number, color: RGB, lightFrom: RGB) => {
    for (let x = 0; x < hd.w; x++) {
      const nx = x / hd.w
      const side = Math.pow(Math.abs(nx - 0.5) * 2, 1.4)
      const bump =
        Math.sin(nx * 9 + seed) * 0.18 + Math.sin(nx * 21 + seed * 2.3) * 0.08 + Math.sin(nx * 3.4 + seed * 0.7) * 0.2
      const y = top + (1 - side * (0.75 + bump)) * amp
      const yy = Math.max(Math.floor(top), Math.floor(Math.min(baseLine, y)))
      for (let py = yy; py < baseLine; py++) {
        const v = (py - yy) / Math.max(1, baseLine - yy)
        hd.set(x, py, hdMix(hdMix(lightFrom, color, 0.35 + v * 0.65), horizon, 0.12 * (1 - v)))
      }
    }
  }
  ridge(1.2, hd.Y(4.6), hd.Y(14.2), hdMix(mountain, horizon, 0.35), hdMix(mountain, horizon, 0.6))
  ridge(4.1, hd.Y(3.4), hd.Y(15.4), mountain, hdMix(mountain, lit, neon ? 0.04 : 0.18))

  // City skyline with two depth layers; neon night lights the windows.
  for (let layer = 0; layer < 2; layer++) {
    const far = layer === 0
    const bw = S * (far ? 0.95 : 1.35)
    const bodyBase = far ? hdMix(hdMix(mountain, podium, 0.5), horizon, 0.3) : hdMix(podium, mountain, 0.35)
    const count = Math.ceil(hd.w / bw)
    for (let i = 0; i < count; i++) {
      const hv = hash2(i, layer + 11)
      const bx = i * bw
      const dist = Math.abs(bx / hd.w - 0.5)
      if (dist < 0.1) continue
      const bh = S * (far ? 1.2 + hv * 2.4 : 0.9 + hv * 1.8) * (0.7 + dist)
      const by = baseLine - bh
      const body = hdMix(bodyBase, hdDarken(bodyBase, 0.7), hash2(i, 41) * 0.6)
      hd.rect(bx, by, bx + bw - 1, baseLine, body)
      hd.rect(bx, by, bx + 1.2, baseLine, hdMix(body, lit, neon ? 0.06 : 0.22))
      for (let wy = by + S * 0.35; wy < baseLine - S * 0.2; wy += S * 0.32) {
        for (let wx = bx + S * 0.2; wx < bx + bw - S * 0.3; wx += S * 0.3) {
          const on = hash2(Math.floor(wx), Math.floor(wy)) > 0.62
          if (neon && on) {
            const wc = hash2(Math.floor(wx) + 7, Math.floor(wy)) > 0.8 ? hdHex(c.frame) : lit
            blendPx(hd, Math.floor(wx), Math.floor(wy), wc, 0.7)
          } else if (!neon && on) blendPx(hd, Math.floor(wx), Math.floor(wy), hdHex("#e8f4fb"), 0.35)
        }
      }
    }
  }

  // Elevated MRT line, pillars, and a moving train with lit windows.
  const railTop = hd.Y(TAIPEI101_TRACK_ROW + 0.28)
  const railBot = hd.Y(TAIPEI101_TRACK_ROW + 0.58)
  for (const pillar of TAIPEI101_PILLARS) {
    hd.rect(hd.X(pillar + 0.25), railBot, hd.X(pillar + 0.7), baseLine, frame)
    hd.rect(hd.X(pillar + 0.25), railBot, hd.X(pillar + 0.4), baseLine, hdMix(frame, lit, 0.2))
  }
  hd.rect(0, railTop, hd.w, railBot, frame)
  const train = taipei101Train(t)
  const trainY0 = hd.Y(TAIPEI101_TRACK_ROW - 0.82)
  const trainY1 = hd.Y(TAIPEI101_TRACK_ROW + 0.28)
  vrect(hd, hd.X(train), trainY0, hd.X(train + 6), trainY1, hdMix(lit, frame, 0.15), hdMix(frame, lit, 0.25))
  for (let k = 0; k < 6; k++) {
    const wx = hd.X(train + 0.4 + k * 0.92)
    hd.rect(wx, trainY0 + S * 0.22, wx + hd.cw * 0.62, trainY0 + S * 0.5, hdMix(glass, lit, neon ? 0.85 : 0.3))
  }

  // Tower geometry (pixel space).
  const cx = hd.X(37.5)
  const baseY = hd.Y(TAIPEI101_PODIUM.top)
  const topY = hd.Y(TAIPEI101_SPIRE.top)
  const H = baseY - topY
  const B = Math.max(2, H * 0.1)
  const SEG = 8
  const f0 = 0.12
  const fSeg = 0.085
  const halfAt = (f: number) => {
    if (f < f0) return B * (1.2 - 0.2 * (f / f0))
    const body = f0 + SEG * fSeg
    if (f < body) {
      const s = Math.floor((f - f0) / fSeg)
      const local = (f - f0 - s * fSeg) / fSeg
      return B * (1 - 0.055 * s) * (0.85 + 0.2 * local)
    }
    const top = B * (1 - 0.055 * (SEG - 1)) * 1.05
    if (f < 0.87) return top + (B * 0.18 - top) * Math.pow((f - body) / (0.87 - body), 0.8)
    return Math.max(0.6, B * 0.1 * (1 - (f - 0.87) / 0.13) + 0.5)
  }
  const side = (u: number): RGB => {
    // u: -1 at the lit left edge .. 1 at the shaded right edge.
    const tone = neon ? hdMix(glass, hdHex("#3a5f94"), 0.7) : hdMix(hdHex("#cfe6f3"), glass, 0.5)
    const lo = neon ? hdDarken(glass, 0.62) : hdDarken(glass, 0.72)
    return hdMix(hdMix(tone, glass, clamp01((u + 1) / 1.1)), lo, clamp01(u * 0.8 + 0.2))
  }
  if (neon) glow(hd, cx, baseY - H * 0.45, H * 0.62, hdHex("#ff5ad0"), 0.2, 1.2)
  else glow(hd, cx, baseY - H * 0.5, H * 0.55, hdHex("#ffffff"), 0.22, 1.1)

  let lastY = -1
  for (let y = Math.max(0, Math.floor(topY)); y < Math.min(hd.h, Math.ceil(baseY)); y++) {
    const f = clamp01((baseY - (y + 0.5)) / H)
    const hw = halfAt(f)
    const xa = Math.floor(cx - hw)
    const xb = Math.ceil(cx + hw)
    const segLocal = f >= f0 && f < f0 + SEG * fSeg ? ((f - f0) % fSeg) / fSeg : 0.5
    const joint = f >= f0 && f < f0 + SEG * fSeg && segLocal < 0.09
    const spire = f >= 0.87
    const rowH = Math.max(3, S * 0.34)
    const colW = Math.max(3, S * 0.46)
    const row = Math.floor((baseY - y) / rowH)
    const rowOpen = (baseY - y) % rowH < rowH - 1.2
    for (let x = xa; x < xb; x++) {
      const u = hw > 0 ? (x + 0.5 - cx) / hw : 0
      let color: RGB = side(u)
      if (spire) color = hdMix(hdHex("#d5e6f2"), hdDarken(frame, 0.8), clamp01((u + 1) / 2))
      else if (joint)
        color = hdMix(hdMix(frame, node, 0.25 + 0.4 * (1 - Math.abs(u))), hdDarken(frame, 0.7), clamp01(u * 0.5 + 0.3))
      else if (rowOpen && Math.abs(u) < 0.86 && H > 60) {
        const col = Math.floor((x - cx + hw) / colW)
        const inCol = (x - cx + hw) % colW < colW - 1.2
        if (inCol) {
          const idx = row * 13 + col * 5 + Math.floor(f * 8)
          const on = taipei101Lit(t, idx)
          if (on) color = hdMix(color, lit, neon ? 0.82 : 0.55)
          else color = hdMix(color, unlit, 0.38)
        }
      }
      if (x === xa || x === xb - 1) color = hdMix(color, node, neon ? 0.25 : 0.4)
      hd.set(x, y, color)
    }
    lastY = y
  }
  // Pinch highlights between segments and the faceted crown.
  for (let s = 0; s <= SEG; s++) {
    const fy = f0 + s * fSeg
    const y = baseY - fy * H
    const hw = halfAt(Math.max(0, fy - 0.003))
    if (s > 0 && s < SEG + 0.5 && hw > 1) {
      hd.rect(cx - hw - 1, y - 1, cx + hw + 1, y + 0.8, hdMix(neon ? hdHex(c.frame) : node, frame, 0.25))
    }
  }
  if (lastY >= 0 && neon) {
    for (let s = 1; s <= SEG; s++) {
      const y = baseY - (f0 + s * fSeg) * H
      glow(hd, cx, y, B * 1.9, hdHex(c.frame), 0.2, 0.28)
    }
  }
  // Spire tip and aircraft beacon.
  const on = taipei101Beacon(t)
  const bx = hd.X(37.5)
  const by = hd.Y(1.15)
  glow(hd, bx, by, dot * (on ? 6 : 2.5), beacon, on ? 0.7 : 0.15)
  hd.disk(bx, by, on ? dot * 0.85 : dot * 0.4, on ? beacon : frame)

  // Mall podium: stone base, lit glazing, and an entrance glow.
  const base = TAIPEI101_PODIUM
  const pX0 = hd.X(base.x0)
  const pX1 = hd.X(base.x1 + 1)
  const pY0 = hd.Y(base.top)
  const pY1 = hd.Y(base.base + 1)
  vrect(hd, pX0, pY0, pX1, pY1, hdMix(podium, node, neon ? 0.04 : 0.2), hdDarken(podium, 0.72))
  hd.rect(pX0, pY0, pX1, pY0 + Math.max(1.5, S * 0.12), frame)
  hd.rect(pX0, pY0, pX0 + hd.cw * 0.7, pY1, hdMix(node, podium, 0.45))
  hd.rect(pX1 - hd.cw * 0.7, pY0, pX1, pY1, hdDarken(podium, 0.7))
  for (let x = pX0 + hd.cw * 1.2; x < pX1 - hd.cw * 1.4; x += hd.cw * 1.4) {
    const bright = hash2(Math.floor(x), 3) > 0.35
    hd.rect(x, pY0 + S * 0.28, x + hd.cw * 0.9, pY1 - S * 0.12, hdMix(unlit, lit, bright ? (neon ? 0.7 : 0.35) : 0.05))
  }
  glow(hd, cx, pY1 - S * 0.2, hd.cw * 3.2, lit, neon ? 0.5 : 0.35, 0.5)
  hd.disk(cx, pY1 - S * 0.15, Math.max(1.8, hd.cw * 0.5), lit)

  // Sky lanterns with a warm bloom.
  for (const lantern of taipei101Lanterns(t)) {
    const lx = hd.X(lantern.x + 0.5)
    const ly = hd.Y(lantern.y + 0.45)
    glow(hd, lx, ly, dot * 5, hdHex("#ffb347"), neon ? 0.55 : 0.4)
    hd.disk(lx, ly, dot * 0.85, hdMix(lit, hdHex("#ffb347"), 0.35))
    hd.disk(lx, hd.Y(lantern.y + 1.15), dot * 0.4, beacon)
  }

  // Street, wet reflections, and park.
  vrect(
    hd,
    0,
    baseLine,
    hd.w,
    hd.Y(TAIPEI101_PARK_TOP),
    hdMix(street, headlight, neon ? 0.03 : 0.05),
    hdDarken(street, 0.8),
  )
  hd.rect(
    0,
    hd.Y(TAIPEI101_GROUND_TOP),
    hd.w,
    hd.Y(TAIPEI101_GROUND_TOP) + Math.max(1, S * 0.08),
    hdMix(street, node, 0.35),
  )
  if (neon) {
    glow(hd, cx, hd.Y(TAIPEI101_GROUND_TOP + 1.3), hd.cw * 14, hdHex(c.frame), 0.2, 0.18)
    glow(hd, cx, hd.Y(TAIPEI101_GROUND_TOP + 1.3), hd.cw * 6, lit, 0.2, 0.2)
  }
  vrect(hd, 0, hd.Y(TAIPEI101_PARK_TOP), hd.w, hd.h, hdMix(ground, node, neon ? 0 : 0.06), hdDarken(ground, 0.78))
  for (let x = 0; x < TAIPEI101_COLUMNS; x += 4) {
    hd.rect(
      hd.X(x),
      hd.Y(TAIPEI101_GROUND_TOP + 0.4),
      hd.X(x + 1.4),
      hd.Y(TAIPEI101_GROUND_TOP + 0.55),
      neon ? frame : node,
    )
  }
  for (const car of taipei101Cars(t)) {
    const nose = car.x
    const y0 = hd.Y(TAIPEI101_CAR_ROW)
    const y1 = hd.Y(TAIPEI101_CAR_ROW + 0.62)
    const cx0 = hd.X(nose - 1.4)
    const cx1 = hd.X(nose + 1.3)
    const paint = hdMix(beacon, street, 0.2)
    // Beam on the road ahead, tail glow behind.
    const hx = hd.X(nose + car.dir * 1.05)
    glow(hd, hx + car.dir * hd.cw * 2.5, (y0 + y1) / 2 + 1, hd.cw * 4.5, headlight, neon ? 0.45 : 0.28, 0.3)
    glow(hd, hd.X(nose - car.dir * 1.3), (y0 + y1) / 2, hd.cw * 2, beacon, 0.55, 0.5)
    vrect(hd, cx0, y0, cx1, y1, hdMix(paint, headlight, 0.2), hdDarken(paint, 0.65))
    hd.rect(cx0 + hd.cw * 0.5, y0 - S * 0.12, cx1 - hd.cw * 0.5, y0 + S * 0.08, hdMix(paint, glass, 0.55))
    hd.disk(hx, (y0 + y1) / 2, Math.max(1.3, hd.cw * 0.18), headlight)
    if (neon) glow(hd, cx0 + (cx1 - cx0) / 2, y1 + S * 0.25, hd.cw * 2.2, beacon, 0.18, 0.3)
  }
  for (const treeX of TAIPEI101_TREES) {
    const tx = hd.X(treeX + 0.8)
    const ty = hd.Y(TAIPEI101_PARK_TOP + 0.35)
    hd.rect(
      hd.X(treeX + 0.62),
      hd.Y(TAIPEI101_PARK_TOP + 0.6),
      hd.X(treeX + 0.98),
      hd.Y(TAIPEI101_PARK_TOP + 1.7),
      hdDarken(tree, 0.5),
    )
    hd.blob(tx, ty, hd.cw * 1.6, hd.ch * 0.62, hdDarken(tree, 0.8), hdDarken(tree, 0.6))
    hd.blob(tx - hd.cw * 0.25, ty - hd.ch * 0.1, hd.cw * 1.2, hd.ch * 0.45, tree, hdMix(tree, lit, neon ? 0.04 : 0.2))
  }
  for (const lampX of TAIPEI101_PARK_LAMPS) {
    hd.rect(
      hd.X(lampX + 0.3),
      hd.Y(TAIPEI101_PARK_TOP + 0.45),
      hd.X(lampX + 0.55),
      hd.Y(TAIPEI101_PARK_TOP + 1.7),
      frame,
    )
    const lx = hd.X(lampX + 0.42)
    const ly = hd.Y(TAIPEI101_PARK_TOP + 0.3)
    glow(hd, lx, ly, dot * (neon ? 9 : 5), headlight, neon ? 0.5 : 0.25)
    hd.disk(lx, ly, dot * 0.6, headlight)
  }
  return hd.pixels
}

import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  BIGBEN_ABBEY,
  BIGBEN_BRIDGE,
  BIGBEN_COLORS,
  BIGBEN_COLUMNS,
  BIGBEN_FACE,
  BIGBEN_GROUND_TOP,
  BIGBEN_LAMPS,
  BIGBEN_MOON,
  BIGBEN_ROWS,
  BIGBEN_STARS,
  BIGBEN_TOWER,
  BIGBEN_WATER_TOP,
  bigbenBirds,
  bigbenClouds,
  bigbenFlag,
  bigbenSkyRgb,
  type BigbenStyle,
} from "./bigben-view-model"
import { clamp01 } from "./atmos-paint"

const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}
const GOLD: RGB = [222, 176, 70]

/**
 * Shaded Westminster: a Gothic Elizabeth Tower with buttressed shaft, pointed
 * windows, a projecting clock stage, louvred belfry, and gilded spire; the
 * abbey's twin towers; a green iron bridge; the red bus; lamplit quay; and a
 * rippling Thames. Night floodlights the stone from below. Pure and
 * deterministic from `elapsedMs`.
 */
export function renderBigbenPixels(width: number, height: number, style: BigbenStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, BIGBEN_COLUMNS, BIGBEN_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const { w, h, cw, ch } = hd
  const night = style === "bigben-night"
  const c = BIGBEN_COLORS[style]
  const t = Math.max(0, elapsedMs)
  const phase = (2 * Math.PI * (t % 2400)) / 2400
  const stone = hdHex(c.stone)
  const stoneDark = hdHex(c.stoneDark)
  const stoneLight = hdHex(c.stoneLight)
  const face = hdHex(c.face)
  const handColor = hdHex(c.hand)
  const arch = hdHex(c.arch)
  const windowLit = hdHex(c.window)
  const water = hdHex(c.water)
  const deep = hdHex(c.waterDeep)
  const lamp = hdHex(c.lampGlow)
  const abbey = hdHex(c.abbey)
  const bus = hdHex(c.bus)
  const beam = hdHex(c.beam)
  const rail = hdHex(c.rail)
  const orb = night ? BIGBEN_MOON : { x: 14, y: 1.7 }
  const orbX = hd.X(orb.x)
  const orbY = hd.Y(orb.y)
  const horizonY = hd.Y(BIGBEN_GROUND_TOP)
  const glow: RGB = night ? [255, 214, 140] : [255, 244, 210]
  const unit = Math.min(cw, ch)

  const blend = (i: number, color: RGB, alpha: number) => {
    if (alpha <= 0) return
    const a = alpha > 1 ? 1 : alpha
    hd.pixels[i] = Math.round(hd.pixels[i]! + (color[0] - hd.pixels[i]!) * a)
    hd.pixels[i + 1] = Math.round(hd.pixels[i + 1]! + (color[1] - hd.pixels[i + 1]!) * a)
    hd.pixels[i + 2] = Math.round(hd.pixels[i + 2]! + (color[2] - hd.pixels[i + 2]!) * a)
  }
  const softBlob = (cx: number, cy: number, rx: number, ry: number, color: RGB, alpha: number, pow = 1) => {
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(h, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(w, Math.ceil(cx + rx)); x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
        if (d < 1) blend((y * w + x) * 3, color, alpha * Math.pow(1 - smooth(0, 1, d), pow))
      }
    }
  }
  /** Floodlit stone: warm from below at night, sunlit from the left by day. */
  const lit = (base: RGB, x: number, y: number, side: number): RGB => {
    const course = 1 + 0.035 * Math.sin(y * 0.55)
    if (night) {
      const up = clamp01(1 - (y - hd.Y(6)) / hd.Y(15))
      const flood = 0.5 + 0.9 * up
      const col = hdMix(hdDarken(base, flood * course), [255, 214, 140], 0.14 * up)
      return hdDarken(col, 0.82 + 0.18 * (1 - side))
    }
    return hdDarken(hdMix(base, [255, 244, 214], 0.08 * (1 - side)), (0.78 + 0.22 * (1 - side)) * course)
  }

  // Sky, glow, and the sun or moon.
  hd.sky((v) => bigbenSkyRgb(style, v))
  const horizonGlow: RGB = night ? [58, 66, 120] : [255, 244, 220]
  for (let y = 0; y < Math.min(h, Math.ceil(horizonY)); y++) {
    const k = smooth(0.35, 1, y / (horizonY || 1))
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      blend(i, horizonGlow, k * (night ? 0.35 : 0.35))
      const d = Math.hypot(x + 0.5 - orbX, y + 0.5 - orbY) / (Math.max(w, h) * 0.25)
      blend(i, glow, (night ? 0.28 : 0.4) * Math.exp(-d * d * 4))
    }
  }
  if (night) {
    hd.stars(BIGBEN_STARS, hdHex(c.sky), (i) => (Math.floor(t / 400) + i) % 3 === 0)
    for (let i = 0; i < 60; i++) {
      const px = Math.floor((((i * 59.3 + 7) % 1000) / 1000) * w)
      const py = Math.floor((((i * 31.7 + 3) % 1000) / 1000) * hd.Y(13))
      if (Math.hypot(px - orbX, py - orbY) < unit * 6) continue
      blend((py * w + px) * 3, [220, 228, 250], 0.3 + 0.25 * ((i * 5) % 3))
    }
  }
  const coreR = Math.max(3, unit * 1.1)
  hd.disk(
    orbX,
    orbY,
    coreR * 1.8,
    hdMix(night ? face : lamp, bigbenSkyRgb(style, orb.y / BIGBEN_ROWS), night ? 0.8 : 0.72),
  )
  hd.disk(orbX, orbY, coreR, night ? hdMix(face, [255, 255, 255], 0.35) : lamp)
  if (night) {
    const crater = hdMix(face, [150, 150, 170], 0.4)
    hd.disk(orbX - coreR * 0.3, orbY - coreR * 0.15, coreR * 0.22, crater)
    hd.disk(orbX + coreR * 0.28, orbY + coreR * 0.3, coreR * 0.16, crater)
  }
  // Soft drifting clouds.
  const cloud = hdHex(c.cloud)
  for (const [index, puff] of bigbenClouds(elapsedMs).entries()) {
    const cx = hd.X(puff.x + 2.5)
    const cy = hd.Y(puff.y + 0.4)
    for (let k = 0; k < 6; k++) {
      const ox = (k - 2.5) * cw * 1.3
      const oy = -Math.sin(k * 1.9 + index) * ch * 0.22
      const rr = ch * (0.75 + 0.2 * Math.sin(k * 2.3 + index))
      softBlob(cx + ox, cy + oy, rr * 1.7, rr, cloud, night ? 0.85 : 0.95, 0.5)
      if (!night) softBlob(cx + ox, cy + oy + rr * 0.4, rr * 1.5, rr * 0.5, [190, 210, 228], 0.3, 0.7)
    }
  }

  // Distant London skyline haze.
  const haze = hdMix(bigbenSkyRgb(style, 0.9), night ? [34, 44, 86] : [170, 190, 208], night ? 0.6 : 0.4)
  for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / cw
    const bh = 1.4 + 0.9 * Math.abs(Math.sin(Math.floor(sx / 1.6) * 7.3)) + 0.4 * Math.sin(sx * 0.2)
    const top = hd.Y(BIGBEN_GROUND_TOP - bh)
    hd.rect(x, top, x + 1, horizonY, haze)
    if (night && Math.floor(sx * 3) % 5 === 0 && (x * 13) % 7 < 2)
      hd.set(x, Math.floor(top + ch * 0.5), [255, 214, 140])
  }
  // The London Eye turning on the horizon.
  {
    const ex = hd.X(46)
    const ey = hd.Y(15.3)
    const er = ch * 2.3
    const eyeColor = hdMix(haze, night ? [120, 140, 200] : [250, 250, 255], 0.35)
    for (let a = 0; a < 360; a += 1.5) {
      const r = (a * Math.PI) / 180
      hd.set(Math.round(ex + Math.cos(r) * er), Math.round(ey + Math.sin(r) * er), eyeColor)
    }
    for (let k = 0; k < 16; k++) {
      const r = (k / 16) * Math.PI * 2 + phase * 0.0
      const steps = Math.ceil(er)
      for (let s = 0; s <= steps; s += 2)
        hd.set(Math.round(ex + Math.cos(r) * s), Math.round(ey + Math.sin(r) * s), eyeColor)
      if (night) hd.disk(ex + Math.cos(r) * er, ey + Math.sin(r) * er, Math.max(1, unit * 0.1), [255, 226, 160])
    }
  }

  // Westminster Abbey: nave, gable with rose window, and twin spired towers.
  {
    const x0 = hd.X(BIGBEN_ABBEY.x0)
    const x1 = hd.X(BIGBEN_ABBEY.x1)
    const top = hd.Y(BIGBEN_ABBEY.top)
    const base = hd.Y(BIGBEN_ABBEY.base + 1)
    const mid = (x0 + x1) / 2
    for (let y = Math.floor(top); y < Math.ceil(base); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const side = (x - x0) / (x1 - x0)
        hd.set(x, y, lit(hdMix(abbey, stoneLight, night ? 0.1 : 0.15), x, y, side))
      }
    }
    // Gable and rose window.
    for (let y = Math.floor(top - ch * 1.4); y < Math.ceil(top); y++) {
      const k = (y - (top - ch * 1.4)) / (ch * 1.4)
      const half = cw * 3.2 * k
      for (let x = Math.floor(mid - half); x < Math.ceil(mid + half); x++)
        hd.set(x, y, lit(abbey, x, y, (x - mid) / (cw * 6) + 0.5))
    }
    hd.disk(mid, top + ch * 0.9, cw * 1.05, hdDarken(abbey, 0.55))
    hd.disk(mid, top + ch * 0.9, cw * 0.8, night ? hdMix(windowLit, abbey, 0.2) : hdMix(abbey, [140, 170, 210], 0.5))
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      for (let s = 0; s < cw * 0.8; s += 1)
        hd.set(Math.round(mid + Math.cos(a) * s), Math.round(top + ch * 0.9 + Math.sin(a) * s), hdDarken(abbey, 0.55))
    }
    // Twin towers with crockets.
    for (const tx of [x0 + cw * 2.5, x1 - cw * 2.5]) {
      for (let y = Math.floor(top - ch * 2.6); y < Math.ceil(top + 2); y++) {
        for (let x = Math.floor(tx - cw * 1.35); x < Math.ceil(tx + cw * 1.35); x++) {
          const side = (x - (tx - cw * 1.35)) / (cw * 2.7)
          hd.set(x, y, lit(hdMix(abbey, stoneLight, 0.12), x, y, side))
        }
      }
      for (let y = 0; y < ch * 2.4; y++) {
        const half = cw * 1.2 * (1 - y / (ch * 2.4))
        hd.rect(
          tx - half,
          top - ch * 2.6 - y,
          tx + half,
          top - ch * 2.6 - y + 1,
          lit(hdDarken(abbey, 0.85), tx, top - ch * 3, 0.4),
        )
      }
      for (const wy of [-2.1, -1.1]) {
        const lancet = night ? windowLit : hdDarken(abbey, 0.45)
        hd.rect(tx - cw * 0.2, top + ch * wy, tx + cw * 0.2, top + ch * (wy + 0.6), lancet)
      }
    }
    // Lancet windows along the nave.
    for (let x = BIGBEN_ABBEY.x0 + 2; x <= BIGBEN_ABBEY.x1 - 2; x += 2.6) {
      if (Math.abs(x - (BIGBEN_ABBEY.x0 + BIGBEN_ABBEY.x1) / 2) < 3) continue
      const px = hd.X(x + 0.5)
      for (let y = Math.floor(top + ch * 1.3); y < Math.ceil(top + ch * 3); y++) {
        const k = (y - top - ch * 1.3) / (ch * 1.7)
        const half = cw * 0.2 * (k < 0.3 ? k / 0.3 : 1)
        hd.rect(px - half, y, px + half, y + 1, night ? windowLit : hdDarken(abbey, 0.5))
      }
    }
  }

  // Elizabeth Tower.
  const tower = BIGBEN_TOWER
  const mid = hd.X((tower.x0 + tower.x1) / 2 + 0.5 + 0.5 * 0)
  const towerMidX = hd.X(BIGBEN_FACE.cx)
  void mid
  const rowY = (row: number) => hd.Y(row)
  const shaftHalf = cw * 3.0
  const stageHalf = cw * 3.35
  const sections: { y0: number; y1: number; half: number }[] = [
    { y0: 18.85, y1: 19.6, half: cw * 3.5 },
    { y0: 11.1, y1: 18.85, half: shaftHalf },
    { y0: 5.4, y1: 11.1, half: stageHalf },
    { y0: 3.6, y1: 5.4, half: shaftHalf * 0.96 },
  ]
  const sandstone = night ? hdMix(stone, [140, 130, 150], 0.5) : stone
  for (const sec of sections) {
    for (let y = Math.floor(rowY(sec.y0)); y < Math.ceil(rowY(sec.y1)); y++) {
      for (let x = Math.floor(towerMidX - sec.half); x < Math.ceil(towerMidX + sec.half); x++) {
        const u = (x + 0.5 - towerMidX) / sec.half
        const side = (u + 1) / 2
        let col = lit(sandstone, x, y, side)
        // Corner buttress strips.
        if (Math.abs(u) > 0.84) col = hdDarken(col, u < 0 ? 1.07 : 0.82)
        else if (Math.abs(u) > 0.8) col = hdDarken(col, 0.78)
        hd.set(x, y, col)
      }
    }
  }
  // Cornices at each stage change.
  for (const [row, half, depth] of [
    [11.1, stageHalf + cw * 0.35, 0.34],
    [5.4, stageHalf + cw * 0.3, 0.3],
    [3.6, shaftHalf + cw * 0.3, 0.26],
    [15.2, shaftHalf + cw * 0.2, 0.2],
    [18.85, shaftHalf + cw * 0.3, 0.3],
  ] as const) {
    hd.rect(
      towerMidX - half,
      rowY(row) - ch * depth,
      towerMidX + half,
      rowY(row),
      lit(stoneLight, towerMidX, rowY(row), 0.25),
    )
    hd.rect(
      towerMidX - half,
      rowY(row),
      towerMidX + half,
      rowY(row) + Math.max(1.5, ch * 0.08),
      hdDarken(stoneDark, 0.6),
    )
  }
  // Pointed windows stacked up the shaft.
  const pointed = (cx: number, y0: number, y1: number, halfW: number, glass: RGB, glowOn: boolean) => {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      const k = (y - y0) / (y1 - y0 || 1)
      const half = halfW * (k < 0.3 ? Math.sqrt(Math.max(0, 1 - (1 - k / 0.3) ** 2)) : 1)
      hd.rect(cx - half - 1.5, y, cx + half + 1.5, y + 1, hdDarken(stoneLight, 0.8))
      hd.rect(
        cx - half,
        y,
        cx + half,
        y + 1,
        glowOn ? hdMix(glass, [255, 240, 190], k * 0.4) : hdDarken(glass, 0.9 - k * 0.15),
      )
    }
    hd.rect(cx - 0.5, y0 + (y1 - y0) * 0.3, cx + 0.5, y1, hdDarken(stoneDark, 0.7))
  }
  for (const [a, b] of [
    [11.9, 13.7],
    [14.3, 16.1],
    [16.7, 18.5],
  ]) {
    pointed(towerMidX, rowY(a), rowY(b), cw * 0.5, night ? windowLit : hdMix(hdHex(c.window), stoneDark, 0.3), night)
    for (const sx of [-1.7, 1.7]) {
      pointed(
        towerMidX + sx * cw,
        rowY(a + 0.5),
        rowY(b - 0.3),
        cw * 0.3,
        night ? windowLit : hdMix(hdHex(c.window), stoneDark, 0.4),
        night,
      )
    }
  }
  // Blind arcade band under the clock stage.
  for (let k = -2; k <= 2; k++) {
    const cx = towerMidX + k * cw * 1.1
    hd.rect(cx - cw * 0.3, rowY(11.35), cx + cw * 0.3, rowY(11.95), hdDarken(stoneDark, 0.75))
  }
  // Clock dial.
  const fx = hd.X(BIGBEN_FACE.cx)
  const fy = hd.Y(BIGBEN_FACE.cy)
  const faceR = Math.max(5, Math.min(cw * 2.55, ch * 1.4))
  // Pointed gable above the dial.
  for (let y = Math.floor(fy - faceR - ch * 0.75); y < Math.ceil(fy - faceR * 0.6); y++) {
    const k = (y - (fy - faceR - ch * 0.75)) / (ch * 0.75 + faceR * 0.4)
    const half = faceR * 1.05 * clamp01(k)
    hd.rect(fx - half, y, fx + half, y + 1, hdDarken(lit(stoneLight, fx, y, 0.4), 0.95))
  }
  hd.disk(fx, fy, faceR * 1.2, hdDarken(stoneDark, 0.75))
  hd.disk(fx, fy, faceR * 1.08, GOLD)
  hd.disk(fx, fy, faceR * 1.0, hdDarken(arch, 0.9))
  hd.disk(fx, fy, faceR * 0.92, night ? hdMix(face, [255, 225, 150], 0.4) : face)
  if (night) softBlob(fx, fy, faceR * 3.2, faceR * 3.2, [255, 222, 150], 0.3, 1.4)
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * Math.PI * 2
    const major = k % 5 === 0
    const r0 = faceR * (major ? 0.62 : 0.8)
    for (let s = r0; s < faceR * 0.9; s += 0.8) {
      hd.set(
        Math.round(fx + Math.cos(a) * s),
        Math.round(fy + Math.sin(a) * s),
        major ? handColor : hdMix(handColor, face, 0.55),
      )
    }
  }
  const phaseClock = (t % 2400) / 2400
  const minuteAngle = 2 * Math.PI * phaseClock - Math.PI / 2
  const hourAngle = 2 * Math.PI * (phaseClock / 12 + 0.3) - Math.PI / 2
  const hand = (angle: number, len: number, r0: number, r1: number) => {
    const steps = Math.ceil(len)
    for (let s = 0; s <= steps; s++) {
      const k = s / steps
      const px = fx + Math.cos(angle) * len * k
      const py = fy + Math.sin(angle) * len * k
      hd.disk(px, py, Math.max(0.7, r0 + (r1 - r0) * k), handColor)
    }
    hd.disk(fx - Math.cos(angle) * len * 0.15, fy - Math.sin(angle) * len * 0.15, Math.max(1, r0), handColor)
  }
  hand(hourAngle, faceR * 0.5, faceR * 0.075, faceR * 0.04)
  hand(minuteAngle, faceR * 0.82, faceR * 0.05, faceR * 0.02)
  hd.disk(fx, fy, Math.max(1.5, faceR * 0.09), GOLD)
  // Belfry louvres.
  for (const bx of [-1.15, 0, 1.15]) {
    const cx = towerMidX + bx * cw
    const y0 = rowY(3.85)
    const y1 = rowY(5.3)
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      const k = (y - y0) / (y1 - y0 || 1)
      const half = cw * 0.38 * (k < 0.3 ? Math.sqrt(Math.max(0, 1 - (1 - k / 0.3) ** 2)) : 1)
      const louvre = Math.floor(y / 2) % 2 === 0 ? 0.55 : 0.8
      hd.rect(cx - half, y, cx + half, y + 1, hdDarken(arch, louvre))
    }
  }
  // Gilded roof, corner pinnacles, and spire.
  const roofBase = rowY(3.6)
  const roofTop = rowY(1.35)
  for (let y = Math.floor(roofTop); y < Math.ceil(roofBase); y++) {
    const k = (y - roofTop) / (roofBase - roofTop || 1)
    const half = shaftHalf * 1.05 * Math.pow(k, 0.9)
    for (let x = Math.floor(towerMidX - half); x < Math.ceil(towerMidX + half); x++) {
      const u = (x + 0.5 - towerMidX) / (half || 1)
      const slate = night ? [46, 52, 74] : [74, 82, 98]
      const col = hdDarken(slate as unknown as RGB, 0.8 + 0.3 * (1 - (u + 1) / 2))
      const rib = Math.abs(((u * 4 + 8) % 1) - 0.5) < 0.05
      hd.set(x, y, rib ? hdMix(col, GOLD, 0.45) : col)
    }
  }
  hd.rect(towerMidX - shaftHalf * 1.07, roofBase - ch * 0.08, towerMidX + shaftHalf * 1.07, roofBase + ch * 0.06, GOLD)
  for (const sx of [-1, 1]) {
    const px = towerMidX + sx * shaftHalf * 1.08
    for (let y = 0; y < ch * 1.9; y++) {
      const half = cw * 0.3 * (1 - y / (ch * 1.9))
      hd.rect(
        px - half,
        roofBase - ch * 0.1 - y,
        px + half,
        roofBase - ch * 0.1 - y + 1,
        lit(sandstone, px, roofBase - y, sx < 0 ? 0.2 : 0.8),
      )
    }
    hd.disk(px, roofBase - ch * 2.05, Math.max(1.2, cw * 0.1), GOLD)
  }
  hd.rect(towerMidX - 1, hd.Y(0.2), towerMidX + 1, roofTop + 2, GOLD)
  hd.disk(towerMidX, hd.Y(0.25), Math.max(1.6, cw * 0.14), GOLD)
  const flag = bigbenFlag(elapsedMs)
  const flagTop = hd.Y(0.05)
  hd.rect(towerMidX + 1, flagTop, towerMidX + 2.4, flagTop + ch * 0.9, stoneDark)
  for (let i = 0; i < cw * 1.8; i++) {
    const wave = Math.sin(i * 0.5 + flag * 2.1) * ch * 0.08
    hd.rect(
      towerMidX + 2 + i,
      flagTop + wave,
      towerMidX + 3 + i,
      flagTop + ch * 0.45 + wave,
      i < cw * 0.9 ? [200, 40, 50] : [235, 235, 245],
    )
  }

  // Floodlight beam raking the stone at night.
  if (night) {
    const bx = hd.X(30.2)
    const by = hd.Y(19.2)
    const tx = hd.X(33.6)
    const ty = hd.Y(16.2)
    const steps = Math.ceil(Math.hypot(tx - bx, ty - by))
    for (let i = 0; i <= steps; i++) {
      const k = i / steps
      softBlob(bx + (tx - bx) * k, by + (ty - by) * k, cw * (0.5 + k), cw * (0.5 + k), beam, 0.1, 1)
    }
    hd.disk(hd.X(32.5), hd.Y(17.5), Math.max(2.6, unit * 0.42), beam)
  }

  // Rooks circling the tower.
  for (const bird of bigbenBirds(elapsedMs)) {
    const bx = hd.X(bird.x + 0.5)
    const by = hd.Y(bird.y + 0.5)
    const flap = Math.floor(t / 170) % 2 === 0 ? -ch * 0.22 : ch * 0.18
    for (const side of [-1, 1]) {
      for (let s = 0; s <= 8; s++) {
        const k = s / 8
        hd.disk(bx + side * k * cw * 0.75, by + flap * k * (1 - 0.3 * k), Math.max(0.9, unit * 0.06), stoneDark)
      }
    }
    hd.disk(bx, by, Math.max(1.2, unit * 0.1), stoneDark)
  }

  // Westminster Bridge: green iron arches on stone piers, parapet and lamps.
  const iron = night ? ([34, 74, 52] as RGB) : ([70, 132, 96] as RGB)
  const deckY = hd.Y(19.15)
  const bridgeEnd = hd.X(BIGBEN_BRIDGE[BIGBEN_BRIDGE.length - 1]! + 2.5)
  hd.rect(0, deckY, bridgeEnd, hd.Y(BIGBEN_GROUND_TOP), hdMix(stone, stoneDark, 0.4))
  hd.rect(0, deckY, bridgeEnd, deckY + 2, hdMix(stoneLight, stone, 0.5))
  for (let x = 0; x < bridgeEnd; x += cw * 0.55) hd.rect(x, deckY - ch * 0.26, x + 1.4, deckY, iron)
  hd.rect(0, deckY - ch * 0.27, bridgeEnd, deckY - ch * 0.22, hdMix(iron, [255, 255, 255], 0.18))
  for (const foot of BIGBEN_BRIDGE) {
    hd.rect(hd.X(foot), deckY, hd.X(foot + 0.9), hd.Y(BIGBEN_WATER_TOP) + 2, lit(stoneDark, hd.X(foot), deckY, 0.3))
  }
  for (let i = 0; i < BIGBEN_BRIDGE.length - 1; i++) {
    const a = hd.X(BIGBEN_BRIDGE[i]! + 0.9)
    const b = hd.X(BIGBEN_BRIDGE[i + 1]!)
    const mid = (a + b) / 2
    const span = (b - a) / 2
    for (let x = Math.floor(a); x < Math.ceil(b); x++) {
      const u = (x + 0.5 - mid) / span
      const arcY = deckY + ch * 0.2 + (hd.Y(BIGBEN_WATER_TOP) - deckY) * (1 - Math.sqrt(Math.max(0, 1 - u * u))) * 0.8
      hd.rect(x, arcY, x + 1, arcY + Math.max(1.5, ch * 0.1), iron)
      if (x % 6 === 0) hd.rect(x, deckY + 2, x + 1, arcY, hdDarken(iron, 0.8))
    }
  }

  // Embankment: road, pavement, railing, and ornate lamp posts.
  const roadTop = hd.Y(19.15)
  void roadTop
  hd.rect(0, hd.Y(BIGBEN_GROUND_TOP - 0.05), w, hd.Y(BIGBEN_GROUND_TOP + 0.2), hdMix(hdHex(c.ground), stoneLight, 0.4))
  for (let y = Math.floor(hd.Y(BIGBEN_GROUND_TOP + 0.2)); y < Math.ceil(hd.Y(BIGBEN_WATER_TOP)); y++) {
    const k = (y - hd.Y(BIGBEN_GROUND_TOP + 0.2)) / (hd.Y(BIGBEN_WATER_TOP) - hd.Y(BIGBEN_GROUND_TOP + 0.2) || 1)
    for (let x = 0; x < w; x++) {
      const blocks = Math.floor(x / (cw * 1.6) + Math.floor(k * 2) * 0.5) % 2 === 0 ? 1 : 0.92
      hd.set(x, y, hdDarken(lit(hdMix(stoneDark, hdHex(c.ground), 0.35), x, y, 0.5), 0.85 * blocks))
    }
  }
  for (let x = 0; x < BIGBEN_COLUMNS; x += 5) {
    hd.rect(hd.X(x + 0.32), hd.Y(BIGBEN_GROUND_TOP - 0.1), hd.X(x + 0.58), hd.Y(BIGBEN_GROUND_TOP + 0.7), rail)
  }
  hd.rect(0, hd.Y(BIGBEN_GROUND_TOP), w, hd.Y(BIGBEN_GROUND_TOP) + 2, rail)
  const lampList = [...BIGBEN_LAMPS]
  for (const lampX of lampList) {
    const px = hd.X(lampX + 0.34)
    hd.rect(px - cw * 0.12, hd.Y(17.6), px + cw * 0.12, hd.Y(BIGBEN_GROUND_TOP + 0.1), iron)
    hd.rect(px - cw * 0.28, hd.Y(BIGBEN_GROUND_TOP - 0.5), px + cw * 0.28, hd.Y(BIGBEN_GROUND_TOP - 0.3), iron)
    hd.blob(px, hd.Y(17.35), cw * 0.3, ch * 0.3, night ? lamp : hdMix(lamp, [255, 255, 255], 0.3))
    if (night) {
      softBlob(px, hd.Y(17.5), cw * 3, ch * 2.2, [255, 214, 140], 0.28, 1.4)
      softBlob(px, hd.Y(19.6), cw * 2.6, ch * 0.8, [255, 214, 140], 0.28, 1)
    }
  }

  // Double-decker bus on the road, rolling at one column per 100ms.
  const busLeft = hd.X(-12 + t / 100)
  const busRight = busLeft + cw * 10
  const busTop = hd.Y(16.9)
  const busBottom = hd.Y(19.05)
  const midDeck = hd.Y(18.05)
  hd.rect(busLeft, busTop, busRight, busBottom, bus)
  hd.rect(busLeft, busTop, busRight, busTop + ch * 0.12, hdDarken(bus, 0.7))
  hd.rect(busLeft, midDeck - 1, busRight, midDeck + 1, hdDarken(bus, 0.75))
  hd.rect(busLeft, busBottom - ch * 0.25, busRight, busBottom, hdDarken(bus, 0.8))
  const windowGlass = night ? hdMix(windowLit, bus, 0.15) : hdMix(face, [150, 190, 220], 0.5)
  for (let k = 0; k < 8; k++) {
    const wx = busLeft + cw * (0.6 + k * 1.15)
    hd.rect(wx, busTop + ch * 0.2, wx + cw * 0.85, midDeck - ch * 0.15, windowGlass)
    hd.rect(wx, midDeck + ch * 0.15, wx + cw * 0.85, busBottom - ch * 0.3, windowGlass)
  }
  hd.rect(busRight - cw * 0.2, busTop, busRight, busBottom, hdDarken(bus, 0.85))
  if (night) {
    softBlob(busRight + cw * 0.5, busBottom - ch * 0.35, cw * 2.5, ch * 0.6, [255, 240, 190], 0.4, 1)
    hd.disk(busRight - cw * 0.1, busBottom - ch * 0.38, Math.max(1.5, unit * 0.16), [255, 244, 210])
  }
  for (const wx of [busLeft + cw * 1.6, busLeft + cw * 8.2]) {
    hd.disk(wx, busBottom, Math.max(2, unit * 0.34), [20, 20, 24])
    hd.disk(wx, busBottom, Math.max(1, unit * 0.15), [120, 120, 130])
  }

  // Thames: gradient, tower reflection, and glittering moving ripples.
  const waterTop = hd.Y(BIGBEN_WATER_TOP)
  hd.water(BIGBEN_WATER_TOP, BIGBEN_ROWS, night ? hdMix(water, [40, 60, 110], 0.3) : water, deep, phase)
  for (let y = Math.floor(waterTop); y < h; y++) {
    const u = (y - waterTop) / (h - waterTop || 1)
    // Mirror of the tower: warm vertical streaks wobbling with the ripples.
    const sway = Math.sin(y * 0.55 + phase) * cw * 0.3 + Math.sin(y * 1.3 - phase * 2) * cw * 0.12
    const halfTower = shaftHalf * (1 - u * 0.2)
    for (let x = Math.floor(towerMidX - halfTower + sway); x < Math.ceil(towerMidX + halfTower + sway); x++) {
      if ((x + y * 3) % 4 === 0) continue
      blend(
        (y * w + x) * 3,
        night ? [255, 200, 130] : hdMix(stone, [255, 255, 255], 0.2),
        (night ? 0.22 : 0.3) * (1 - u * 0.65),
      )
    }
  }
  for (let y = Math.floor(waterTop); y < h; y++) {
    const u = (y - waterTop) / (h - waterTop || 1)
    for (let x = 0; x < w; x++) {
      const spark = Math.sin(x * 0.4 + y * 0.9 + phase * 2) * Math.sin(x * 0.13 - phase)
      if (spark > 0.93) blend((y * w + x) * 3, night ? [255, 226, 160] : [255, 255, 255], 0.45 * (1 - u * 0.5))
    }
  }
  // Orb reflection shimmering in the river.
  const reflect = night ? face : lamp
  const shimmerCenter = hd.X(orb.x) + Math.sin(phase) * cw * 0.3
  for (let y = Math.floor(waterTop); y < h; y++) {
    const u = (y - waterTop) / (h - waterTop || 1)
    const wave = Math.sin(y * 0.4 + phase) * cw * 0.5
    const half = cw * (1.2 + u * 1.6)
    for (let x = Math.floor(shimmerCenter - half + wave); x < Math.ceil(shimmerCenter + half + wave); x++) {
      if ((x + y) % 3 === 0) continue
      blend((y * w + x) * 3, reflect, 0.55 * (1 - Math.abs(x - shimmerCenter - wave) / (half + 1)))
    }
  }
  // Lamp pools on the water.
  for (const lampX of lampList) {
    const px = hd.X(lampX + 0.34)
    for (let y = Math.floor(waterTop); y < h; y += 2) {
      const u = (y - waterTop) / (h - waterTop || 1)
      const wave = Math.sin(y * 0.5 + phase + lampX) * cw * 0.4
      blend(
        (y * w + Math.max(0, Math.min(w - 1, Math.floor(px + wave)))) * 3,
        lamp,
        (night ? 0.5 : 0.16) * (1 - u * 0.5),
      )
    }
  }
  return hd.pixels
}

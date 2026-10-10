import {
  BALLOONS_CLOUDS,
  BALLOONS_COLUMNS,
  BALLOONS_COTTAGES,
  BALLOONS_FAR,
  BALLOONS_GROUND_TOP,
  BALLOONS_MOON,
  BALLOONS_ROWS,
  BALLOONS_SCRUB,
  BALLOONS_SPIRES,
  BALLOONS_STARS,
  BALLOONS_TETHER,
  BALLOONS_COLORS,
  balloonsAscend,
  balloonsBirds,
  balloonsCloudDrift,
  balloonsFlame,
  balloonsSkyRgb,
  type BalloonsStyle,
} from "./balloons-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import { clamp01 } from "./atmos-paint"

const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}
const WHITE: RGB = [255, 255, 255]

/**
 * Freeform HD renderer. A soft sun or moon glows over layered Cappadocian
 * hills, tapered fairy chimneys with caps, and cave cottages. Balloons are
 * striped teardrops with a shaded side, ropes, a basket, and a burner that
 * lights the envelope from inside. Pure and deterministic from `elapsedMs`.
 */
export function renderBalloonsPixels(width: number, height: number, style: BalloonsStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, BALLOONS_COLUMNS, BALLOONS_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "balloons-night"
  const c = BALLOONS_COLORS[style]
  const clock = Math.max(0, elapsedMs)
  const flameOn = balloonsFlame(elapsedMs)
  const drift = balloonsCloudDrift(elapsedMs)
  const rock = hdHex(c.rock)
  const house = hdHex(c.house)
  const basket = hdHex(c.basket)
  const envelope = hdHex(c.envelope)
  const envelopeAlt = hdHex(c.envelopeAlt)
  const flame = hdHex(c.flame)
  const moon = hdHex(c.moon)
  const { w, h, cw, ch } = hd
  const groundY = hd.Y(BALLOONS_GROUND_TOP)
  const sunX = hd.X(BALLOONS_MOON.x + 0.5)
  const sunY = hd.Y(BALLOONS_MOON.y + 0.5)
  const coreR = Math.max(3, Math.min(cw, ch) * 0.9)
  const warm: RGB = night ? [255, 196, 110] : [255, 214, 150]

  const blend = (i: number, color: RGB, alpha: number) => {
    if (alpha <= 0) return
    const a = alpha > 1 ? 1 : alpha
    hd.pixels[i] = Math.round(hd.pixels[i]! + (color[0] - hd.pixels[i]!) * a)
    hd.pixels[i + 1] = Math.round(hd.pixels[i + 1]! + (color[1] - hd.pixels[i + 1]!) * a)
    hd.pixels[i + 2] = Math.round(hd.pixels[i + 2]! + (color[2] - hd.pixels[i + 2]!) * a)
  }
  const softBlob = (cx: number, cy: number, rx: number, ry: number, color: RGB, alpha: number) => {
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(h, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(w, Math.ceil(cx + rx)); x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
        if (d < 1) blend((y * w + x) * 3, color, alpha * (1 - smooth(0.35, 1, d)))
      }
    }
  }

  // Sky with a radial bloom around the sun or moon and a warm horizon band.
  hd.sky((t) => balloonsSkyRgb(style, t))
  const bloom = night ? hdMix(moon, [120, 130, 200], 0.4) : warm
  const reach = Math.max(w, h) * (night ? 0.28 : 0.55)
  for (let y = 0; y < Math.min(h, Math.ceil(groundY)); y++) {
    const horizon = smooth(0.45, 1, y / (groundY || 1))
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const d = Math.hypot(x + 0.5 - sunX, y + 0.5 - sunY) / reach
      blend(i, bloom, (night ? 0.3 : 0.55) * Math.exp(-d * d * 3))
      blend(i, warm, horizon * (night ? 0.05 : 0.3))
    }
  }
  if (night) {
    hd.stars(BALLOONS_STARS, moon, (index) => (Math.floor(clock / 400) + index) % 3 === 0)
    for (let i = 0; i < 46; i++) {
      const px = Math.floor(hd.X((i * 41.3 + 4) % BALLOONS_COLUMNS))
      const py = Math.floor(hd.Y((((i * 29.7 + 1) % 100) / 100) * 11))
      if (px >= 0 && px < w && py >= 0 && py < h)
        blend((py * w + px) * 3, moon, (Math.floor(clock / 500) + i) % 5 === 0 ? 0.9 : 0.45)
    }
  }
  hd.disk(sunX, sunY, coreR * 1.8, hdMix(moon, hdMix(bloom, [0, 0, 0], 0.2), 0.7))
  hd.disk(sunX, sunY, coreR, moon)
  if (night) {
    hd.disk(sunX + coreR * 0.3, sunY - coreR * 0.2, coreR * 0.3, hdMix(moon, [150, 150, 190], 0.3))
  }

  // Soft layered clouds, drifting with the shared beat.
  const cloudColor = hdHex(c.cloud)
  const cloudLit = hdMix(cloudColor, night ? [120, 130, 190] : [255, 236, 214], 0.5)
  BALLOONS_CLOUDS.forEach(([cx0, cy0, cwid], index) => {
    const cx = hd.X(cx0 + (index === 0 ? drift : (drift + 2) % 5) + cwid / 2)
    const cy = hd.Y(cy0 + 0.2)
    for (let k = 0; k < 6; k++) {
      const ox = (k - 2.5) * cw * cwid * 0.17
      const oy = Math.sin(k * 2.1 + index) * ch * 0.25
      softBlob(cx + ox, cy + oy, cw * cwid * 0.22, ch * (0.9 + 0.2 * Math.sin(k)), cloudColor, night ? 0.75 : 0.65)
    }
    softBlob(cx, cy - ch * 0.35, cw * cwid * 0.3, ch * 0.5, cloudLit, 0.4)
  })

  // Distant haze ridge and rolling valley hills.
  const ridge = (sx: number, base: number, amp: number, f: number, p: number) =>
    base - amp * (0.55 + 0.45 * Math.sin(sx * f + p)) - amp * 0.3 * Math.sin(sx * f * 2.7 + p * 2)
  const farHill = hdMix(hdHex(c.far), balloonsSkyRgb(style, 0.85), 0.55)
  const midHill = hdMix(rock, balloonsSkyRgb(style, 0.9), 0.4)
  for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / cw
    const far = hd.Y(ridge(sx, BALLOONS_GROUND_TOP - 0.4, 2.2, 0.09, 1))
    for (let y = Math.max(0, Math.floor(far)); y < Math.ceil(groundY); y++) {
      const depth = clamp01((y - far) / hd.Y(3))
      hd.set(x, y, hdMix(hdMix(farHill, warm, 0.18 * (1 - depth)), midHill, depth * 0.5))
    }
  }
  const near = (sx: number) => ridge(sx, BALLOONS_GROUND_TOP + 0.2, 1.1, 0.16, 3)
  for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / cw
    const top = hd.Y(near(sx))
    for (let y = Math.max(0, Math.floor(top)); y < Math.ceil(groundY) + 1; y++) {
      const depth = clamp01((y - top) / hd.Y(1.5))
      const sunSide = clamp01(1 - Math.abs(sx - BALLOONS_MOON.x) / 70)
      hd.set(x, y, hdMix(hdMix(midHill, warm, 0.22 * sunSide * (1 - depth)), hdDarken(midHill, 0.75), depth))
    }
  }

  // Fairy chimneys: tapering shaft, mushroom cap, strata, and a shaded flank.
  const chimney = (sx: number, topRow: number, baseRow: number, halfBase: number, shadeK: number) => {
    const cx = hd.X(sx)
    const y0 = hd.Y(topRow)
    const y1 = hd.Y(baseRow)
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) {
      const t = (y - y0) / (y1 - y0 || 1)
      const cap = t < 0.14 ? 0.5 + (t / 0.14) * 0.15 : 0
      const shaft = 0.2 + 0.8 * Math.pow(t, 1.9)
      const half = hd.X(halfBase) * (t < 0.14 ? cap : shaft * (t < 0.2 ? 0.7 : 1))
      const xa = Math.floor(cx - half)
      const xb = Math.ceil(cx + half)
      for (let x = xa; x < xb; x++) {
        const u = (x + 0.5 - cx) / (half || 1)
        const lit = clamp01(0.72 + u * 0.28 * shadeK)
        const strata = 1 + 0.06 * Math.sin(y * 0.45 + sx)
        let col = hdDarken(hdMix(rock, warm, night ? 0.08 : 0.2 * clamp01(u * 0.5 + 0.5)), lit * strata)
        if (t < 0.14) col = hdDarken(col, 0.82)
        hd.set(x, y, col)
      }
    }
  }
  const shadeK = night ? 0.7 : 1.1
  BALLOONS_SPIRES.forEach((s, i) =>
    chimney(s + 0.5, BALLOONS_GROUND_TOP - 5 + (i % 2) * 0.8, BALLOONS_GROUND_TOP + 0.6, 1.5, shadeK),
  )
  for (const s of [14, 61, 71]) chimney(s + 0.5, BALLOONS_GROUND_TOP - 2.6, BALLOONS_GROUND_TOP + 0.6, 0.9, shadeK)

  // Distant balloons and swifts.
  for (const distant of BALLOONS_FAR) {
    const cx = hd.X(distant.x + 0.5)
    const cy = hd.Y(distant.y + 0.8)
    hd.blob(cx, cy, cw * 0.75, ch * 0.95, hdMix(hdHex(c.far), balloonsSkyRgb(style, 0.2), 0.2))
    hd.disk(cx + cw * 0.2, cy - ch * 0.2, cw * 0.18, hdMix(hdHex(c.far), WHITE, 0.3))
    hd.stroke(distant.x + 0.5, distant.y + 1.7, distant.x + 0.5, distant.y + 2.2, Math.max(0.8, cw * 0.06), basket)
  }
  for (const swift of balloonsBirds(elapsedMs)) {
    const bx = hd.X(swift.x + 0.5)
    const by = hd.Y(swift.y + 0.5)
    const flap = Math.floor(clock / 160) % 2 === 0 ? -ch * 0.2 : ch * 0.2
    hd.stroke(swift.x + 0.5 - 0.5, (by + flap) / ch, swift.x + 0.5, swift.y + 0.5, Math.max(1, cw * 0.07), basket)
    hd.stroke(swift.x + 0.5, swift.y + 0.5, swift.x + 1.0, (by + flap) / ch, Math.max(1, cw * 0.07), basket)
    void bx
  }

  // A hot-air balloon: striped teardrop with a shaded flank, ropes, and basket.
  const drawBalloon = (sx: number, sy: number, scale: number, skin: RGB, lit: boolean, burn: boolean) => {
    const cx = hd.X(sx + 0.5)
    const rx = cw * 2.05 * scale
    const top = hd.Y(sy - 0.55 * scale + 0.1)
    const mid = top + ch * 2.15 * scale
    const skirtY = top + ch * 4.1 * scale
    const gores = 6
    const stripeA = skin
    const stripeB = hdMix(skin, WHITE, 0.72)
    const stripeC = hdDarken(skin, 0.74)
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(h, Math.ceil(skirtY)); y++) {
      const t = (y + 0.5 - top) / (skirtY - top)
      let half: number
      if (y < mid) {
        const k = (mid - (y + 0.5)) / (mid - top)
        half = rx * Math.sqrt(Math.max(0, 1 - k * k))
      } else {
        const k = (y + 0.5 - mid) / (skirtY - mid)
        half = rx * (1 - 0.62 * Math.pow(k, 1.4))
      }
      if (half < 0.5) continue
      for (let x = Math.floor(cx - half); x < Math.ceil(cx + half); x++) {
        const u = (x + 0.5 - cx) / half
        const g = Math.floor((Math.asin(Math.max(-1, Math.min(1, u))) / Math.PI + 0.5) * gores)
        let col = g % 3 === 1 ? stripeB : g % 3 === 2 ? stripeC : stripeA
        if (t > 0.62 && t < 0.7) col = hdMix(col, [255, 224, 150], 0.7)
        const shade = 0.58 + 0.42 * clamp01((u + 1) / 2 + 0.1) ** 0.8
        col = hdDarken(col, shade)
        if (u > 0.45 && u < 0.6 && t < 0.55) col = hdMix(col, WHITE, 0.16)
        if (burn) col = hdMix(col, warm, 0.28 * smooth(0.3, 1, t) * (1 - Math.abs(u) * 0.8))
        else if (lit) col = hdMix(col, warm, 0.1)
        if (Math.abs(Math.abs(u) - 1) < 0.07) col = hdDarken(col, 0.8)
        hd.set(x, y, col)
      }
    }
    // Ropes and basket.
    const bx0 = cx - cw * 0.42 * scale
    const bx1 = cx + cw * 0.42 * scale
    const by0 = skirtY + ch * 0.75 * scale
    const by1 = by0 + ch * 0.62 * scale
    const rope = hdDarken(basket, 0.8)
    for (const [ax, bx] of [
      [cx - rx * 0.36, bx0],
      [cx + rx * 0.36, bx1],
    ] as const) {
      const steps = Math.max(1, Math.ceil(by0 - skirtY))
      for (let i = 0; i <= steps; i++) hd.set(Math.round(ax + (bx - ax) * (i / steps)), Math.round(skirtY + i), rope)
    }
    hd.rect(bx0, by0, bx1, by1, basket)
    hd.rect(bx0, by0, bx1, by0 + Math.max(1, ch * 0.08), hdMix(basket, WHITE, 0.25))
    hd.rect(bx1 - Math.max(1, cw * 0.1 * scale), by0, bx1, by1, hdDarken(basket, 0.7))
    if (burn) {
      const f = Math.max(1.6, cw * 0.2 * scale)
      softBlob(cx, skirtY + ch * 0.2 * scale, cw * 1.5 * scale, ch * 1.3 * scale, flame, 0.4)
      hd.disk(cx, skirtY + ch * 0.1 * scale, f * 1.2, hdMix(flame, [255, 120, 40], 0.5))
      hd.disk(cx, skirtY + ch * 0.18 * scale, f * 0.7, WHITE)
    }
  }

  // Tethered balloon over the cottages, then the free ascending fleet.
  const tether = BALLOONS_TETHER
  drawBalloon(tether.x, tether.top - 1.4, 0.88, envelope, true, flameOn)
  hd.stroke(
    tether.x + 0.1,
    tether.top + 2.6,
    tether.x - 0.8,
    BALLOONS_GROUND_TOP + 0.4,
    Math.max(0.7, cw * 0.04),
    hdDarken(basket, 0.8),
  )
  hd.stroke(
    tether.x + 0.9,
    tether.top + 2.6,
    tether.x + 1.7,
    BALLOONS_GROUND_TOP + 0.4,
    Math.max(0.7, cw * 0.04),
    hdDarken(basket, 0.8),
  )
  for (const balloon of balloonsAscend(elapsedMs)) {
    drawBalloon(balloon.x, balloon.y, 1, balloon.alt ? envelopeAlt : envelope, true, flameOn)
  }

  // Valley floor: terraced fields, scrub, and a path.
  const floorTop = groundY
  for (let y = Math.floor(floorTop); y < h; y++) {
    const u = (y - floorTop) / (h - floorTop || 1)
    const base = hdMix(hdMix(hdHex(c.ground), warm, night ? 0.04 : 0.16 * (1 - u)), hdDarken(hdHex(c.ground), 0.7), u)
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / cw
      // Perspective furrows fanning toward the viewer.
      const furrow = Math.sin((sx - 38) * (0.9 + u * 3.2) * 0.35) > 0.6 ? 0.9 : 1
      hd.set(x, y, hdDarken(base, furrow))
    }
  }
  const scrub = hdHex(c.scrub)
  for (const tuft of BALLOONS_SCRUB) {
    hd.blob(hd.X(tuft + 0.8), hd.Y(BALLOONS_GROUND_TOP + 1.15), cw * 1.3, ch * 0.45, hdDarken(scrub, 0.8), scrub)
    hd.blob(hd.X(tuft + 0.5), hd.Y(BALLOONS_GROUND_TOP + 1.0), cw * 0.8, ch * 0.3, scrub)
  }
  for (let x = 2; x < BALLOONS_COLUMNS; x += 6) {
    hd.disk(hd.X(x + 0.5), hd.Y(BALLOONS_GROUND_TOP + 3.45), Math.max(1.2, cw * 0.12), scrub)
  }

  // Cave cottages with stepped roofs and lit windows.
  for (const cottage of BALLOONS_COTTAGES) {
    const wall = night ? hdMix(house, [60, 50, 70], 0.2) : house
    const x0 = hd.X(cottage)
    const x1 = hd.X(cottage + 2)
    const roofY = hd.Y(16.35)
    const eaveY = hd.Y(17.15)
    const baseY = hd.Y(19.1)
    hd.rect(x0, eaveY, x1, baseY, wall)
    hd.rect(x0 + (x1 - x0) * 0.55, eaveY, x1, baseY, hdDarken(wall, 0.78))
    // Roof ridge as a shaded triangle.
    for (let y = Math.floor(roofY); y < Math.ceil(eaveY); y++) {
      const t = (y - roofY) / (eaveY - roofY || 1)
      const half = (x1 - x0) * (0.12 + 0.62 * t)
      const mx = (x0 + x1) / 2
      for (let x = Math.floor(mx - half); x < Math.ceil(mx + half); x++) {
        hd.set(x, y, hdDarken(hdMix(wall, hdHex("#a24a3a"), 0.45), x < mx ? 1 : 0.8))
      }
    }
    const win = night ? ([255, 218, 140] as RGB) : hdDarken(wall, 0.45)
    hd.rect(x0 + (x1 - x0) * 0.2, hd.Y(17.7), x0 + (x1 - x0) * 0.42, hd.Y(18.4), win)
    hd.rect(x0 + (x1 - x0) * 0.62, hd.Y(17.7), x0 + (x1 - x0) * 0.8, hd.Y(18.4), win)
    hd.rect((x0 + x1) / 2 - (x1 - x0) * 0.08, hd.Y(18.4), (x0 + x1) / 2 + (x1 - x0) * 0.08, baseY, hdDarken(wall, 0.4))
    if (night) softBlob((x0 + x1) / 2, hd.Y(18), cw * 2.6, ch * 1.6, [255, 200, 110], 0.14)
  }
  return hd.pixels
}

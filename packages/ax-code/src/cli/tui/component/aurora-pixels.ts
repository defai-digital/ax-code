import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  AURORA_COLUMNS,
  AURORA_COLORS,
  AURORA_CURTAIN_BOTTOM,
  AURORA_CURTAINS,
  AURORA_CURTAIN_WIDTH,
  AURORA_CYCLE_MS,
  AURORA_HORIZON,
  AURORA_LAKE_TOP,
  AURORA_MIST_ROW,
  AURORA_MOON,
  AURORA_PINES,
  AURORA_ROWS,
  AURORA_STARS,
  AURORA_TREELINE,
  auroraRipple,
  auroraShimmer,
  auroraSkyRgb,
  type AuroraStyle,
} from "./aurora-view-model"

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}

/**
 * Freeform HD aurora. Per-pixel curtains with vertical rays and a bright lower
 * edge hang over snowy ranges, a layered pine forest, and a frozen lake that
 * mirrors the sky. Pure and deterministic: everything derives from
 * `elapsedMs` and loops at 2400ms.
 */
export function renderAuroraPixels(width: number, height: number, style: AuroraStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, AURORA_COLUMNS, AURORA_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const dawn = style === "aurora-dawn"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % AURORA_CYCLE_MS) / AURORA_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = AURORA_COLORS[style]
  const curtain = hdHex(c.curtain)
  const edge = hdHex(c.curtainEdge)
  const snow = hdHex(c.snow)
  const pine = hdHex(c.pine)
  const trunk = hdHex(c.trunk)
  const horizonColor = hdHex(c.skyBottom)
  const bottom = dawn ? AURORA_CURTAIN_BOTTOM - 3 : AURORA_CURTAIN_BOTTOM + 1.5
  const strength = dawn ? 0.5 : 1
  const topTint: RGB = dawn ? [236, 168, 206] : [140, 96, 240]
  const midTint = hdMix(curtain, topTint, 0.25)
  const { cw, ch, w, h } = hd
  const laneTop = hd.Y(AURORA_LAKE_TOP)
  const horizonY = hd.Y(AURORA_HORIZON)

  const blend = (i: number, color: RGB, alpha: number) => {
    if (alpha <= 0) return
    const a = alpha > 1 ? 1 : alpha
    hd.pixels[i] = Math.round(hd.pixels[i]! + (color[0] - hd.pixels[i]!) * a)
    hd.pixels[i + 1] = Math.round(hd.pixels[i + 1]! + (color[1] - hd.pixels[i + 1]!) * a)
    hd.pixels[i + 2] = Math.round(hd.pixels[i + 2]! + (color[2] - hd.pixels[i + 2]!) * a)
  }
  const add = (i: number, color: RGB, k: number) => {
    hd.pixels[i] = Math.min(255, Math.round(hd.pixels[i]! + color[0] * k))
    hd.pixels[i + 1] = Math.min(255, Math.round(hd.pixels[i + 1]! + color[1] * k))
    hd.pixels[i + 2] = Math.min(255, Math.round(hd.pixels[i + 2]! + color[2] * k))
  }

  /** Curtain intensity and tint at a scene position. */
  const curtainAt = (sx: number, sy: number): { a: number; color: RGB } => {
    if (sy < 0 || sy > bottom + 1.2) return { a: 0, color: curtain }
    const v = sy / bottom
    let env = 0
    for (const center of AURORA_CURTAINS) {
      const sway = auroraRipple(elapsed, center + sy * 0.2) + Math.sin(sy * 0.5 + theta + center) * 0.8
      const sigma = AURORA_CURTAIN_WIDTH * (0.85 + 0.25 * Math.sin(sy * 0.3 + center))
      const d = (sx - center - sway) / sigma
      const rays =
        0.6 + 0.25 * Math.sin(sx * 1.3 + sy * 0.25 + center * 3 + theta) + 0.15 * Math.sin(sx * 3.1 - sy * 0.4 + center)
      env += Math.exp(-d * d) * rays
    }
    // A faint veil joins the three curtains into one band.
    env += 0.14 * (0.6 + 0.4 * Math.sin(sx * 0.21 + theta))
    const vertical = smooth(0, 0.3, v) * (1 - smooth(0.9, 1.1, v))
    const rim = Math.exp(-(((v - 0.88) / 0.1) ** 2)) * 0.55
    const a = clamp01(env * (vertical * 0.8 + rim) * strength)
    const body = hdMix(topTint, midTint, smooth(0, 0.5, v))
    return { a, color: hdMix(hdMix(body, curtain, smooth(0.4, 0.85, v)), edge, rim * 0.9 + (a > 0.75 ? 0.15 : 0)) }
  }

  /** Sky pixel including stars-free aurora, used directly and in the lake mirror. */
  const skyPixel = (x: number, sy: number): RGB => {
    const base = auroraSkyRgb(style, clamp01(sy / AURORA_ROWS))
    const { a, color } = curtainAt((x + 0.5) / cw, sy)
    if (a <= 0.004) return base
    return hdMix(base, color, a * 0.9)
  }

  // Sky and curtains.
  for (let y = 0; y < Math.ceil(laneTop); y++) {
    const sy = (y + 0.5) / ch
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const p = skyPixel(x, sy)
      hd.pixels[i] = p[0]
      hd.pixels[i + 1] = p[1]
      hd.pixels[i + 2] = p[2]
    }
  }
  // Horizon glow: rose at dawn, teal-tinted starlight at night.
  const glowColor = dawn ? hdMix(horizonColor, [255, 214, 170], 0.5) : hdMix(curtain, [30, 70, 110], 0.55)
  for (let y = Math.floor(hd.Y(AURORA_HORIZON - 6)); y < Math.ceil(laneTop); y++) {
    const k = smooth(AURORA_HORIZON - 6, AURORA_LAKE_TOP, (y + 0.5) / ch) * (dawn ? 0.55 : 0.28)
    for (let x = 0; x < w; x++) blend((y * w + x) * 3, glowColor, k)
  }

  if (!dawn) {
    const moon = hdHex(c.moon)
    const mx = hd.X(AURORA_MOON.x)
    const my = hd.Y(AURORA_MOON.y)
    const r = Math.max(3, Math.min(cw, ch) * 0.9)
    const reach = r * 7
    for (let y = Math.max(0, Math.floor(my - reach)); y < Math.min(h, Math.ceil(my + reach)); y++) {
      for (let x = Math.max(0, Math.floor(mx - reach)); x < Math.min(w, Math.ceil(mx + reach)); x++) {
        const d = Math.hypot(x + 0.5 - mx, y + 0.5 - my) / r
        if (d > 7) continue
        add((y * w + x) * 3, hdMix([0, 0, 0], moon, 1), 0.34 * Math.exp(-d * 0.8) * (d < 1 ? 0 : 1))
      }
    }
    hd.disk(mx, my, r, moon)
    hd.disk(mx + r * 0.3, my - r * 0.15, r * 0.3, hdMix(moon, [150, 160, 190], 0.35))
    hd.disk(mx - r * 0.35, my + r * 0.25, r * 0.22, hdMix(moon, [150, 160, 190], 0.25))
    hd.stars(AURORA_STARS, hdHex(c.star), (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
    // Extra deterministic dust stars above the curtains.
    for (let i = 0; i < 70; i++) {
      const sx = (i * 37.7 + 5) % AURORA_COLUMNS
      const sy = (((i * 53.3 + 2) % 100) / 100) * (AURORA_HORIZON - 1)
      const twinkle = (Math.floor(elapsed / 300) + i) % 4 === 0
      const px = Math.floor(hd.X(sx))
      const py = Math.floor(hd.Y(sy))
      const idx = (py * w + px) * 3
      if (px < 0 || px >= w || py < 0 || py >= h) continue
      add(idx, hdHex(c.star), twinkle ? 0.9 : 0.4)
    }
  }

  // Far snowy range lit by the sky glow.
  const farRidge = (sx: number) =>
    AURORA_HORIZON - 0.2 - 2.4 * Math.pow(Math.abs(Math.sin(sx * 0.085 + 0.9)), 1.3) - 0.7 * Math.sin(sx * 0.31 + 1.7)
  const nearRidge = (sx: number) =>
    AURORA_HORIZON + 1.4 - 1.5 * Math.pow(Math.abs(Math.sin(sx * 0.13 + 2.4)), 1.2) - 0.45 * Math.sin(sx * 0.41)
  const farBase = dawn ? hdMix(hdHex("#7e6a94"), horizonColor, 0.25) : hdMix(hdHex("#1a3256"), curtain, 0.06)
  const farSnow = dawn ? hdMix(snow, hdHex("#f6c0b0"), 0.45) : hdMix(snow, hdHex("#6c8ec0"), 0.55)
  const nearBase = dawn ? hdHex("#4d4668") : hdHex("#0f2440")
  for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / cw
    const far = hd.Y(farRidge(sx))
    const near = hd.Y(nearRidge(sx))
    for (let y = Math.max(0, Math.floor(far)); y < Math.ceil(laneTop); y++) {
      const depth = clamp01((y - far) / hd.Y(3))
      let col = hdMix(farBase, glowColor, 0.15 + depth * 0.35)
      // Snow above the snow line with a faceted lit side.
      const facet =
        Math.cos(sx * 0.085 + 0.9) * Math.sin(sx * 0.085 + 0.9) < 0 === Math.sin(sx * 0.9 + depth * 3) > -0.6
      if (depth < 0.4) col = hdMix(col, facet ? farSnow : hdMix(farSnow, farBase, 0.45), 0.8 - depth * 1.6)
      hd.set(x, y, col)
    }
    for (let y = Math.max(0, Math.floor(near)); y < Math.ceil(laneTop); y++) {
      const depth = clamp01((y - near) / hd.Y(3))
      let col = hdMix(nearBase, glowColor, 0.18 * (1 - depth))
      if (depth < 0.16) col = hdMix(col, farSnow, 0.4 * (1 - depth / 0.16))
      hd.set(x, y, col)
    }
  }

  // Low mist along the shore, drifting with the loop.
  for (let y = Math.floor(hd.Y(AURORA_MIST_ROW - 1.2)); y < Math.ceil(laneTop); y++) {
    const sy = (y + 0.5) / ch
    const band = Math.exp(-(((sy - AURORA_MIST_ROW) / 0.9) ** 2))
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / cw
      const wisp = 0.55 + 0.45 * Math.sin(sx * 0.4 - theta + Math.sin(sy * 2))
      blend((y * w + x) * 3, snow, band * wisp * (dawn ? 0.3 : 0.22))
    }
  }

  // Layered pine forest: a dense back row and the eight lead trees.
  const shore = AURORA_LAKE_TOP - 0.45
  const drawPine = (sx: number, baseRow: number, tall: number, wide: number, dark: RGB, lit: RGB, snowy: boolean) => {
    const cx = hd.X(sx)
    const apex = hd.Y(baseRow - tall)
    const base = hd.Y(baseRow)
    const half = hd.X(wide)
    const tiers = 4
    for (let y = Math.max(0, Math.floor(apex)); y < Math.min(h, Math.ceil(base)); y++) {
      const t = (y - apex) / (base - apex || 1)
      const tierT = (t * tiers) % 1
      const widest = half * (0.25 + 0.75 * t)
      const rowHalf = widest * (0.45 + 0.55 * tierT)
      const xa = Math.floor(cx - rowHalf)
      const xb = Math.ceil(cx + rowHalf)
      for (let x = xa; x < xb; x++) {
        const side = (x + 0.5 - cx) / (rowHalf || 1)
        let col = side < -0.1 ? hdMix(dark, lit, 0.55 * (1 - tierT)) : hdMix(dark, [0, 0, 0], 0.15)
        if (snowy && tierT < 0.38 && Math.abs(side) < 0.9 - tierT) col = hdMix(col, snow, 0.8 - tierT)
        hd.set(x, y, col)
      }
    }
  }
  const forestDark = dawn ? hdDarken(pine, 0.62) : hdDarken(pine, 0.5)
  const forestLit = dawn ? hdMix(pine, snow, 0.25) : hdMix(pine, curtain, 0.28)
  for (let i = 0; i < 58; i++) {
    const sx = i * 1.35 + ((i * 7) % 5) * 0.12
    drawPine(sx, shore - 0.2, 2.2 + ((i * 5) % 4) * 0.45, 0.85, hdDarken(forestDark, 0.8), forestLit, false)
  }
  // Shore snowbank.
  for (let y = Math.floor(hd.Y(shore - 0.1)); y < Math.ceil(laneTop); y++) {
    const u = (y - hd.Y(shore - 0.1)) / (laneTop - hd.Y(shore - 0.1) || 1)
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / cw
      const rise = Math.sin(sx * 0.7) * 0.16 + Math.sin(sx * 0.23) * 0.2
      if (u + rise < 0.05) continue
      hd.set(x, y, hdMix(snow, dawn ? hdHex("#d9b4c0") : hdHex("#6c88b4"), 0.35 + 0.4 * u))
    }
  }
  for (const tree of AURORA_PINES) {
    const sx = tree + 0.5
    drawPine(sx, shore + 0.4, AURORA_LAKE_TOP - AURORA_TREELINE + 1.2, 1.9, forestDark, forestLit, true)
    hd.rect(hd.X(sx - 0.2), hd.Y(shore + 0.1), hd.X(sx + 0.2), hd.Y(shore + 0.5), trunk)
  }

  // Frozen lake: deep gradient with a mirrored, ripple-shifted sky.
  const top = hdHex(c.water)
  const deep = hdHex(c.waterDeep)
  const mirror = auroraShimmer(elapsed) ? 1 : 0.88
  for (let y = Math.floor(laneTop); y < h; y++) {
    const u = (y - laneTop) / (h - laneTop || 1)
    const sy = (y + 0.5) / ch
    const mirrorY = AURORA_HORIZON - (sy - AURORA_LAKE_TOP) * 1.2
    const base = hdMix(top, deep, Math.pow(u, 0.8))
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / cw
      const dx = Math.sin(sy * 2.2 + theta + sx * 0.3) * 0.6 + Math.sin(sy * 5 - theta * 2) * 0.25
      const reflected = skyPixel(x + dx * cw, mirrorY)
      const sky = hdMix(base, reflected, 0.5 * (1 - u * 0.6) * mirror)
      const i = (y * w + x) * 3
      hd.pixels[i] = sky[0]
      hd.pixels[i + 1] = sky[1]
      hd.pixels[i + 2] = sky[2]
    }
  }
  // Dark forest reflection hugging the shore, broken by ripples.
  for (let y = Math.floor(laneTop); y < Math.min(h, Math.ceil(hd.Y(AURORA_LAKE_TOP + 1.6))); y++) {
    const u = (y - laneTop) / (hd.Y(1.6) || 1)
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / cw
      const broken = 0.5 + 0.5 * Math.sin(sx * 3.1 + y * 0.5 + theta)
      blend((y * w + x) * 3, forestDark, (1 - u) * (0.55 - broken * 0.2))
    }
  }
  const bright = auroraShimmer(elapsed)
  const base0 = (y: number) => hdMix(top, deep, (y - laneTop) / (h - laneTop || 1))
  const shimmer = hdHex(c.shimmer)
  for (const center of AURORA_CURTAINS) {
    const cx = hd.X(center + auroraRipple(elapsed, center))
    for (let y = Math.floor(laneTop); y < h; y += 3) {
      const u = (y - laneTop) / (h - laneTop || 1)
      const len = cw * (1.2 + 1.8 * Math.sin(y * 0.31 + theta + center) ** 2) * (1 - u * 0.5)
      const off = Math.sin(y * 0.2 + theta) * cw * 0.8
      hd.rect(
        cx + off - len,
        y,
        cx + off + len,
        y + 1,
        hdMix(hdMix(base0(y), shimmer, 0.35), shimmer, bright ? 0.2 : 0),
      )
    }
  }
  for (let x = 4; x < AURORA_COLUMNS; x += 17) {
    hd.stroke(
      x,
      AURORA_LAKE_TOP + 4.7,
      x + 1.5,
      AURORA_LAKE_TOP + 5.25,
      Math.max(1, cw * 0.12),
      bright ? snow : hdMix(snow, deep, 0.4),
    )
  }

  // Falling snow drifting in the foreground.
  for (let i = 0; i < 16; i++) {
    const x = (i * 17 + 3 + phase * AURORA_COLUMNS) % AURORA_COLUMNS
    const y = 1.2 + (i % 6) * 1.6 + Math.sin(theta + i * 0.7) * 0.25
    hd.disk(hd.X(x), hd.Y(y), i % 4 === 0 ? Math.max(1.4, cw * 0.26) : 1.15, snow)
  }
  void horizonY
  return hd.pixels
}

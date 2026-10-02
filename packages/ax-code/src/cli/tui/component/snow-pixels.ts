import { artHash, artLine, blendPixel, glow, polyFill, softDisk, vignette } from "./scene-art-kit"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  SNOW_BASE,
  SNOW_COLUMNS,
  SNOW_COLORS,
  SNOW_CYCLE_MS,
  SNOW_GROUND_TOP,
  SNOW_MOON,
  SNOW_PINES,
  SNOW_RIDGE,
  SNOW_ROWS,
  SNOW_SPARKS,
  SNOW_SUN,
  snowFlakeGlyph,
  snowFlakes,
  snowPineHalf,
  snowShadowDX,
  snowSkyRgb,
  snowSparkBright,
  type SnowStyle,
} from "./snow-view-model"

/**
 * Freeform HD renderer. Graded sky with sun or moon bloom, faceted distant
 * peaks under mist, tiered snow-laden pines with lit and shaded boughs, a
 * small cabin, soft blue drift shadows, glinting ground, and layered snowfall
 * come from the shared scene model. Pure and deterministic: everything
 * derives from `elapsedMs`, and the sky loops with the cycle.
 */
export function renderSnowPixels(width: number, height: number, style: SnowStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, SNOW_COLUMNS, SNOW_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "winter-night"
  const c = SNOW_COLORS[style]
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % SNOW_CYCLE_MS) / SNOW_CYCLE_MS
  const u = Math.min(hd.cw, hd.ch / 2)
  const orbAt = night ? SNOW_MOON : SNOW_SUN
  const lightDir = orbAt.x > SNOW_COLUMNS / 2 ? 1 : -1
  const snow = hdHex(c.snow)
  const pine = hdHex(c.pine)
  const pineDeep = hdHex(c.pineDeep)
  const trunk = hdHex(c.trunk)
  const ridge = hdHex(c.ridge)
  const ground = hdHex(c.ground)
  const sparkDim = hdHex(c.sparkDim)
  const orb = hdHex(c.orb)
  const groundY = hd.Y(SNOW_GROUND_TOP)
  const baseY = hd.Y(SNOW_BASE + 1)
  const horizon = snowSkyRgb(style, 1)
  const snowLit = night ? hdMix(snow, [200, 220, 255], 0.3) : snow
  const snowShade = night ? hdMix(ground, [30, 50, 100], 0.35) : hdMix(ground, [120, 140, 190], 0.45)
  const shadowColor: RGB = night ? [38, 52, 98] : [150, 166, 204]

  hd.sky((t) => snowSkyRgb(style, Math.min(1, (t * hd.h) / (groundY || 1))))

  // Sky: stars at night, a soft overcast sun by day, with long bloom.
  const ox = hd.X(orbAt.x)
  const oy = hd.Y(orbAt.y)
  const orbR = Math.max(4, u * 1.3)
  if (night) {
    for (let i = 0; i < 90; i++) {
      const sx = artHash(i, 11) * hd.w
      const sy = Math.pow(artHash(i, 5), 1.4) * groundY * 0.7
      if (Math.hypot(sx - ox, sy - oy) < orbR * 3) continue
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(phase * Math.PI * 2 + i * 2.1))
      blendPixel(hd, Math.floor(sx), Math.floor(sy), [230, 238, 255], 0.3 + 0.55 * tw)
    }
    glow(hd, ox, oy, orbR * 10, [120, 150, 220], 0.55)
    softDisk(hd, ox, oy, orbR, hdMix(orb, [255, 255, 255], 0.3))
    softDisk(hd, ox + orbR * 0.35, oy - orbR * 0.1, orbR * 0.85, hdMix(orb, [20, 30, 70], 0.2), 0.55)
  } else {
    // Thin cloud bands drift slowly and wrap off-screen on the cycle.
    for (let i = 0; i < 5; i++) {
      const span = SNOW_COLUMNS + 30
      const cx = hd.X(((i * 19 + phase * span) % span) - 15)
      const cy = hd.Y(1 + (i % 4) * 2)
      for (let k = 0; k < 16; k++) {
        softDisk(hd, cx + k * hd.cw * 0.6, cy + Math.sin(k * 0.7 + i) * hd.ch * 0.1, hd.ch * 0.4, [255, 255, 255], 0.14)
      }
    }
    glow(hd, ox, oy, orbR * 12, [255, 240, 205], 0.55)
    glow(hd, ox, oy, orbR * 4, [255, 248, 225], 0.6)
    softDisk(hd, ox, oy, orbR, hdMix(orb, [255, 255, 255], 0.5))
  }

  // Distant peaks: faceted shading, jagged snow caps, then a mist band.
  for (const peak of SNOW_RIDGE) {
    const ax = hd.X(peak.ax)
    const ay = hd.Y(peak.ay)
    const halfBase = hd.X(peak.rows * 1.7)
    const foot = groundY
    const topSnowDepth = (foot - ay) * 0.42
    const lean = hd.X(0.6)
    polyFill(
      hd,
      [
        [ax, ay],
        [ax + halfBase * ((foot - ay) / (hd.Y(peak.rows) || 1)), foot],
        [ax - halfBase * ((foot - ay) / (hd.Y(peak.rows) || 1)), foot],
      ],
      (x, y) => {
        const t = (y - ay) / (foot - ay || 1)
        const side = x >= ax + lean * (1 - t) ? 1 : -1
        const lit = side === lightDir
        let col = lit ? hdMix(ridge, snowLit, 0.2) : hdDarken(ridge, 0.72)
        const crag = artHash(Math.floor(x / 3), Math.floor(y / 3)) * 0.5
        col = hdDarken(col, 0.94 + crag * 0.1)
        const jag = Math.sin(x * 0.19 + peak.ax) * hd.ch * 0.35 + Math.sin(x * 0.07) * hd.ch * 0.25
        if (y - ay < topSnowDepth + jag) col = hdMix(lit ? snowLit : hdMix(snowShade, snowLit, 0.45), col, 0.1)
        return hdMix(col, horizon, 0.12 + t * 0.5)
      },
    )
  }
  // Hazy far tree line.
  for (let i = -2; i < SNOW_COLUMNS / 2.2 + 2; i++) {
    const tx = hd.X(i * 2.2 + (i % 3) * 0.4)
    const th = hd.ch * (1.1 + artHash(i, 2) * 1.2)
    polyFill(
      hd,
      [
        [tx, groundY - th],
        [tx + hd.cw * 1.0, groundY],
        [tx - hd.cw * 1.0, groundY],
      ],
      () => hdMix(hdDarken(pineDeep, night ? 0.9 : 1), horizon, 0.55),
    )
  }
  for (let y = Math.floor(groundY - hd.ch * 2.2); y < groundY; y++) {
    const k = ((y - (groundY - hd.ch * 2.2)) / (hd.ch * 2.2)) * 0.5
    for (let x = 0; x < hd.w; x++) blendPixel(hd, x, y, horizon, k)
  }

  // Snowfield with gentle drifts that catch the light.
  for (let y = Math.max(0, Math.floor(groundY - hd.ch * 0.6)); y < hd.h; y++) {
    const sy = (y + 0.5) / hd.ch
    for (let x = 0; x < hd.w; x++) {
      const sx = (x + 0.5) / hd.cw
      const crest = SNOW_GROUND_TOP + Math.sin(sx * 0.25) * 0.28 + Math.cos(sx * 0.09 + 1) * 0.22
      if (sy < crest) continue
      const depth = Math.min(1, (sy - SNOW_GROUND_TOP) / (SNOW_ROWS - SNOW_GROUND_TOP))
      const slope = (Math.cos(sx * 0.25) * 0.25 - Math.sin(sx * 0.09 + 1) * 0.09) * lightDir
      let col = hdMix(ground, snowLit, 0.3 + depth * 0.2)
      col = hdMix(col, slope > 0 ? snowLit : snowShade, Math.min(0.5, Math.abs(slope) * 1.6))
      col = hdMix(col, snowShade, (1 - depth) * 0.12)
      col = hdDarken(col, 1 + (artHash(x, y) - 0.5) * 0.035)
      hd.set(x, y, col)
    }
  }
  // Warm or cool light pool from the orb on the snow.
  glow(hd, ox, groundY + hd.ch * 2, hd.cw * 26, night ? [140, 170, 240] : [255, 244, 214], night ? 0.22 : 0.3)

  // Pine shadows lie across the snow, away from the light.
  const shadowDX = snowShadowDX(style)
  for (const tree of SNOW_PINES) {
    const rx = hd.X(snowPineHalf(tree.h - 1) * 1.3)
    const cx = hd.X(tree.x + 0.5 + shadowDX * 3)
    const cy = groundY + hd.ch * 1.5
    const ry = hd.ch * 1.1
    for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(hd.h, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(hd.w, Math.ceil(cx + rx)); x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry)
        if (d < 1) blendPixel(hd, x, y, shadowColor, (1 - d) * 0.9)
      }
    }
  }

  // Small cabin tucked between the middle pines.
  {
    const cx0 = hd.X(33.6)
    const cw = hd.X(5.2)
    const top = hd.Y(13.1)
    const bottom = hd.Y(SNOW_BASE + 1.4)
    const wall = night ? [58, 40, 30] : [118, 82, 56]
    polyFill(
      hd,
      [
        [cx0, top],
        [cx0 + cw, top],
        [cx0 + cw, bottom],
        [cx0, bottom],
      ],
      (x, y) => hdDarken(wall as unknown as RGB, 0.9 + Math.sin(y * 0.9) * 0.06 + (x > cx0 + cw * 0.5 ? -0.08 : 0)),
    )
    polyFill(
      hd,
      [
        [cx0 - hd.cw * 0.5, top + hd.ch * 0.1],
        [cx0 + cw * 0.5, top - hd.ch * 1.1],
        [cx0 + cw + hd.cw * 0.5, top + hd.ch * 0.1],
      ],
      (x, y) =>
        y < top - hd.ch * 0.5 + Math.abs(x - (cx0 + cw / 2)) * 0.15 ? snowLit : hdMix(snowLit, snowShade, 0.4),
    )
    const wx = cx0 + cw * 0.3
    const wy = top + hd.ch * 0.35
    const win: RGB = night ? [255, 205, 110] : [170, 190, 210]
    hd.rect(wx, wy, wx + hd.cw * 1.1, wy + hd.ch * 0.6, win)
    if (night) {
      glow(hd, wx + hd.cw * 0.5, wy + hd.ch * 0.3, hd.cw * 4.5, [255, 190, 90], 0.45)
      // Chimney smoke rises and thins out over the cycle.
      for (let i = 0; i < 6; i++) {
        const t = (phase + i / 6) % 1
        softDisk(
          hd,
          cx0 + cw * 0.78 + Math.sin(t * 5 + i) * hd.cw * 0.4,
          top - hd.ch * (1 + t * 2.4),
          hd.cw * (0.3 + t * 0.5),
          [190, 205, 235],
          0.28 * (1 - t),
        )
      }
    }
  }

  // Pines: tiered boughs with snow riding on each tier.
  for (const tree of SNOW_PINES) {
    const cx = hd.X(tree.x + 0.5)
    const apexY = hd.Y(SNOW_BASE - tree.h + 1)
    const maxHalf = hd.X((snowPineHalf(tree.h - 1) + 0.6) * 1.3)
    const tiers = tree.h >= 11 ? 6 : tree.h >= 9 ? 5 : 4
    const bodyH = baseY - apexY
    // Trunk.
    for (let y = Math.floor(baseY - hd.ch * 0.2); y < Math.min(hd.h, baseY + hd.ch * 1.6); y++) {
      for (let x = Math.floor(cx - hd.cw * 0.5); x < cx + hd.cw * 0.5; x++) {
        const tt = (x - (cx - hd.cw * 0.5)) / hd.cw
        hd.set(x, y, hdDarken(trunk, 0.7 + (lightDir > 0 ? tt : 1 - tt) * 0.5))
      }
    }
    for (let i = tiers - 1; i >= 0; i--) {
      const t0 = i / tiers
      const t1 = (i + 1) / tiers
      const topY = apexY + bodyH * (t0 * 0.9)
      const botY = apexY + bodyH * (t1 * 0.9 + 0.1 * (t1 === 1 ? 1 : 0)) + bodyH * 0.05
      const halfB = maxHalf * Math.pow(t1, 0.85) * (0.8 + 0.2 * t1) + (i === 0 ? hd.cw * 0.5 : 0)
      const pts: [number, number][] = [[cx, topY]]
      const sc = 5
      for (let s = 0; s <= sc * 2; s++) {
        const f = s / (sc * 2)
        const px = cx + halfB - f * halfB * 2
        const dip = Math.abs(Math.sin(f * Math.PI * sc)) * hd.ch * 0.28
        pts.push([px, botY - dip + (1 - Math.abs(f - 0.5) * 2) * hd.ch * 0.15])
      }
      polyFill(hd, pts, (x, y) => {
        const v = (y - topY) / (botY - topY || 1)
        const wHere = Math.max(1, halfB * Math.min(1, Math.max(0.05, v)))
        const off = (x - cx) / wHere
        const lit = off * lightDir > 0
        let col = hdMix(pineDeep, pine, lit ? 0.55 + (1 - v) * 0.4 : 0.1)
        col = hdDarken(col, 0.78 + (1 - v) * 0.3)
        const needle = artHash(Math.floor(x * 0.7), Math.floor(y * 0.5) + tree.x)
        col = hdDarken(col, 0.92 + needle * 0.14)
        // Snow settles on the upper surface and the lit rim of each tier.
        const rim = Math.abs(off) > 0.78 - (lit ? 0.12 : 0) + Math.sin(x * 0.4 + i) * 0.1
        const crown = v < 0.3 + Math.sin(x * 0.35 + tree.x + i) * 0.16 - Math.abs(off) * 0.25
        if (crown || (rim && v < 0.85 && needle > 0.15)) {
          return hdMix(lit ? snowLit : hdMix(snowLit, snowShade, 0.55), pine, needle > 0.9 ? 0.2 : 0)
        }
        return col
      })
    }
    // Snow mound where the trunk meets the drift.
    polyFill(
      hd,
      [
        [cx - hd.cw * 2.4, baseY + hd.ch * 0.7],
        [cx - hd.cw * 1.3, baseY + hd.ch * 0.1],
        [cx + hd.cw * 1.3, baseY + hd.ch * 0.1],
        [cx + hd.cw * 2.4, baseY + hd.ch * 0.7],
      ],
      () => snowLit,
    )
  }

  // Ground glints on the shared beat.
  SNOW_SPARKS.forEach((spark, i) => {
    const sx = hd.X(spark.x + 0.5)
    const sy = hd.Y(spark.y + 0.5)
    if (snowSparkBright(elapsed, i)) {
      glow(hd, sx, sy, u * 2.2, [255, 255, 255], 0.5)
      artLine(hd, sx - u * 0.9, sy, sx + u * 0.9, sy, 0.6, 0.6, [255, 255, 255])
      artLine(hd, sx, sy - u * 0.9, sx, sy + u * 0.9, 0.6, 0.6, [255, 255, 255])
    } else {
      softDisk(hd, sx, sy, Math.max(0.8, u * 0.12), sparkDim)
    }
  })

  // Snowfall in three depth layers. Whole-number loops wrap seamlessly on the cycle.
  const flake: RGB = hdHex(c.flake)
  for (let i = 0; i < 90; i++) {
    const layer = i % 3
    const speed = layer === 0 ? 1 : layer === 1 ? 2 : 3
    const y = ((artHash(i, 17) + phase * speed) % 1) * (groundY + hd.ch * 3.2) - hd.ch * 0.5
    const x = artHash(i, 23) * hd.w + Math.sin(phase * Math.PI * 2 * speed + i) * hd.cw * (0.5 + layer * 0.4)
    const r = Math.max(0.7, u * (0.07 + layer * 0.06))
    softDisk(hd, x, y, r, flake, 0.35 + layer * 0.2)
  }
  for (const drop of snowFlakes(elapsed)) {
    const glyph = snowFlakeGlyph(drop.char, elapsed)
    const cx = hd.X(drop.x + 0.5)
    const cy = hd.Y(drop.y + 0.5)
    const r = glyph === "@" ? u * 0.34 : glyph === "*" ? u * 0.24 : u * 0.15
    softDisk(hd, cx, cy, Math.max(0.9, r), flake, 0.95)
    if (glyph === "@") {
      glow(hd, cx, cy, r * 4, flake, 0.2)
      artLine(hd, cx - r * 2, cy, cx + r * 2, cy, 0.5, 0.5, flake, 0.7)
      artLine(hd, cx, cy - r * 2, cx, cy + r * 2, 0.5, 0.5, flake, 0.7)
    }
  }
  vignette(hd, night ? 0.4 : 0.15)
  return hd.pixels
}

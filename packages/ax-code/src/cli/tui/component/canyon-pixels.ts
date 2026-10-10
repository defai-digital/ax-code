import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  CANYON_COLORS,
  CANYON_COLUMNS,
  CANYON_CYCLE_MS,
  CANYON_FIRE,
  CANYON_FLOOR_TOP,
  CANYON_MOON,
  CANYON_RIVER_TOP,
  CANYON_ROWS,
  CANYON_STARS,
  CANYON_STRATA_TOP,
  CANYON_SUN,
  canyonEagle,
  canyonSkyRgb,
  canyonTick,
  type CanyonStyle,
} from "./canyon-view-model"
import { hash } from "./atmos-paint"

/** Deterministic hash in [0, 1). */
/** Smooth 1D value noise. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u
}

/**
 * Freeform HD canyon. Hazy far mesas, finely layered sandstone walls with
 * ledge highlights and erosion streaks, shaded foreground cliffs, a river
 * that mirrors the sky and the walls, a sandy bank with scrub, a soaring
 * eagle, and a night campfire that lights the ground and the stones. Pure
 * and deterministic: everything derives from `elapsedMs` and loops at 2400ms.
 */
export function renderCanyonPixels(width: number, height: number, style: CanyonStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, CANYON_COLUMNS, CANYON_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "canyon-night"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % CANYON_CYCLE_MS) / CANYON_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = CANYON_COLORS[style]
  const { w, h, cw, ch } = hd
  const px = hd.pixels
  const blend = (x: number, y: number, color: RGB, alpha: number) => {
    if (alpha <= 0 || x < 0 || y < 0 || x >= w || y >= h) return
    const a = Math.min(1, alpha)
    const i = (y * w + x) * 3
    px[i] = Math.round(px[i]! + (color[0] - px[i]!) * a)
    px[i + 1] = Math.round(px[i + 1]! + (color[1] - px[i + 1]!) * a)
    px[i + 2] = Math.round(px[i + 2]! + (color[2] - px[i + 2]!) * a)
  }
  /** Soft radial additive light in pixel space. */
  const glow = (cx: number, cy: number, rx: number, ry: number, color: RGB, strength: number) => {
    const xa = Math.max(0, Math.floor(cx - rx))
    const xb = Math.min(w - 1, Math.ceil(cx + rx))
    const ya = Math.max(0, Math.floor(cy - ry))
    const yb = Math.min(h - 1, Math.ceil(cy + ry))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
        if (d >= 1) continue
        blend(x, y, color, strength * (1 - d) * (1 - d))
      }
    }
  }
  const strata = [hdHex(c.strata1), hdHex(c.strata2), hdHex(c.strata3)] as const
  const rim = hdHex(c.rim)
  const rimShade = hdHex(c.rimBg)
  const glint = hdHex(c.glint)
  const orb = night ? CANYON_MOON : CANYON_SUN
  const orbX = hd.X(orb.x)
  const orbY = hd.Y(orb.y)
  const coreR = Math.max(3, Math.min(cw, ch) * 0.9)
  const skyAt = (sceneY: number) => canyonSkyRgb(style, sceneY / CANYON_ROWS)
  const light = night ? hdHex("#9fb4e0") : hdHex("#fff0c0")

  // Sky, sun or moon bloom, stars, thin clouds.
  hd.sky((t) => canyonSkyRgb(style, t))
  glow(orbX, orbY, cw * 16, ch * 7, light, night ? 0.22 : 0.42)
  if (night) hd.stars(CANYON_STARS, glint, (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
  for (let y = 0; y < Math.floor(hd.Y(CANYON_STRATA_TOP - 1)); y++) {
    const sceneY = y / ch
    if (sceneY < 1.5) continue
    const x0 = 0
    for (let x = x0; x < w; x += 1) {
      // Thin wind-streaked cirrus that drifts slowly and loops with the cycle.
      const sx = x / cw + phase * 4
      const band = noise1(sx * 0.18, Math.floor(sceneY * 1.8) + 3)
      const streak = Math.max(0, band - 0.62) * (0.5 + 0.5 * Math.sin(sceneY * 2.3))
      if (streak > 0) blend(x, y, night ? hdHex("#4a5c90") : hdHex("#ffffff"), streak * (night ? 0.5 : 0.9))
    }
  }
  if (night) {
    hd.disk(orbX, orbY, coreR * 1.55, hdMix(hdHex("#c8d6f5"), skyAt(orb.y), 0.55))
    hd.disk(orbX, orbY, coreR, hdHex("#eef4ff"))
    hd.disk(orbX - coreR * 0.3, orbY - coreR * 0.2, coreR * 0.28, hdHex("#c9d4ee"))
    hd.disk(orbX + coreR * 0.35, orbY + coreR * 0.3, coreR * 0.2, hdHex("#c9d4ee"))
  } else {
    hd.halo(orbX, orbY, coreR, hdHex("#fffbe0"), hdHex(c.sun), skyAt(orb.y))
  }

  // Far mesas fade into the haze.
  const hazeColor = hdMix(hdHex(c.strata3), skyAt(CANYON_STRATA_TOP - 1), night ? 0.8 : 0.62)
  const mesaTop = (sx: number) => {
    const butte = Math.max(0, 1 - Math.abs(sx - 26) / 6) * 1.6 + Math.max(0, 1 - Math.abs(sx - 52) / 8) * 1.2
    const plateau = 0.5 + noise1(sx * 0.35, 7) * 0.8
    return CANYON_STRATA_TOP - 0.6 - plateau - butte
  }
  for (let x = 0; x < w; x++) {
    const sx = x / cw
    const top = hd.Y(mesaTop(sx))
    const bottom = hd.Y(CANYON_STRATA_TOP + 1)
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(h, Math.ceil(bottom)); y++) {
      const u = (y - top) / (bottom - top || 1)
      const base = hdMix(hazeColor, hdDarken(hazeColor, 0.82), u)
      const ledge = Math.floor(u * 6) % 2 === 0 ? 1 : 0.94
      blend(x, y, hdDarken(base, ledge), 1)
    }
  }

  // Layered canyon wall: thin strata with lit ledges, shaded undercuts, and erosion streaks.
  const wallTop = CANYON_STRATA_TOP - 0.2
  const y0 = Math.max(0, Math.floor(hd.Y(wallTop - 0.8)))
  const y1 = Math.min(h, Math.ceil(hd.Y(CANYON_RIVER_TOP)))
  const sequence = [0, 2, 1, 0, 2, 1, 2, 0, 1, 2] as const
  const sunSide = night ? 0.5 : orb.x
  for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / cw
    const rimWave = Math.sin(sx * 0.55) * 0.42 + Math.cos(sx * 0.27) * 0.28 + Math.sin(sx * 1.3) * 0.12
    const top = hd.Y(CANYON_STRATA_TOP + rimWave)
    const streak = noise1(sx * 2.4, 11)
    for (let y = y0; y < y1; y++) {
      if (y < top) continue
      const sy = (y + 0.5) / ch
      const depth = sy - (CANYON_STRATA_TOP + rimWave)
      // Each layer has its own thickness so the cut reads as sedimentary rock.
      const layerPos = depth / 0.85 + noise1(sx * 0.2, 5) * 0.8 + Math.sin(sx * 0.35 + depth) * 0.1
      const layer = Math.floor(layerPos)
      const within = layerPos - layer
      let color = strata[sequence[((layer % sequence.length) + sequence.length) % sequence.length]!]!
      color = hdMix(color, hdDarken(color, 0.75), hash(layer, 3) * 0.5)
      // Lit top edge of every ledge and a darker undercut.
      if (within < 0.16) color = hdMix(color, hdHex("#ffe6b0"), night ? 0.1 : 0.3)
      else if (within > 0.82) color = hdDarken(color, 0.72)
      // Vertical erosion streaks and grain.
      color = hdDarken(color, 0.9 + streak * 0.14 + (hash(x, y) - 0.5) * 0.06)
      // Lit on the sun side, shadowed in the far right and toward the river.
      const side = night ? 1 : 1.08 - (Math.abs(sx - sunSide) / CANYON_COLUMNS) * 0.5
      const occlusion = 1 - Math.max(0, (sy - (CANYON_RIVER_TOP - 2.2)) / 2.2) * 0.32
      const shadowSide = sx > 48 + Math.sin(sy * 0.65) * 3 ? 0.84 : 1
      px[(y * w + x) * 3] = Math.min(255, Math.round(color[0] * side * occlusion * shadowSide))
      px[(y * w + x) * 3 + 1] = Math.min(255, Math.round(color[1] * side * occlusion * shadowSide))
      px[(y * w + x) * 3 + 2] = Math.min(255, Math.round(color[2] * side * occlusion * shadowSide))
    }
  }

  // Foreground cliffs framing the view, with ledges and a rim light.
  const cliff = (side: 1 | -1) => {
    for (let y = Math.floor(hd.Y(CANYON_STRATA_TOP - 1.4)); y < Math.ceil(hd.Y(CANYON_RIVER_TOP)); y++) {
      const sy = (y + 0.5) / ch
      const t = Math.max(
        0,
        Math.min(1, (sy - (CANYON_STRATA_TOP - 1.4)) / (CANYON_RIVER_TOP - CANYON_STRATA_TOP + 1.4)),
      )
      const reach = 3.4 + t * t * 5.2 + noise1(sy * 1.4, side > 0 ? 17 : 23) * 1.4
      const edge = hd.X(reach)
      for (let k = 0; k < edge; k++) {
        const x = side > 0 ? k : w - 1 - k
        const u = k / (edge || 1)
        const layer = Math.floor(sy * 1.25 + noise1(sy * 0.4, 31) * 2)
        let color = hdMix(rim, rimShade, 0.25 + u * 0.55)
        if (layer % 2 === 0) color = hdMix(color, strata[1], night ? 0.08 : 0.2)
        color = hdDarken(color, 0.92 + hash(x, y) * 0.1)
        // Rim light along the inner edge, brighter on the sun side.
        const rimLight = Math.max(0, 1 - (edge - k) / (cw * 0.9))
        const lit = side > 0 === orb.x < CANYON_COLUMNS / 2 ? 1 : 0.5
        hd.set(x, y, hdMix(color, hdHex(night ? "#8a96c8" : "#ffd79a"), rimLight * 0.4 * lit))
      }
    }
  }
  cliff(1)
  cliff(-1)

  // River: mirrors the sky and the shaded wall base.
  const ry0 = Math.floor(hd.Y(CANYON_RIVER_TOP))
  const ry1 = Math.min(h, Math.ceil(hd.Y(CANYON_FLOOR_TOP)))
  const water = hdHex(c.water)
  const deep = hdHex(c.riverBg)
  for (let y = ry0; y < ry1; y++) {
    const u = (y - ry0) / (ry1 - ry0 || 1)
    for (let x = 0; x < w; x++) {
      const sx = x / cw
      const wave = Math.sin(sx * 1.9 + theta - u * 5) * 0.5 + Math.sin(sx * 0.7 - theta * 2 + u * 3) * 0.5
      let color = hdMix(
        hdMix(water, deep, night ? 0.45 + u * 0.55 : 0.2 + u * 0.8),
        hdDarken(strata[1], night ? 0.9 : 0.7),
        Math.max(0, 0.45 - u * 0.9),
      )
      color = hdDarken(color, 1 + wave * 0.07)
      if (hd.w > 40)
        color = hdMix(color, hdHex(c.skyBottom), Math.max(0, 0.18 - Math.abs(u - 0.55) * 0.3) * (wave > 0.55 ? 1 : 0))
      px[(y * w + x) * 3] = color[0]
      px[(y * w + x) * 3 + 1] = color[1]
      px[(y * w + x) * 3 + 2] = color[2]
    }
  }
  hd.reflection(orb.x, CANYON_RIVER_TOP, CANYON_FLOOR_TOP, night ? hdHex("#dbe7ff") : hdHex("#fff2c0"), theta, 2.8)
  const tick = canyonTick(elapsed)
  for (let i = 0; i < 9; i++) {
    const sx = (i * 8.7 + tick * 1.4 + hash(i, 4) * 4) % CANYON_COLUMNS
    const sy = CANYON_RIVER_TOP + 0.25 + hash(i, 9) * 1.5
    hd.rect(hd.X(sx), hd.Y(sy), hd.X(sx + 0.7 + hash(i, 6)), hd.Y(sy) + Math.max(1, ch * 0.06), glint)
  }
  // Wet bank line where river meets the sand.
  hd.rect(0, hd.Y(CANYON_FLOOR_TOP) - 2, w, hd.Y(CANYON_FLOOR_TOP), hdMix(deep, hdHex(c.ground), 0.5))

  // Sandy floor: gradient, grain, pebbles, scrub.
  const ground = hdHex(c.ground)
  const fy0 = Math.floor(hd.Y(CANYON_FLOOR_TOP))
  for (let y = fy0; y < h; y++) {
    const u = (y - fy0) / Math.max(1, h - fy0)
    const sandBase = night
      ? hdMix(ground, hdHex("#0c0a10"), u * 0.7)
      : hdMix(hdMix(ground, hdHex("#d0a266"), 0.45), hdDarken(ground, 0.7), u)
    for (let x = 0; x < w; x++) {
      const dune = Math.sin((x / cw) * 0.4 + u * 3) * 0.05
      const grain = (hash(x >> 1, y >> 1) - 0.5) * 0.1
      const color = hdDarken(sandBase, 1 + dune + grain)
      px[(y * w + x) * 3] = color[0]
      px[(y * w + x) * 3 + 1] = color[1]
      px[(y * w + x) * 3 + 2] = color[2]
    }
  }
  const stone = hdHex(c.stone)
  for (let i = 0; i < 26; i++) {
    const sx = hash(i, 71) * CANYON_COLUMNS
    const sy = CANYON_FLOOR_TOP + 0.4 + hash(i, 72) * (CANYON_ROWS - CANYON_FLOOR_TOP - 0.8)
    const r = Math.max(1, cw * (0.1 + hash(i, 73) * 0.18))
    hd.blob(hd.X(sx), hd.Y(sy), r * 1.5, r, hdDarken(hdMix(ground, stone, 0.5), 0.75))
    hd.blob(hd.X(sx) - r * 0.2, hd.Y(sy) - r * 0.3, r * 1.1, r * 0.6, hdDarken(hdMix(ground, stone, 0.6), 1.1))
  }
  // Scrub bushes and grass tufts at the sides, bending in a slow breeze.
  const scrub = night ? hdHex("#1a2418") : hdHex("#6b7a38")
  for (let i = 0; i < 16; i++) {
    const sx = i < 8 ? 1 + i * 2.2 + hash(i, 5) * 1.5 : CANYON_COLUMNS - 1 - (i - 8) * 2.4 - hash(i, 6) * 1.5
    const sy = CANYON_FLOOR_TOP + 0.8 + hash(i, 8) * 4.6
    const sway = Math.sin(theta + i) * cw * 0.12
    for (let k = -2; k <= 2; k++) {
      hd.stroke(
        sx + k * 0.08,
        sy,
        sx + k * 0.22 + sway / cw,
        sy - 0.5 - hash(i, k + 20) * 0.5,
        Math.max(0.8, cw * 0.06),
        hdDarken(scrub, 0.8 + hash(k, i) * 0.4),
      )
    }
  }

  // Campfire: stone ring, glow, layered flames.
  const fx = hd.X(CANYON_FIRE.x + 1.5)
  const fy = hd.Y(CANYON_FIRE.y + 1.1)
  const flick = 0.5 + 0.5 * Math.cos(theta * 6)
  if (night) {
    glow(fx, fy - ch * 0.4, cw * 11, ch * 4.2, hdHex("#ff8a30"), 0.5 + 0.2 * flick)
    // Warm the river bank and the stones near the fire.
  }
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2
    const sx = fx + Math.cos(a) * cw * 1.7
    const sy = fy + Math.sin(a) * ch * 0.38
    const r = Math.max(1.5, cw * 0.32)
    hd.blob(
      sx,
      sy,
      r,
      r * 0.75,
      night ? hdMix(stone, hdHex("#ff9a3c"), 0.35 + Math.sin(a) * 0.1) : hdMix(stone, ground, 0.2),
    )
    hd.blob(sx - r * 0.2, sy - r * 0.25, r * 0.6, r * 0.35, night ? hdHex("#ffb870") : hdHex("#c8c8d0"))
  }
  if (night) {
    const hot = hdHex("#ffe9a0")
    const flame = hdHex(c.flame)
    for (let k = 0; k < 5; k++) {
      const lean = Math.sin(theta * 6 + k * 1.7) * cw * 0.25
      const height = ch * (1.1 + 0.35 * flick + 0.2 * Math.sin(theta * 12 + k)) * (1 - Math.abs(k - 2) * 0.17)
      const baseX = fx + (k - 2) * cw * 0.5
      hd.blob(baseX + lean * 0.4, fy - height * 0.45, cw * 0.55, height * 0.55, hdMix(flame, hdHex("#c2330c"), 0.4))
      hd.blob(baseX + lean * 0.6, fy - height * 0.4, cw * 0.38, height * 0.4, flame)
    }
    hd.blob(fx, fy - ch * 0.35, cw * 0.32, ch * 0.45, hot)
    // Rising embers.
    for (let k = 0; k < 7; k++) {
      const rise = (phase * 3 + k * 0.17) % 1
      hd.disk(
        fx + Math.sin(k * 2.3 + rise * 5) * cw * 1.3,
        fy - ch * (0.8 + rise * 3.4),
        Math.max(1, cw * 0.09),
        hdMix(hdHex("#ffcf70"), hdHex(c.flame), rise),
      )
    }
  } else {
    for (let k = 0; k < 4; k++) hd.blob(fx + (k - 1.5) * cw * 0.4, fy - ch * 0.15, cw * 0.28, ch * 0.14, hdHex(c.ash))
    // Thin smoke wisp.
    for (let k = 0; k < 8; k++) {
      const rise = (phase + k / 8) % 1
      blend(
        Math.round(fx + Math.sin(rise * 7 + k) * cw * 0.5 + rise * cw),
        Math.round(fy - ch * (0.3 + rise * 3)),
        hdHex("#e8e4e0"),
        0.35 * (1 - rise),
      )
    }
  }

  // Eagle riding a thermal, shaped by a bent wing and body.
  const eagle = (() => {
    const e = canyonEagle(elapsed)
    return { x: phase * CANYON_COLUMNS, y: e.y + (Math.sin(theta) * 2 - Math.round(Math.sin(theta) * 2)) }
  })()
  const wing = Math.sin(theta * 6) * 0.3
  const feather = hdHex(c.eagle)
  const ex = hd.X(eagle.x + 0.5)
  const ey = hd.Y(eagle.y + 0.5)
  const span = cw * 1.9
  const wr = Math.max(1.1, cw * 0.14)
  for (const dir of [-1, 1]) {
    hd.stroke(
      eagle.x + 0.5,
      eagle.y + 0.5,
      eagle.x + 0.5 + (dir * span * 0.55) / cw,
      eagle.y + 0.5 - 0.1 + wing,
      wr * 1.1,
      feather,
    )
    hd.stroke(
      eagle.x + 0.5 + (dir * span * 0.55) / cw,
      eagle.y + 0.4 + wing,
      eagle.x + 0.5 + (dir * span) / cw,
      eagle.y + 0.55 + wing * 1.5,
      wr * 0.7,
      feather,
    )
  }
  hd.blob(ex, ey + ch * 0.05, cw * 0.2, ch * 0.16, feather)
  hd.disk(ex + cw * 0.18, ey - ch * 0.05, Math.max(1, cw * 0.1), feather)

  // Warm dust motes in the canyon air.
  const dust = night ? hdHex("#8a96c8") : hdHex("#ffe6b0")
  for (let i = 0; i < 14; i++) {
    const x = 8 + ((i * 6.3 + phase * 12) % 60)
    const y = 5.4 + hash(i, 90) * 2.6 + Math.sin(theta + i) * 0.15
    blend(Math.round(hd.X(x)), Math.round(hd.Y(y)), dust, night ? 0.35 : 0.7)
  }
  return hd.pixels
}

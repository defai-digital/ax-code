import { blendPx, clamp01, glow, hash2, vrect } from "./atmos-paint"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  VOLCANO_BASE,
  VOLCANO_COLORS,
  VOLCANO_COLUMNS,
  VOLCANO_CRATER,
  VOLCANO_CX,
  VOLCANO_GROUND_TOP,
  VOLCANO_LAVA_X,
  VOLCANO_MOON,
  VOLCANO_ROWS,
  VOLCANO_STARS,
  VOLCANO_TOP,
  volcanoEmbers,
  volcanoGlow,
  volcanoHalf,
  volcanoPoolStep,
  volcanoSkyRgb,
  volcanoSmoke,
  volcanoStarBright,
  volcanoSurgeRows,
  type VolcanoStyle,
} from "./volcano-view-model"

/**
 * Freeform HD renderer. A stratovolcano with eroded gullies is lit by its own
 * crater: the eruption throws a billowing ash column, a winding lava river
 * with white-hot surges, arcing embers, and orange light across the flanks and
 * the pool below. The calm night is moonlit, with a dim crater, drifting steam,
 * and a still lake mirroring the cone. Pure and deterministic.
 */
export function renderVolcanoPixels(width: number, height: number, style: VolcanoStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, VOLCANO_COLUMNS, VOLCANO_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const eruption = style === "volcano-eruption"
  const c = VOLCANO_COLORS[style]
  const t = Math.max(0, elapsedMs)
  const S = Math.min(hd.ch, hd.cw * 2)
  const pulse = eruption ? volcanoGlow(t) : 0
  const rock = hdHex(c.rock)
  const rim = hdHex(c.rim)
  const lava = hdHex(c.lava)
  const lavaBright = hdHex(c.lavaBright)
  const glowDeep = hdHex(c.glowDeep)
  const glowHot = hdHex(c.glowHot)
  const ember = hdHex(c.ember)
  const groundCol = hdHex(c.ground)
  const sky = hdHex(c.sky)
  const cx = hd.X(VOLCANO_CX)
  const craterX = hd.X((VOLCANO_CRATER.x0 + VOLCANO_CRATER.x1) / 2)
  const craterY = hd.Y((VOLCANO_CRATER.y0 + VOLCANO_CRATER.y1) / 2)
  const groundY = hd.Y(VOLCANO_GROUND_TOP)
  const fire = eruption ? hdMix(glowDeep, glowHot, pulse) : glowDeep

  hd.sky((v) => volcanoSkyRgb(style, v))
  // Sky: red-lit horizon in eruption, starfield and moon in calm.
  if (eruption) {
    glow(hd, craterX, craterY - S * 2, S * 15, hdHex("#e0451a"), 0.55 + 0.12 * pulse, 0.85)
    glow(hd, craterX, groundY, hd.cw * 38, hdHex("#c33d1e"), 0.35, 0.5)
  } else {
    for (let i = 0; i < 120; i++) {
      blendPx(
        hd,
        Math.floor(hash2(i, 1) * hd.w),
        Math.floor(hash2(i, 2) * groundY * 0.8),
        hdHex("#d6dcff"),
        0.15 + 0.5 * hash2(i, 3),
      )
    }
    VOLCANO_STARS.forEach((s, i) => {
      if (volcanoStarBright(t, i)) hd.disk(hd.X(s.x + 0.5), hd.Y(s.y + 0.5), Math.max(1, S * 0.08), sky)
    })
    const mx = hd.X(VOLCANO_MOON.x)
    const my = hd.Y(VOLCANO_MOON.y)
    const mr = Math.max(3, S * 0.5)
    glow(hd, mx, my, mr * 12, hdHex("#8fa6e0"), 0.45)
    hd.disk(mx, my, mr, hdHex("#e8eefc"))
    hd.disk(mx - mr * 0.3, my + mr * 0.2, mr * 0.2, hdHex("#c4cde6"))
    hd.disk(mx + mr * 0.35, my - mr * 0.3, mr * 0.15, hdHex("#d0d8ee"))
  }

  // Far range for depth.
  const farBase = hdMix(
    eruption ? hdHex("#3a1824") : hdHex("#1a2646"),
    volcanoSkyRgb(style, VOLCANO_GROUND_TOP / VOLCANO_ROWS),
    0.3,
  )
  for (let x = 0; x < hd.w; x++) {
    const nx = x / hd.w
    const y = groundY - hd.ch * (1.2 + 1.5 * Math.pow(Math.abs(Math.sin(nx * 7 + 1.3)), 1.3) + 0.5 * Math.sin(nx * 19))
    for (let py = Math.max(0, Math.floor(y)); py < groundY; py++)
      hd.set(x, py, hdMix(farBase, hdDarken(farBase, 0.7), (py - y) / (groundY - y || 1)))
  }

  // Cone: concave flanks, gullies, ridge light from crater (eruption) or moon (calm).
  const top = hd.Y(VOLCANO_TOP)
  const base = hd.Y(VOLCANO_BASE + 1)
  const lightDir = eruption ? 0 : -1
  for (let py = Math.floor(top); py < Math.min(hd.h, Math.ceil(groundY)); py++) {
    const sy = (py + 0.5) / hd.ch
    const f = clamp01((py + 0.5 - top) / (base - top || 1))
    const hw = hd.X(volcanoHalf(Math.min(sy, VOLCANO_BASE + 0.5)) - (1 - Math.pow(f, 0.7)) * 0.4)
    const jag = (hash2(py >> 1, 4) - 0.5) * hd.cw * 0.25 * (1 - f)
    for (let px = Math.floor(cx - hw - jag); px < Math.ceil(cx + hw + jag); px++) {
      const u = (px + 0.5 - cx) / (hw || 1)
      const streak = Math.sin(u * 15 + Math.sin(py * 0.04 + u * 3) * 2.3 + hash2(Math.floor(u * 30), 9) * 6)
      const gully = streak > 0.55 ? 0.78 : streak < -0.7 ? 1.18 : 1
      let col: RGB = hdMix(rock, rim, 0.12 + 0.18 * f)
      col = hdDarken(col, gully * (0.78 + 0.35 * (1 - f) * (1 - Math.abs(u)) + (hash2(px >> 1, py >> 1) - 0.5) * 0.12))
      if (eruption) {
        // Crater light: warm falloff by distance, strongest near the summit.
        const d = Math.hypot((px - craterX) / hd.cw, (py - craterY) / hd.ch) / 22
        const warm = clamp01(1 - d) * (0.6 + 0.3 * pulse) * (gully > 1 ? 1.2 : 0.9)
        col = hdMix(col, hdMix(lava, glowHot, 0.35), warm * warm * 1.1)
      } else {
        const moon = clamp01(0.5 - u * lightDir * 0.9) * 0.35 * (gully >= 1 ? 1 : 0.6)
        col = hdMix(col, hdHex("#6c80b8"), moon * (1 - f * 0.4))
        if (f < 0.12) col = hdMix(col, hdHex("#c8d4f0"), 0.5 * (1 - f / 0.12) * (gully >= 1 ? 1 : 0.4))
      }
      hd.set(px, py, col)
    }
    hd.set(
      Math.floor(cx - hw - jag),
      py,
      hdMix(rim, eruption ? lava : hdHex("#a8b8e8"), eruption ? 0.35 * (1 - f) : 0.25),
    )
  }
  // Crater rim lips and glowing throat.
  const cr0 = hd.X(VOLCANO_CRATER.x0)
  const cr1 = hd.X(VOLCANO_CRATER.x1)
  hd.blob(craterX, craterY, (cr1 - cr0) / 2 + 2, hd.ch * 0.52, hdDarken(rock, 0.7))
  hd.blob(craterX, craterY + 1, (cr1 - cr0) / 2 - 1, hd.ch * 0.34, fire)
  hd.blob(craterX, craterY + 2, (cr1 - cr0) / 3.4, hd.ch * 0.18, eruption ? hdMix(glowHot, lavaBright, pulse) : glowHot)
  glow(
    hd,
    craterX,
    craterY,
    hd.cw * (eruption ? 9 : 3.5),
    eruption ? hdMix(glowHot, lavaBright, 0.5) : glowDeep,
    eruption ? 0.6 + 0.25 * pulse : 0.35,
    0.8,
  )

  // Ground: dark basalt with gradient.
  vrect(
    hd,
    0,
    groundY,
    hd.w,
    hd.h,
    hdMix(groundCol, eruption ? hdHex("#4a1a18") : hdHex("#2a3860"), 0.2),
    hdDarken(groundCol, 0.82),
  )
  if (eruption) {
    // Lava river winds down the right flank into the pool, with a thinner branch left.
    const flow = (x0: number, y0: number, y1: number, width: number, sway: number, seed: number) => {
      const steps = Math.ceil(hd.Y(y1 - y0))
      for (let i = 0; i <= steps; i++) {
        const v = i / steps
        const sy = y0 + (y1 - y0) * v
        const px = hd.X(x0 + 0.5 + Math.sin(v * 5.2 + seed) * sway * v + v * v * 1.4)
        const py = hd.Y(sy)
        const wpx = hd.cw * width * (0.55 + 0.9 * v)
        glow(hd, px, py, wpx * 3.2, lava, 0.12 + 0.04 * pulse, 0.5)
        hd.disk(px, py, wpx, hdMix(lava, hdHex("#c33d1e"), 0.35 + 0.3 * (hash2(i >> 2, seed | 0) - 0.5)))
        hd.disk(px, py, wpx * 0.55, hdMix(lava, lavaBright, 0.5 + 0.35 * pulse))
      }
    }
    flow(VOLCANO_LAVA_X - 1, 9.4, 19, 0.45, 1.3, 1)
    flow(VOLCANO_LAVA_X - 7.6, 10.2, 19, 0.28, -0.9, 3)
    const surge = hdHex(c.surge)
    for (const row of volcanoSurgeRows(t)) {
      const v = clamp01((row - 9.4) / 9.6)
      const sx = hd.X(VOLCANO_LAVA_X - 0.5 + Math.sin(v * 5.2 + 1) * 1.3 * v + v * v * 1.4)
      glow(hd, sx, hd.Y(row + 0.5), hd.cw * 2.2, surge, 0.55, 0.9)
      hd.disk(sx, hd.Y(row + 0.5), Math.max(1.5, hd.cw * 0.3), surge)
    }
    // Pool at the foot: molten shimmer with reflected glow.
    const pool = hdHex(c.pool)
    const step = volcanoPoolStep(t)
    const px0 = hd.X(39)
    const px1 = hd.X(50)
    glow(hd, (px0 + px1) / 2, hd.Y(20), hd.cw * 15, hdHex("#e04a1a"), 0.5, 0.35)
    for (let y = Math.floor(hd.Y(19.2)); y < Math.ceil(hd.Y(21)); y++) {
      const v = (y - hd.Y(19.2)) / (hd.Y(21) - hd.Y(19.2) || 1)
      const inset = hd.cw * (0.3 + v * 1.0 - (1 - v) * 0.2)
      const pcx = (px0 + px1) / 2
      const ph = Math.sqrt(Math.max(0, 1 - Math.pow((v - 0.45) / 0.62, 2)))
      for (let x = Math.floor(pcx - (pcx - px0) * ph + inset * 0); x < Math.ceil(pcx + (px1 - pcx) * ph); x++) {
        const cell = Math.floor((x / hd.cw + step) % 3)
        const wave = Math.sin(x * 0.12 + y * 0.35 + (t / 300) * 2.1)
        const hot = cell === 0 ? 0.55 : 0.1
        hd.set(x, y, hdMix(hdMix(pool, hdHex("#8a2a14"), v * 0.5), lavaBright, clamp01(hot + 0.3 * wave)))
      }
    }
    // Hot rocks mid-slope.
    glow(hd, cx + hd.cw * 5, hd.Y(14.5), hd.cw * 6, hdHex("#ff6a2a"), 0.08, 0.8)
  } else {
    // Still lake: mirrored cone and a moon column.
    const water0 = hd.Y(19.3)
    for (let y = Math.floor(water0); y < hd.h; y++) {
      const v = (y - water0) / (hd.h - water0 || 1)
      for (let x = 0; x < hd.w; x++) {
        const wave = Math.sin(y * 0.4 + x * 0.02 + t / 500) * 0.5
        const dist = Math.abs(x - cx)
        const mirrorHalf = hd.X(volcanoHalf(VOLCANO_TOP + (VOLCANO_BASE + 1 - VOLCANO_TOP) * (1 - v * 0.9))) * 0.9
        if (y > hd.Y(19.6) && dist < mirrorHalf * (0.75 + v * 0.1) && v < 0.8) {
          blendPx(hd, x, y, hdHex("#3a4a78"), 0.18 * (1 - v) + 0.04 * wave)
        }
      }
    }
    const mx = hd.X(VOLCANO_MOON.x)
    for (let y = Math.floor(water0); y < hd.h; y += 2) {
      const v = (y - water0) / (hd.h - water0 || 1)
      const sw = hd.cw * (0.4 + v * 1.6) * (0.5 + 0.5 * Math.sin(y * 0.3 + t / 400))
      hd.rect(mx - sw, y, mx + sw, y + 1, hdMix(hdHex("#c4d0f0"), groundCol, 0.5 + v * 0.3))
    }
    hd.rect(0, water0, hd.w, water0 + 1, hdMix(hdHex("#6a7ab0"), groundCol, 0.5))
    // Steam wisps from the crater.
    for (let i = 0; i < 4; i++) {
      const rise = (t / 4000 + i / 4) % 1
      glow(
        hd,
        craterX + Math.sin(rise * 6 + i) * hd.cw * 1.2 + rise * hd.cw * 3,
        craterY - rise * hd.ch * 4,
        hd.cw * (1 + rise * 2),
        hdHex("#7a86a8"),
        0.3 * (1 - rise),
        0.7,
      )
    }
  }
  // Foreground rock silhouettes.
  for (let i = 0; i < 9; i++) {
    const rx = hd.X(4 + i * 8.5 + hash2(i, 8) * 3)
    if (Math.abs(rx - cx) < hd.cw * 14) continue
    const rh = hd.ch * (0.5 + hash2(i, 9) * 0.9)
    const col = hdDarken(groundCol, 0.55)
    hd.blob(rx, groundY + hd.ch * 0.7, hd.cw * (1.2 + hash2(i, 10)), rh * 0.6, col)
    if (eruption) glow(hd, rx - hd.cw * 0.4, groundY, hd.cw * 1.5, lava, 0.1, 0.7)
  }

  if (eruption) {
    // Ash column: billowing puffs lit from below by the crater, drifting downwind.
    for (let k = 0; k < 30; k++) {
      const age = (t / 6400 + k / 30) % 1
      const py = craterY - age * hd.ch * 8.4
      const spread = hd.cw * (2.6 + age * 11)
      const px = craterX + hd.cw * (age * age * 6 + Math.sin(k * 2.3 + t / 1300) * 1.1 * (0.4 + age))
      const base = hdMix(hdHex(c.smoke), hdHex("#2c2430"), 0.25 + age * 0.45)
      const lit = hdMix(base, ember, (1 - age) * 0.5)
      glow(hd, px, py, spread, hdDarken(base, 0.6), 0.95 * (1 - age * 0.3), 0.6)
      glow(hd, px - spread * 0.1, py + spread * 0.25, spread * 0.7, lit, 0.7 * (1 - age), 0.45)
    }
    for (const puff of volcanoSmoke(t)) {
      glow(hd, hd.X(puff.x + 0.5), hd.Y(puff.y + 0.5), Math.max(3, puff.size * S * 0.9), hdHex(c.smoke), 0.35, 0.6)
    }
    // Rare lightning inside the ash cloud.
    const flash = Math.floor(t / 130) % 17 === 3
    if (flash) {
      let lx = craterX + hd.cw * 3
      let ly = hd.Y(2.2)
      for (let s = 0; s < 8; s++) {
        const nx = lx + (hash2(s, Math.floor(t / 130)) - 0.5) * hd.cw * 2.2
        const ny = ly + hd.ch * 0.45
        for (let k = 0; k <= 6; k++)
          hd.disk(lx + ((nx - lx) * k) / 6, ly + ((ny - ly) * k) / 6, Math.max(1, S * 0.05), hdHex("#fff4e0"))
        lx = nx
        ly = ny
      }
      glow(hd, craterX + hd.cw * 3, hd.Y(3.5), hd.cw * 8, hdHex("#ffe0b0"), 0.3, 0.8)
    }
  }
  // Embers with glow trails.
  for (const spark of volcanoEmbers(t)) {
    if (!spark.visible) continue
    const ex = hd.X(spark.x + 0.5)
    const ey = hd.Y(spark.y + 0.5)
    const big = spark.char === "*"
    glow(hd, ex, ey, S * (big ? 0.7 : 0.45), ember, eruption ? 0.55 : 0.3)
    hd.disk(
      ex,
      ey,
      big ? Math.max(1.4, S * 0.1) : Math.max(1, S * 0.06),
      eruption ? hdMix(ember, lavaBright, 0.4) : ember,
    )
  }
  return hd.pixels
}

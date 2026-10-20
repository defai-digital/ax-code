import { blendPx, clamp01, hash2, vrect } from "./atmos-paint"
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
  const calmBreath = eruption ? 0 : volcanoGlow(t)
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
  const pixels = hd.pixels

  /** atmos-paint glow twin with identical math. Every write in this pipeline
   * lands on integer pixels, so blending where alpha < 1/510 is provably the
   * identity and can be skipped (per pixel and via the row/column window). */
  const glowFast = (cx: number, cy: number, radius: number, color: RGB, strength: number, squash = 1) => {
    if (radius <= 0 || strength <= 0) return
    const ry = radius * squash
    const xa = Math.max(0, Math.floor(cx - radius))
    const xb = Math.min(hd.w - 1, Math.ceil(cx + radius))
    const ya = Math.max(0, Math.floor(cy - ry))
    const yb = Math.min(hd.h - 1, Math.ceil(cy + ry))
    const cr = color[0]!
    const cg = color[1]!
    const cb = color[2]!
    const dSkip = 1 - Math.sqrt(1 / (510 * strength)) - 1e-9
    for (let y = ya; y <= yb; y++) {
      const dy = (y + 0.5 - cy) / ry
      if (dy >= dSkip || dy <= -dSkip) continue
      const fxSpan = Math.sqrt(Math.max(0, dSkip * dSkip - dy * dy)) * radius + 1
      const xlo = Math.max(xa, Math.ceil(cx - fxSpan))
      const xhi = Math.min(xb, Math.floor(cx + fxSpan))
      let i = (y * hd.w + xlo) * 3
      for (let x = xlo; x <= xhi; x++, i += 3) {
        const d = Math.hypot((x + 0.5 - cx) / radius, dy)
        if (d >= dSkip) continue
        const f = 1 - d
        const alpha = strength * f * f
        if (alpha <= 0) continue
        const a = alpha > 1 ? 1 : alpha
        const p0 = pixels[i]!
        pixels[i] = Math.round(p0 + (cr - p0) * a)
        const p1 = pixels[i + 1]!
        pixels[i + 1] = Math.round(p1 + (cg - p1) * a)
        const p2 = pixels[i + 2]!
        pixels[i + 2] = Math.round(p2 + (cb - p2) * a)
      }
    }
  }

  hd.sky((v) => volcanoSkyRgb(style, v))
  // Sky: red-lit horizon in eruption, starfield and moon in calm.
  if (eruption) {
    glowFast(craterX, craterY - S * 2, S * 15, hdHex("#e0451a"), 0.55 + 0.12 * pulse, 0.85)
    glowFast(craterX, groundY, hd.cw * 38, hdHex("#c33d1e"), 0.35, 0.5)
  } else {
    for (let i = 0; i < 220; i++) {
      const sx = Math.floor(hash2(i, 1) * hd.w)
      const sy = Math.floor(hash2(i, 2) * groundY * 0.38)
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 520 + hash2(i, 3) * 6.2))
      blendPx(hd, sx, sy, hdHex("#d6dcff"), (0.18 + 0.55 * hash2(i, 3)) * tw)
      if (i % 4 === 0) glowFast(sx, sy, 2.4 + hash2(i, 5) * 1.8, hdHex("#d6dcff"), 0.42 * tw)
    }
    VOLCANO_STARS.forEach((s, i) => {
      if (volcanoStarBright(t, i)) hd.disk(hd.X(s.x + 0.5), hd.Y(s.y + 0.5), Math.max(1, S * 0.08), sky)
    })
    const mx = hd.X(VOLCANO_MOON.x)
    const my = hd.Y(VOLCANO_MOON.y)
    const mr = Math.max(3, S * 0.5)
    glowFast(mx, my, mr * 12, hdHex("#8fa6e0"), 0.45)
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
  {
    const farDeep = hdDarken(farBase, 0.7)
    const fb0 = farBase[0]!
    const fb1 = farBase[1]!
    const fb2 = farBase[2]!
    const fd0 = farDeep[0]!
    const fd1 = farDeep[1]!
    const fd2 = farDeep[2]!
    const pyEnd = Math.min(hd.h, groundY)
    for (let x = 0; x < hd.w; x++) {
      const nx = x / hd.w
      const y =
        groundY - hd.ch * (1.2 + 1.5 * Math.pow(Math.abs(Math.sin(nx * 7 + 1.3)), 1.3) + 0.5 * Math.sin(nx * 19))
      for (let py = Math.max(0, Math.floor(y)); py < pyEnd; py++) {
        let u = (py - y) / (groundY - y || 1)
        if (u < 0) u = 0
        else if (u > 1) u = 1
        const i = (py * hd.w + x) * 3
        pixels[i] = Math.round(fb0 + (fd0 - fb0) * u)
        pixels[i + 1] = Math.round(fb1 + (fd1 - fb1) * u)
        pixels[i + 2] = Math.round(fb2 + (fd2 - fb2) * u)
      }
    }
  }

  // Cone: concave flanks, gullies, ridge light from crater (eruption) or moon (calm).
  const top = hd.Y(VOLCANO_TOP)
  const base = hd.Y(VOLCANO_BASE + 1)
  const lightDir = eruption ? 0 : -1
  {
    // Per-frame tones; the per-pixel chain is inlined with identical clamps.
    const warmTone = hdMix(lava, glowHot, 0.35)
    const wt0 = warmTone[0]!
    const wt1 = warmTone[1]!
    const wt2 = warmTone[2]!
    const moonTone = hdHex("#6c80b8")
    const mt0 = moonTone[0]!
    const mt1 = moonTone[1]!
    const mt2 = moonTone[2]!
    const moonLit = hdHex("#c8d4f0")
    const ml0 = moonLit[0]!
    const ml1 = moonLit[1]!
    const ml2 = moonLit[2]!
    const rimEdgeCol = eruption ? lava : hdHex("#a8b8e8")
    const warmRowBase = 0.6 + 0.3 * pulse
    for (let py = Math.floor(top); py < Math.min(hd.h, Math.ceil(groundY)); py++) {
      const sy = (py + 0.5) / hd.ch
      const f = clamp01((py + 0.5 - top) / (base - top || 1))
      const hw = hd.X(volcanoHalf(Math.min(sy, VOLCANO_BASE + 0.5)) - (1 - Math.pow(f, 0.7)) * 0.4)
      const jag = (hash2(py >> 1, 4) - 0.5) * hd.cw * 0.25 * (1 - f)
      const rowTone = hdMix(rock, rim, 0.12 + 0.18 * f)
      const r0 = rowTone[0]!
      const r1 = rowTone[1]!
      const r2 = rowTone[2]!
      const rowLit = 0.35 * (1 - f)
      const dyCrater = (py - craterY) / hd.ch
      const moonRow = 1 - f * 0.4
      const summitRow = f < 0.12 ? 0.5 * (1 - f / 0.12) : 0
      const xa = Math.max(0, Math.floor(cx - hw - jag))
      const xb = Math.min(hd.w - 1, Math.ceil(cx + hw + jag) - 1)
      let i = (py * hd.w + xa) * 3
      for (let px = xa; px <= xb; px++, i += 3) {
        const u = (px + 0.5 - cx) / (hw || 1)
        const streak = Math.sin(u * 15 + Math.sin(py * 0.04 + u * 3) * 2.3 + hash2(Math.floor(u * 30), 9) * 6)
        const gully = streak > 0.55 ? 0.78 : streak < -0.7 ? 1.18 : 1
        const factor = gully * (0.78 + rowLit * (1 - Math.abs(u)) + (hash2(px >> 1, py >> 1) - 0.5) * 0.12)
        let v0 = r0 * factor
        let c0 = v0 < 0 ? 0 : v0 > 255 ? 255 : Math.round(v0)
        let v1 = r1 * factor
        let c1 = v1 < 0 ? 0 : v1 > 255 ? 255 : Math.round(v1)
        let v2 = r2 * factor
        let c2 = v2 < 0 ? 0 : v2 > 255 ? 255 : Math.round(v2)
        if (eruption) {
          const d = Math.hypot((px - craterX) / hd.cw, dyCrater) / 22
          let oneMinus = 1 - d
          if (oneMinus < 0) oneMinus = 0
          else if (oneMinus > 1) oneMinus = 1
          const warm = oneMinus * warmRowBase * (gully > 1 ? 1.2 : 0.9)
          let m = warm * warm * 1.1
          if (m > 1) m = 1
          c0 = Math.round(c0 + (wt0 - c0) * m)
          c1 = Math.round(c1 + (wt1 - c1) * m)
          c2 = Math.round(c2 + (wt2 - c2) * m)
        } else {
          let cl = 0.5 - u * lightDir * 0.9
          if (cl < 0) cl = 0
          else if (cl > 1) cl = 1
          let mm = cl * 0.35 * (gully >= 1 ? 1 : 0.6) * moonRow
          if (mm > 1) mm = 1
          c0 = Math.round(c0 + (mt0 - c0) * mm)
          c1 = Math.round(c1 + (mt1 - c1) * mm)
          c2 = Math.round(c2 + (mt2 - c2) * mm)
          if (summitRow > 0) {
            let sm = summitRow * (gully >= 1 ? 1 : 0.4)
            if (sm > 1) sm = 1
            c0 = Math.round(c0 + (ml0 - c0) * sm)
            c1 = Math.round(c1 + (ml1 - c1) * sm)
            c2 = Math.round(c2 + (ml2 - c2) * sm)
          }
        }
        pixels[i] = c0
        pixels[i + 1] = c1
        pixels[i + 2] = c2
      }
      hd.set(Math.floor(cx - hw - jag), py, hdMix(rim, rimEdgeCol, eruption ? 0.35 * (1 - f) : 0.25))
    }
  }
  // Crater rim lips and glowing throat.
  const cr0 = hd.X(VOLCANO_CRATER.x0)
  const cr1 = hd.X(VOLCANO_CRATER.x1)
  hd.blob(craterX, craterY, (cr1 - cr0) / 2 + 2, hd.ch * 0.52, hdDarken(rock, 0.7))
  hd.blob(craterX, craterY + 1, (cr1 - cr0) / 2 - 1, hd.ch * 0.34, fire)
  hd.blob(craterX, craterY + 2, (cr1 - cr0) / 3.4, hd.ch * 0.18, eruption ? hdMix(glowHot, lavaBright, pulse) : glowHot)
  glowFast(
    craterX,
    craterY,
    hd.cw * (eruption ? 9 : 3.5 + 1.3 * calmBreath),
    eruption ? hdMix(glowHot, lavaBright, 0.5) : glowDeep,
    eruption ? 0.6 + 0.25 * pulse : 0.28 + 0.2 * calmBreath,
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
        glowFast(px, py, wpx * 3.2, lava, 0.12 + 0.04 * pulse, 0.5)
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
      glowFast(sx, hd.Y(row + 0.5), hd.cw * 2.2, surge, 0.55, 0.9)
      hd.disk(sx, hd.Y(row + 0.5), Math.max(1.5, hd.cw * 0.3), surge)
    }
    // Pool at the foot: molten shimmer with reflected glow.
    const pool = hdHex(c.pool)
    const poolDeep = hdHex("#8a2a14")
    const step = volcanoPoolStep(t)
    const px0 = hd.X(39)
    const px1 = hd.X(50)
    glowFast((px0 + px1) / 2, hd.Y(20), hd.cw * 15, hdHex("#e04a1a"), 0.5, 0.35)
    {
      const lb0 = lavaBright[0]!
      const lb1 = lavaBright[1]!
      const lb2 = lavaBright[2]!
      const yFrom = Math.floor(hd.Y(19.2))
      const yTo = Math.min(hd.h, Math.ceil(hd.Y(21)))
      for (let y = yFrom; y < yTo; y++) {
        const v = (y - hd.Y(19.2)) / (hd.Y(21) - hd.Y(19.2) || 1)
        const inset = hd.cw * (0.3 + v * 1.0 - (1 - v) * 0.2)
        const pcx = (px0 + px1) / 2
        const ph = Math.sqrt(Math.max(0, 1 - Math.pow((v - 0.45) / 0.62, 2)))
        const inner = hdMix(pool, poolDeep, v * 0.5)
        const i0 = inner[0]!
        const i1 = inner[1]!
        const i2 = inner[2]!
        const xa = Math.max(0, Math.floor(pcx - (pcx - px0) * ph + inset * 0))
        const xb = Math.min(hd.w - 1, Math.ceil(pcx + (px1 - pcx) * ph) - 1)
        for (let x = xa; x <= xb; x++) {
          const cell = Math.floor((x / hd.cw + step) % 3)
          const wave = Math.sin(x * 0.12 + y * 0.35 + (t / 300) * 2.1)
          const hot = cell === 0 ? 0.55 : 0.1
          let u = hot + 0.3 * wave
          if (u < 0) u = 0
          else if (u > 1) u = 1
          const idx = (y * hd.w + x) * 3
          pixels[idx] = Math.round(i0 + (lb0 - i0) * u)
          pixels[idx + 1] = Math.round(i1 + (lb1 - i1) * u)
          pixels[idx + 2] = Math.round(i2 + (lb2 - i2) * u)
        }
      }
    }
    // Hot rocks mid-slope.
    glowFast(cx + hd.cw * 5, hd.Y(14.5), hd.cw * 6, hdHex("#ff6a2a"), 0.08, 0.8)
  } else {
    // Still lake: mirrored cone and a moon column.
    const water0 = hd.Y(19.3)
    {
      const mirrorCol = hdHex("#3a4a78")
      const mc0 = mirrorCol[0]!
      const mc1 = mirrorCol[1]!
      const mc2 = mirrorCol[2]!
      const mirrorFrom = Math.max(0, Math.floor(water0))
      for (let y = mirrorFrom; y < hd.h; y++) {
        const v = (y - water0) / (hd.h - water0 || 1)
        // Per-row mirror geometry; the wave sin only runs inside the mirror.
        const mirrorHalf = hd.X(volcanoHalf(VOLCANO_TOP + (VOLCANO_BASE + 1 - VOLCANO_TOP) * (1 - v * 0.9))) * 0.9
        const inMirrorRow = y > hd.Y(19.6) && v < 0.8
        const rowK = 0.18 * (1 - v)
        const mirrorWidth = mirrorHalf * (0.75 + v * 0.1)
        const waveY = y * 0.4 + t / 500
        let i = y * hd.w * 3
        for (let x = 0; x < hd.w; x++, i += 3) {
          if (!inMirrorRow) continue
          const dist = Math.abs(x - cx)
          if (dist >= mirrorWidth) continue
          const wave = Math.sin(waveY + x * 0.02) * 0.5
          let a = rowK + 0.04 * wave
          if (a <= 0) continue
          if (a > 1) a = 1
          const p0 = pixels[i]!
          pixels[i] = Math.round(p0 + (mc0 - p0) * a)
          const p1 = pixels[i + 1]!
          pixels[i + 1] = Math.round(p1 + (mc1 - p1) * a)
          const p2 = pixels[i + 2]!
          pixels[i + 2] = Math.round(p2 + (mc2 - p2) * a)
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
    // Steam wisps from the crater, plus a thin downwind plume in the empty sky.
    for (let i = 0; i < 4; i++) {
      const rise = (t / 4000 + i / 4) % 1
      glowFast(
        craterX + Math.sin(rise * 6 + i) * hd.cw * 1.2 + rise * hd.cw * 3,
        craterY - rise * hd.ch * 4,
        hd.cw * (1 + rise * 2),
        hdHex("#7a86a8"),
        0.3 * (1 - rise),
        0.7,
      )
    }
    for (let k = 0; k < 16; k++) {
      const age = (t / 4800 + k / 16) % 1
      if (age < 0.1) continue
      const py = craterY - age * hd.ch * 7.2
      const spread = hd.cw * (1.6 + age * 5.5)
      const px = craterX + hd.cw * (age * age * 3.2 + Math.sin(k * 1.9 + t / 1400) * 1.4 * (0.3 + age))
      glowFast(px, py, spread, hdHex("#7a86a8"), 0.4 * (1 - age), 0.62)
    }
  }
  // Foreground rock silhouettes.
  for (let i = 0; i < 9; i++) {
    const rx = hd.X(4 + i * 8.5 + hash2(i, 8) * 3)
    if (Math.abs(rx - cx) < hd.cw * 14) continue
    const rh = hd.ch * (0.5 + hash2(i, 9) * 0.9)
    const col = hdDarken(groundCol, 0.55)
    hd.blob(rx, groundY + hd.ch * 0.7, hd.cw * (1.2 + hash2(i, 10)), rh * 0.6, col)
    if (eruption) glowFast(rx - hd.cw * 0.4, groundY, hd.cw * 1.5, lava, 0.1, 0.7)
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
      glowFast(px, py, spread, hdDarken(base, 0.6), 0.95 * (1 - age * 0.3), 0.6)
      glowFast(px - spread * 0.1, py + spread * 0.25, spread * 0.7, lit, 0.7 * (1 - age), 0.45)
    }
    for (const puff of volcanoSmoke(t)) {
      glowFast(hd.X(puff.x + 0.5), hd.Y(puff.y + 0.5), Math.max(3, puff.size * S * 0.9), hdHex(c.smoke), 0.35, 0.6)
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
      glowFast(craterX + hd.cw * 3, hd.Y(3.5), hd.cw * 8, hdHex("#ffe0b0"), 0.3, 0.8)
    }
  }
  // Embers with glow trails.
  for (const spark of volcanoEmbers(t)) {
    if (!spark.visible) continue
    const ex = hd.X(spark.x + 0.5)
    const ey = hd.Y(spark.y + 0.5)
    const big = spark.char === "*"
    glowFast(ex, ey, S * (big ? 0.7 : 0.45), ember, eruption ? 0.55 : 0.3)
    hd.disk(
      ex,
      ey,
      big ? Math.max(1.4, S * 0.1) : Math.max(1, S * 0.06),
      eruption ? hdMix(ember, lavaBright, 0.4) : ember,
    )
  }
  if (!eruption) {
    // Cool ash rising through the empty sky above the cone, never the flanks.
    const ash = hdMix(ember, hdHex("#8a96b8"), 0.55)
    for (let i = 0; i < 56; i++) {
      const age = (t / 1900 + hash2(i, 17)) % 1
      const py = craterY - 50 - age * hd.ch * 7.5
      const px = craterX + (hash2(i, 18) - 0.5) * hd.cw * 14 + Math.sin(t / 580 + i) * hd.cw * (1.4 + age * 2.2)
      const rad = S * (0.8 + (1 - age) * 1.15)
      glowFast(px, py, rad, ash, 0.44 * (1 - age) * Math.min(1, age * 8), 0.85)
      hd.disk(px, py, Math.max(1.1, S * 0.08), ash)
    }
    for (let i = 0; i < 40; i++) {
      const age = (t / 1100 + hash2(i, 21)) % 1
      const py = craterY - 42 - age * hd.ch * 6.2
      const span = Math.max(1, hd.w)
      const px = (((hash2(i, 22) * span + Math.sin(t / 400 + i) * hd.cw * 3 + t * 0.05) % span) + span) % span
      glowFast(px, py, S * 1.05, ash, 0.36 * (1 - age), 0.9)
    }
  }
  return hd.pixels
}

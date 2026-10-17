import { paintContour, paintVolume } from "./scene-volume"
import {
  SINGAPORE_BAY_TOP,
  SINGAPORE_COLORS,
  SINGAPORE_COLUMNS,
  SINGAPORE_MERLION,
  SINGAPORE_ROWS,
  SINGAPORE_SKYLINE,
  SINGAPORE_SKYPARK,
  SINGAPORE_STARS,
  SINGAPORE_TOWERS,
  SINGAPORE_TREES,
  singaporeBoat,
  singaporeJet,
  singaporePhase,
  singaporeSkyRgb,
  type SingaporeStyle,
} from "./singapore-view-model"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import { blitGlyphText } from "./text-scene-glyphs"
import { hash } from "./atmos-paint"

/** Deterministic hash in [0, 1). */
/** Paints the existing RGB scene transport; never writes to the terminal itself. */
export function renderSingaporePixels(width: number, height: number, style: SingaporeStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, SINGAPORE_COLUMNS, SINGAPORE_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const { X, Y, cw, ch } = hd
  const colors = SINGAPORE_COLORS[style]
  const night = style === "singapore-night"
  const phase = singaporePhase(elapsedMs)
  const skyTop = hdHex(colors.sky),
    horizon = hdHex(colors.skyBottom)
  const tower = hdHex(colors.tower),
    shade = hdHex(colors.shade),
    glass = hdHex(colors.glass)
  const light = hdHex(colors.light),
    stone = hdHex(colors.stone),
    stoneShade = hdHex(colors.stoneShade)
  const accent = hdHex(colors.accent),
    green = hdHex(colors.green),
    canopy = hdHex(colors.canopy)
  const fountain = hdHex(colors.fountain),
    waterTop = hdHex(colors.water),
    waterDeep = hdHex(colors.waterDeep)
  const skyline = hdHex(colors.skyline)
  const line = Math.max(0.5, Math.min(cw, ch) * 0.07)
  // Alpha blend over what is already painted; the HD canvas only has opaque writes.
  const blend = (px: number, py: number, color: RGB, alpha: number) => {
    if (px < 0 || py < 0 || px >= hd.w || py >= hd.h || alpha <= 0) return
    const a = Math.min(1, alpha)
    const i = (py * hd.w + px) * 3
    for (let c = 0; c < 3; c++) hd.pixels[i + c] = Math.round(hd.pixels[i + c]! * (1 - a) + color[c]! * a)
  }
  // Separable falloff with precomputed per-column alpha (no sqrt, no per-pixel
  // division) so full-width glows stay cheap at 1080p.
  const glow = (cx: number, cy: number, rx: number, ry: number, color: RGB, strength: number) => {
    if (rx <= 0 || ry <= 0) return
    const xa = Math.max(0, Math.floor(cx - rx)),
      xb = Math.min(hd.w - 1, Math.ceil(cx + rx))
    const ya = Math.max(0, Math.floor(cy - ry)),
      yb = Math.min(hd.h - 1, Math.ceil(cy + ry))
    const colA = new Float32Array(Math.max(0, xb - xa + 1))
    for (let px = xa; px <= xb; px++) {
      const fx = 1 - Math.abs(px + 0.5 - cx) / rx
      colA[px - xa] = fx > 0 ? fx * fx : 0
    }
    for (let py = ya; py <= yb; py++) {
      const fy = 1 - Math.abs(py + 0.5 - cy) / ry
      if (fy <= 0) continue
      const ay = strength * fy * fy
      let i = (py * hd.w + xa) * 3
      for (let px = xa; px <= xb; px++, i += 3) {
        const a = ay * colA[px - xa]!
        if (a < 0.004) continue
        const keep = 1 - Math.min(1, a)
        hd.pixels[i] = Math.round(hd.pixels[i]! * keep + color[0]! * a)
        hd.pixels[i + 1] = Math.round(hd.pixels[i + 1]! * keep + color[1]! * a)
        hd.pixels[i + 2] = Math.round(hd.pixels[i + 2]! * keep + color[2]! * a)
      }
    }
  }
  // Quadratic falloff keeps thousands of spark writes allocation- and sqrt-free.
  const softDisk = (x: number, y: number, r: number, color: RGB, alpha: number) => {
    const cx = Math.round(x),
      cy = Math.round(y),
      span = Math.max(0, Math.ceil(r))
    const r2 = Math.max(1, r * r)
    for (let dy = -span; dy <= span; dy++)
      for (let dx = -span; dx <= span; dx++) {
        const d2 = (dx * dx + dy * dy) / r2
        if (d2 <= 1) blend(cx + dx, cy + dy, color, alpha * (1 - d2 * 0.7))
      }
  }
  // Vertical light streaks wobble and break up with depth instead of solid columns.
  const streak = (center: number, color: RGB, offset: number, span: number) => {
    for (let column = -span; column <= span; column += 0.3) {
      const edge = 1 - Math.abs(column) / (span + 0.3)
      for (let row = 0; row < 20; row++) {
        const depth = row / 20
        if (hash(column * 20 + offset * 9, row) < 0.22 + depth * 0.4) continue
        const y = 18.35 + depth * 4.6
        const x = center + column + Math.sin(row * 0.9 + phase * 2 + offset) * 0.4
        const alpha = (night ? 0.6 : 0.42) * edge * (1 - depth * 0.7)
        const px = Math.round(X(x)),
          py = Math.round(Y(y))
        blend(px, py, color, alpha)
        blend(px + 1, py, color, alpha * 0.6)
        blend(px, py + 1, color, alpha * 0.6)
      }
    }
  }

  // Sky, horizon warmth, and the orb with a soft bloom.
  hd.sky((v) => singaporeSkyRgb(style, v))
  glow(X(38), Y(18.2), X(30), Y(3.4), night ? hdMix(horizon, accent, 0.3) : horizon, night ? 0.3 : 0.45)
  const orbX = X(64),
    orbY = Y(2.8)
  glow(orbX, orbY, cw * 7, ch * 4.5, light, night ? 0.28 : 0.5)
  hd.halo(orbX, orbY, Math.min(cw, ch) * 0.9, light, hdMix(light, glass, 0.5), singaporeSkyRgb(style, 0.12))
  if (night) {
    const r = Math.min(cw, ch) * 0.9
    hd.disk(orbX - r * 0.3, orbY - r * 0.2, r * 0.22, hdMix(light, glass, 0.35))
    hd.disk(orbX + r * 0.35, orbY + r * 0.3, r * 0.16, hdMix(light, glass, 0.35))
  } else hd.disk(orbX, orbY, Math.min(cw, ch) * 0.55, hdMix(light, [255, 255, 255], 0.55))

  // Layered clouds drift gently; shaded bellies sit below lit crowns.
  const cloud = (cx: number, cy: number, scale: number) => {
    const tone = night ? hdMix(horizon, skyTop, 0.3) : hdMix(stone, glass, 0.12)
    const belly = night ? hdMix(skyTop, horizon, 0.35) : hdMix(tone, skyTop, 0.45)
    hd.blob(X(cx), Y(cy + 0.3), X(3.4 * scale), Y(0.5 * scale), belly)
    hd.blob(X(cx - 1.9 * scale), Y(cy + 0.18), X(1.6 * scale), Y(0.5 * scale), belly)
    hd.blob(X(cx + 2 * scale), Y(cy + 0.2), X(1.7 * scale), Y(0.46 * scale), belly)
    hd.blob(X(cx - 0.9 * scale), Y(cy - 0.18), X(1.5 * scale), Y(0.58 * scale), tone)
    hd.blob(X(cx + 0.8 * scale), Y(cy - 0.3), X(1.7 * scale), Y(0.66 * scale), tone)
    hd.blob(X(cx + 2.3 * scale), Y(cy - 0.05), X(1.1 * scale), Y(0.4 * scale), tone)
  }
  const drift = Math.sin(phase)
  cloud(8 + drift, 3, 1)
  cloud(37 + drift, 2, 1.25)
  cloud(56 - drift * 0.7, 4.6, 0.75)

  if (night) {
    hd.stars(SINGAPORE_STARS, light, (i) => Math.sin(phase * 2 + i) > 0)
    for (let i = 0; i < 90; i++) {
      const sx = Math.floor(hash(i, 1) * hd.w),
        sy = Math.floor(hash(i, 2) * Y(10))
      if (Math.hypot(sx - orbX, sy - orbY) < cw * 4) continue
      blend(sx, sy, light, (Math.floor(Math.max(0, elapsedMs) / 300) + i) % 3 === 0 ? 0.85 : 0.45)
    }
    // Light-show beams fan out of the SkyPark deck and fade into the sky.
    for (const [index, end] of [30, 40, 53, 63].entries()) {
      const sweep = Math.sin(phase + index * 1.7) * 6
      const tipX = end + (index < 2 ? -11 : 11) + sweep
      const beam = hdMix(hdMix(accent, canopy, index / 3), light, 0.35)
      const yTop = Y(-2.5),
        yBase = Y(7)
      for (let py = Math.max(0, Math.floor(yTop)); py < Math.min(hd.h, Math.ceil(yBase)); py++) {
        const u = (py - yBase) / (yTop - yBase || 1)
        const bx = X(end + (tipX - end) * u)
        const halfPx = (0.25 + u * 1.1) * cw * 0.5
        for (let px = Math.max(0, Math.floor(bx - halfPx)); px <= Math.min(hd.w - 1, Math.ceil(bx + halfPx)); px++) {
          const d = Math.abs(px + 0.5 - bx) / (halfPx || 1)
          blend(px, py, beam, 0.45 * (1 - u * 0.55) * (1 - d) * (1 - d))
        }
      }
    }
    // One full firework show per three-second playback: the rocket climbs from
    // behind the skyline, blooms fully by ~2.4s, and rains out before the end.
    const show = (Math.max(0, elapsedMs) % 3000) / 3000
    if (show < 0.5) {
      const u = show / 0.5,
        ry = 13.5 - 8.3 * u
      glow(X(22), Y(ry), cw * 0.9, ch * 0.5, light, 0.8 * u)
      for (let k = 0; k < 10; k++)
        softDisk(X(22 + Math.sin(k * 2.1) * 0.15), Y(ry + 0.3 + k * 0.32), line, light, 0.6 * (1 - k / 10) * u)
    } else {
      const u = (show - 0.5) / 0.5,
        reach = 0.4 + 3.4 * Math.min(1, u * 1.7),
        fade = Math.max(0, 1 - Math.max(0, u - 0.45) / 0.55)
      for (let i = 0; i < 22; i++) {
        const angle = (i / 22) * Math.PI * 2 + 0.13,
          spark = hdMix(light, accent, (i % 3) / 2)
        const steps = Math.max(2, Math.ceil((reach * cw) / 1.4))
        for (let s = 2; s <= steps; s++) {
          const r = (s / steps) * reach
          softDisk(
            X(22 + Math.cos(angle) * r),
            Y(5.2 + Math.sin(angle) * r * 0.82 + u * u * 1.1 * (r / reach)),
            line * 1.3,
            spark,
            0.9 * fade * (1 - r / reach),
          )
        }
      }
      if (u < 0.12) glow(X(22), Y(5.2), cw * 1.8, ch, light, (0.12 - u) * 6)
    }
  } else {
    // Two gulls glide across; wings flap with the loop.
    for (const [index, bird] of [
      { x: 22, y: 5 },
      { x: 25.5, y: 6.2 },
    ].entries()) {
      const bx = bird.x + (phase / (Math.PI * 2)) * 6,
        by = bird.y + Math.sin(phase * 2 + index) * 0.25
      const flap = Math.sin(phase * 6 + index * 2) * 0.25
      hd.stroke(bx - 0.7, by + flap, bx, by, line * 0.7, shade)
      hd.stroke(bx, by, bx + 0.7, by + flap, line * 0.7, shade)
      hd.disk(X(bx), Y(by), line * 0.8, shade)
    }
  }

  hd.water(SINGAPORE_BAY_TOP, SINGAPORE_ROWS, waterTop, waterDeep, phase)
  // Glitter path under the sun or moon, widening and dimming toward the viewer.
  for (let i = 0; i < 140; i++) {
    const depth = hash(i, 7)
    const spread = 1.5 + depth * 5
    const gx = 64 + (hash(i, 13) - 0.5) * 2 * spread,
      gy = 18.4 + depth * 5.2
    const twinkle = Math.sin(phase * 3 + i * 1.7) * 0.5 + 0.5
    softDisk(
      X(gx),
      Y(gy),
      line * 1.1,
      night ? hdMix(light, accent, 0.3) : light,
      (night ? 0.4 : 0.5) * twinkle * (1 - depth * 0.55),
    )
  }

  // Hazy far layer gives the bay depth behind the hero skyline.
  const far = hdMix(skyline, singaporeSkyRgb(style, 0.75), 0.55)
  for (const [x, top, width] of [
    [0, 14, 3],
    [3, 13, 2],
    [7, 15, 3],
    [13, 14, 2],
    [19, 13, 3],
    [21, 15, 4],
    [26, 14, 2],
    [64, 14, 3],
    [67, 13, 2],
    [70, 15, 3],
    [73, 12, 3],
    [66, 16, 5],
  ] as const) {
    hd.rect(X(x), Y(top), X(x + width), Y(SINGAPORE_BAY_TOP), far)
    hd.rect(X(x), Y(top + (SINGAPORE_BAY_TOP - top) * 0.55), X(x + width), Y(SINGAPORE_BAY_TOP), hdDarken(far, 0.85))
    for (let y = top + 0.7; y < SINGAPORE_BAY_TOP - 0.4; y += 1.1)
      hd.rect(
        X(x + 0.4),
        Y(y),
        X(x + width - 0.4),
        Y(y + 0.14),
        night ? hdMix(far, light, 0.18 + hash(x * 3, Math.round(y * 5)) * 0.1) : hdMix(far, glass, 0.3),
      )
  }
  // Near skyline: gradient slabs with a sun-side rim, varied windows, and antennas.
  for (const building of SINGAPORE_SKYLINE) {
    const x0 = X(building.x),
      x1 = X(building.x + building.width),
      y0 = Y(building.top),
      y1 = Y(SINGAPORE_BAY_TOP)
    for (let py = Math.max(0, Math.floor(y0)); py < Math.min(hd.h, Math.ceil(y1)); py++) {
      const v = (py - y0) / (y1 - y0 || 1)
      const body = hdMix(skyline, hdDarken(skyline, 0.78), v * 0.7)
      hd.rect(Math.floor(x0), py, Math.ceil(x1), py + 1, body)
      hd.rect(Math.floor(x0), py, Math.ceil(x0 + cw * 0.12), py + 1, hdMix(body, light, night ? 0.1 : 0.28))
    }
    hd.stroke(
      building.x + building.width / 2,
      building.top - 0.6,
      building.x + building.width / 2,
      building.top,
      line,
      shade,
    )
    for (let y = building.top + 0.6; y < SINGAPORE_BAY_TOP - 0.4; y += 0.8)
      for (let x = building.x + 0.4; x < building.x + building.width - 0.3; x += 0.8) {
        const litWindow = night && hash(Math.round(x * 3), Math.round(y * 7)) > 0.3
        hd.rect(X(x), Y(y), X(x + 0.23), Y(y + 0.18), litWindow ? hdMix(light, accent, 0.15) : glass)
      }
    streak(
      building.x + building.width / 2,
      night ? hdMix(light, skyline, 0.4) : skyline,
      building.x,
      building.width * 0.45,
    )
  }

  // Three gently bowed hotel towers with lit faces, soft side planes, and dense glass.
  for (const [index, center] of SINGAPORE_TOWERS.entries()) {
    const bowAt = (depth: number) => Math.sin(depth * Math.PI) * (index === 0 ? -0.7 : 0.4)
    const towerDark = hdDarken(tower, 0.82)
    for (let py = Math.max(0, Math.floor(Y(7.3))); py < Math.min(hd.h, Math.ceil(Y(SINGAPORE_BAY_TOP))); py++) {
      const depth = Math.max(0, Math.min(1, (py / ch - 7.3) / (SINGAPORE_BAY_TOP - 7.3)))
      const cx = center + bowAt(depth),
        half = 2.4 + depth * 0.7
      // Row-constant tones; the per-pixel loop only lerps scalars and writes.
      const band = 0.12 + 0.08 * Math.sin(depth * 9 + index)
      const row: [number, number, number] = [
        (tower[0]! + (towerDark[0]! - tower[0]!) * depth * 0.45) | 0,
        (tower[1]! + (towerDark[1]! - tower[1]!) * depth * 0.45) | 0,
        (tower[2]! + (towerDark[2]! - tower[2]!) * depth * 0.45) | 0,
      ]
      row[0] = (row[0]! + (glass[0]! - row[0]!) * band) | 0
      row[1] = (row[1]! + (glass[1]! - row[1]!) * band) | 0
      row[2] = (row[2]! + (glass[2]! - row[2]!) * band) | 0
      const rimMix = night ? 0.08 : 0.2
      for (let px = Math.max(0, Math.floor(X(cx - half))); px < Math.min(hd.w, Math.ceil(X(cx + half))); px++) {
        const u = (px / cw - (cx - half)) / (half * 2)
        let r = row[0]!,
          g = row[1]!,
          b = row[2]!
        if (u > 0.8) {
          const k = Math.min(1, (u - 0.8) / 0.2) * 0.85
          r += (shade[0]! - r) * k
          g += (shade[1]! - g) * k
          b += (shade[2]! - b) * k
        } else if (u < 0.05) {
          r += (light[0]! - r) * rimMix
          g += (light[1]! - g) * rimMix
          b += (light[2]! - b) * rimMix
        }
        const factor = 0.97 + Math.floor(hash(px >> 1, py >> 2) * 4) * 0.02
        const i = (py * hd.w + px) * 3
        hd.pixels[i] = Math.max(0, Math.min(255, Math.round(r * factor)))
        hd.pixels[i + 1] = Math.max(0, Math.min(255, Math.round(g * factor)))
        hd.pixels[i + 2] = Math.max(0, Math.min(255, Math.round(b * factor)))
      }
    }
    for (let y = 8; y < 17.8; y += 0.42) {
      const bow = bowAt((y - 7.3) / 10.7)
      for (let x = -1.9; x < 1.9; x += 0.58) {
        const roll = hash(Math.round((center + x) * 13) + index * 7, Math.round(y * 29))
        const tone = night
          ? roll > 0.32
            ? hdMix(light, accent, roll * 0.25)
            : hdMix(glass, shade, 0.55)
          : hdMix(glass, skyTop, 0.1 + roll * 0.3)
        hd.rect(X(center + bow + x), Y(y), X(center + bow + x + 0.32), Y(y + 0.14), tone)
      }
    }
    for (const rib of [-2.2, -0.8, 0.7, 2.15]) {
      let lastX = center + rib,
        lastY = 7.4
      for (let step = 1; step <= 18; step++) {
        const depth = step / 18,
          nextY = 7.4 + depth * 10.3,
          nextX = center + bowAt(depth) + rib * (1 + depth * 0.15)
        hd.stroke(lastX, lastY, nextX, nextY, line * 0.6, hdMix(tower, light, night ? 0.14 : 0.32))
        lastX = nextX
        lastY = nextY
      }
    }
    hd.stroke(center - 2.5, 17.8, center + 2.6, 17.8, line, light)
    streak(center, night ? light : glass, index, 1.7)
  }
  // Atmospheric haze lifts the skyline off the bay; alpha is row-constant.
  const hazeTone = night ? hdMix(horizon, accent, 0.25) : horizon
  for (let py = Math.max(0, Math.floor(Y(15.5))); py < Math.min(hd.h, Math.ceil(Y(SINGAPORE_BAY_TOP))); py++) {
    const u = (py - Y(15.5)) / (Y(SINGAPORE_BAY_TOP) - Y(15.5) || 1)
    const a = 0.4 * u * u,
      keep = 1 - a
    let i = py * hd.w * 3
    for (let px = 0; px < hd.w; px++, i += 3) {
      hd.pixels[i] = Math.round(hd.pixels[i]! * keep + hazeTone[0]! * a)
      hd.pixels[i + 1] = Math.round(hd.pixels[i + 1]! * keep + hazeTone[1]! * a)
      hd.pixels[i + 2] = Math.round(hd.pixels[i + 2]! * keep + hazeTone[2]! * a)
    }
  }

  // The long boat-shaped SkyPark joins all three towers; gardens crown the deck.
  const park = SINGAPORE_SKYPARK
  const hullA = park.x0 - 2.5,
    hullB = park.x1 + 4
  for (let px = Math.max(0, Math.floor(X(hullA))); px < Math.min(hd.w, Math.ceil(X(hullB))); px++) {
    const u = (px / cw - hullA) / (hullB - hullA)
    const belly = 0.2 + 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.55)
    const top = Y(park.y - 0.45),
      bottom = Y(park.y - 0.45 + belly)
    // Column-constant tones; the row loop only lerps scalars and writes.
    const base = u > 0.5 ? hdMix(tower, shade, 0.55) : hdMix(tower, shade, 0.25)
    for (let py = Math.max(0, Math.floor(top)); py < Math.min(hd.h, Math.ceil(bottom)); py++) {
      const k = ((py - top) / (bottom - top || 1)) * 0.8
      const i = (py * hd.w + px) * 3
      hd.pixels[i] = Math.round(base[0]! + (shade[0]! - base[0]!) * k)
      hd.pixels[i + 1] = Math.round(base[1]! + (shade[1]! - base[1]!) * k)
      hd.pixels[i + 2] = Math.round(base[2]! + (shade[2]! - base[2]!) * k)
    }
    const deckTone = hdMix(tower, light, night ? 0.25 : 0.45)
    for (let py = Math.max(0, Math.floor(top)); py < Math.min(hd.h, Math.ceil(top + Math.max(1, ch * 0.12))); py++) {
      const i = (py * hd.w + px) * 3
      hd.pixels[i] = deckTone[0]!
      hd.pixels[i + 1] = deckTone[1]!
      hd.pixels[i + 2] = deckTone[2]!
    }
    if (night) for (let k = 1; k <= 3; k++) blend(px, Math.round(bottom) + k, accent, 0.16 / k)
  }
  hd.rect(X(park.x0 + 0.5), Y(park.y - 0.55), X(park.x1 + 2.5), Y(park.y - 0.45), night ? accent : light)
  hd.stroke(
    park.x1 - 8,
    park.y - 0.2,
    park.x1 - 1,
    park.y - 0.2,
    line * 1.1,
    night ? hdMix(accent, light, 0.3) : hdMix(glass, light, 0.6),
  )
  for (let x = park.x0 + 2; x < park.x1 - 2; x += 1.1) hd.stroke(x, park.y - 0.72, x, park.y - 0.4, line, shade)
  for (let x = park.x0 + 2; x < park.x1 - 2; x += 1.1) {
    hd.blob(X(x + 0.25), Y(park.y - 0.5), cw * 0.58, ch * 0.22, hdDarken(green, 0.75))
    hd.blob(X(x), Y(park.y - 0.65), cw * 0.6, ch * 0.27, green)
  }
  for (let x = park.x0 + 2.55; x < park.x1 - 2; x += 2.2)
    hd.blob(X(x), Y(park.y - 0.84), cw * 0.28, ch * 0.13, hdMix(green, light, night ? 0.15 : 0.35))

  // Supertrees: tapered ribbed trunks carrying glowing saucer canopies.
  for (const [index, tree] of SINGAPORE_TREES.entries()) {
    const branch = hdHex(colors.tree)
    if (night) glow(X(tree.x), Y(tree.top + 0.2), X(tree.radius * 1.5), Y(1.2), hdMix(canopy, accent, 0.4), 0.35)
    hd.mass(tree.x, tree.top + 1, SINGAPORE_BAY_TOP, 0.2, 0.7, hdMix(branch, green, 0.35), branch, shade)
    // Open lattice ribs fan from the trunk tip to the canopy rim.
    for (let i = 0; i <= 12; i++) {
      const u = (i / 12) * 2 - 1,
        tipX = tree.x + tree.radius * u
      const tipY = tree.top - 0.6 + u * u * 0.4
      hd.stroke(tree.x, tree.top + 2.8, tipX, tipY, line, night ? hdMix(canopy, accent, 0.3) : branch)
    }
    hd.blob(
      X(tree.x),
      Y(tree.top + 0.45),
      X(tree.radius * 0.98),
      Y(0.55),
      night ? hdMix(branch, shade, 0.4) : hdMix(green, shade, 0.45),
    )
    hd.blob(X(tree.x), Y(tree.top), X(tree.radius), Y(0.62), night ? hdMix(canopy, branch, 0.5) : green)
    hd.blob(X(tree.x), Y(tree.top - 0.28), X(tree.radius * 0.72), Y(0.4), night ? canopy : hdMix(canopy, green, 0.55))
    for (let i = 0; i <= 12; i++) {
      const u = (i / 12) * 2 - 1,
        tipX = tree.x + tree.radius * u
      const tipY = tree.top - 0.6 + u * u * 0.4
      hd.disk(
        X(tipX),
        Y(tipY),
        line * 2.2,
        night ? hdMix(canopy, accent, (Math.sin(phase * 2 + i * 0.4 + index) + 1) / 2) : hdMix(canopy, green, 0.3),
      )
    }
    hd.blob(X(tree.x), Y(18), X(tree.radius * 0.6), Y(0.24), green)
    if (night) streak(tree.x, canopy, index, 1.1)
  }

  // Reflect the actual skyline and SkyPark, displaced by coherent wave bands.
  // All samples are above the shoreline, so reflection never feeds back into itself.
  const shore = Math.floor(Y(SINGAPORE_BAY_TOP))
  for (let py = shore; py < hd.h; py++) {
    const depth = (py - shore) / Math.max(1, hd.h - shore)
    const sourceY = Math.max(0, shore - 1 - Math.floor((py - shore) * 1.75))
    const shift =
      Math.sin(depth * 44 - phase * 2) * cw * (0.15 + depth * 0.8) + Math.sin(depth * 113 + phase) * cw * 0.16
    const wave = 0.78 + 0.22 * Math.sin(depth * 160 - phase * 3)
    const strength = (night ? 0.64 : 0.34) * (1 - depth * 0.65) * wave
    for (let px = 0; px < hd.w; px++) {
      const sourceX = Math.max(0, Math.min(hd.w - 1, Math.round(px + shift)))
      const src = (sourceY * hd.w + sourceX) * 3,
        dst = (py * hd.w + px) * 3
      for (let channel = 0; channel < 3; channel++)
        hd.pixels[dst + channel] = Math.round(
          hd.pixels[dst + channel]! * (1 - strength) + hd.pixels[src + channel]! * strength,
        )
    }
  }

  // Foreground Merlion: maned lion head, scaled fish body, tail fanning up behind.
  const lion = SINGAPORE_MERLION
  hd.blob(X(lion.x - 1), Y(lion.base + 0.35), X(7), Y(0.6), hdMix(waterDeep, shade, 0.6))
  hd.rect(X(lion.x - 6.4), Y(lion.base + 0.05), X(lion.x + 3.2), Y(lion.base + 0.45), hdDarken(stoneShade, 0.85))
  hd.rect(X(lion.x - 5.6), Y(lion.base - 0.15), X(lion.x + 2.6), Y(lion.base + 0.2), stoneShade)
  hd.rect(X(lion.x - 5.6), Y(lion.base - 0.22), X(lion.x + 2.6), Y(lion.base - 0.1), hdMix(stone, light, 0.3))
  for (let ring = 0; ring < 2; ring++) {
    const spread = (phase / (Math.PI * 2) + ring * 0.5) % 1,
      rx = 4.5 + spread * 3.5
    for (let a = 0; a < Math.PI * 2; a += 0.1)
      blend(
        Math.round(X(lion.x - 1 + Math.cos(a) * rx)),
        Math.round(Y(lion.base + 0.45 + Math.sin(a) * rx * 0.1)),
        fountain,
        0.3 * (1 - spread),
      )
  }
  for (let i = 0; i < 9; i++) {
    const foam = Math.sin(phase * 2 + i * 1.3)
    hd.disk(
      X(lion.x - 6 + i * 1.1),
      Y(lion.base + 0.3 + foam * 0.05),
      line * (1.3 + foam * 0.3),
      hdMix(fountain, waterTop, 0.25),
    )
  }
  // Carved Merlion in profile. A continuous fish silhouette and folded mane
  // replace the former stack of round blobs. Cool occlusion preserves stone volume.
  const stoneKey = hdMix(stone, [220, 229, 222], night ? 0.28 : 0.12)
  const stoneFace = (x: number, y: number): RGB => {
    const sx = x / cw,
      sy = y / ch
    const gain = 0.78 + 0.2 * Math.max(0, Math.min(1, (sx - 10) / 7))
    return hdDarken(hdMix(stoneKey, stoneShade, Math.max(0, (sy - 14) / 9) * 0.24), gain)
  }
  paintContour(
    hd,
    [
      [13.8, 18.7],
      [10.5, 18.4],
      [8.2, 16.4],
      [7.9, 14.4],
      [6.4, 13.4],
      [4.7, 13.4],
      [6.1, 14.6],
      [6.4, 17],
      [8.8, 19.1],
      [12.8, 19.6],
    ],
    stoneFace,
  )
  paintContour(
    hd,
    [
      [7.9, 14.5],
      [6.8, 13.1],
      [4.8, 12.7],
      [5.4, 14.1],
      [4.7, 15.2],
      [6.7, 15.1],
      [8, 15.7],
    ],
    stoneFace,
  )
  for (let ray = 0; ray < 5; ray++) hd.stroke(7.8, 15.2, 5.3 + ray * 0.35, 13.1 + ray * 0.42, line * 0.45, stoneShade)
  paintContour(
    hd,
    [
      [11.8, 13.5],
      [14.6, 13.2],
      [16.1, 14.2],
      [16.6, 16.2],
      [15.4, 18.2],
      [13.6, 19.7],
      [11.3, 19.6],
      [12.5, 17.4],
      [11.3, 15.1],
    ],
    stoneFace,
  )
  // Scales follow the fish's taper, with a lit lip and recessed lower edge.
  for (let row = 0; row < 8; row++) {
    const y = 15 + row * 0.48,
      center = 14.1 - Math.max(0, y - 16) * 0.45
    for (let col = -1; col <= 1; col++) {
      const x = center + col * 0.85 + (row % 2) * 0.32
      hd.stroke(x - 0.36, y, x, y + 0.2, line * 0.55, stoneShade)
      hd.stroke(x, y + 0.2, x + 0.36, y, line * 0.55, stoneShade)
      hd.stroke(x - 0.3, y - 0.07, x + 0.3, y - 0.07, line * 0.35, stoneKey)
    }
  }
  // Swept mane and lion brow, facing the fountain's shared mouth anchor.
  paintContour(
    hd,
    [
      [11.6, 10],
      [13.2, 9.7],
      [14.5, 10.2],
      [15, 11.3],
      [14.6, 13.1],
      [13.7, 14.6],
      [11.8, 15],
      [10.6, 13.7],
      [10.4, 11.8],
    ],
    stoneFace,
  )
  for (let fold = 0; fold < 7; fold++) {
    const x = 10.9 + fold * 0.43
    hd.stroke(x, 10.7, x - 0.15, 12.3, line * 0.7, hdMix(stoneShade, shade, 0.1))
    hd.stroke(x - 0.15, 12.3, x + 0.4, 14.1, line * 0.6, stoneShade)
    hd.stroke(x + 0.14, 10.9, x + 0.1, 12.2, line * 0.4, stoneKey)
  }
  paintContour(
    hd,
    [
      [13.9, 10.6],
      [15, 10.75],
      [15.65, 11.35],
      [15.8, 11.95],
      [16.95, 12.2],
      [17.1, 12.75],
      [16, 12.85],
      [15.5, 13.35],
      [14.4, 13.2],
      [13.9, 12.3],
    ],
    stoneFace,
  )
  paintVolume(hd, 14.6, 12.2, 0.85, 0.7, stoneKey, night)
  paintContour(
    hd,
    [
      [15.4, 12.25],
      [16.75, 12.2],
      [17, 12.5],
      [16.65, 12.75],
      [15.6, 12.8],
    ],
    () => hdMix(stoneKey, stoneShade, 0.16),
  )
  paintContour(
    hd,
    [
      [15.1, 12.9],
      [17.1, 12.85],
      [16.8, 13.2],
      [15.5, 13.35],
    ],
    () => stoneShade,
  )
  hd.stroke(16.15, 12.9, 17.1, 12.9, line * 0.75, hdMix(shade, stoneShade, 0.2))
  paintVolume(hd, 14, 10.35, 0.42, 0.45, stoneKey, night)
  hd.stroke(14.9, 11.25, 15.7, 11.38, line * 0.8, stoneShade)
  hd.blob(X(15.38), Y(11.65), X(0.24), Y(0.1), shade)
  paintContour(
    hd,
    [
      [16.65, 12.13],
      [17.1, 12.18],
      [17, 12.43],
      [16.7, 12.4],
    ],
    () => hdMix(stoneShade, shade, 0.25),
  )
  hd.stroke(15.6, 12.65, 16.45, 12.7, line * 0.4, stoneShade)

  // The fountain shares the parabolic path of the text fallback: a soft outer
  // plume, a bright core, airborne spray, and a pulsing splash with ripples.
  let previous = singaporeJet(0, elapsedMs)
  for (let i = 1; i <= 90; i++) {
    const next = singaporeJet(i / 90, elapsedMs)
    hd.stroke(previous.x, previous.y, next.x, next.y, line * (1.6 - i / 120), hdMix(fountain, stoneShade, 0.25))
    previous = next
  }
  previous = singaporeJet(0, elapsedMs)
  for (let i = 1; i <= 90; i++) {
    const next = singaporeJet(i / 90, elapsedMs)
    hd.stroke(previous.x, previous.y, next.x, next.y, line * Math.max(0.3, 0.8 - i / 300), fountain)
    if (i % 6 === 0) softDisk(X(next.x), Y(next.y), line * 1.6, fountain, 0.5 + 0.3 * Math.sin(phase * 5 - i))
    previous = next
  }
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2 + phase * 3,
      r = 0.7 + (i % 3) * 0.35
    softDisk(X(32 + Math.cos(angle) * r * 1.6), Y(20 + Math.sin(angle) * r * 0.28), line * 1.4, fountain, 0.75)
  }
  for (let ring = 0; ring < 2; ring++) {
    const spread = (phase / (Math.PI * 2) + ring * 0.5) % 1,
      rx = 0.8 + spread * 2.6
    for (let a = 0; a < Math.PI * 2; a += 0.12)
      blend(
        Math.round(X(32 + Math.cos(a) * rx)),
        Math.round(Y(20.1 + Math.sin(a) * rx * 0.2)),
        fountain,
        0.4 * (1 - spread),
      )
  }

  // Bumboat crossing the bay: striped hull, lit cabin, roof, and a fading wake.
  const boat = singaporeBoat(elapsedMs)
  for (let i = 0; i < 6; i++)
    hd.stroke(
      boat.x - 1.2 - i * 0.9,
      boat.y + 0.68 + (i % 2) * 0.06,
      boat.x - 0.5 - i * 0.9,
      boat.y + 0.68,
      line,
      hdMix(waterTop, fountain, 0.35),
    )
  hd.blob(X(boat.x + 1.7), Y(boat.y + 0.62), X(2.9), Y(0.32), hdMix(waterDeep, shade, 0.5))
  hd.blob(X(boat.x + 1.7), Y(boat.y + 0.42), X(2.6), Y(0.34), hdDarken(accent, 0.8))
  hd.stroke(boat.x - 0.6, boat.y + 0.22, boat.x + 3.9, boat.y + 0.22, line * 0.9, hdMix(accent, light, 0.4))
  hd.rect(X(boat.x + 0.4), Y(boat.y - 0.15), X(boat.x + 3), Y(boat.y + 0.4), light)
  hd.rect(X(boat.x + 0.55), Y(boat.y - 0.02), X(boat.x + 2.85), Y(boat.y + 0.16), glass)
  hd.rect(X(boat.x + 0.3), Y(boat.y - 0.32), X(boat.x + 3.1), Y(boat.y - 0.12), hdDarken(accent, 0.65))

  const title = "SINGAPORE"
  const charW = Math.max(1, Math.round(cw * 1.5)),
    charH = Math.max(1, Math.round(ch * 1.05))
  const titleX = Math.round(X(38) - (title.length * charW) / 2),
    titleY = Math.round(Y(22.5))
  blitGlyphText(
    hd.pixels,
    hd.w,
    hd.h,
    titleX + Math.max(1, Math.round(cw * 0.1)),
    titleY + Math.max(1, Math.round(ch * 0.08)),
    charW,
    charH,
    title,
    hdDarken(waterDeep, 0.6),
  )
  blitGlyphText(hd.pixels, hd.w, hd.h, titleX, titleY, charW, charH, title, light)
  return hd.pixels
}

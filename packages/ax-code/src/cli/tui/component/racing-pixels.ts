import { blendPixel } from "./scene-art-kit"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  RACING_CENTER_X,
  RACING_COLORS,
  RACING_COLUMNS,
  RACING_CYCLE_MS,
  RACING_GANTRY,
  RACING_HORIZON,
  RACING_MOON,
  RACING_ROWS,
  RACING_STARS,
  RACING_SUN,
  racingExhaust,
  racingRival,
  racingRoadHalf,
  racingSkyRgb,
  racingSway,
  type RacingStyle,
} from "./racing-view-model"
import { hash } from "./atmos-paint"

/** Smooth 1D value noise. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u
}

/** Mountain silhouette height in scene rows at a scene column. */
function ridgeY(sx: number): number {
  const left = 8.5 - Math.max(0, 1 - sx / 30) * 4.5
  const right = 8.5 - Math.max(0, 1 - (RACING_COLUMNS - sx) / 30) * 4.5
  const peak = Math.max(0, 1 - Math.abs(sx - 31) / 7) * 1.6 + Math.max(0, 1 - Math.abs(sx - 47) / 9) * 1.1
  return Math.min(left, right) - peak - noise1(sx * 0.5, 7) * 0.7
}

/**
 * Freeform HD mountain highway in chase view. Green peaks frame the pass, a
 * sign gantry spans the road, guardrails and lamps stream past in
 * perspective, a rival weaves ahead, and the player car fills the foreground
 * from behind: black by day (opening), red at dusk (ending). Pure and
 * deterministic: everything derives from `elapsedMs` and loops at 2400ms.
 */
export function renderRacingPixels(width: number, height: number, style: RacingStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, RACING_COLUMNS, RACING_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const night = style === "racing-night"
  const elapsed = Math.max(0, elapsedMs)
  const phase = (elapsed % RACING_CYCLE_MS) / RACING_CYCLE_MS
  const theta = phase * Math.PI * 2
  const c = RACING_COLORS[style]
  const { w, h, cw, ch } = hd
  const px = hd.pixels
  const blend = (x: number, y: number, color: RGB, alpha: number) => blendPixel(hd, x, y, color, alpha)
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
  const grass = hdHex(c.grass)
  const grassDark = hdHex(c.grassDark)
  const asphalt = hdHex(c.asphaltBg)
  const linePaint = hdHex(c.line)
  const body = hdHex(c.carBg)
  const tail = hdHex(c.tail)
  const orb = night ? RACING_MOON : RACING_SUN
  const orbX = hd.X(orb.x)
  const orbY = hd.Y(orb.y)
  const coreR = Math.max(3, Math.min(cw, ch) * 0.9)
  const skyAt = (sceneY: number) => racingSkyRgb(style, sceneY / RACING_ROWS)

  // Sky, sun or moon bloom, stars.
  hd.sky((t) => racingSkyRgb(style, t))
  glow(orbX, orbY, cw * 16, ch * 7, night ? hdHex("#9fb4e0") : hdHex("#fff0c0"), night ? 0.22 : 0.42)
  if (night) hd.stars(RACING_STARS, hdHex("#e8f0ff"), (index) => (Math.floor(elapsed / 400) + index) % 3 === 0)
  if (night) {
    hd.disk(orbX, orbY, coreR * 1.55, hdMix(hdHex("#c8d6f5"), skyAt(orb.y), 0.55))
    hd.disk(orbX, orbY, coreR, hdHex("#eef4ff"))
    hd.disk(orbX - coreR * 0.3, orbY - coreR * 0.2, coreR * 0.28, hdHex("#c9d4ee"))
  } else {
    hd.halo(orbX, orbY, coreR, hdHex("#fffbe0"), hdHex(c.sun), skyAt(orb.y))
  }

  // Mountains: static green shoulders with rocky shading above the horizon.
  const mountain = hdHex(c.mountain)
  const mountainFar = hdHex(c.mountainFar)
  const rock = hdHex(c.rock)
  const horizonPx = Math.floor(hd.Y(RACING_HORIZON))
  for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / cw
    const top = hd.Y(ridgeY(sx))
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(h, horizonPx); y++) {
      const u = (y - top) / (horizonPx - top || 1)
      const rocky = noise1(sx * 1.7, 13) > 0.72
      let color = hdMix(mountainFar, mountain, Math.max(0, Math.min(1, u * 1.4)))
      if (rocky) color = hdMix(color, rock, 0.45)
      color = hdDarken(color, 0.94 + hash(x >> 1, y >> 1) * 0.1)
      const i = (y * w + x) * 3
      px[i] = color[0]
      px[i + 1] = color[1]
      px[i + 2] = color[2]
    }
  }

  // Ground and highway: grass verge, perspective asphalt, streaming dashes.
  for (let y = horizonPx; y < h; y++) {
    const sy = (y + 0.5) / ch
    const t = Math.max(0, Math.min(1, (sy - RACING_HORIZON) / (RACING_ROWS - RACING_HORIZON)))
    const half = racingRoadHalf(sy)
    const leftEdge = hd.X(RACING_CENTER_X - half)
    const rightEdge = hd.X(RACING_CENTER_X + half)
    const dashPhase = (((t * 9 - phase * 9) % 1) + 1) % 1
    const dashOn = dashPhase < 0.55
    const dashHalf = Math.max(1, cw * (0.12 + t * 0.3))
    for (let x = 0; x < w; x++) {
      let color: RGB
      if (x < leftEdge || x >= rightEdge) {
        color = hdDarken(hdMix(grass, grassDark, t), 0.95 + hash(x >> 1, y >> 1) * 0.08)
        // Guardrail band just outside the asphalt on both shoulders.
        const rail =
          (x >= leftEdge - cw * 1.6 && x < leftEdge - cw * 0.4) ||
          (x > rightEdge + cw * 0.4 && x <= rightEdge + cw * 1.6)
        if (rail && t > 0.12) color = hdHex(c.guardrail)
      } else {
        color = hdDarken(hdMix(asphalt, hdHex(c.asphalt), 0.12 + t * 0.1), 0.96 + hash(x, y) * 0.06)
        const edgeLine = x < leftEdge + dashHalf * 1.4 || x >= rightEdge - dashHalf * 1.4
        const sx = (x + 0.5) / cw
        const lane =
          Math.abs(sx - RACING_CENTER_X) * cw < dashHalf ||
          Math.abs(sx - (RACING_CENTER_X - half / 2)) * cw < dashHalf ||
          Math.abs(sx - (RACING_CENTER_X + half / 2)) * cw < dashHalf
        if (edgeLine || (dashOn && lane)) color = linePaint
      }
      const i = (y * w + x) * 3
      px[i] = color[0]
      px[i + 1] = color[1]
      px[i + 2] = color[2]
    }
  }

  // Street lamps streaming down both shoulders toward the viewer.
  const lampPole = hdHex(night ? "#3a3f48" : c.lamp)
  for (let k = 0; k < 6; k++) {
    const t = (((k / 6 + phase) % 1) + 1) % 1
    const sy = RACING_HORIZON + 1 + t * t * (RACING_ROWS - RACING_HORIZON - 2)
    const half = racingRoadHalf(sy)
    const poleH = 0.5 + t * 2.2
    for (const side of [-1, 1]) {
      const lx = RACING_CENTER_X + side * (half + 2.5)
      hd.stroke(lx, sy, lx, sy - poleH, Math.max(0.8, cw * 0.08), lampPole)
      hd.stroke(lx, sy - poleH, lx - side * 0.9, sy - poleH, Math.max(0.8, cw * 0.07), lampPole)
      if (night) {
        glow(hd.X(lx - side * 0.9), hd.Y(sy - poleH), cw * (1 + t * 2), ch * (0.6 + t), hdHex(c.lamp), 0.55)
        hd.disk(hd.X(lx - side * 0.9), hd.Y(sy - poleH), Math.max(1, cw * 0.14), hdHex("#fff2c0"))
      }
    }
  }

  // Sign gantry over the road at the pass exit.
  const gantryPaint = hdHex(c.gantry)
  const beamR = Math.max(1, cw * 0.16)
  hd.stroke(RACING_GANTRY.x0, RACING_GANTRY.legBottom + 0.5, RACING_GANTRY.x0, RACING_GANTRY.beamY, beamR, gantryPaint)
  hd.stroke(RACING_GANTRY.x1, RACING_GANTRY.legBottom + 0.5, RACING_GANTRY.x1, RACING_GANTRY.beamY, beamR, gantryPaint)
  hd.stroke(RACING_GANTRY.x0, RACING_GANTRY.beamY, RACING_GANTRY.x1, RACING_GANTRY.beamY, beamR, gantryPaint)
  hd.stroke(
    RACING_GANTRY.x0,
    RACING_GANTRY.beamY + 0.9,
    RACING_GANTRY.x1,
    RACING_GANTRY.beamY + 0.9,
    beamR * 0.7,
    gantryPaint,
  )
  for (let x = RACING_GANTRY.x0 + 3; x < RACING_GANTRY.x1 - 2; x += 4) {
    hd.stroke(x, RACING_GANTRY.beamY + 0.9, x + 2, RACING_GANTRY.beamY, beamR * 0.45, gantryPaint)
  }
  hd.rect(
    hd.X(RACING_CENTER_X - 5),
    hd.Y(RACING_GANTRY.beamY - 0.2),
    hd.X(RACING_CENTER_X + 5),
    hd.Y(RACING_GANTRY.beamY + 1.1),
    hdHex(c.sign),
  )
  hd.rect(
    hd.X(RACING_CENTER_X - 4.2),
    hd.Y(RACING_GANTRY.beamY + 0.25),
    hd.X(RACING_CENTER_X + 4.2),
    hd.Y(RACING_GANTRY.beamY + 0.45),
    hdHex(c.signText),
  )
  if (night) {
    for (const lx of [RACING_GANTRY.x0 + 6, RACING_CENTER_X, RACING_GANTRY.x1 - 6]) {
      glow(hd.X(lx), hd.Y(RACING_GANTRY.beamY + 1.2), cw * 2.4, ch * 1.2, hdHex(c.lamp), 0.5)
    }
  }

  // Rival car ahead: low dark body, roof, twin taillights.
  const rival = racingRival(elapsed)
  const smoothRivalX = RACING_CENTER_X - 4 + Math.sin(theta) * 3
  const rivalPaint = hdHex(c.rival)
  hd.blob(hd.X(smoothRivalX + 2), hd.Y(rival.y + 1.6), cw * 2.4, ch * 0.55, hdDarken(asphalt, 0.6))
  hd.blob(hd.X(smoothRivalX + 2), hd.Y(rival.y + 1.1), cw * 2.2, ch * 0.6, rivalPaint)
  hd.blob(hd.X(smoothRivalX + 2), hd.Y(rival.y + 0.55), cw * 1.4, ch * 0.45, rivalPaint)
  hd.disk(hd.X(smoothRivalX + 0.6), hd.Y(rival.y + 1.2), Math.max(1, cw * 0.22), tail)
  hd.disk(hd.X(smoothRivalX + 3.4), hd.Y(rival.y + 1.2), Math.max(1, cw * 0.22), tail)
  if (night) {
    glow(hd.X(smoothRivalX + 0.6), hd.Y(rival.y + 1.2), cw * 1.2, ch * 0.5, tail, 0.5)
    glow(hd.X(smoothRivalX + 3.4), hd.Y(rival.y + 1.2), cw * 1.2, ch * 0.5, tail, 0.5)
  }

  // Player car from behind, swaying gently with the road.
  const sway = racingSway(elapsed) + Math.sin(theta) * 0.4
  const carCx = hd.X(RACING_CENTER_X + sway)
  const shadowY = hd.Y(23.4)
  hd.blob(carCx, shadowY, cw * 10.5, ch * 0.55, hdDarken(asphalt, 0.55))
  // Rear body, cabin, and glass.
  hd.blob(carCx, hd.Y(21.2), cw * 9.2, ch * 2.1, body)
  hd.blob(carCx, hd.Y(19.6), cw * 7.6, ch * 1.5, hdMix(body, hdHex("#ffffff"), night ? 0.12 : 0.18))
  hd.blob(carCx, hd.Y(18.4), cw * 5.2, ch * 1.15, body)
  hd.blob(carCx, hd.Y(18.5), cw * 4.3, ch * 0.8, hdHex(c.glass))
  hd.blob(carCx - cw * 1.2, hd.Y(18.2), cw * 2.2, ch * 0.35, hdMix(hdHex(c.glass), hdHex("#ffffff"), 0.35))
  // Mirrors and wheels.
  hd.blob(carCx - cw * 6.4, hd.Y(18.6), cw * 0.8, ch * 0.32, body)
  hd.blob(carCx + cw * 6.4, hd.Y(18.6), cw * 0.8, ch * 0.32, body)
  hd.blob(carCx - cw * 8.8, hd.Y(22.6), cw * 1.1, ch * 0.8, hdHex("#0a0a0c"))
  hd.blob(carCx + cw * 8.8, hd.Y(22.6), cw * 1.1, ch * 0.8, hdHex("#0a0a0c"))
  // Spoiler with endplates.
  hd.rect(carCx - cw * 10, hd.Y(19.9), carCx + cw * 10, hd.Y(20.25), hdDarken(body, 0.8))
  hd.rect(carCx - cw * 10.2, hd.Y(19.7), carCx - cw * 9.7, hd.Y(20.5), hdDarken(body, 0.8))
  hd.rect(carCx + cw * 9.7, hd.Y(19.7), carCx + cw * 10.2, hd.Y(20.5), hdDarken(body, 0.8))
  hd.rect(carCx - cw * 3.4, hd.Y(20.25), carCx - cw * 2.9, hd.Y(20.8), hdDarken(body, 0.7))
  hd.rect(carCx + cw * 2.9, hd.Y(20.25), carCx + cw * 3.4, hd.Y(20.8), hdDarken(body, 0.7))
  // Taillights, plate, bumper, and exhausts.
  const tailGlow = night ? 0.65 : 0.35
  for (const side of [-1, 1]) {
    const tx = carCx + side * cw * 6.2
    const ty = hd.Y(21.1)
    glow(tx, ty, cw * 2.6, ch * 0.7, tail, tailGlow)
    hd.blob(tx, ty, cw * 2.1, ch * 0.42, tail)
    hd.blob(tx - side * cw * 0.6, ty - ch * 0.12, cw * 1.2, ch * 0.18, hdHex("#ffd0c8"))
  }
  hd.rect(carCx - cw * 2.4, hd.Y(22), carCx + cw * 2.4, hd.Y(22.6), hdHex(c.plate))
  hd.rect(carCx - cw * 9, hd.Y(22.9), carCx + cw * 9, hd.Y(23.3), hdDarken(body, 0.75))
  const exhaustLit = racingExhaust(elapsed)
  for (const side of [-1, 1]) {
    const ex = carCx + side * cw * 5.4
    const ey = hd.Y(23.15)
    hd.disk(ex, ey, Math.max(1.5, cw * 0.5), hdHex("#c8ccd4"))
    hd.disk(ex, ey, Math.max(1, cw * 0.28), hdHex("#14161a"))
    if (exhaustLit) {
      glow(ex, ey + ch * 0.35, cw * 0.9, ch * 0.5, hdHex(c.flame), night ? 0.7 : 0.4)
      hd.blob(ex, ey + ch * 0.4, cw * 0.4, ch * 0.35, hdHex(c.flame))
    }
  }
  // Speed streaks hugging the road surface beside the car.
  const streak = night ? hdHex(c.lamp) : hdHex("#ffffff")
  for (let i = 0; i < 8; i++) {
    const t = (((i / 8 + phase * 2) % 1) + 1) % 1
    const sy = 14 + t * 9
    const side = i % 2 === 0 ? -1 : 1
    const sx = RACING_CENTER_X + side * (racingRoadHalf(sy) - 1.5 - hash(i, 3) * 3)
    blend(Math.round(hd.X(sx)), Math.round(hd.Y(sy)), streak, 0.35 + t * 0.4)
    blend(Math.round(hd.X(sx)), Math.round(hd.Y(sy + 0.3)), streak, 0.25 + t * 0.3)
  }
  return hd.pixels
}

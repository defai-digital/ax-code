import {
  TAEGEUK_BORDER,
  TAEGEUK_CENTER,
  TAEGEUK_COLUMNS,
  TAEGEUK_GROUND_TOP,
  TAEGEUK_PYLONS,
  TAEGEUK_RADIUS,
  TAEGEUK_ROWS,
  TAEGEUK_TICKS,
  TAEGEUK_COLORS,
  taegeukConfetti,
  taegeukDots,
  taegeukFrame,
  taegeukRed,
  taegeukSkyRgb,
  taegeukSparks,
  taegeukWave,
  type TaegeukStyle,
} from "./taegeuk-view-model"
import { createHdCanvas, hdHex } from "./scene-hd"

/**
 * Freeform HD renderer. A circular taegeuk of two commas, orbiting eyes,
 * sparks, confetti disks, trigrams, and the crowd wave come from the shared
 * scene model. Pure and deterministic: everything derives from `elapsedMs`.
 */
export function renderTaegeukPixels(width: number, height: number, style: TaegeukStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, TAEGEUK_COLUMNS, TAEGEUK_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const c = TAEGEUK_COLORS[style]
  const ring = hdHex(c.ring)
  const red = hdHex(c.red)
  const blue = hdHex(c.blue)
  const frame = taegeukFrame(elapsedMs)
  const border = TAEGEUK_BORDER

  hd.sky((t) => taegeukSkyRgb(style, t))
  hd.rect(hd.X(border.x0), hd.Y(border.y0), hd.X(border.x1 + 1), hd.Y(border.y0 + 0.28), ring)
  hd.rect(hd.X(border.x0), hd.Y(border.y1 + 0.72), hd.X(border.x1 + 1), hd.Y(border.y1 + 1), ring)
  hd.rect(hd.X(border.x0), hd.Y(border.y0), hd.X(border.x0 + 0.28), hd.Y(border.y1 + 1), ring)
  hd.rect(hd.X(border.x1 + 0.72), hd.Y(border.y0), hd.X(border.x1 + 1), hd.Y(border.y1 + 1), ring)

  const ray = hdHex(c.ray)
  for (let k = 0; k < TAEGEUK_TICKS; k++) {
    const angle = (2 * Math.PI * k) / TAEGEUK_TICKS
    hd.disk(
      hd.X(TAEGEUK_CENTER.x + Math.cos(angle) * (TAEGEUK_RADIUS + 1.5)),
      hd.Y(TAEGEUK_CENTER.y + 0.5 + Math.sin(angle) * (TAEGEUK_RADIUS + 1.5)),
      Math.max(1.3, Math.min(hd.cw, hd.ch) * 0.14),
      ray,
    )
  }

  const cx = hd.X(TAEGEUK_CENTER.x)
  const cy = hd.Y(TAEGEUK_CENTER.y + 0.5)
  const radius = TAEGEUK_RADIUS * Math.min(hd.cw, hd.ch)
  const ringWidth = Math.max(1.2, Math.min(hd.cw, hd.ch) * 0.4)
  const rot = (frame * Math.PI) / 2
  const inner = radius / 2
  const xa = Math.max(0, Math.floor(cx - radius))
  const xb = Math.min(hd.w - 1, Math.ceil(cx + radius))
  const ya = Math.max(0, Math.floor(cy - radius))
  const yb = Math.min(hd.h - 1, Math.ceil(cy + radius))
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const dist = Math.hypot(dx, dy)
      if (dist > radius) continue
      if (dist > radius - ringWidth) {
        hd.set(x, y, ring)
        continue
      }
      const px = dx * Math.cos(rot) + dy * Math.sin(rot)
      const py = -dx * Math.sin(rot) + dy * Math.cos(rot)
      let yang = taegeukRed(Math.atan2(dy, dx), frame)
      if (px * px + (py - inner) * (py - inner) <= inner * inner) yang = false
      if (px * px + (py + inner) * (py + inner) <= inner * inner) yang = true
      hd.set(x, y, yang ? red : blue)
    }
  }
  for (const dot of taegeukDots(elapsedMs)) {
    hd.disk(hd.X(dot.x + 0.5), hd.Y(dot.y + 0.5), Math.max(2.4, Math.min(hd.cw, hd.ch) * 0.42), dot.red ? red : blue)
  }
  const spark = hdHex(c.spark)
  for (const star of taegeukSparks(elapsedMs)) {
    hd.disk(hd.X(star.x + 0.5), hd.Y(star.y + 0.5), Math.max(1.8, Math.min(hd.cw, hd.ch) * 0.2), spark)
  }

  const trigram = hdHex(c.trigram)
  const bar = (x: number, y: number, broken: boolean) => {
    if (broken) {
      hd.rect(hd.X(x), hd.Y(y + 0.28), hd.X(x + 1.15), hd.Y(y + 0.72), trigram)
      hd.rect(hd.X(x + 1.85), hd.Y(y + 0.28), hd.X(x + 3), hd.Y(y + 0.72), trigram)
    } else {
      hd.rect(hd.X(x), hd.Y(y + 0.28), hd.X(x + 3), hd.Y(y + 0.72), trigram)
    }
  }
  for (const y of [3, 4, 5]) bar(24, y, false)
  for (const y of [3, 4, 5]) bar(49, y, true)
  bar(24, 16, false)
  bar(24, 17, true)
  bar(24, 18, false)
  bar(49, 16, true)
  bar(49, 17, false)
  bar(49, 18, true)

  for (const bit of taegeukConfetti(elapsedMs)) {
    hd.disk(hd.X(bit.x + 0.5), hd.Y(bit.y + 0.5), Math.max(1.5, Math.min(hd.cw, hd.ch) * 0.16), bit.red ? red : blue)
  }
  const flood = hdHex(c.flood)
  for (const pylon of TAEGEUK_PYLONS) {
    hd.disk(hd.X(pylon + 0.5), hd.Y(14.45), Math.max(2.2, hd.cw * 0.28), flood)
    hd.rect(hd.X(pylon), hd.Y(15), hd.X(pylon + 1), hd.Y(20), ring)
  }
  hd.rect(0, hd.Y(TAEGEUK_GROUND_TOP), hd.w, hd.h, hdHex(c.ground))
  const crowd = hdHex(c.crowd)
  const wave = taegeukWave(elapsedMs)
  for (let x = 0; x < TAEGEUK_COLUMNS; x++) {
    if ((x + wave) % 4 === 0) {
      hd.disk(hd.X(x + 0.5), hd.Y(TAEGEUK_GROUND_TOP + 0.5), Math.max(1.6, hd.cw * 0.18), crowd)
    }
    if ((x + wave + 2) % 4 === 0) {
      hd.disk(hd.X(x + 0.5), hd.Y(TAEGEUK_GROUND_TOP + 1.5), Math.max(1.6, hd.cw * 0.18), crowd)
    }
  }
  return hd.pixels
}
